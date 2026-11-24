'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { tempConfig } = require('./helpers');

async function start() {
  const config = tempConfig();
  const { server, services } = createApp(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, services, config };
}

function client(base) {
  let cookie = '';
  async function call(method, path, body, opts = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = opts.contentType || 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const set = res.headers.get('set-cookie');
    if (set && set.startsWith('rd_session=')) cookie = set.split(';')[0];
    if (set && set.includes('Max-Age=0')) cookie = '';
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
  return { call, get cookie() { return cookie; } };
}

test('health, packages and security headers', async () => {
  const { server, base } = await start();
  try {
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
    const pk = await (await fetch(base + '/api/packages')).json();
    assert.equal(pk.packages.length, 5);
    assert.equal(pk.paymentsConfigured, false);
  } finally { server.close(); }
});

test('auth: signup sets an HttpOnly session cookie and grants 50 tokens', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    const su = await c.call('POST', '/api/auth/signup', { email: 'new@example.com', password: 'longpassword', name: 'New' });
    assert.equal(su.status, 201);
    assert.match(c.cookie, /^rd_session=/);
    const cookieHeader = su.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Lax/);
    const w = await c.call('GET', '/api/wallet');
    assert.equal(w.data.total, 50);
    assert.equal(w.data.starterGranted, true);
  } finally { server.close(); }
});

test('auth: protected routes refuse anonymous callers; session survives a fresh request', async () => {
  const { server, base } = await start();
  try {
    const anon = client(base);
    assert.equal((await anon.call('GET', '/api/projects')).status, 401);
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'keep@example.com', password: 'longpassword' });
    assert.equal((await c.call('GET', '/api/me')).data.user.email, 'keep@example.com');
    await c.call('POST', '/api/auth/logout', {});
    assert.equal((await c.call('GET', '/api/me')).status, 401);
  } finally { server.close(); }
});

test('CSRF: state-changing requests must be JSON', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'csrf@example.com', password: 'longpassword' });
    const res = await c.call('POST', '/api/projects', 'name=evil', { contentType: 'text/plain' });
    assert.equal(res.status, 415);
  } finally { server.close(); }
});

test('admin routes: non-admins get 403, admins get stats', async () => {
  const { server, base } = await start();
  try {
    const user = client(base);
    await user.call('POST', '/api/auth/signup', { email: 'plain@example.com', password: 'longpassword' });
    assert.equal((await user.call('GET', '/api/admin/stats')).status, 403);
    const admin = client(base);
    await admin.call('POST', '/api/auth/signup', { email: 'admin@example.com', password: 'longpassword' });
    const stats = await admin.call('GET', '/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.data.users, 2);
    assert.equal(stats.data.engineHealth.length, 6);
  } finally { server.close(); }
});

test('projects: create, rename, duplicate, delete, and ownership isolation', async () => {
  const { server, base } = await start();
  try {
    const a = client(base);
    await a.call('POST', '/api/auth/signup', { email: 'owner-a@example.com', password: 'longpassword' });
    const p = await a.call('POST', '/api/projects', { name: 'Store', description: 'shop' });
    assert.equal(p.status, 201);
    const id = p.data.id;
    assert.equal((await a.call('PATCH', `/api/projects/${id}`, { name: 'Better store' })).data.name, 'Better store');
    assert.equal((await a.call('POST', `/api/projects/${id}/duplicate`, {})).status, 201);
    assert.equal((await a.call('GET', '/api/projects')).data.projects.length, 2);

    const b = client(base);
    await b.call('POST', '/api/auth/signup', { email: 'owner-b@example.com', password: 'longpassword' });
    assert.equal((await b.call('GET', `/api/projects/${id}`)).status, 404, 'other users cannot read it');
    assert.equal((await b.call('DELETE', `/api/projects/${id}`)).status, 404, 'other users cannot delete it');
    assert.equal((await a.call('DELETE', `/api/projects/${id}`)).status, 200);
    assert.equal((await a.call('GET', `/api/projects/${id}`)).status, 404);
  } finally { server.close(); }
});

test('estimate is read-only; generation charges the wallet and produces files', async () => {
  const { server, base, services } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'gen@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Portfolio' });
    const prompt = 'Create a portfolio website with about and contact pages in teal';

    const est = await c.call('POST', `/api/projects/${proj.id}/estimate`, { prompt });
    assert.equal(est.status, 200);
    assert.ok(est.data.estimatedTokens > 0);
    assert.equal((await c.call('GET', '/api/wallet')).data.reserved, 0, 'estimate must not reserve');

    const gen = await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt });
    assert.equal(gen.status, 201, JSON.stringify(gen.data));
    assert.equal(gen.data.job.status, 'completed');
    assert.equal(gen.data.job.checks.passed, true);

    const wallet = (await c.call('GET', '/api/wallet')).data;
    assert.equal(wallet.reserved, 0, 'reservation settled');
    assert.equal(wallet.used, gen.data.job.chargedTokens);
    assert.equal(wallet.total, 50 - gen.data.job.chargedTokens);

    const files = await c.call('GET', `/api/projects/${proj.id}/files`);
    assert.ok(files.data.files.includes('index.html'));
    assert.ok(files.data.files.includes('README.md'));
  } finally { server.close(); }
});

