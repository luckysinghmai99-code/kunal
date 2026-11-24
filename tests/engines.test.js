'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzePrompt, detectLanguage } = require('../src/engines/01-prompt');
const design = require('../src/engines/02-design');
const frontend = require('../src/engines/03-frontend');
const backend = require('../src/engines/04-backend');
const testing = require('../src/engines/05-testing');
const exporter = require('../src/engines/06-export');
const orchestrator = require('../src/engines');
const { estimate } = require('../src/services/pricing');
const { buildZip, crc32 } = require('../src/lib/zip');

function buildAll(prompt) {
  const spec = orchestrator.plan(prompt, { projectName: 'Test Site' });
  const d = design.generate(spec);
  const files = { ...frontend.generate(d, spec), ...backend.generate(spec) };
  return { spec, d, files };
}

test('Engine 01 understands English and Hindi briefs', () => {
  const en = analyzePrompt('Create an ecommerce store with products, cart and checkout in blue');
  assert.equal(en.category, 'ecommerce');
  assert.ok(en.pages.includes('products') && en.pages.includes('cart') && en.pages.includes('checkout'));
  assert.equal(en.colors.primary, '#2563eb');
  assert.equal(en.language, 'en');

  const hi = analyzePrompt('एक रेलवे टिकट बुकिंग पोर्टल बनाओ, लॉगिन और डैशबोर्ड के साथ');
  assert.equal(hi.category, 'railway-booking');
  assert.ok(hi.pages.includes('login') && hi.pages.includes('dashboard'));
  assert.equal(hi.language, 'hi');
  assert.equal(detectLanguage('make a page दुकान'), 'mixed');
});

test('Engine 01 handles follow-up instructions without losing context', () => {
  const first = analyzePrompt('Create a SaaS landing page with pricing');
  const second = analyzePrompt('Add a gallery page', first);
  assert.equal(second.isRevision, true);
  assert.ok(second.pages.includes('pricing'), 'keeps earlier pages');
  assert.ok(second.pages.includes('gallery'), 'adds the new page');
});

test('Engine 01 rejects empty and oversized prompts', () => {
  assert.throws(() => analyzePrompt('hi'), /too short/);
  assert.throws(() => analyzePrompt('x'.repeat(20001)), /too long/);
});

test('Pricing: small landing page is cheap, complex app costs significantly more, starter covers ~4 small outputs', () => {
  const small = estimate(analyzePrompt('Create a simple landing page'));
  const medium = estimate(analyzePrompt('Create a business website with about, services, contact and a gallery, with 3 images'));
  const complex = estimate(analyzePrompt(
    'Build a Netflix-inspired streaming app with home, login, signup, profile, dashboard, pricing, faq and gallery pages, ' +
    'hero banners, card grid, search bar, stats and table, with animations, razorpay payments, 6 images, and an email notification flow. ' +
    'Users can browse movies, watch trailers, manage subscriptions and see personalized recommendations across devices.'
  ));
  assert.ok(small.tokens <= 12, `small=${small.tokens}`);
  assert.ok(medium.tokens > small.tokens * 2, `medium=${medium.tokens}`);
  assert.ok(complex.tokens > medium.tokens * 2, `complex=${complex.tokens}`);
  assert.ok(small.tokens * 4 <= 50, 'starter allowance supports four small outputs');
});

test('Pricing: revisions cost less than a fresh build', () => {
  const spec = analyzePrompt('Create a portfolio website');
  const fresh = estimate(spec);
  const revision = estimate(spec, { revision: true });
  assert.ok(revision.tokens < fresh.tokens);
});

