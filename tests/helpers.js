'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');

function tempConfig(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-test-'));
  return loadConfig({
    DATA_DIR: dir,
    ADMIN_EMAILS: 'admin@example.com',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    ...extra,
  });
}

module.exports = { tempConfig };
