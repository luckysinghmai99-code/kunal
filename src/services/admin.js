'use strict';

const { newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');
const wallet = require('./wallet');
const { publicUser } = require('./auth');

class AdminService {
  constructor(store) {
    this.store = store;
  }

  stats() {
    return this.store.read((d) => {
      const captured = d.payments.filter((p) => p.status === 'captured');
      const grants = d.ledger.filter((e) => e.type === 'admin_grant').reduce((s, e) => s + e.amount, 0);
      return {
        users: d.users.length,
        projects: d.projects.length,
        generationJobs: d.jobs.length,
        jobsFailed: d.jobs.filter((j) => j.status === 'failed').length,
        tokensInCirculation: d.wallets.reduce((s, w) => s + w.balance, 0),
        tokensReserved: d.wallets.reduce((s, w) => s + w.reserved, 0),
        tokensUsed: d.wallets.reduce((s, w) => s + w.used, 0),
        paymentsCaptured: captured.length,
        revenueInr: captured.reduce((s, p) => s + p.amountPaise, 0) / 100,
        adminGrantedTokens: grants,
        engineHealth: ['prompt-intelligence', 'design-intelligence', 'frontend-coding', 'backend-database', 'testing-autofix', 'export-deployment']
          .map((id) => ({ id, status: 'ok' })),
      };
    });
  }

  listUsers() {
    return this.store.read((d) => d.users.map((u) => {
      const w = d.wallets.find((x) => x.userId === u.id);
      return { ...publicUser(u), balance: w ? w.balance : 0, reserved: w ? w.reserved : 0 };
    }));
  }

  setPackages(packages) {
    if (!Array.isArray(packages) || packages.length === 0 || packages.length > 20) throw new HttpError(422, 'Provide 1 to 20 packages');
    const cleaned = packages.map((p) => {
      const id = String(p.id || '').trim();
      if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new HttpError(422, `Invalid package id "${id}"`);
      const priceInr = Number(p.priceInr);
      const tokens = Number.parseInt(p.tokens, 10);
      const bonusTokens = Number.parseInt(p.bonusTokens || 0, 10);
      const discountPercent = Number(p.discountPercent || 0);
      if (!(priceInr > 0) || !(tokens > 0) || bonusTokens < 0 || discountPercent < 0 || discountPercent > 90) {
        throw new HttpError(422, `Invalid values for package "${id}"`);
      }
      return { id, name: String(p.name || id).slice(0, 60), priceInr, tokens, bonusTokens, discountPercent, active: p.active !== false };
    });
    return this.store.tx((d) => {
      d.packages = cleaned;
      return d.packages;
    });
  }

  grantTokens(adminId, userId, { amount, reason }) {
    const n = Number.parseInt(amount, 10);
    if (!(n > 0) || n > 100000) throw new HttpError(422, 'Amount must be between 1 and 100000');
    const note = String(reason || '').trim().slice(0, 200);
    if (!note) throw new HttpError(422, 'A reason is required for manual grants');
    return this.store.tx((d) => {
      if (!d.users.some((u) => u.id === userId)) throw new HttpError(404, 'User not found');
      const result = wallet.credit(d, userId, { amount: n, type: 'admin_grant', reference: newId('grt'), note: `${note} (by ${adminId})` });
      return wallet.snapshot(result.wallet);
    });
  }
}

module.exports = { AdminService };
