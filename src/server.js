'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { Store } = require('./lib/store');
const { HttpError, sendJson, sendRaw, readBody, readJson, parseCookies } = require('./lib/http');
const { AuthService } = require('./services/auth');
const { ProjectService, owned, filesOf } = require('./services/projects');
const { GenerationService } = require('./services/generation');
const { PaymentService } = require('./services/payments');
const { AdminService } = require('./services/admin');
const { packageProject } = require('./engines/06-export');
const { buildRoutes, matchRoute } = require('./routes/api');

const SESSION_COOKIE = 'rd_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

function securityHeaders(res, config) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://api.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function cookieHeader(token, maxAge, config) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader(config) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;
}

function createServices(config, options = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const outboxFile = path.join(config.dataDir, 'outbox.log');
  const outbox = (msg) => fs.appendFileSync(outboxFile, JSON.stringify({ ...msg, at: new Date().toISOString() }) + '\n');
  const services = {
    config,
    store,
    auth: new AuthService(store, config, { outbox }),
    projects: new ProjectService(store),
    generation: new GenerationService(store),
    payments: new PaymentService(store, config, options),
    admin: new AdminService(store),
    exporter: {
      exportProject(userId, projectId) {
        const { project, files, checks } = store.read((d) => {
          const p = owned(d, userId, projectId);
          const lastJob = d.jobs.filter((j) => j.projectId === projectId && j.status === 'completed').pop();
          return { project: p, files: filesOf(d, projectId), checks: lastJob ? lastJob.checks : null };
        });
        if (!project.design || !project.spec) throw new HttpError(409, 'Generate the project before exporting');
        const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
        const { zip, excluded } = packageProject({ design: project.design, spec: project.spec, projectFiles: files, checks: checks || { passed: false } });
        return { zip, slug, excluded };
      },
    },
  };
  return services;
}

function createApp(config = loadConfig(), options = {}) {
  const services = createServices(config, options);
  const routes = buildRoutes(services);

  async function handleApi(req, res, url) {
    const { route, params, pathMatched } = matchRoute(routes, req.method, url.pathname);
    if (!route) {
      if (pathMatched) throw new HttpError(405, 'Method not allowed');
      throw new HttpError(404, 'Not found');
    }

    const cookies = parseCookies(req.headers.cookie);
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    const token = cookies[SESSION_COOKIE] || bearer;
    const user = route.auth ? services.auth.userForToken(token) : (token ? services.auth.userForToken(token) : null);
    if (route.auth && !user) throw new HttpError(401, 'Please sign in');
    if (route.admin && user.role !== 'admin') throw new HttpError(403, 'Admin access required');

    let body = {};
    let raw = null;
    if (route.raw) {
      raw = await readBody(req);
    } else if (MUTATING.has(req.method) && req.method !== 'DELETE') {
      // CSRF hardening: state-changing API calls must send JSON. Cross-site HTML forms cannot.
      const type = String(req.headers['content-type'] || '');
      if (!type.startsWith('application/json')) throw new HttpError(415, 'Send requests with Content-Type: application/json');
      body = await readJson(req);
    }

    const ctx = {
      params, query: url.searchParams, body, raw, user, token,
      headers: req.headers,
      ip: req.socket.remoteAddress || 'unknown',
    };
    const result = (await route.handler(ctx)) || {};

    if (result.raw) {
      const headers = { 'Content-Type': result.type, 'Content-Length': result.raw.length, ...(result.headers || {}) };
      if (result.cookie) headers['Set-Cookie'] = cookieHeader(result.cookie, result.maxAge || 2592000, config);
      res.writeHead(200, headers);
      res.end(result.raw);
      return;
    }
    const headers = {};
    if (result.cookie) headers['Set-Cookie'] = cookieHeader(result.cookie, result.maxAgeSeconds || 2592000, config);
    if (result.clearCookie) headers['Set-Cookie'] = clearCookieHeader(config);
    if (result.body === undefined && !result.status) {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    sendJson(res, result.status || 200, result.body ?? {}, headers);
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    let file = path.normalize(path.join(config.publicDir, pathname));
    if (!file.startsWith(config.publicDir + path.sep)) throw new HttpError(403, 'Forbidden');
    if (!path.extname(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new HttpError(404, 'Not found');
    const type = STATIC_TYPES[path.extname(file)] || 'application/octet-stream';
    const cache = path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300';
    sendRaw(res, 200, fs.readFileSync(file), { 'Content-Type': type, 'Cache-Control': cache });
  }

  async function handle(req, res) {
    securityHeaders(res, config);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      const status = err.status && err.status >= 400 ? err.status : 500;
      if (status === 500) console.error('[error]', err);
      if (res.headersSent) return res.end();
      const body = { error: status >= 500 ? 'Something went wrong. Please try again.' : err.message };
      if (err.details) body.details = err.details;
      sendJson(res, status, body);
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, services };
}

if (require.main === module) {
  const config = loadConfig();
  const { server } = createApp(config);
  server.listen(config.port, () => {
    console.log(`RAILDESIGN AI listening on http://localhost:${config.port}`);
  });
}

module.exports = { createApp, createServices };
