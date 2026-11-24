'use strict';

// Ties the prompt pipeline to wallet reservations and project storage.
//   plan (read-only) -> price -> reserve -> run stages -> save files -> settle
// A failed stage never throws out of run(): the job is recorded as failed with
// its logs, the work done so far is charged, and the job can be resumed, which
// reserves only the remaining cost.

const { newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');
const orchestrator = require('../engines');
const { estimate } = require('./pricing');
const wallet = require('./wallet');
const { owned, filesOf, saveGeneration } = require('./projects');

const TOTAL_STAGES = orchestrator.STAGES.length;

function freshState(spec) {
  return { spec, design: null, files: {}, checks: null, excluded: [], manifest: [] };
}

function publicJob(job) {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    completed: job.completed,
    failedStage: job.failedStage,
    error: job.error,
    estimate: job.estimate,
    chargedTokens: job.chargedTokens,
    logs: job.logs,
    checks: job.checks
      ? { passed: job.checks.passed, total: job.checks.total, failed: job.checks.failed, fixed: job.checks.fixed }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

class GenerationService {
  constructor(store) {
    this.store = store;
  }

  /** Engine 01 + pricing only. Read-only: nothing is reserved or saved. */
  estimate(userId, projectId, prompt) {
    return this.store.read((d) => {
      const project = owned(d, userId, projectId);
      const previousSpec = project.spec || null;
      const spec = orchestrator.plan(prompt, { previousSpec, projectName: project.name });
      const price = estimate(spec, { revision: Boolean(previousSpec) });
      const balance = wallet.snapshot(wallet.getWallet(d, userId));
      return {
        language: spec.language,
        category: spec.category,
        pages: spec.pages,
        components: spec.components,
        integrations: spec.integrations,
        backend: spec.backend,
        database: spec.database,
        auth: spec.auth,
        missing: spec.missing,
        plan: spec.plan,
        estimatedTokens: price.tokens,
        breakdown: price.breakdown,
        multipliers: price.multipliers,
        balance,
        canAfford: balance.available >= price.tokens,
      };
    });
  }

  /** Start a new generation. Returns the job; stage failures are recorded, not thrown. */
  run(userId, projectId, prompt, { onLog } = {}) {
    return this.store.tx((d) => {
      const project = owned(d, userId, projectId);
      const previousSpec = project.spec || null;
      const spec = orchestrator.plan(prompt, { previousSpec, projectName: project.name });
      const price = estimate(spec, { revision: Boolean(previousSpec) });
      const now = new Date().toISOString();

      const job = {
        id: newId('job'), userId, projectId, prompt: String(prompt).slice(0, 20000), spec,
        estimate: price.tokens, chargedTokens: 0, status: 'queued', progress: 0,
        completed: [], logs: [], checks: null, error: null, failedStage: null,
        context: {}, createdAt: now, updatedAt: now,
      };
      d.jobs.push(job);
      d.messages.push({ id: newId('msg'), projectId, userId, role: 'user', content: String(prompt).slice(0, 4000), createdAt: now });

      return this.execute(d, project, job, freshState(spec), price.tokens, onLog);
    });
  }

  /** Resume a failed job from its first incomplete stage. Reserves only the remaining cost. */
  resume(userId, jobId, { onLog } = {}) {
    return this.store.tx((d) => {
      const job = d.jobs.find((j) => j.id === jobId && j.userId === userId);
      if (!job) throw new HttpError(404, 'Job not found');
      if (job.status !== 'failed') throw new HttpError(409, 'Only failed jobs can be resumed');
      const project = owned(d, userId, job.projectId);
      const remaining = Math.max(1, job.estimate - job.chargedTokens);
      const state = job.context.state || freshState(job.spec);
      return this.execute(d, project, job, state, remaining, onLog);
    });
  }

  /**
   * Reserve `reserveAmount`, run remaining stages, persist results and settle.
   * Must run inside store.tx so reservation, work and settlement are atomic.
   */
  execute(d, project, job, state, reserveAmount, onLog) {
    const reservation = wallet.reserve(d, job.userId, {
      amount: reserveAmount, projectId: project.id, note: `Generation: ${job.prompt.slice(0, 60)}`,
    });
    const result = orchestrator.execute(job, state, onLog);

    let charge;
    if (result.status === 'completed') {
      charge = reserveAmount;
      saveGeneration(d, project, state.files, { label: 'generation', spec: state.spec, design: state.design });
      job.context = {};
    } else {
      const earned = Math.ceil((job.estimate * job.completed.length) / TOTAL_STAGES);
      charge = Math.min(reserveAmount, Math.max(0, earned - job.chargedTokens));
      job.context = { state };
    }
    wallet.settle(d, reservation.id, charge);
    job.chargedTokens += charge;
    job.checks = state.checks;
    job.updatedAt = new Date().toISOString();

    d.messages.push({
      id: newId('msg'), projectId: project.id, userId: job.userId, role: 'assistant',
      content: job.status === 'completed'
        ? `Generated ${Object.keys(state.files).length} files and passed all checks. Charged ${job.chargedTokens} tokens.`
        : `Stopped at "${job.failedStage}": ${job.error}. Charged ${job.chargedTokens} tokens so far. You can resume this job.`,
      createdAt: job.updatedAt,
    });
    return publicJob(job);
  }

  getJob(userId, jobId) {
    return this.store.read((d) => {
      const job = d.jobs.find((j) => j.id === jobId && j.userId === userId);
      if (!job) throw new HttpError(404, 'Job not found');
      return publicJob(job);
    });
  }

  listJobs(userId, projectId) {
    return this.store.read((d) => d.jobs
      .filter((j) => j.userId === userId && j.projectId === projectId)
      .map(publicJob));
  }
}

module.exports = { GenerationService, publicJob, filesOf };
