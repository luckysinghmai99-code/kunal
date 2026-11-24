'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store } = require('../src/lib/store');
const { tempConfig } = require('./helpers');
const { AuthService } = require('../src/services/auth');

function setup() {
  const config = tempConfig();
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const sent = [];
  const auth = new AuthService(store, config, { outbox: (m) => sent.push(m) });
  return { store, auth, config, sent };
}

test('signup hashes the password and rejects duplicates', () => {
  const { store, auth } = setup();
  auth.signup({ email: 'Owner@Example.com', password: 'longpassword', name: 'Owner' });
  const stored = store.read((d) => d.users[0]);
  assert.equal(stored.email, 'owner@example.com');
  assert.notEqual(stored.passwordHash, 'longpassword');
  assert.match(stored.passwordHash, /^scrypt\$/);
  assert.throws(() => auth.signup({ email: 'owner@example.com', password: 'longpassword' }), (e) => e.status === 409);
});

test('validation rejects bad email and short passwords', () => {
  const { auth } = setup();
  assert.throws(() => auth.signup({ email: 'nope', password: 'longpassword' }), (e) => e.status === 422);
  assert.throws(() => auth.signup({ email: 'x@example.com', password: 'short' }), (e) => e.status === 422);
});

test('login issues a session token; the token resolves to the user; logout revokes it', () => {
  const { auth } = setup();
  auth.signup({ email: 'u@example.com', password: 'longpassword', name: 'U' });
  const session = auth.login({ email: 'u@example.com', password: 'longpassword' });
  assert.ok(session.token.length > 30);
  assert.equal(auth.userForToken(session.token).email, 'u@example.com');
  auth.logout(session.token);
  assert.equal(auth.userForToken(session.token), null);
});

test('session tokens are stored hashed, never in plain text', () => {
  const { store, auth } = setup();
  auth.signup({ email: 'h@example.com', password: 'longpassword' });
  const session = auth.login({ email: 'h@example.com', password: 'longpassword' });
  const raw = fs.readFileSync(path.join(path.dirname(store.file), 'db.json'), 'utf8');
  assert.ok(!raw.includes(session.token), 'plain token must not be persisted');
});

test('wrong password and unknown email return the same error', () => {
  const { auth } = setup();
  auth.signup({ email: 'k@example.com', password: 'longpassword' });
  assert.throws(() => auth.login({ email: 'k@example.com', password: 'wrongpassword' }), (e) => e.status === 401 && e.message === 'Invalid email or password');
  assert.throws(() => auth.login({ email: 'ghost@example.com', password: 'wrongpassword' }), (e) => e.status === 401 && e.message === 'Invalid email or password');
});

test('login is rate limited after repeated failures', () => {
  const { auth } = setup();
  auth.signup({ email: 'r@example.com', password: 'longpassword' });
  let limited = false;
  for (let i = 0; i < 12; i++) {
    try { auth.login({ email: 'r@example.com', password: 'nope-nope', ip: '1.2.3.4' }); } catch (e) { if (e.status === 429) limited = true; }
  }
  assert.ok(limited);
});

test('password reset: link is single-use, sends a link, and signs out other sessions', () => {
  const { auth, sent } = setup();
  auth.signup({ email: 'p@example.com', password: 'oldpassword' });
  const session = auth.login({ email: 'p@example.com', password: 'oldpassword' });
  const response = auth.requestPasswordReset('p@example.com');
  assert.match(response.message, /If an account exists/);
  assert.equal(sent.length, 1);
  const token = new URL(sent[0].link).searchParams.get('token');
  auth.resetPassword({ token, password: 'newpassword' });
  assert.equal(auth.userForToken(session.token), null, 'old session must be revoked');
  assert.throws(() => auth.resetPassword({ token, password: 'anotherpass' }), (e) => e.status === 400);
  auth.login({ email: 'p@example.com', password: 'newpassword' });
});

test('forgot-password does not reveal whether an account exists', () => {
  const { auth, sent } = setup();
  const res = auth.requestPasswordReset('nobody@example.com');
  assert.match(res.message, /If an account exists/);
  assert.equal(sent.length, 0);
});

test('admin role is assigned from ADMIN_EMAILS', () => {
  const { auth } = setup();
  const user = auth.signup({ email: 'admin@example.com', password: 'longpassword' });
  assert.equal(user.role, 'admin');
});

test('data survives a restart (persistent storage)', () => {
  const config = tempConfig();
  const file = path.join(config.dataDir, 'db.json');
  const s1 = new Store(file).open();
  const a1 = new AuthService(s1, config);
  a1.signup({ email: 'persist@example.com', password: 'longpassword' });
  const session = a1.login({ email: 'persist@example.com', password: 'longpassword' });
  const s2 = new Store(file).open();
  const a2 = new AuthService(s2, config);
  assert.equal(a2.userForToken(session.token).email, 'persist@example.com');
});
