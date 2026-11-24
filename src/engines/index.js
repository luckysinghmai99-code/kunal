'use strict';

// AI orchestration layer. Connects the six engines in fixed order:
//   Prompt Intelligence -> Design Intelligence -> Frontend Coding ->
//   Backend & Database -> Testing & Auto-Fix -> Export & Deployment
// Each stage is retried once on failure. Progress and logs are recorded on the
// job so an interrupted or failed job can be resumed from its last good stage.

const promptEngine = require('./01-prompt');
const designEngine = require('./02-design');
const frontendEngine = require('./03-frontend');
const backendEngine = require('./04-backend');
const testingEngine = require('./05-testing');
const exportEngine = require('./06-export');

const STAGES = [
  { id: 'analyze', engine: 'prompt-intelligence', label: 'Analyzing prompt' },
  { id: 'design', engine: 'design-intelligence', label: 'Designing system and layout' },
  { id: 'frontend', engine: 'frontend-coding', label: 'Writing frontend files' },
  { id: 'backend', engine: 'backend-database', label: 'Generating backend and schema' },
  { id: 'test', engine: 'testing-autofix', label: 'Testing and auto-fixing' },
  { id: 'export', engine: 'export-deployment', label: 'Packaging project' },
];

const MAX_ATTEMPTS = 2;

function sanitizeName(name) {
  return String(name || 'RAILDESIGN Project').replace(/[<>&"'`]/g, '').trim().slice(0, 80) || 'RAILDESIGN Project';
}

/** Pure planning step (Engine 01 only). Safe to call for price estimates: no side effects. */
function plan(prompt, { previousSpec = null, projectName = '' } = {}) {
  const spec = promptEngine.analyzePrompt(prompt, previousSpec);
  spec.appName = sanitizeName(projectName || spec.appName);
  return spec;
}

function stageRunner(state) {
  return {
    analyze: () => {},
    design: () => { state.design = designEngine.generate(state.spec); },
    frontend: () => { state.files = { ...frontendEngine.generate(state.design, state.spec) }; },
    backend: () => { Object.assign(state.files, backendEngine.generate(state.spec)); },
    test: () => {
      const result = testingEngine.test(state.files);
      state.files = result.files;
      state.checks = { passed: result.passed, total: result.total, failed: result.failed, fixed: result.fixed, items: result.checks };
      if (!result.passed) {
        const names = result.checks.filter((c) => !c.ok).map((c) => c.name).slice(0, 5).join('; ');
        throw new Error(`Tests failed: ${names}`);
      }
    },
    export: () => {
      const { files, excluded } = exportEngine.packageProject({
        design: state.design, spec: state.spec, projectFiles: state.files, checks: state.checks,
      });
      state.files = files;
      state.excluded = excluded;
      state.manifest = Object.entries(files).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) }));
    },
  };
}

/**
 * Run remaining stages for a job. Mutates `job` and `state` only; caller persists.
 * @returns {{status: 'completed'|'failed', completedStages: number}}
 */
function execute(job, state, onLog = () => {}) {
  const runners = stageRunner(state);
  job.status = 'running';
  for (const stage of STAGES) {
    if (job.completed.includes(stage.id)) continue;
    let lastError = null;
    let ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
      const started = Date.now();
      try {
        runners[stage.id]();
        ok = true;
        const entry = { at: new Date().toISOString(), stage: stage.id, engine: stage.engine, level: 'info', message: `${stage.label}: done`, attempt, ms: Date.now() - started };
        job.logs.push(entry);
        onLog(entry);
      } catch (err) {
        lastError = err;
        const entry = { at: new Date().toISOString(), stage: stage.id, engine: stage.engine, level: 'error', message: `${stage.label}: ${err.message}`, attempt, ms: Date.now() - started };
        job.logs.push(entry);
        onLog(entry);
      }
    }
    if (!ok) {
      job.status = 'failed';
      job.error = lastError ? lastError.message : 'Unknown error';
      job.failedStage = stage.id;
      return { status: 'failed', completedStages: job.completed.length };
    }
    job.completed.push(stage.id);
    job.progress = Math.round((job.completed.length / STAGES.length) * 100);
  }
  job.status = 'completed';
  job.progress = 100;
  job.error = null;
  job.failedStage = null;
  return { status: 'completed', completedStages: job.completed.length };
}

module.exports = { STAGES, plan, execute, sanitizeName };
