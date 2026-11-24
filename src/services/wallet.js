'use strict';

// Token wallet. Every function takes the in-memory data object and must be
// called inside store.tx(). Balances can never go negative: reservations are
// checked against available tokens before they are created.

const { newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');

const STARTER_TOKENS = 50; // one-time allowance, granted exactly once per account

function getWallet(d, userId) {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    wallet = { userId, balance: 0, reserved: 0, used: 0, purchased: 0, updatedAt: new Date().toISOString() };
    d.wallets.push(wallet);
  }
  return wallet;
}

function snapshot(wallet) {
  return {
    total: wallet.balance,
    available: wallet.balance - wallet.reserved,
    reserved: wallet.reserved,
    used: wallet.used,
    purchased: wallet.purchased,
    remaining: wallet.balance - wallet.reserved,
  };
}

function writeLedger(d, wallet, entry) {
  const row = {
    id: newId('led'),
    userId: wallet.userId,
    createdAt: new Date().toISOString(),
    reference: null,
    projectId: null,
    note: '',
    amount: 0,
    balanceBefore: wallet.balance,
    balanceAfter: wallet.balance,
    reservedBefore: wallet.reserved,
    reservedAfter: wallet.reserved,
    ...entry,
  };
  d.ledger.push(row);
  wallet.updatedAt = row.createdAt;
  return row;
}

function grantStarter(d, userId) {
  const wallet = getWallet(d, userId);
  const already = d.ledger.some((e) => e.userId === userId && e.type === 'starter_grant');
  if (already) return wallet;
  const before = wallet.balance;
  wallet.balance += STARTER_TOKENS;
  writeLedger(d, wallet, {
    type: 'starter_grant', amount: STARTER_TOKENS, balanceBefore: before, balanceAfter: wallet.balance,
    note: 'One-time starter allowance',
  });
  return wallet;
}

/** Credit tokens from a verified purchase or admin action. Idempotent per (type, reference). */
function credit(d, userId, { amount, type, reference = null, note = '' }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Credit amount must be a positive integer');
  const wallet = getWallet(d, userId);
  if (reference && d.ledger.some((e) => e.type === type && e.reference === reference)) {
    return { wallet, duplicate: true };
  }
  const before = wallet.balance;
  wallet.balance += amount;
  if (type === 'purchase' || type === 'bonus') wallet.purchased += amount;
  writeLedger(d, wallet, { type, amount, reference, note, balanceBefore: before, balanceAfter: wallet.balance });
  return { wallet, duplicate: false };
}

function reserve(d, userId, { amount, projectId = null, note = '' }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Reservation amount must be a positive integer');
  const wallet = getWallet(d, userId);
  const available = wallet.balance - wallet.reserved;
  if (available < amount) {
    throw new HttpError(402, 'Not enough tokens', { required: amount, available });
  }
  const reservedBefore = wallet.reserved;
  wallet.reserved += amount;
  const reservation = {
    id: newId('rsv'), userId, projectId, amount, status: 'reserved',
    createdAt: new Date().toISOString(), settledAt: null, charged: 0, released: 0,
  };
  d.reservations.push(reservation);
  writeLedger(d, wallet, {
    type: 'reserve', amount: 0, projectId, note: note || 'Tokens reserved for task',
    reference: reservation.id, reservedBefore, reservedAfter: wallet.reserved,
  });
  return reservation;
}

/**
 * Settle a reservation: charge the actual usage and release the rest.
 * A reservation can be settled exactly once, so double charging is impossible.
 */
function settle(d, reservationId, actualUsed) {
  const reservation = d.reservations.find((r) => r.id === reservationId);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (reservation.status !== 'reserved') return reservation; // already settled, no-op

  const wallet = getWallet(d, reservation.userId);
  const charge = Math.max(0, Math.min(Math.floor(actualUsed), reservation.amount));
  const release = reservation.amount - charge;

  const reservedBefore = wallet.reserved;
  const balanceBefore = wallet.balance;
  wallet.reserved -= reservation.amount;
  wallet.balance -= charge;
  wallet.used += charge;

  reservation.status = 'settled';
  reservation.settledAt = new Date().toISOString();
  reservation.charged = charge;
  reservation.released = release;

  writeLedger(d, wallet, {
    type: 'charge', amount: -charge, projectId: reservation.projectId, reference: reservation.id,
    note: 'Actual usage charged', balanceBefore, balanceAfter: wallet.balance,
    reservedBefore, reservedAfter: wallet.reserved,
  });
  if (release > 0) {
    writeLedger(d, wallet, {
      type: 'release', amount: 0, projectId: reservation.projectId, reference: reservation.id,
      note: `${release} unused reserved tokens returned`, reservedBefore: wallet.reserved,
      reservedAfter: wallet.reserved,
    });
  }
  return reservation;
}

/** Refund-style debit for revoked purchases. Never drives the balance below zero. */
function debitPurchase(d, userId, { amount, reference }) {
  const wallet = getWallet(d, userId);
  const takeable = Math.min(amount, wallet.balance - wallet.reserved, wallet.purchased);
  if (takeable <= 0) {
    writeLedger(d, wallet, { type: 'refund_pending_review', amount: 0, reference, note: 'Refund requires manual review' });
    return { debited: 0, pendingReview: amount };
  }
  const before = wallet.balance;
  wallet.balance -= takeable;
  wallet.purchased -= takeable;
  writeLedger(d, wallet, { type: 'refund', amount: -takeable, reference, balanceBefore: before, balanceAfter: wallet.balance });
  return { debited: takeable, pendingReview: amount - takeable };
}

module.exports = {
  STARTER_TOKENS, getWallet, snapshot, grantStarter, credit, reserve, settle, debitPurchase,
};

/** Read-only wallet view for the UI. Does not create a wallet row. */
function viewFor(d, userId) {
  const wallet = d.wallets.find((w) => w.userId === userId) || { userId, balance: 0, reserved: 0, used: 0, purchased: 0 };
  const ledger = d.ledger
    .filter((e) => e.userId === userId)
    .slice(-100)
    .reverse()
    .map(({ id, type, amount, balanceBefore, balanceAfter, reservedBefore, reservedAfter, projectId, note, createdAt }) => ({
      id, type, amount, balanceBefore, balanceAfter, reservedBefore, reservedAfter, projectId, note, createdAt,
    }));
  const starterGranted = d.ledger.some((e) => e.userId === userId && e.type === 'starter_grant');
  return { ...snapshot(wallet), starterGranted, starterAllowance: STARTER_TOKENS, ledger };
}

module.exports.viewFor = viewFor;
