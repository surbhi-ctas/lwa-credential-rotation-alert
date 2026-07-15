'use strict';

/**
 * ============================================================
 * COPY THIS FILE into each project as:
 *   monitor/lwaRotationMonitor.js
 *
 * Then in app.js / server.js add ONE line:
 *   require('./monitor/lwaRotationMonitor');
 * ============================================================
 */

const { RotationMonitor, createStore } = require('lwa-credential-rotation-alert');

// Point at YOUR credentials model (any table / collection name)
const YourAmazonCredModel = require('../models/YourAmazonCred'); // ← change this

const store = createStore({
  model: YourAmazonCredModel
  // If column names differ:
  // fields: {
  //   marketplace: 'region_code',
  //   lastClientSecretRotatedAt: 'secret_rotated_at',
  //   nextClientSecretRotationAt: 'secret_due_at',
  //   lastRefreshTokenRotatedAt: 'token_rotated_at',
  //   nextRefreshTokenRotationAt: 'token_due_at'
  // }
});

const monitor = new RotationMonitor({
  store,
  alertBeforeDays: Number(process.env.LWA_ALERT_BEFORE_DAYS || 2),
  cronExpression: process.env.LWA_ALERT_CRON || '0 9 * * *',
  timezone: process.env.TZ || 'Asia/Kolkata',
  runOnStart: true,

  // email: true  → send email (uses SMTP_* + LWA_ALERT_EMAIL_* env)
  // email: false → no email
  // email: { to, from, host, port, auth } → custom SMTP
  email: process.env.LWA_ALERT_EMAIL !== 'false',

  console: true,
  slackWebhook: process.env.LWA_ALERT_SLACK_WEBHOOK, // optional
  webhookUrl: process.env.LWA_ALERT_WEBHOOK_URL      // optional
});

monitor.start();

module.exports = { monitor, store };