test('generation is refused with 402 when the wallet cannot cover the estimate', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'broke@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Big' });
    const prompt = 'Build a Netflix-inspired streaming app with home, login, signup, profile, dashboard, pricing, faq and gallery pages, hero banners, card grid, search bar, stats and table, with animations, razorpay payments, 6 images, and an email notification flow and personalized recommendations across devices.';
    const res = await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt });
    assert.equal(res.status, 402);
    assert.equal((await c.call('GET', '/api/wallet')).data.used, 0);
  } finally { server.close(); }
});

test('file editing validates paths and preview is sandboxed', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'files@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Site' });
    await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt: 'Create a landing page in green' });
    assert.equal((await c.call('PUT', `/api/projects/${proj.id}/file`, { path: '../etc/passwd', content: 'x' })).status, 422);
    assert.equal((await c.call('GET', `/api/projects/${proj.id}/file?path=..%2Fsecret`)).status, 422);
    const ok = await c.call('PUT', `/api/projects/${proj.id}/file`, { path: 'assets/styles.css', content: 'body{color:red}' });
    assert.equal(ok.status, 200);
    const preview = await c.call('GET', `/api/projects/${proj.id}/preview/index.html`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /^sandbox/);
  } finally { server.close(); }
});

test('versions: edits create snapshots and restore brings back earlier files', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'ver@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Versioned' });
    await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt: 'Create a landing page in green' });
    await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt: 'Add a pricing page' });
    const detail = (await c.call('GET', `/api/projects/${proj.id}`)).data;
    assert.ok(detail.versions.length >= 1);
    const v = detail.versions[detail.versions.length - 1].number;
    const res = await c.call('POST', `/api/projects/${proj.id}/versions/${v}/restore`, {});
    assert.equal(res.status, 200);
  } finally { server.close(); }
});

test('ZIP export downloads a real archive for a generated project', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'zip@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Shop Site' });
    await c.call('POST', `/api/projects/${proj.id}/generate`, { prompt: 'Create an ecommerce store with checkout and login' });
    const res = await c.call('GET', `/api/projects/${proj.id}/export`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), /shop-site\.zip/);
    const buf = Buffer.from(res.data);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
    assert.ok(buf.includes(Buffer.from('server/server.js')), 'backend included');
  } finally { server.close(); }
});

test('publish is honest: 503 without a deployment provider', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'pub@example.com', password: 'longpassword' });
    const { data: proj } = await c.call('POST', '/api/projects', { name: 'Pub' });
    const res = await c.call('POST', `/api/projects/${proj.id}/publish`, {});
    assert.equal(res.status, 503);
  } finally { server.close(); }
});

test('payments endpoints refuse to fake success without Razorpay keys', async () => {
  const { server, base } = await start();
  try {
    const c = client(base);
    await c.call('POST', '/api/auth/signup', { email: 'pay@example.com', password: 'longpassword' });
    assert.equal((await c.call('POST', '/api/payments/orders', { packageId: 'basic' })).status, 503);
    assert.equal((await c.call('GET', '/api/wallet')).data.total, 50);
  } finally { server.close(); }
});

test('contact form validates input and stores valid messages', async () => {
  const { server, base, services } = await start();
  try {
    const c = client(base);
    assert.equal((await c.call('POST', '/api/contact', { email: 'bad', message: 'hello there' })).status, 422);
    assert.equal((await c.call('POST', '/api/contact', { email: 'ok@example.com', message: 'hello there' })).status, 201);
    assert.equal(services.store.read((d) => d.contacts.length), 1);
  } finally { server.close(); }
});

test('static pages: clean URLs resolve, traversal is blocked', async () => {
  const { server, base } = await start();
  try {
    assert.equal((await fetch(base + '/pricing')).status, 200);
    assert.equal((await fetch(base + '/dashboard')).status, 200);
    assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
    assert.equal((await fetch(base + '/api/nope')).status, 404);
  } finally { server.close(); }
});
