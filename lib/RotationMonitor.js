'use strict';

const cron = require('node-cron');
const { evaluateCredential } = require('./rotation');
const { sendAlerts } = require('./alerts');

class RotationMonitor {
  /**
   * @param {object} opts
   * @param {object} opts.store - storage adapter (createStore / MemoryStore / custom)
   * @param {number} [opts.alertBeforeDays=2]
   * @param {string} [opts.cronExpression='0 9 * * *']
   * @param {string} [opts.timezone]
   * @param {function} [opts.onAlert] - custom handler; if omitted, built-in channels are used
   * @param {boolean} [opts.runOnStart=true]
   * @param {boolean|object} [opts.email=false]
   *   false → no email
   *   true  → email using SMTP_* / LWA_ALERT_EMAIL_* env vars
   *   { to, from, host, port, auth } → email with this config
   * @param {boolean} [opts.console=true] - log alerts to console
   * @param {string} [opts.slackWebhook] - Slack incoming webhook URL
   * @param {string} [opts.webhookUrl] - generic POST webhook
   */
  constructor({
    store,
    alertBeforeDays = 2,
    cronExpression = '0 9 * * *',
    timezone,
    onAlert,
    runOnStart = true,
    email = false,
    console: consoleEnabled = true,
    slackWebhook,
    webhookUrl
  }) {
    if (!store) throw new Error('RotationMonitor requires a `store` adapter.');
    if (typeof store.getAllCredentials !== 'function') {
      throw new Error('store.getAllCredentials() is required.');
    }
    this.store = store;
    this.alertBeforeDays = alertBeforeDays;
    this.cronExpression = cronExpression;
    this.timezone = timezone;
    this.onAlert = onAlert;
    this.runOnStart = runOnStart;
    this.email = email;
    this.consoleEnabled = consoleEnabled;
    this.slackWebhook = slackWebhook;
    this.webhookUrl = webhookUrl;
    this.task = null;
  }

  async _dispatchAlert(evaluation, credential) {
    if (typeof this.onAlert === 'function') {
      await this.onAlert(evaluation, credential);
      return;
    }

    await sendAlerts(
      {
        email: this.email,
        console: this.consoleEnabled,
        slackWebhook: this.slackWebhook || process.env.LWA_ALERT_SLACK_WEBHOOK,
        webhookUrl: this.webhookUrl || process.env.LWA_ALERT_WEBHOOK_URL
      },
      evaluation
    );
  }

  /**
   * Run a single check across every credential the store returns
   * (all Amazon marketplaces / stores in that project's table).
   */
  async checkNow() {
    const credentials = await this.store.getAllCredentials();
    const results = [];

    for (const credential of credentials || []) {
      if (!credential) continue;
      const evaluation = evaluateCredential(credential, this.alertBeforeDays);
      results.push(evaluation);

      if (evaluation.shouldAlert) {
        try {
          await this._dispatchAlert(evaluation, credential);
        } catch (err) {
          console.error(
            `[lwa-credential-rotation-alert] onAlert failed for ${evaluation.credentialId}:`,
            err
          );
        }
      }
    }

    return results;
  }

  /** Start the recurring cron job. */
  start() {
    if (!cron.validate(this.cronExpression)) {
      throw new Error(`Invalid cronExpression: ${this.cronExpression}`);
    }

    if (this.runOnStart) {
      this.checkNow().catch((err) =>
        console.error('[lwa-credential-rotation-alert] initial check failed:', err)
      );
    }

    const scheduleOpts = this.timezone ? { timezone: this.timezone } : undefined;
    this.task = cron.schedule(
      this.cronExpression,
      () => {
        this.checkNow().catch((err) =>
          console.error('[lwa-credential-rotation-alert] scheduled check failed:', err)
        );
      },
      scheduleOpts
    );
    return this.task;
  }

  /** Stop the recurring cron job. */
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

module.exports = RotationMonitor;
