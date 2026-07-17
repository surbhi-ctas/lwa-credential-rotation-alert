'use strict';

const cron = require('node-cron');
const { evaluateCredential, DEFAULT_ALERT_MILESTONES } = require('./rotation');
const { sendAlerts } = require('./alerts');

class RotationMonitor {
  /**
   * @param {object} opts
   * @param {object} opts.store
   * @param {number} [opts.alertBeforeDays=7] - continuous alerts when daysLeft ≤ this
   * @param {number[]} [opts.alertMilestones=[30,14,7,3,1]] - also alert on these exact days-left
   * @param {string} [opts.cronExpression='0 9 * * *']
   * @param {string} [opts.timezone] - e.g. 'Asia/Kolkata'
   * @param {boolean} [opts.runOnStart=true] - check immediately when start()
   * @param {boolean} [opts.enabled=true] - master switch
   * @param {boolean} [opts.dryRun=false] - evaluate only; do not send alerts
   * @param {boolean} [opts.trackClientSecret=true]
   * @param {boolean} [opts.trackRefreshToken=false]
   * @param {number} [opts.minRepeatHours=0] - suppress repeat alerts for same store within N hours
   * @param {boolean} [opts.warnMissingNextDate=true] - log stores with no next rotation date
   * @param {string} [opts.projectName] - project label in alerts; falls back to LWA_PROJECT_NAME / COMPANY_NAME / PROJECT_NAME env
   * @param {function} [opts.onAlert]
   * @param {function} [opts.onCheckComplete] - (summary, results) after each checkNow
   * @param {boolean|object} [opts.email=false]
   * @param {boolean} [opts.console=true]
   * @param {string} [opts.slackWebhook]
   * @param {string} [opts.webhookUrl]
   */
  constructor({
    store,
    alertBeforeDays = 7,
    alertMilestones = DEFAULT_ALERT_MILESTONES,
    cronExpression = '0 9 * * *',
    timezone,
    onAlert,
    onCheckComplete,
    runOnStart = true,
    enabled = true,
    dryRun = false,
    trackClientSecret = true,
    trackRefreshToken = false,
    minRepeatHours = 0,
    warnMissingNextDate = true,
    projectName,
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
    this.alertMilestones = Array.isArray(alertMilestones) ? alertMilestones : [];
    this.cronExpression = cronExpression;
    this.timezone = timezone;
    this.onAlert = onAlert;
    this.onCheckComplete = onCheckComplete;
    this.runOnStart = runOnStart;
    this.enabled = enabled !== false;
    this.dryRun = Boolean(dryRun);
    this.trackClientSecret = trackClientSecret;
    this.trackRefreshToken = trackRefreshToken;
    this.minRepeatHours = Number(minRepeatHours) || 0;
    this.warnMissingNextDate = warnMissingNextDate !== false;
    this.projectName =
      projectName ||
      process.env.LWA_PROJECT_NAME ||
      process.env.COMPANY_NAME ||
      process.env.PROJECT_NAME ||
      undefined;
    this.email = email;
    this.consoleEnabled = consoleEnabled;
    this.slackWebhook = slackWebhook;
    this.webhookUrl = webhookUrl;
    this.task = null;
    /** @type {Map<string, { at: number, severity: string }>} */
    this._lastAlert = new Map();
  }

  _alertKey(evaluation, check) {
    return `${evaluation.credentialId || evaluation.label}:${check.type}`;
  }

  /**
   * Skip dispatch if we already alerted recently (unless severity got worse).
   */
  _shouldDispatch(evaluation) {
    if (this.minRepeatHours <= 0) return true;
    const alerting = (evaluation.checks || []).filter((c) => c.shouldAlert);
    if (!alerting.length) return false;

    const rank = { info: 1, warning: 2, critical: 3 };
    const now = Date.now();
    const windowMs = this.minRepeatHours * 60 * 60 * 1000;

    // Dispatch if ANY check is new / escalated / outside silence window
    return alerting.some((check) => {
      const key = this._alertKey(evaluation, check);
      const prev = this._lastAlert.get(key);
      if (!prev) return true;
      if (now - prev.at >= windowMs) return true;
      if ((rank[check.severity] || 0) > (rank[prev.severity] || 0)) return true;
      return false;
    });
  }

  _rememberAlert(evaluation) {
    const now = Date.now();
    for (const check of evaluation.checks || []) {
      if (!check.shouldAlert) continue;
      this._lastAlert.set(this._alertKey(evaluation, check), {
        at: now,
        severity: check.severity
      });
    }
  }

  async _dispatchAlert(evaluation, credential) {
    if (this.dryRun) return;

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
   * Run a single check across every store/credential.
   * @returns {Promise<object[]>}
   */
  async checkNow() {
    if (!this.enabled) {
      return [];
    }

    const credentials = await this.store.getAllCredentials();
    const results = [];
    let alerted = 0;
    let skippedDedupe = 0;
    let missingNext = 0;

    for (const credential of credentials || []) {
      if (!credential) continue;

      const evaluation = evaluateCredential(credential, this.alertBeforeDays, {
        trackClientSecret: this.trackClientSecret,
        trackRefreshToken: this.trackRefreshToken,
        alertMilestones: this.alertMilestones,
        projectName: this.projectName
      });
      results.push(evaluation);

      if (evaluation.missingNextDate) {
        missingNext += 1;
        if (this.warnMissingNextDate) {
          console.warn(
            `[lwa-credential-rotation-alert] missing nextClientSecretRotationAt for store: ${
              evaluation.label || evaluation.credentialId || '?'
            }`
          );
        }
      }

      if (!evaluation.shouldAlert) continue;

      if (!this._shouldDispatch(evaluation)) {
        skippedDedupe += 1;
        evaluation.alertSkipped = 'dedupe';
        continue;
      }

      try {
        await this._dispatchAlert(evaluation, credential);
        this._rememberAlert(evaluation);
        alerted += 1;
        evaluation.alerted = !this.dryRun;
        evaluation.dryRun = this.dryRun;
      } catch (err) {
        console.error(
          `[lwa-credential-rotation-alert] onAlert failed for ${evaluation.credentialId}:`,
          err
        );
        evaluation.alertError = String(err && err.message ? err.message : err);
      }
    }

    const summary = {
      checkedAt: new Date(),
      total: results.length,
      alerting: results.filter((r) => r.shouldAlert).length,
      alerted,
      skippedDedupe,
      missingNextDate: missingNext,
      dryRun: this.dryRun
    };

    if (typeof this.onCheckComplete === 'function') {
      try {
        await this.onCheckComplete(summary, results);
      } catch (err) {
        console.error('[lwa-credential-rotation-alert] onCheckComplete failed:', err);
      }
    }

    return results;
  }

  /** Start the recurring cron job. */
  start() {
    if (!this.enabled) {
      console.warn('[lwa-credential-rotation-alert] monitor.enabled=false — not started');
      return null;
    }
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

  /** Clear in-memory dedupe state (useful in tests). */
  clearAlertHistory() {
    this._lastAlert.clear();
  }
}

module.exports = RotationMonitor;
