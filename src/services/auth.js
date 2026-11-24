'use strict';

const { hashPassword, verifyPassword, randomToken, sha256, newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');
const wallet = require('./wallet');

const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}

class AuthService {
  constructor(store, config, { outbox = null } = {}) {
    this.store = store;
    this.config = config;
    this.outbox = outbox; // function(message) used for password reset emails; dev writes to a log
    this.attempts = new Map();
  }

  roleFor(email) {
    return this.config.adminEmails.includes(email) ? 'admin' : 'user';
  }

  validateCredentials(email, password) {
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 200) throw new HttpError(422, 'A valid email is required');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(422, 'Password must be 8 to 200 characters');
    }
    return e;
  }

  signup({ email, password, name }) {
    const e = this.validateCredentials(email, password);
    const displayName = String(name || '').trim().slice(0, 80) || e.split('@')[0];
    const passwordHash = hashPassword(password);
    return this.store.tx((d) => {
      if (d.users.some((u) => u.email === e)) throw new HttpError(409, 'An account with this email already exists');
      const now = new Date().toISOString();
      const user = { id: newId('usr'), email: e, name: displayName, passwordHash, role: this.roleFor(e), createdAt: now, updatedAt: now };
      d.users.push(user);
      wallet.grantStarter(d, user.id);
      return publicUser(user);
    });
  }

  checkRateLimit(key) {
    const now = Date.now();
    const entry = this.attempts.get(key) || { count: 0, windowStart: now };
    if (now - entry.windowStart > LOGIN_WINDOW_MS) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count++;
    this.attempts.set(key, entry);
    if (entry.count > LOGIN_MAX_ATTEMPTS) throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
  }

  login({ email, password, ip = 'unknown' }) {
    const e = String(email || '').trim().toLowerCase();
    this.checkRateLimit(`${ip}:${e}`);
    const user = this.store.read((d) => d.users.find((u) => u.email === e));
    // Verify even when the user is missing to keep timing similar.
    const ok = user ? verifyPassword(String(password || ''), user.passwordHash) : (verifyPassword(String(password || ''), 'scrypt$00$00') || false);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
    this.attempts.delete(`${ip}:${e}`);
    const token = randomToken();
    this.store.tx((d) => {
      const now = Date.now();
      d.sessions.push({
        id: newId('ses'),
        userId: user.id,
        tokenHash: sha256(token),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString(),
      });
      d.sessions = d.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
    });
    return { token, user: publicUser(user), maxAgeSeconds: SESSION_DAYS * 86400 };
  }

  userForToken(token) {
    if (!token) return null;
    const hash = sha256(token);
    return this.store.read((d) => {
      const session = d.sessions.find((s) => s.tokenHash === hash);
      if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
      const user = d.users.find((u) => u.id === session.userId);
      return user ? publicUser(user) : null;
    });
  }

  logout(token) {
    if (!token) return;
    const hash = sha256(token);
    this.store.tx((d) => { d.sessions = d.sessions.filter((s) => s.tokenHash !== hash); });
  }

  requestPasswordReset(email) {
    const e = String(email || '').trim().toLowerCase();
    this.store.tx((d) => {
      const user = d.users.find((u) => u.email === e);
      if (!user) return;
      const token = randomToken();
      d.resets = d.resets.filter((r) => r.userId !== user.id);
      d.resets.push({
        id: newId('rst'), userId: user.id, tokenHash: sha256(token), usedAt: null,
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60000).toISOString(),
      });
      if (this.outbox) this.outbox({ to: e, subject: 'Reset your RAILDESIGN AI password', link: `${this.config.appUrl}/reset.html?token=${token}` });
    });
    // Always return the same response, whether or not the account exists.
    return { message: 'If an account exists for this email, a reset link has been sent.' };
  }

  resetPassword({ token, password }) {
    if (!token) throw new HttpError(400, 'Reset token is required');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
      throw new HttpError(422, 'Password must be 8 to 200 characters');
    }
    const passwordHash = hashPassword(password);
    const hash = sha256(token);
    this.store.tx((d) => {
      const reset = d.resets.find((r) => r.tokenHash === hash);
      if (!reset || reset.usedAt || new Date(reset.expiresAt).getTime() < Date.now()) {
        throw new HttpError(400, 'This reset link is invalid or has expired');
      }
      const user = d.users.find((u) => u.id === reset.userId);
      if (!user) throw new HttpError(400, 'This reset link is invalid or has expired');
      user.passwordHash = passwordHash;
      user.updatedAt = new Date().toISOString();
      reset.usedAt = new Date().toISOString();
      d.sessions = d.sessions.filter((s) => s.userId !== user.id); // sign out everywhere
    });
    return { message: 'Password updated. Please sign in.' };
  }

  getProfile(userId) {
    return this.store.read((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user) throw new HttpError(404, 'User not found');
      return publicUser(user);
    });
  }

  updateProfile(userId, { name }) {
    const displayName = String(name || '').trim();
    if (displayName.length < 1 || displayName.length > 80) throw new HttpError(422, 'Name must be 1 to 80 characters');
    return this.store.tx((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user) throw new HttpError(404, 'User not found');
      user.name = displayName;
      user.updatedAt = new Date().toISOString();
      return publicUser(user);
    });
  }

  changePassword(userId, { currentPassword, newPassword }) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw new HttpError(422, 'New password must be at least 8 characters');
    return this.store.tx((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user || !verifyPassword(String(currentPassword || ''), user.passwordHash)) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      user.passwordHash = hashPassword(newPassword);
      user.updatedAt = new Date().toISOString();
      return { ok: true };
    });
  }
}

module.exports = { AuthService, publicUser, SESSION_DAYS };
