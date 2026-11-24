'use strict';

// Schema migrations for the JSON document store.
// Each migration runs once, in order, and is recorded in data.schemaVersion.

const DEFAULT_PACKAGES = [
  { id: 'starter', name: 'Starter', priceInr: 199, tokens: 100, bonusTokens: 0, discountPercent: 0, active: true },
  { id: 'basic', name: 'Basic', priceInr: 499, tokens: 300, bonusTokens: 30, discountPercent: 0, active: true },
  { id: 'professional', name: 'Professional', priceInr: 1299, tokens: 900, bonusTokens: 150, discountPercent: 10, active: true },
  { id: 'business', name: 'Business', priceInr: 2999, tokens: 2200, bonusTokens: 500, discountPercent: 15, active: true },
  { id: 'enterprise', name: 'Enterprise', priceInr: 9999, tokens: 8000, bonusTokens: 2000, discountPercent: 20, active: true },
];

const COLLECTIONS = [
  'users', 'sessions', 'resets', 'projects', 'files', 'versions', 'messages', 'jobs',
  'wallets', 'ledger', 'reservations', 'orders', 'payments', 'packages', 'contacts', 'events',
];

const MIGRATIONS = [
  {
    version: 1,
    name: 'create core collections',
    up(data) {
      for (const name of COLLECTIONS) data[name] = data[name] || [];
    },
  },
  {
    version: 2,
    name: 'seed default token packages',
    up(data) {
      if (data.packages.length === 0) data.packages.push(...DEFAULT_PACKAGES.map((p) => ({ ...p })));
    },
  },
  {
    version: 3,
    name: 'index-ready fields on ledger and jobs',
    up(data) {
      for (const entry of data.ledger) entry.reference = entry.reference || null;
      for (const job of data.jobs) job.logs = job.logs || [];
    },
  },
];

function runMigrations(data) {
  let applied = 0;
  for (const migration of MIGRATIONS) {
    if ((data.schemaVersion || 0) >= migration.version) continue;
    migration.up(data);
    data.schemaVersion = migration.version;
    applied++;
  }
  return applied;
}

module.exports = { runMigrations, DEFAULT_PACKAGES, MIGRATIONS, COLLECTIONS };
