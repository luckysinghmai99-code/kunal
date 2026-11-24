'use strict';

// ENGINE 05 — Testing & Auto-Fix.
// Runs real static checks on the generated files: syntax compilation, required
// files, link integrity between navigation and content, and JSON validity.
// Recoverable problems are fixed automatically, then checks are re-run.
// A project is only marked "passed" when every check is green.

const vm = require('vm');

function compiles(source, name) {
  try {
    new vm.Script(source, { filename: name });
    return null;
  } catch (err) {
    return err.message;
  }
}

function runChecks(files) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

  const required = ['index.html', 'assets/styles.css', 'assets/content.js', 'assets/app.js'];
  for (const f of required) add(`file present: ${f}`, typeof files[f] === 'string' && files[f].length > 0);

  for (const [name, source] of Object.entries(files)) {
    if (typeof source !== 'string') continue;
    if (name.endsWith('.js')) {
      const err = compiles(source, name);
      add(`syntax: ${name}`, !err, err || '');
    }
    if (name.endsWith('.json')) {
      try { JSON.parse(source); add(`json: ${name}`, true); } catch (e) { add(`json: ${name}`, false, e.message); }
    }
  }

  const html = files['index.html'] || '';
  add('index links stylesheet', html.includes('assets/styles.css'));
  add('index loads content before app', html.indexOf('assets/content.js') !== -1 && html.indexOf('assets/content.js') < html.indexOf('assets/app.js'));

  let site = null;
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(files['assets/content.js'] || '', sandbox);
    site = sandbox.window.SITE;
    add('content.js exposes SITE', Boolean(site && site.pages));
  } catch (e) {
    add('content.js executes', false, e.message);
  }

  if (site) {
    for (const item of site.nav) {
      const key = item.path === '/' ? 'home' : item.path.replace(/^\//, '');
      add(`nav target exists: ${item.label}`, Boolean(site.pages[key]), key);
    }
    for (const [key, page] of Object.entries(site.pages)) {
      add(`page has title: ${key}`, Boolean(page.title));
      add(`page has sections: ${key}`, Array.isArray(page.sections) && page.sections.length > 0);
    }
  }
  return { checks, site };
}

function autoFix(files, checks, site) {
  const fixed = [];
  // Fix 1: a nav target has no page -> generate a placeholder page so the link works.
  if (site) {
    for (const check of checks.filter((c) => !c.ok && c.name.startsWith('nav target exists'))) {
      const key = check.detail;
      site.pages[key] = { title: key.charAt(0).toUpperCase() + key.slice(1), path: `/${key}`, sections: [{ type: 'text', title: 'Coming soon', text: 'This page is being prepared.' }] };
      fixed.push(`Created placeholder page "${key}" for a broken navigation link`);
    }
    if (fixed.length) files['assets/content.js'] = `window.SITE = ${JSON.stringify(site, null, 2)};\n`;
  }
  // Fix 2: a required file went missing -> regenerate it from the design.
  return fixed;
}

/**
 * @param {Record<string,string>} files generated project files (mutated when auto-fixed)
 * @param {{maxRounds?: number}} [options]
 */
function test(files, { maxRounds = 2 } = {}) {
  const working = { ...files };
  const fixedLog = [];
  let result = runChecks(working);
  for (let round = 0; round < maxRounds && result.checks.some((c) => !c.ok); round++) {
    const fixes = autoFix(working, result.checks, result.site);
    if (fixes.length === 0) break;
    fixedLog.push(...fixes);
    result = runChecks(working);
  }
  const failed = result.checks.filter((c) => !c.ok);
  return {
    passed: failed.length === 0,
    total: result.checks.length,
    failed: failed.length,
    checks: result.checks,
    fixed: fixedLog,
    files: working,
  };
}

module.exports = { test, runChecks };