test('Engine 02 builds a palette and navigation from the spec', () => {
  const spec = analyzePrompt('Create a dark SaaS site in purple', null);
  const d = design.generate(spec);
  assert.equal(d.mode, 'dark');
  assert.equal(d.palette.primary, '#7c3aed');
  assert.ok(d.layout.header.items.length >= 2);
  assert.match(d.palette.primaryText, /^#/);
});

test('Engine 03 writes real files that compile and reference each other', () => {
  const { files } = buildAll('Create a portfolio website with about and contact');
  assert.ok(files['index.html'].includes('assets/app.js'));
  assert.ok(files['assets/app.js'].length > 500);
  const failures = testing.runChecks(files).checks.filter((c) => !c.ok);
  assert.deepEqual(failures, []);
});

test('Engine 03 escapes user text: app renders with textContent only', () => {
  const { files } = buildAll('Create a portfolio website');
  assert.ok(!files['assets/app.js'].includes('innerHTML'), 'generated app must not use innerHTML');
});

test('Engine 04 adds backend only when the project needs it', () => {
  const landing = backend.generate(analyzePrompt('Create a landing page'));
  assert.deepEqual(landing, {});
  const shop = backend.generate(analyzePrompt('Create an ecommerce store with checkout and login'));
  assert.ok(shop['server/server.js'].includes("'/api/contact'"));
  assert.ok(shop['db/migrations/001_init.sql'].includes('CREATE TABLE IF NOT EXISTS products'));
  assert.ok(shop['db/migrations/001_init.sql'].includes('CREATE TABLE IF NOT EXISTS users'));
});

test('Engine 05 passes a clean project', () => {
  const { files } = buildAll('Create a portfolio website');
  const result = testing.test(files);
  assert.equal(result.passed, true);
  assert.equal(result.failed, 0);
});

test('Engine 05 auto-fixes a broken navigation link and then passes', () => {
  const { files } = buildAll('Create a portfolio website');
  const sandbox = { window: {} };
  require('vm').runInNewContext(files['assets/content.js'], sandbox);
  const site = sandbox.window.SITE;
  delete site.pages.contact; // nav still links to contact, so the link is now broken
  const broke = { ...files, 'assets/content.js': `window.SITE = ${JSON.stringify(site)};` };
  const before = testing.runChecks(broke).checks.filter((c) => !c.ok);
  assert.ok(before.some((c) => c.name.startsWith('nav target exists')), 'the corruption must be detected');
  const result = testing.test(broke);
  assert.equal(result.passed, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.ok(result.fixed.length > 0);
});

test('Engine 05 never reports passed when a file is unparseable and cannot be fixed', () => {
  const { files } = buildAll('Create a portfolio website');
  const bad = { ...files, 'assets/app.js': 'function ( {' };
  const result = testing.test(bad);
  assert.equal(result.passed, false);
});

test('Engine 06 blocks export when a live secret is present', () => {
  const { spec, d, files } = buildAll('Create a portfolio website');
  files['config.js'] = 'const key = "rzp_live_ABCDEFGH12345678";';
  assert.throws(() => exporter.packageProject({ design: d, spec, projectFiles: files, checks: { passed: true } }), /possible live secret/);
});

test('Engine 06 excludes .env files from the package', () => {
  const { spec, d, files } = buildAll('Create a portfolio website');
  files['.env'] = 'PORT=3000';
  const { files: out, excluded } = exporter.packageProject({ design: d, spec, projectFiles: files, checks: { passed: true } });
  assert.ok(!('.env' in out));
  assert.deepEqual(excluded, ['.env']);
  assert.ok(out['README.md'].includes('Run locally'));
  assert.ok(out['assets/logo.svg'].includes('<svg'));
});

test('ZIP writer produces an archive the system unzip accepts', (t) => {
  const probe = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (probe.error) { t.skip('unzip not installed'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  const zipPath = path.join(dir, 'out.zip');
  const entries = [
    { name: 'index.html', content: '<h1>Hello</h1>' },
    { name: 'assets/app.js', content: 'console.log("ünïcode ✓");' },
    { name: 'empty.txt', content: '' },
  ];
  fs.writeFileSync(zipPath, buildZip(entries));
  const check = spawnSync('unzip', ['-tq', zipPath], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const out = spawnSync('unzip', ['-p', zipPath, 'assets/app.js'], { encoding: 'utf8' });
  assert.equal(out.stdout, 'console.log("ünïcode ✓");');
});

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('Orchestrator runs all six stages in order', () => {
  const spec = orchestrator.plan('Create a portfolio website with about and contact');
  const job = { id: 'j', completed: [], logs: [], status: 'queued' };
  const state = { spec, design: null, files: {}, checks: null, excluded: [], manifest: [] };
  const result = orchestrator.execute(job, state);
  assert.equal(result.status, 'completed');
  assert.deepEqual(job.completed, ['analyze', 'design', 'frontend', 'backend', 'test', 'export']);
  assert.equal(job.progress, 100);
  assert.ok(state.manifest.length > 0);
});
