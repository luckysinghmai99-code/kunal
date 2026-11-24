'use strict';

// Dynamic token pricing. Cost is derived from the engine workload in the
// project spec (pages, components, images, backend, DB, integrations,
// animations, testing, export) and a complexity score. Prompt length only
// contributes a small logarithmic factor; it is never the price on its own.

const WEIGHTS = {
  base: 3,
  page: 2,
  component: 0.5,
  image: 1.5,
  backend: 4,
  database: 3,
  integration: 3,
  animation: 1,
  testing: 1,
  export: 1,
};

const REVISION_DISCOUNT = 0.5; // edits to an existing project reuse prior work
const MIN_TOKENS = 3;

function estimate(spec, { revision = false } = {}) {
  const breakdown = {
    base: WEIGHTS.base,
    pages: spec.pages.length * WEIGHTS.page,
    components: spec.components.length * WEIGHTS.component,
    images: spec.imagesRequested * WEIGHTS.image,
    backend: spec.backend ? WEIGHTS.backend : 0,
    database: spec.database ? WEIGHTS.database : 0,
    integrations: spec.integrations.length * WEIGHTS.integration,
    animations: spec.animations.length * WEIGHTS.animation,
    testing: WEIGHTS.testing,
    export: WEIGHTS.export,
  };
  const units = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const complexityMultiplier = 1 + Math.min(spec.complexityScore / 10, 1.5);
  const promptMultiplier = 1 + Math.min(Math.log10(1 + spec.wordCount) / 10, 0.3);
  let tokens = Math.ceil(units * complexityMultiplier * promptMultiplier);
  if (revision) tokens = Math.ceil(tokens * REVISION_DISCOUNT);
  tokens = Math.max(MIN_TOKENS, tokens);
  return {
    tokens,
    revision,
    breakdown,
    multipliers: { complexity: Number(complexityMultiplier.toFixed(2)), prompt: Number(promptMultiplier.toFixed(2)) },
  };
}

module.exports = { estimate, WEIGHTS };
