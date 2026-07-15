'use strict';

/**
 * OMS example — MongoDB `tbl_store_details` (mongoose)
 *
 * REQUIRED in schema (add if missing):
 *   client_secret_next_rotation_at: { type: Date }
 */

const {
  RotationMonitor,
  createStore,
  DEFAULTS,
  DEFAULT_ALERT_MILESTONES
} = require('lwa-credential-rotation-alert');

// const StoreDetails = require('../models/storeDetails.model');

function startOmsLwaMonitor(StoreDetails) {
  const store = createStore({
    model: StoreDetails,
    filter: { status: 1, is_amazon_store: true },
    fields: {
      id: '_id',
      label: 'store_name',
      marketplace: 'marketplace_id',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      refreshToken: 'refresh_token',
      nextClientSecretRotationAt: 'client_secret_next_rotation_at',
      lastClientSecretRotatedAt: false,
      clientSecretRotationIntervalDays: false,
      lastRefreshTokenRotatedAt: false,
      nextRefreshTokenRotationAt: false,
      refreshTokenRotationIntervalDays: false,
      projectName: false
    }
  });

  const monitor = new RotationMonitor({
    store,

    // --- scheduling ---
    cronExpression: '0 9,21 * * *', // 2× / day
    timezone: 'Asia/Kolkata',
    runOnStart: true, // check immediately on boot

    // --- what to track ---
    trackClientSecret: true,
    trackRefreshToken: false,
    projectName: 'OMS',

    // --- when to alert ---
    alertBeforeDays: 7, // continuous while ≤ 7 days left (or overdue)
    alertMilestones: DEFAULT_ALERT_MILESTONES, // also fire on day 30, 14, 7, 3, 1
    // alertMilestones: [30, 14, 7, 3, 1],

    // --- noise control ---
    minRepeatHours: 12, // don't re-email same store within 12h (unless severity worsens)
    warnMissingNextDate: true, // log stores with no next date

    // --- channels ---
    email: true,
    console: true,
    // slackWebhook: process.env.LWA_ALERT_SLACK_WEBHOOK,

    // --- safety / ops ---
    enabled: true,
    dryRun: false, // true = evaluate only, no email/slack
    onCheckComplete: (summary) => {
      console.log('[LWA rotation check]', summary);
      // summary = { total, alerting, alerted, skippedDedupe, missingNextDate, dryRun }
    }
  });

  monitor.start();

  // Manual check anytime (e.g. admin API):
  // await monitor.checkNow();

  return { store, monitor };
}

module.exports = { startOmsLwaMonitor, DEFAULTS, DEFAULT_ALERT_MILESTONES };
