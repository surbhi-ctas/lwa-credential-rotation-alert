'use strict';

const { computeNextRotation, DEFAULTS } = require('./rotation');

/**
 * STORAGE ADAPTER CONTRACT
 * ------------------------
 * Any object you pass as `store` to RotationMonitor must implement:
 *
 *   async getAllCredentials()                 -> array of credential records
 *   async getCredential(id)                   -> single credential record (optional but recommended)
 *   async saveCredential(data)                -> create/update, returns record
 *   async markClientSecretRotated(id, opts)   -> returns updated record
 *   async markRefreshTokenRotated(id, opts)   -> returns updated record
 *
 * Prefer `createStore({ model, fields })` for production — it wraps your
 * existing table (any name, any column names) into this contract.
 *
 * Canonical credential shape after normalization:
 * {
 *   id, projectName, marketplace, label,
 *   clientId, clientSecret, refreshToken,
 *   lastClientSecretRotatedAt, clientSecretRotationIntervalDays, nextClientSecretRotationAt,
 *   lastRefreshTokenRotatedAt, refreshTokenRotationIntervalDays, nextRefreshTokenRotationAt
 * }
 *
 * MemoryStore is for local testing only.
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

    const refreshTokenIntervalDays =
      data.refreshTokenRotationIntervalDays ||
      existing.refreshTokenRotationIntervalDays ||
      DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;

    const lastClientSecretRotatedAt = new Date(
      data.lastClientSecretRotatedAt || existing.lastClientSecretRotatedAt || Date.now()
    );
    const lastRefreshTokenRotatedAt = new Date(
      data.lastRefreshTokenRotatedAt || existing.lastRefreshTokenRotatedAt || Date.now()
    );

    const record = {
      ...existing,
      ...data,
      id,
      clientSecretRotationIntervalDays: clientSecretIntervalDays,
      refreshTokenRotationIntervalDays: refreshTokenIntervalDays,
      lastClientSecretRotatedAt,
      lastRefreshTokenRotatedAt,
      nextClientSecretRotationAt:
        data.nextClientSecretRotationAt ||
        computeNextRotation(lastClientSecretRotatedAt, clientSecretIntervalDays),
      nextRefreshTokenRotationAt:
        data.nextRefreshTokenRotationAt ||
        computeNextRotation(lastRefreshTokenRotatedAt, refreshTokenIntervalDays)
    };

    this._data.set(id, record);
    return record;
  }

  async markClientSecretRotated(id, { newClientSecret } = {}) {
    const record = this._data.get(id);
    if (!record) throw new Error(`Credential not found: ${id}`);
    record.lastClientSecretRotatedAt = new Date();
    record.nextClientSecretRotationAt = computeNextRotation(
      record.lastClientSecretRotatedAt,
      record.clientSecretRotationIntervalDays
    );
    if (newClientSecret) record.clientSecret = newClientSecret;
    this._data.set(id, record);
    return record;
  }

  async markRefreshTokenRotated(id, { newRefreshToken } = {}) {
    const record = this._data.get(id);
    if (!record) throw new Error(`Credential not found: ${id}`);
    record.lastRefreshTokenRotatedAt = new Date();
    record.nextRefreshTokenRotationAt = computeNextRotation(
      record.lastRefreshTokenRotatedAt,
      record.refreshTokenRotationIntervalDays
    );
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
