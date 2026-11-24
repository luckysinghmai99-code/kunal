'use strict';

// ENGINE 04 — Backend & Database.
// For projects that need accounts, bookings, commerce or payments, generates a
// dependency-free Node server (static files + JSON API) and SQL migrations
// derived from the spec's entities. Projects without backend needs ship as
// static files only.

function entitiesFor(spec) {
  const entities = [{ name: 'submissions', fields: [['id', 'TEXT PRIMARY KEY'], ['name', 'TEXT'], ['email', 'TEXT'], ['message', 'TEXT'], ['created_at', 'TEXT NOT NULL']] }];
  if (spec.auth) {
    entities.push({ name: 'users', fields: [['id', 'TEXT PRIMARY KEY'], ['email', 'TEXT UNIQUE NOT NULL'], ['password_hash', 'TEXT NOT NULL'], ['name', 'TEXT'], ['created_at', 'TEXT NOT NULL']] });
  }
  if (spec.category === 'ecommerce' || spec.pages.includes('products')) {
    entities.push({ name: 'products', fields: [['id', 'TEXT PRIMARY KEY'], ['title', 'TEXT NOT NULL'], ['price_inr', 'INTEGER NOT NULL'], ['stock', 'INTEGER NOT NULL DEFAULT 0']] });
  }
  if (spec.pages.includes('booking') || spec.category === 'railway-booking' || spec.category === 'travel') {
    entities.push({ name: 'bookings', fields: [['id', 'TEXT PRIMARY KEY'], ['customer_email', 'TEXT NOT NULL'], ['details', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'pending'"], ['created_at', 'TEXT NOT NULL']] });
  }
  if (spec.integrations.includes('razorpay')) {
    entities.push({ name: 'payments', fields: [['id', 'TEXT PRIMARY KEY'], ['order_ref', 'TEXT'], ['amount_paise', 'INTEGER NOT NULL'], ['status', "TEXT NOT NULL DEFAULT 'created'"], ['created_at', 'TEXT NOT NULL']] });
  }
  return entities;
}

function schemaSql(entities) {
  return entities
    .map((e) => `CREATE TABLE IF NOT EXISTS ${e.name} (\n  ${e.fields.map(([n, t]) => `${n} ${t}`).join(',\n  ')}\n);`)
    .join('\n\n') + '\n';
}

function serverJs(spec) {
  return [
    "'use strict';",
    '// Generated backend: static site + JSON API. No external dependencies.',
    "const http = require('http');",
    "const fs = require('fs');",
    "const path = require('path');",
    "const crypto = require('crypto');",
    '',
    'const PORT = Number(process.env.PORT || 3000);',
    "const ROOT = path.join(__dirname, '..');",
    "const DATA_FILE = path.join(ROOT, 'data', 'submissions.json');",
    "const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };",
    '',
    'function readStore() {',
    "  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return []; }",
    '}',
    'function writeStore(rows) {',
    '  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });',
    '  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));',
    '}',
    '',
    'function send(res, status, body, type) {',
    "  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });",
    '  res.end(typeof body === \'string\' ? body : JSON.stringify(body));',
    '}',
    '',
    'const server = http.createServer((req, res) => {',
    "  const url = new URL(req.url, 'http://localhost');",
    "  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, app: " + JSON.stringify(spec.appName) + ' });',
    "  if (req.method === 'POST' && url.pathname === '/api/contact') {",
    "    let body = '';",
    "    req.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });",
    "    req.on('end', () => {",
    '      let data;',
    "      try { data = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { error: 'Invalid JSON' }); }",
    "      const name = String(data.name || '').slice(0, 120);",
    "      const email = String(data.email || '').slice(0, 200);",
    "      const message = String(data.message || '').slice(0, 5000);",
    "      if (!email.includes('@')) return send(res, 422, { error: 'A valid email is required' });",
    '      const rows = readStore();',
    "      rows.push({ id: crypto.randomUUID(), name, email, message, created_at: new Date().toISOString() });",
    '      writeStore(rows);',
    '      send(res, 201, { ok: true });',
    '    });',
    '    return;',
    '  }',
    "  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });",
    "  let file = path.normalize(path.join(ROOT, 'public', decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname)));",
    "  if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'Forbidden' });",
    '  fs.readFile(file, (err, buf) => {',
    "    if (err) return send(res, 404, { error: 'Not found' });",
    "    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');",
    '  });',
    '});',
    '',
    'if (require.main === module) {',
    "  server.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));",
    '}',
    '',
    'module.exports = { server };',
    '',
  ].join('\n');
}

function generate(spec) {
  if (!spec.backend) return {};
  const entities = entitiesFor(spec);
  return {
    'server/server.js': serverJs(spec),
    'db/migrations/001_init.sql': schemaSql(entities),
    'db/schema.json': JSON.stringify({ entities: entities.map((e) => e.name) }, null, 2) + '\n',
    'package.json': JSON.stringify({
      name: spec.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      version: '1.0.0',
      private: true,
      scripts: { start: 'node server/server.js', test: 'node --test' },
      engines: { node: '>=18' },
    }, null, 2) + '\n',
    '.env.example': 'PORT=3000\nNODE_ENV=development\n# Add provider keys here. Never commit real values.\n',
  };
}

module.exports = { generate, entitiesFor, schemaSql };
