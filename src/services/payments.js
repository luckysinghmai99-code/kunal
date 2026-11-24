'use strict';

// Razorpay integration (India). Keys come from environment variables only.
// Tokens are credited ONLY after server-side verification:
//   - checkout: HMAC-SHA256(order_id|payment_id) must equal razorpay_signature
//   - webhook:  HMAC-SHA256(raw body) must equal X-Razorpay-Signature
// Credits are idempotent per payment id, so retries never double-credit.

const { hmacHex, safeEqual, newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');
const wallet = require('./wallet');

const RAZORPAY_API = 'https://api.razorpay.com/v1';

function finalPaise(pkg) {
  return Math.round(pkg.priceInr * (100 - pkg.discountPercent)) ; // priceInr * (1-d) * 100 paise
}

function tokensFor(pkg) {
  return pkg.tokens + (pkg.bonusTokens || 0);
}

class PaymentService {
  constructor(store, config, { fetchImpl = globalThis.fetch } = {}) {
    this.store = store;
    this.config = config;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.config.razorpay.keyId && this.config.razorpay.keySecret);
  }

  get webhookConfigured() {
    return Boolean(this.config.razorpay.webhookSecret);
  }

  listPackages() {
    return this.store.read((d) => d.packages.filter((p) => p.active).map((p) => ({
      id: p.id,
      name: p.name,
      priceInr: p.priceInr,
      discountPercent: p.discountPercent,
      payableInr: finalPaise(p) / 100,
      tokens: p.tokens,
      bonusTokens: p.bonusTokens || 0,
      totalTokens: tokensFor(p),
    })));
  }

  requireConfigured() {
    if (!this.configured) {
      throw new HttpError(503, 'Payments are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }
  }

  async createOrder(userId, packageId) {
    this.requireConfigured();
    const pkg = this.store.read((d) => d.packages.find((p) => p.id === packageId && p.active));
    if (!pkg) throw new HttpError(404, 'Package not found');
    const amount = finalPaise(pkg);
    const localId = newId('ord');

    const auth = Buffer.from(`${this.config.razorpay.keyId}:${this.config.razorpay.keySecret}`).toString('base64');
    const res = await this.fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: this.config.currency, receipt: localId, notes: { userId, packageId } }),
    });
    if (!res.ok) throw new HttpError(502, 'Razorpay rejected the order request');
    const rzp = await res.json();

    this.store.tx((d) => {
      d.orders.push({
        id: localId, razorpayOrderId: rzp.id, userId, packageId, amountPaise: amount,
        currency: this.config.currency, tokens: tokensFor(pkg), status: 'created', createdAt: new Date().toISOString(),
      });
    });
    return { orderId: rzp.id, amount, currency: this.config.currency, keyId: this.config.razorpay.keyId, packageName: pkg.name };
  }

  verifySignature(orderId, paymentId, signature) {
    if (!this.configured) return false;
    const expected = hmacHex(this.config.razorpay.keySecret, `${orderId}|${paymentId}`);
    return safeEqual(expected, signature);
  }

  /** Called from the checkout handler after Razorpay returns the payment. */
  confirmPayment(userId, { orderId, paymentId, signature }) {
    this.requireConfigured();
    if (!orderId || !paymentId || !signature) throw new HttpError(400, 'orderId, paymentId and signature are required');
    if (!this.verifySignature(orderId, paymentId, signature)) throw new HttpError(400, 'Payment signature verification failed');

    return this.store.tx((d) => {
      const order = d.orders.find((o) => o.razorpayOrderId === orderId);
      if (!order || order.userId !== userId) throw new HttpError(404, 'Order not found');
      const result = wallet.credit(d, userId, {
        amount: order.tokens, type: 'purchase', reference: paymentId, note: `Purchased ${order.packageId}`,
      });
      order.status = 'paid';
      if (!d.payments.some((p) => p.id === paymentId)) {
        d.payments.push({ id: paymentId, orderId: order.id, razorpayOrderId: orderId, userId, amountPaise: order.amountPaise, status: 'captured', createdAt: new Date().toISOString() });
      }
      return { credited: result.duplicate ? 0 : order.tokens, duplicate: result.duplicate, balance: wallet.snapshot(result.wallet) };
    });
  }

  /**
   * Razorpay webhook. Requires the raw request body so the signature can be checked
   * before any JSON parsing. Idempotent per payment id.
   */
  handleWebhook(rawBody, signatureHeader) {
    if (!this.webhookConfigured) throw new HttpError(503, 'Webhook secret not configured (RAZORPAY_WEBHOOK_SECRET)');
    const expected = hmacHex(this.config.razorpay.webhookSecret, rawBody);
    if (!safeEqual(expected, signatureHeader || '')) throw new HttpError(400, 'Invalid webhook signature');

    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'Malformed webhook body'); }
    const payment = event.payload && event.payload.payment && event.payload.payment.entity;
    const refund = event.payload && event.payload.refund && event.payload.refund.entity;

    return this.store.tx((d) => {
      d.events.push({ id: newId('evt'), type: event.event, receivedAt: new Date().toISOString() });
      if (event.event === 'payment.captured' && payment) {
        const order = d.orders.find((o) => o.razorpayOrderId === payment.order_id);
        if (!order) return { handled: false, reason: 'unknown order' };
        const result = wallet.credit(d, order.userId, { amount: order.tokens, type: 'purchase', reference: payment.id, note: 'Webhook capture' });
        order.status = 'paid';
        return { handled: true, duplicate: result.duplicate };
      }
      if (event.event === 'payment.failed' && payment) {
        const order = d.orders.find((o) => o.razorpayOrderId === payment.order_id);
        if (order && order.status !== 'paid') order.status = 'failed';
        return { handled: true };
      }
      if (event.event === 'refund.processed' && refund) {
        const order = d.orders.find((o) => o.razorpayOrderId === refund.order_id || (refund.payment_id && d.payments.find((p) => p.id === refund.payment_id && p.orderId === o.id)));
        if (!order) return { handled: false, reason: 'unknown order' };
        const tokens = Math.floor((order.tokens * refund.amount) / order.amountPaise);
        const result = wallet.debitPurchase(d, order.userId, { amount: tokens, reference: refund.id });
        return { handled: true, ...result };
      }
      return { handled: false, reason: 'event not used' };
    });
  }

  paymentHistory(userId) {
    return this.store.read((d) => ({
      orders: d.orders.filter((o) => o.userId === userId).map(({ id, packageId, amountPaise, currency, tokens, status, createdAt, razorpayOrderId }) => ({ id, packageId, amountPaise, currency, tokens, status, createdAt, razorpayOrderId })),
      payments: d.payments.filter((p) => p.userId === userId).map(({ id, amountPaise, status, createdAt }) => ({ id, amountPaise, status, createdAt })),
    }));
  }
}

module.exports = { PaymentService, finalPaise, tokensFor };
