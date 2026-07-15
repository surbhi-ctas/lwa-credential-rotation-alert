'use strict';

/**
 * Example: custom column names on an existing table.
 * createStore maps YOUR columns → the package's logical fields.
 */

const { createStore, RotationMonitor, alerts } = require('lwa-credential-rotation-alert');

// Imagine your existing model uses different column names:
//   region_code, secret_rotated_at, secret_due_at, ...
function wireExistingModel(MyExistingModel) {
  const store = createStore({
    model: MyExistingModel,
    fields: {
      id: 'id',
      projectName: 'app_name',
      marketplace: 'region_code',
      label: 'display_name',
      clientId: 'lwa_client_id',
      clientSecret: 'lwa_client_secret',
      refreshToken: 'lwa_refresh_token',
      clientSecretRotationIntervalDays: 'secret_interval_days',
      lastClientSecretRotatedAt: 'secret_rotated_at',
      nextClientSecretRotationAt: 'secret_due_at',
      refreshTokenRotationIntervalDays: 'token_interval_days',
      lastRefreshTokenRotatedAt: 'token_rotated_at',
      nextRefreshTokenRotationAt: 'token_due_at'
    }
  });

  const monitor = new RotationMonitor({
    store,
    alertBeforeDays: 7,
    onAlert: (evaluation) => alerts.sendAlerts({ console: true }, evaluation)
  });

  return { store, monitor };
}

module.exports = { wireExistingModel };
