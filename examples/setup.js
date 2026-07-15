'use strict';

/**
 * Example: monitor/lwaRotationMonitor.js
 *
 * Copy into every project. Change only:
 *  - which model/table you wrap with createStore
 *  - how you send alerts (email / Slack / webhook)
 */

const {
  RotationMonitor,
  createStore,
  alerts
} = require('lwa-credential-rotation-alert');

// --- pick YOUR project's model (any table name) ---
const { AmazonCred } = require('../models/AmazonCred'); // mongoose example
// OR: const { store } = require('../models/amazonCred.model')(sequelize, 'project_a_amazon_creds');

const store = createStore({
  model: AmazonCred
  // If columns differ from the package defaults:
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
  alertBeforeDays: 2,
  cronExpression: '0 9 * * *',
  timezone: process.env.TZ || 'UTC',
  runOnStart: true,
  onAlert: async (evaluation) => {
    // evaluation = { credentialId, projectName, marketplace, label, checks, shouldAlert }

    // Console (always useful in logs)
    alerts.consoleAlert(evaluation);

    // Slack
    if (process.env.LWA_ALERT_SLACK_WEBHOOK) {
      await alerts.slackAlert(process.env.LWA_ALERT_SLACK_WEBHOOK, evaluation);
    }

    // Email (requires: npm install nodemailer)
    if (process.env.MAIL_TO) {
      await alerts.emailAlert(
        {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD
          }
        },
        {
          from: process.env.EMAIL_FROM || process.env.SMTP_USERNAME,
          to: process.env.MAIL_TO
        },
        evaluation
      );
    }

    // Or fire all configured channels at once:
    // await alerts.sendAlerts({
    //   console: true,
    //   slackWebhook: process.env.LWA_ALERT_SLACK_WEBHOOK,
    //   email: {
    //     transporterOptions: { host: process.env.SMTP_HOST, port: 587, auth: { user, pass } },
    //     mailOptions: { from, to: process.env.MAIL_TO }
    //   }
    // }, evaluation);
  }
});

monitor.start();
module.exports = monitor;

/**
 * In app.js / server.js:
 *   require('./monitor/lwaRotationMonitor');
 *
 * After you rotate a secret in Seller Central / SP-API:
 *   await store.markClientSecretRotated(id, { newClientSecret: '...' });
 * After seller re-authorizes:
 *   await store.markRefreshTokenRotated(id, { newRefreshToken: '...' });
 */
