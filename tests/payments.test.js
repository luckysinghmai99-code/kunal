'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Store } = require('../src/lib/store');
const { hmacHex } = require('../src/lib/crypto');
const { tempConfig } = require('./helpers');
const { AuthService } = require('../src/services/auth');
const { PaymentService, finalPaise } = require('../src/services/payments');
const wallet = require('../src/services/wallet');

const SECRET = 'test_key_secret_value';
const WEBHOOK = 'test_webhook_secret_value';

function setup(fetchImpl) {
  const config = tempConfig({ RAZORPAY_KEY_ID: 'rzp_test_ID123', RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK });
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const auth = new AuthService(store, config);
  const user = auth.signup({ email: 'buyer@example.com', password: 'longpassword', name: 'Buyer' });
  const pay = new PaymentService(store, config, { fetchImpl: fetchImpl || (async () => ({ ok: true, json: async () => ({ id: 'order_TEST123' }) })) });
  // Seed a local order as createOrder would.
  store.tx((d) => d.orders.push({
    id: 'ord_local1', razorpayOrderId: 'order_TEST123', userId: user.id, packageId: 'basic',
    amountPaise: 49900, currency: 'INR', tokens: 330, status: 'created', createdAt: new Date().toISOString(),
  }));
  return { store, pay, user, config };
}

test('payment amounts: discounts are applied in paise', () => {
  assert.equal(finalPaise({ priceInr: 1299, discountPercent: 10 }), 116910);
  assert.equal(finalPaise({ priceInr: 499, discountPercent: 0 }), 49900);
});

test('payments are not configured without keys: clear 503, no fake success', async () => {
  const config = tempConfig();
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const pay = new PaymentService(store, config);
  assert.equal(pay.configured, false);
  await assert.rejects(() => pay.createOrder('u', 'basic'), (e) => e.status === 503);
  assert.throws(() => pay.confirmPayment('u', { orderId: 'a', paymentId: 'b', signature: 'c' }), (e) => e.status === 503);
});

test('createOrder calls Razorpay with server-side basic auth and records a local order', async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ id: 'order_ABC999' }) };
  };
  const { store, user, config } = setup(fetchImpl);
  const pay = new PaymentService(store, config, { fetchImpl });
  const res = await pay.createOrder(user.id, 'starter');
  assert.equal(res.orderId, 'order_ABC999');
  assert.equal(captured.url, 'https://api.razorpay.com/v1/orders');
  assert.match(captured.opts.headers.Authorization, /^Basic /);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.amount, 19900);
  assert.equal(body.currency, 'INR');
  assert.equal(store.read((d) => d.orders.some((o) => o.razorpayOrderId === 'order_ABC999')), true);
});

test('checkout confirmation: valid signature credits tokens exactly once', () => {
  const { store, pay, user } = setup();
  const paymentId = 'pay_OK1';
  const signature = hmacHex(SECRET, 'order_TEST123|pay_OK1');
  const first = pay.confirmPayment(user.id, { orderId: 'order_TEST123', paymentId, signature });
  const second = pay.confirmPayment(user.id, { orderId: 'order_TEST123', paymentId, signature });
  assert.equal(first.credited, 330);
  assert.equal(second.duplicate, true);
  assert.equal(store.read((d) => wallet.viewFor(d, user.id)).total, 380); // 50 starter + 330
});

test('checkout confirmation: a forged signature is rejected and grants nothing', () => {
  const { store, pay, user } = setup();
  assert.throws(() => pay.confirmPayment(user.id, { orderId: 'order_TEST123', paymentId: 'pay_X', signature: 'deadbeef' }), (e) => e.status === 400);
  assert.equal(store.read((d) => wallet.viewFor(d, user.id)).total, 50);
});

test("checkout confirmation: another user's order cannot be claimed", () => {
  const { store, pay, config } = setup();
  const auth = new AuthService(store, config);
  const other = auth.signup({ email: 'other@example.com', password: 'longpassword' });
  const signature = hmacHex(SECRET, 'order_TEST123|pay_OK2');
  assert.throws(() => pay.confirmPayment(other.id, { orderId: 'order_TEST123', paymentId: 'pay_OK2', signature }), (e) => e.status === 404);
});

test('webhook: invalid signature is rejected', () => {
  const { pay } = setup();
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_W', order_id: 'order_TEST123' } } } }));
  assert.throws(() => pay.handleWebhook(body, 'bad'), (e) => e.status === 400);
});

test('webhook: payment.captured credits once, idempotently', () => {
  const { store, pay, user } = setup();
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_W1', order_id: 'order_TEST123' } } } }));
  const sig = hmacHex(WEBHOOK, body);
  pay.handleWebhook(body, sig);
  pay.handleWebhook(body, sig);
  assert.equal(store.read((d) => wallet.viewFor(d, user.id)).total, 380);
});

test('webhook is refused when no webhook secret is configured', () => {
  const config = tempConfig({ RAZORPAY_KEY_ID: 'rzp_test_ID123', RAZORPAY_KEY_SECRET: SECRET });
  const store = new Store(path.join(config.dataDir, 'db.json')).open();
  const pay = new PaymentService(store, config);
  assert.throws(() => pay.handleWebhook(Buffer.from('{}'), 'x'), (e) => e.status === 503);
});
