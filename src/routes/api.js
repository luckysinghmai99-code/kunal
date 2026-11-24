'use strict';

const { HttpError } = require('../lib/http');
const { newId } = require('../lib/crypto');
const { viewFor } = require('../services/wallet');
const { validFilePath } = require('../services/projects');

function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })
    .replace(/\*$/, '(.*)');
  if (pattern.endsWith('*')) keys.push('rest');
  return { re: new RegExp(`^${source}$`), keys };
}

const PREVIEW_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const extOf = (p) => { const i = p.lastIndexOf('.'); return i === -1 ? '' : p.slice(i); };

function buildRoutes(s) {
  const routes = [];
  const add = (method, pattern, opts, handler) => routes.push({ method, pattern, ...compile(pattern), ...opts, handler });
  const pub = (m, p, h, o = {}) => add(m, p, { auth: false, ...o }, h);
  const authed = (m, p, h, o = {}) => add(m, p, { auth: true, ...o }, h);
  const admin = (m, p, h) => add(m, p, { auth: true, admin: true }, h);

  // ---- Public
  pub('GET', '/api/health', () => ({ body: { ok: true, service: 'raildesign-ai', time: new Date().toISOString() } }));
  pub('GET', '/api/packages', () => ({ body: { packages: s.payments.listPackages(), currency: s.config.currency, paymentsConfigured: s.payments.configured } }));

  pub('POST', '/api/auth/signup', async ({ body }) => {
    const user = s.auth.signup(body);
    const session = s.auth.login({ email: body.email, password: body.password });
    return { status: 201, body: { user, maxAgeSeconds: session.maxAgeSeconds }, cookie: session.token };
  });
  pub('POST', '/api/auth/login', ({ body, ip }) => {
    const session = s.auth.login({ email: body.email, password: body.password, ip });
    return { body: { user: session.user }, cookie: session.token };
  });
  pub('POST', '/api/auth/logout', ({ token }) => { s.auth.logout(token); return { body: { ok: true }, clearCookie: true }; });
  pub('POST', '/api/auth/forgot', ({ body }) => ({ body: s.auth.requestPasswordReset(body.email) }));
  pub('POST', '/api/auth/reset', ({ body }) => ({ body: s.auth.resetPassword(body) }));

  pub('POST', '/api/contact', ({ body }) => {
    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'A valid email is required');
    if (message.length < 5) throw new HttpError(422, 'Message must be at least 5 characters');
    s.store.tx((d) => d.contacts.push({ id: newId('cnt'), name, email, message, createdAt: new Date().toISOString() }));
    return { status: 201, body: { ok: true, message: 'Thanks. We will reply soon.' } };
  });

  pub('POST', '/api/webhooks/razorpay', ({ raw, headers }) => {
    const result = s.payments.handleWebhook(raw, headers['x-razorpay-signature']);
    return { body: result };
  }, { raw: true });

  // ---- Account
  authed('GET', '/api/me', ({ user }) => ({ body: { user: s.auth.getProfile(user.id) } }));
  authed('PUT', '/api/me', ({ user, body }) => ({ body: { user: s.auth.updateProfile(user.id, body) } }));
  authed('PUT', '/api/me/password', ({ user, body }) => ({ body: s.auth.changePassword(user.id, body) }));

  // ---- Wallet and payments
  authed('GET', '/api/wallet', ({ user }) => ({ body: s.store.read((d) => viewFor(d, user.id)) }));
  authed('GET', '/api/payments/history', ({ user }) => ({ body: s.payments.paymentHistory(user.id) }));
  authed('POST', '/api/payments/orders', async ({ user, body }) => ({ body: await s.payments.createOrder(user.id, String(body.packageId || '')) }));
  authed('POST', '/api/payments/confirm', ({ user, body }) => ({ body: s.payments.confirmPayment(user.id, body) }));

  // ---- Projects
  authed('GET', '/api/projects', ({ user }) => ({ body: { projects: s.projects.list(user.id) } }));
  authed('POST', '/api/projects', ({ user, body }) => ({ status: 201, body: s.projects.create(user.id, body) }));
  authed('GET', '/api/projects/:id', ({ user, params }) => ({ body: s.projects.get(user.id, params.id) }));
  authed('PATCH', '/api/projects/:id', ({ user, params, body }) => ({ body: s.projects.update(user.id, params.id, body) }));
  authed('DELETE', '/api/projects/:id', ({ user, params }) => ({ body: s.projects.remove(user.id, params.id) }));
  authed('POST', '/api/projects/:id/duplicate', ({ user, params }) => ({ status: 201, body: s.projects.duplicate(user.id, params.id) }));

  authed('POST', '/api/projects/:id/estimate', ({ user, params, body }) => ({ body: s.generation.estimate(user.id, params.id, String(body.prompt || '')) }));
  authed('POST', '/api/projects/:id/generate', async ({ user, params, body }) => {
    const prompt = String(body.prompt || '');
    if (prompt.trim().length < 3) throw new HttpError(422, 'Describe what you want to build');
    const job = s.generation.run(user.id, params.id, prompt);
    return { status: job.status === 'completed' ? 201 : 202, body: { job } };
  });
  authed('GET', '/api/projects/:id/jobs', ({ user, params }) => ({ body: { jobs: s.generation.listJobs(user.id, params.id) } }));
  authed('GET', '/api/jobs/:id', ({ user, params }) => ({ body: { job: s.generation.getJob(user.id, params.id) } }));
  authed('POST', '/api/jobs/:id/resume', ({ user, params }) => ({ body: { job: s.generation.resume(user.id, params.id) } }));

  authed('GET', '/api/projects/:id/files', ({ user, params }) => ({ body: { files: Object.keys(s.projects.files(user.id, params.id)).sort() } }));
  authed('GET', '/api/projects/:id/file', ({ user, params, query }) => {
    const path = query.get('path');
    if (!validFilePath(path)) throw new HttpError(422, 'Invalid file path');
    return { body: { path, content: s.projects.readFile(user.id, params.id, path) } };
  });
  authed('PUT', '/api/projects/:id/file', ({ user, params, body }) => ({ body: s.projects.saveFile(user.id, params.id, body.path, body.content) }));
  authed('POST', '/api/projects/:id/versions/:n/restore', ({ user, params }) => ({ body: s.projects.restoreVersion(user.id, params.id, params.n) }));

  authed('GET', '/api/projects/:id/preview/*', ({ user, params }) => {
    const rel = params.rest || 'index.html';
    const path = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
    if (!validFilePath(path)) throw new HttpError(422, 'Invalid preview path');
    const files = s.projects.files(user.id, params.id);
    const content = files[path];
    if (content === undefined) throw new HttpError(404, 'Preview file not found');
    return {
      raw: Buffer.from(content, 'utf8'),
      type: PREVIEW_TYPES[extOf(path)] || 'application/octet-stream',
      headers: {
        'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'self' 'unsafe-inline' data:",
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    };
  }, { preview: true });

  authed('GET', '/api/projects/:id/export', ({ user, params }) => {
    s.projects.get(user.id, params.id);
    const job = s.generation.listJobs(user.id, params.id).find((j) => j.status === 'completed');
    if (!job) throw new HttpError(409, 'Generate the project before exporting');
    const exported = s.exporter.exportProject(user.id, params.id);
    const slug = exported.slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    return {
      raw: exported.zip,
      type: 'application/zip',
      headers: { 'Content-Disposition': `attachment; filename="${slug}.zip"` },
    };
  });

  authed('POST', '/api/projects/:id/publish', () => {
    if (!s.config.deploy.provider || !s.config.deploy.token) {
      throw new HttpError(503, 'Publishing needs a deployment provider. Set DEPLOY_PROVIDER and DEPLOY_PROVIDER_TOKEN.');
    }
    throw new HttpError(501, 'Deployment adapter is not implemented for this provider yet. Use the ZIP export for now.');
  });

  // ---- Admin
  admin('GET', '/api/admin/stats', () => ({ body: s.admin.stats() }));
  admin('GET', '/api/admin/users', () => ({ body: { users: s.admin.listUsers() } }));
  admin('PUT', '/api/admin/packages', ({ body }) => ({ body: { packages: s.admin.setPackages(body.packages) } }));
  admin('POST', '/api/admin/users/:id/grant', ({ user, params, body }) => ({ body: s.admin.grantTokens(user.id, params.id, body) }));

  return routes;
}

function matchRoute(routes, method, pathname) {
  let pathMatched = false;
  for (const route of routes) {
    const m = route.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params = {};
    route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] || ''); });
    return { route, params };
  }
  return { route: null, pathMatched };
}

module.exports = { buildRoutes, matchRoute };
