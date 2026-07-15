'use strict';

/**
 * Amazon's own defaults (confirmed from SP-API docs):
 *  - LWA client secret must be rotated every 180 days.
 *  - Refresh token (public apps) must be re-authorized every 365 days.
 * You can override either per credential.
 */
const DEFAULTS = {
  CLIENT_SECRET_ROTATION_DAYS: 180,
  REFRESH_TOKEN_ROTATION_DAYS: 365
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the next rotation date given a last-rotated date and interval.
 * @param {Date|string} lastRotatedAt
 * @param {number} intervalDays
 * @returns {Date}
 */
function computeNextRotation(lastRotatedAt, intervalDays) {
  const base = new Date(lastRotatedAt);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid lastRotatedAt: ${lastRotatedAt}`);
  }
  const days = Number(intervalDays);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid intervalDays: ${intervalDays}`);
  }
  return new Date(base.getTime() + days * MS_PER_DAY);
}

/**
 * Days remaining until a date (can be negative if overdue).
 * @param {Date|string} targetDate
 * @returns {number}
 */
function daysUntil(targetDate) {
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`Invalid targetDate: ${targetDate}`);
  }
  const ms = target.getTime() - Date.now();
  return Math.ceil(ms / MS_PER_DAY);
}

/**
 * Resolve the due date for a rotation check.
 * Prefers explicit next*At; otherwise computes from last*At + interval.
 */
function resolveDueDate(credential, {
  nextKey,
  lastKey,
  intervalKey,
  defaultInterval
}) {
  if (credential[nextKey]) return new Date(credential[nextKey]);
  if (credential[lastKey]) {
    const interval = credential[intervalKey] || defaultInterval;
    return computeNextRotation(credential[lastKey], interval);
  }
  return null;
}

/**
 * Evaluate a single credential record and decide alert status.
 * A credential can track BOTH a client-secret rotation date and a
 * refresh-token re-auth date independently.
 *
 * Supports multiple Amazon stores/marketplaces: pass one credential
 * row per store; each is evaluated on its own dates.
 *
 * @param {object} credential - canonical shape (see createStore / README)
 * @param {number} alertBeforeDays - start alerting this many days before deadline
 * @returns {object} evaluation result
 */
function evaluateCredential(credential, alertBeforeDays = 2) {
  const checks = [];

  const secretDue = resolveDueDate(credential, {
    nextKey: 'nextClientSecretRotationAt',
    lastKey: 'lastClientSecretRotatedAt',
    intervalKey: 'clientSecretRotationIntervalDays',
    defaultInterval: DEFAULTS.CLIENT_SECRET_ROTATION_DAYS
  });

  if (secretDue) {
    const d = daysUntil(secretDue);
    checks.push({
      type: 'CLIENT_SECRET',
      dueDate: secretDue,
      daysLeft: d,
      overdue: d < 0,
      shouldAlert: d <= alertBeforeDays
    });
  }

  const tokenDue = resolveDueDate(credential, {
    nextKey: 'nextRefreshTokenRotationAt',
    lastKey: 'lastRefreshTokenRotatedAt',
    intervalKey: 'refreshTokenRotationIntervalDays',
    defaultInterval: DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS
  });

  if (tokenDue) {
    const d = daysUntil(tokenDue);
    checks.push({
      type: 'REFRESH_TOKEN',
      dueDate: tokenDue,
      daysLeft: d,
      overdue: d < 0,
      shouldAlert: d <= alertBeforeDays
    });
  }

  const projectName = credential.projectName || (credential.meta && credential.meta.projectName);
  const marketplace = credential.marketplace;
  const label =
    credential.label ||
    [projectName, marketplace].filter(Boolean).join(' - ') ||
    credential.id;

  return {
    credentialId: credential.id != null ? String(credential.id) : undefined,
    projectName: projectName || undefined,
    marketplace,
    label,
    checks,
    shouldAlert: checks.some((c) => c.shouldAlert)
  };
}

module.exports = {
  DEFAULTS,
  MS_PER_DAY,
  computeNextRotation,
  daysUntil,
  resolveDueDate,
  evaluateCredential
};
