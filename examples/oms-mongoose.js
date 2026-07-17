'use strict';

/**
 * OMS example — MongoDB `tbl_store_details` (mongoose)
 *
 * REQUIRED in schema (add if missing):
 *   client_secret_next_rotation_at: { type: Date }
 *
 * Project name in emails/alerts comes from (first match):
 *   RotationMonitor projectName → LWA_PROJECT_NAME → COMPANY_NAME → PROJECT_NAME
 */

const {
  RotationMonitor,
  createStore,
  DEFAULTS,
  DEFAULT_ALERT_MILESTONES
} = require('lwa-credential-rotation-alert');

// const StoreDetails = require('../models/storeDetails.model');

function startOmsLwaMonitor(StoreDetails, options = {}) {
  const store = createStore({
    model: StoreDetails,
    filter: options.filter || { status: 1, is_amazon_store: true },
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

    // dynamic project name — shows in email subject/body
    // uses options.projectName, or env COMPANY_NAME (OMS already has this)
    projectName:
      options.projectName ||
      process.env.LWA_PROJECT_NAME ||
      process.env.COMPANY_NAME ||
      process.env.PROJECT_NAME,

    cronExpression: options.cronExpression || '0 9 * * *',
    timezone: options.timezone || 'Asia/Kolkata',
    runOnStart: options.runOnStart !== false,

    trackClientSecret: true,
    trackRefreshToken: false,

    alertBeforeDays: options.alertBeforeDays ?? 7,
    alertMilestones: options.alertMilestones ?? DEFAULT_ALERT_MILESTONES,
    minRepeatHours: options.minRepeatHours ?? 12,
    warnMissingNextDate: options.warnMissingNextDate !== false,

    email: options.email !== false,
    console: options.console !== false,

    enabled: options.enabled !== false,
    dryRun: Boolean(options.dryRun),
    onCheckComplete: options.onCheckComplete || ((summary) => {
      console.log(`[LWA ${process.env.COMPANY_NAME || 'OMS'}]`, summary);
    })
  });

  monitor.start();
  return { store, monitor };
}

module.exports = { startOmsLwaMonitor, DEFAULTS, DEFAULT_ALERT_MILESTONES };
