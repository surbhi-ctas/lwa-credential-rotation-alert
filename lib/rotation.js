'use strict';

/**
 * Amazon defaults:
 *  - LWA client secret: rotate every 180 days.
 *  - Refresh token (public apps): re-authorize every 365 days (optional tracking).
 */
const DEFAULTS = {
  CLIENT_SECRET_ROTATION_DAYS: 180,
  REFRESH_TOKEN_ROTATION_DAYS: 365
};

/** Suggested early warning checkpoints (days left). */
const DEFAULT_ALERT_MILESTONES = [30, 14, 7, 3, 1];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeNextRotation(fromDate, intervalDays) {
  const base = new Date(fromDate);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid fromDate: ${fromDate}`);
  }
  const days = Number(intervalDays);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid intervalDays: ${intervalDays}`);
  }
  return new Date(base.getTime() + days * MS_PER_DAY);
}

function daysUntil(targetDate) {
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`Invalid targetDate: ${targetDate}`);
  }
  const ms = target.getTime() - Date.now();
  return Math.ceil(ms / MS_PER_DAY);
}

function resolveDueDate(credential, { nextKey, lastKey, intervalKey, defaultInterval }) {
  if (credential[nextKey]) return new Date(credential[nextKey]);
  if (credential[lastKey]) {
    const interval = credential[intervalKey] || defaultInterval;
    return computeNextRotation(credential[lastKey], interval);
  }
  return null;
}

/**
 * @param {number} daysLeft
 * @returns {'critical'|'warning'|'info'}
 */
function severityForDaysLeft(daysLeft) {
  if (daysLeft < 0 || daysLeft <= 1) return 'critical';
  if (daysLeft <= 7) return 'warning';
  return 'info';
}

/**
 * Decide whether to alert for a given daysLeft.
 *
 * - Continuous window: daysLeft <= alertBeforeDays (or overdue)
 * - Early milestones: exact match on alertMilestones (e.g. day 30, day 14)
 *
 * @param {number} daysLeft
 * @param {number} alertBeforeDays
 * @param {number[]} [alertMilestones]
 */
function shouldAlertForDaysLeft(daysLeft, alertBeforeDays, alertMilestones) {
  if (daysLeft < 0) return true; // overdue — always
  if (daysLeft <= alertBeforeDays) return true;
  if (Array.isArray(alertMilestones) && alertMilestones.includes(daysLeft)) return true;
  return false;
}

/**
 * Which milestone bucket this daysLeft hits (exact or continuous window).
 * @returns {number|null}
 */
function resolveMilestone(daysLeft, alertBeforeDays, alertMilestones) {
  if (daysLeft < 0) return 0;
  if (Array.isArray(alertMilestones) && alertMilestones.includes(daysLeft)) {
    return daysLeft;
  }
  if (daysLeft <= alertBeforeDays) return daysLeft;
  return null;
}

function buildCheck(type, dueDate, alertBeforeDays, alertMilestones) {
  const d = daysUntil(dueDate);
  const shouldAlert = shouldAlertForDaysLeft(d, alertBeforeDays, alertMilestones);
  return {
    type,
    dueDate,
    daysLeft: d,
    overdue: d < 0,
    shouldAlert,
    severity: severityForDaysLeft(d),
    milestone: resolveMilestone(d, alertBeforeDays, alertMilestones)
  };
}

/**
 * @param {object} credential
 * @param {number} [alertBeforeDays=2]
 * @param {object} [opts]
 * @param {boolean} [opts.trackClientSecret=true]
 * @param {boolean} [opts.trackRefreshToken=false]
 * @param {number[]} [opts.alertMilestones] - e.g. [30, 14, 7, 3, 1]
 * @param {string} [opts.projectName] - default project label if credential has none
 */
function evaluateCredential(credential, alertBeforeDays = 2, opts = {}) {
  const trackClientSecret = opts.trackClientSecret !== false;
  const trackRefreshToken = opts.trackRefreshToken === true;
  const alertMilestones = opts.alertMilestones;
  const checks = [];

  if (trackClientSecret) {
    const secretDue = resolveDueDate(credential, {
      nextKey: 'nextClientSecretRotationAt',
      lastKey: 'lastClientSecretRotatedAt',
      intervalKey: 'clientSecretRotationIntervalDays',
      defaultInterval: DEFAULTS.CLIENT_SECRET_ROTATION_DAYS
    });
    if (secretDue) {
      checks.push(buildCheck('CLIENT_SECRET', secretDue, alertBeforeDays, alertMilestones));
    }
  }

  if (trackRefreshToken) {
    const tokenDue = resolveDueDate(credential, {
      nextKey: 'nextRefreshTokenRotationAt',
      lastKey: 'lastRefreshTokenRotatedAt',
      intervalKey: 'refreshTokenRotationIntervalDays',
      defaultInterval: DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS
    });
    if (tokenDue) {
      checks.push(buildCheck('REFRESH_TOKEN', tokenDue, alertBeforeDays, alertMilestones));
    }
  }

  const projectName =
    credential.projectName ||
    opts.projectName ||
    (credential.meta && credential.meta.projectName);
  const marketplace = credential.marketplace;
  const label =
    credential.label ||
    [projectName, marketplace].filter(Boolean).join(' - ') ||
    credential.id;

  const alerting = checks.filter((c) => c.shouldAlert);
  const worst = alerting.length
    ? alerting.reduce((a, b) => {
        const rank = { critical: 3, warning: 2, info: 1 };
        return (rank[b.severity] || 0) > (rank[a.severity] || 0) ? b : a;
      })
    : null;

  return {
    credentialId: credential.id != null ? String(credential.id) : undefined,
    projectName: projectName || undefined,
    marketplace,
    label,
    checks,
    shouldAlert: alerting.length > 0,
    severity: worst ? worst.severity : undefined,
    missingNextDate:
      trackClientSecret &&
      !credential.nextClientSecretRotationAt &&
      !credential.lastClientSecretRotatedAt
  };
}

module.exports = {
  DEFAULTS,
  DEFAULT_ALERT_MILESTONES,
  MS_PER_DAY,
  computeNextRotation,
  daysUntil,
  resolveDueDate,
  severityForDaysLeft,
  shouldAlertForDaysLeft,
  evaluateCredential
};
