'use strict';

const { computeNextRotation, DEFAULTS } = require('./rotation');

/**
 * STORAGE ADAPTER CONTRACT
 * ------------------------
 * Prefer `createStore({ model, fields, filter })` for production.
 *
 * Canonical credential shape after normalization (only next secret date required):
 * {
 *   id, projectName, marketplace, label,
 *   nextClientSecretRotationAt,          // required for alerts
 *   lastClientSecretRotatedAt?,          // optional
 *   nextRefreshTokenRotationAt?, ...     // optional / off by default
 * }
 */

class MemoryStore {
  constructor() {
    this._data = new Map();
    this._seq = 1;
  }

  async saveCredential(data) {
    const id = data.id || String(this._seq++);
    const existing = this._data.get(id) || {};

    const clientSecretIntervalDays =
      data.clientSecretRotationIntervalDays ||
      existing.clientSecretRotationIntervalDays ||
      DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;

    let nextClientSecretRotationAt =
      data.nextClientSecretRotationAt || existing.nextClientSecretRotationAt || null;
    let lastClientSecretRotatedAt =
      data.lastClientSecretRotatedAt != null
        ? new Date(data.lastClientSecretRotatedAt)
        : existing.lastClientSecretRotatedAt || null;

    if (!nextClientSecretRotationAt && lastClientSecretRotatedAt) {
      nextClientSecretRotationAt = computeNextRotation(
        lastClientSecretRotatedAt,
        clientSecretIntervalDays
      );
    }

    const record = {
      ...existing,
      ...data,
      id,
      clientSecretRotationIntervalDays: clientSecretIntervalDays,
      lastClientSecretRotatedAt: lastClientSecretRotatedAt || undefined,
      nextClientSecretRotationAt: nextClientSecretRotationAt
        ? new Date(nextClientSecretRotationAt)
        : undefined
    };

    // Optional refresh-token fields only if caller provides them
    if (
      data.nextRefreshTokenRotationAt ||
      data.lastRefreshTokenRotatedAt ||
      existing.nextRefreshTokenRotationAt
    ) {
      const refreshTokenIntervalDays =
        data.refreshTokenRotationIntervalDays ||
        existing.refreshTokenRotationIntervalDays ||
        DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;
      const lastRefreshTokenRotatedAt = new Date(
        data.lastRefreshTokenRotatedAt || existing.lastRefreshTokenRotatedAt || Date.now()
      );
      record.refreshTokenRotationIntervalDays = refreshTokenIntervalDays;
      record.lastRefreshTokenRotatedAt = lastRefreshTokenRotatedAt;
      record.nextRefreshTokenRotationAt = new Date(
        data.nextRefreshTokenRotationAt ||
          computeNextRotation(lastRefreshTokenRotatedAt, refreshTokenIntervalDays)
      );
    }

    this._data.set(id, record);
    return record;
  }

  async markClientSecretRotated(id, { newClientSecret, intervalDays } = {}) {
    const record = this._data.get(id);
    if (!record) throw new Error(`Credential not found: ${id}`);
    const now = new Date();
    const interval =
      intervalDays || record.clientSecretRotationIntervalDays || DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;
    record.lastClientSecretRotatedAt = now;
    record.nextClientSecretRotationAt = computeNextRotation(now, interval);
    if (newClientSecret) record.clientSecret = newClientSecret;
    this._data.set(id, record);
    return record;
  }

  async markRefreshTokenRotated(id, { newRefreshToken, intervalDays } = {}) {
    const record = this._data.get(id);
    if (!record) throw new Error(`Credential not found: ${id}`);
    const now = new Date();
    const interval =
      intervalDays ||
      record.refreshTokenRotationIntervalDays ||
      DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;
    record.lastRefreshTokenRotatedAt = now;
    record.nextRefreshTokenRotationAt = computeNextRotation(now, interval);
    if (newRefreshToken) record.refreshToken = newRefreshToken;
    this._data.set(id, record);
    return record;
  }

  async getAllCredentials() {
    return Array.from(this._data.values());
  }

  async getCredential(id) {
    return this._data.get(id);
  }
}

module.exports = { MemoryStore };
