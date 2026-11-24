'use strict';

const path = require('path');

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function loadConfig(env = process.env) {
  const root = path.resolve(__dirname, '..');
  return {
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    appUrl: env.APP_URL || `http://localhost:${env.PORT || 3000}`,
    dataDir: path.resolve(root, env.DATA_DIR || 'data'),
    publicDir: path.resolve(root, 'public'),
    cookieSecure: bool(env.COOKIE_SECURE, false),
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    currency: env.CURRENCY || 'INR',
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID || '',
      keySecret: env.RAZORPAY_KEY_SECRET || '',
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    },
    llm: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    },
    deploy: {
      provider: env.DEPLOY_PROVIDER || '',
      token: env.DEPLOY_PROVIDER_TOKEN || '',
    },
  };
}

module.exports = { loadConfig };
