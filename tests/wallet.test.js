'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/lib/store');
const { tempConfig } = require('./helpers');
const wallet = require('../src/services/wallet');
const { AuthService } = require('../src/services/auth');
const path = require('path');

function fresh() {
  const config = tempConfig();
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const auth = new AuthService(store, config);
  return { store, auth, config };
}

test('every new account receives exactly 50 starter tokens, once', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'a@example.com', password: 'password123', name: 'A' });
  const view = store.read((d) => wallet.viewFor(d, user.id));
  assert.equal(view.total, 50);
  assert.equal(view.available, 50);
  // Calling grantStarter again must not grant more.
  store.tx((d) => wallet.grantStarter(d, user.id));
  assert.equal(store.read((d) => wallet.viewFor(d, user.id)).total, 50);
  assert.equal(store.read((d) => d.ledger.filter((e) => e.type === 'starter_grant').length), 1);
});

test('reserve, then settle charges actual usage and returns the rest', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'b@example.com', password: 'password123', name: 'B' });
  const rsv = store.tx((d) => wallet.reserve(d, user.id, { amount: 20 }));
  let view = store.read((d) => wallet.viewFor(d, user.id));
  assert.equal(view.reserved, 20);
  assert.equal(view.available, 30);
  store.tx((d) => wallet.settle(d, rsv.id, 12));
  view = store.read((d) => wallet.viewFor(d, user.id));
  assert.equal(view.total, 38);
  assert.equal(view.used, 12);
  assert.equal(view.reserved, 0);
  assert.equal(view.available, 38);
});

test('settling twice never double charges', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'c@example.com', password: 'password123', name: 'C' });
  const rsv = store.tx((d) => wallet.reserve(d, user.id, { amount: 10 }));
  store.tx((d) => wallet.settle(d, rsv.id, 10));
  store.tx((d) => wallet.settle(d, rsv.id, 10));
  const view = store.read((d) => wallet.viewFor(d, user.id));
  assert.equal(view.total, 40);
  assert.equal(view.used, 10);
});

test('cannot reserve more than the available balance; no negative balances', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'd@example.com', password: 'password123', name: 'D' });
  assert.throws(() => store.tx((d) => wallet.reserve(d, user.id, { amount: 51 })), (err) => err.status === 402);
  store.tx((d) => wallet.reserve(d, user.id, { amount: 50 }));
  assert.throws(() => store.tx((d) => wallet.reserve(d, user.id, { amount: 1 })), (err) => err.status === 402);
  const view = store.read((d) => wallet.viewFor(d, user.id));
  assert.ok(view.total >= 0 && view.available >= 0);
});

test('credits are idempotent per payment reference', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'e@example.com', password: 'password123', name: 'E' });
  const first = store.tx((d) => wallet.credit(d, user.id, { amount: 300, type: 'purchase', reference: 'pay_1' }));
  const second = store.tx((d) => wallet.credit(d, user.id, { amount: 300, type: 'purchase', reference: 'pay_1' }));
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(store.read((d) => wallet.viewFor(d, user.id)).total, 350);
});

test('ledger records before and after balances for every movement', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'f@example.com', password: 'password123', name: 'F' });
  store.tx((d) => wallet.credit(d, user.id, { amount: 100, type: 'purchase', reference: 'x' }));
  const rows = store.read((d) => d.ledger.filter((e) => e.userId === user.id));
  for (const row of rows) {
    assert.equal(typeof row.balanceBefore, 'number');
    assert.equal(typeof row.balanceAfter, 'number');
    assert.equal(row.balanceAfter - row.balanceBefore, row.amount);
  }
});

test('refund debit never drives the balance negative', () => {
  const { store, auth } = fresh();
  const user = auth.signup({ email: 'g@example.com', password: 'password123', name: 'G' });
  store.tx((d) => wallet.credit(d, user.id, { amount: 100, type: 'purchase', reference: 'p1' }));
  store.tx((d) => wallet.reserve(d, user.id, { amount: 140 })); // 50 starter + 100 purchased = 150 total
  const result = store.tx((d) => wallet.debitPurchase(d, user.id, { amount: 500, reference: 'r1' }));
  const view = store.read((d) => wallet.viewFor(d, user.id));
  assert.ok(view.total >= 0);
  assert.ok(result.pendingReview > 0, 'excess must be flagged for review');
});
