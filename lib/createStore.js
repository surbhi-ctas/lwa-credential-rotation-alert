'use strict';

const { computeNextRotation, DEFAULTS } = require('./rotation');
const {
  DEFAULT_FIELDS,
  resolveFields,
  isMapped,
  getField,
  toDbPayload,
  normalizeCredential
} = require('./fieldMap');

/**
 * Wrap YOUR existing model / collection as a RotationMonitor store.
 *
 * Minimal for OMS-style tables: map only next client-secret date (+ label fields).
 * last* and refresh-token fields are optional — disable with `false`.
 *
 * @example OMS tbl_store_details (next date only)
 *   createStore({
 *     model: StoreDetails,
 *     filter: { status: 1, is_amazon_store: true },
 *     fields: {
 *       id: '_id',
 *       label: 'store_name',
 *       marketplace: 'marketplace_id',
 *       clientId: 'client_id',
 *       clientSecret: 'client_secret',
 *       nextClientSecretRotationAt: 'client_secret_next_rotation_at',
 *       lastClientSecretRotatedAt: false,
 *       lastRefreshTokenRotatedAt: false,
 *       nextRefreshTokenRotationAt: false,
 *       refreshToken: false
 *     }
 *   });
 */
function createStore(opts = {}) {
  const { model, filter } = opts;
  if (!model && !opts.getAll) {
    throw new Error('createStore requires `model` or a custom `getAll` function.');
  }

  const fields = resolveFields(opts.fields);

  async function loadAll() {
    if (typeof opts.getAll === 'function') return opts.getAll();
    if (typeof model.find === 'function' && !model.findAll) {
      const q = filter != null ? model.find(filter) : model.find();
      return q && q.lean ? q.lean() : q;
    }
    if (typeof model.findAll === 'function') {
      return model.findAll({ raw: true, where: filter || undefined });
    }
    throw new Error('createStore: model has no find()/findAll(). Pass opts.getAll instead.');
  }

  async function loadOne(id) {
    if (typeof opts.getOne === 'function') return opts.getOne(id);
    if (typeof model.findById === 'function') {
      const q = model.findById(id);
      return q && q.lean ? q.lean() : q;
    }
    if (typeof model.findByPk === 'function') {
      return model.findByPk(id, { raw: true });
    }
    throw new Error('createStore: model has no findById()/findByPk(). Pass opts.getOne instead.');
  }

  async function persistNew(data) {
    if (typeof opts.create === 'function') return opts.create(data);
    if (typeof model.create === 'function') return model.create(data);
    throw new Error('createStore: model has no create(). Pass opts.create instead.');
  }

  async function persistUpdate(id, patch) {
    if (typeof opts.updateById === 'function') return opts.updateById(id, patch);
    if (typeof model.findByIdAndUpdate === 'function') {
      return model.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
    }
    if (typeof model.findByPk === 'function') {
      const row = await model.findByPk(id);
      if (!row) throw new Error(`Credential not found: ${id}`);
      Object.assign(row, patch);
      await row.save();
      return row;
    }
    throw new Error('createStore: cannot update. Pass opts.updateById instead.');
  }

  function toPlain(saved) {
    if (!saved) return saved;
    if (typeof saved.toJSON === 'function') return saved.toJSON();
    if (typeof saved.toObject === 'function') return saved.toObject();
    return saved;
  }

  return {
    fields,

    async getAllCredentials() {
      const rows = await loadAll();
      return (rows || []).map((row) => normalizeCredential(row, fields));
    },

    async getCredential(id) {
      const row = await loadOne(id);
      return normalizeCredential(row, fields);
    },

    async saveCredential(data) {
      const payload = toDbPayload(data, fields);
      const interval =
        (isMapped(fields, 'clientSecretRotationIntervalDays') &&
          (payload[fields.clientSecretRotationIntervalDays] ||
            data.clientSecretRotationIntervalDays)) ||
        DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;

      // Prefer an explicit next date. Optionally derive from last if mapped.
      if (
        isMapped(fields, 'nextClientSecretRotationAt') &&
        !payload[fields.nextClientSecretRotationAt]
      ) {
        if (isMapped(fields, 'lastClientSecretRotatedAt')) {
          const last =
            payload[fields.lastClientSecretRotatedAt] ||
            data.lastClientSecretRotatedAt ||
            new Date();
          payload[fields.nextClientSecretRotationAt] = computeNextRotation(last, interval);
          if (!payload[fields.lastClientSecretRotatedAt]) {
            payload[fields.lastClientSecretRotatedAt] = new Date(last);
          }
        }
      }

      if (
        isMapped(fields, 'clientSecretRotationIntervalDays') &&
        payload[fields.clientSecretRotationIntervalDays] == null
      ) {
        payload[fields.clientSecretRotationIntervalDays] = interval;
      }

      // Refresh-token fields only if mapped (disabled by default for OMS)
      if (isMapped(fields, 'nextRefreshTokenRotationAt') && !payload[fields.nextRefreshTokenRotationAt]) {
        if (isMapped(fields, 'lastRefreshTokenRotatedAt')) {
          const last =
            payload[fields.lastRefreshTokenRotatedAt] ||
            data.lastRefreshTokenRotatedAt ||
            new Date();
          const tokenInterval =
            payload[fields.refreshTokenRotationIntervalDays] ||
            data.refreshTokenRotationIntervalDays ||
            DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;
          payload[fields.nextRefreshTokenRotationAt] = computeNextRotation(last, tokenInterval);
          if (!payload[fields.lastRefreshTokenRotatedAt]) {
            payload[fields.lastRefreshTokenRotatedAt] = new Date(last);
          }
        }
      }

      const id = data.id || (isMapped(fields, 'id') ? payload[fields.id] : undefined);
      let saved;
      if (id) {
        try {
          saved = await persistUpdate(id, payload);
        } catch (_) {
          saved = await persistNew(
            isMapped(fields, 'id') ? { ...payload, [fields.id]: id } : payload
          );
        }
      } else {
        saved = await persistNew(payload);
      }

      return normalizeCredential(toPlain(saved), fields);
    },

    /**
     * After you rotate the LWA client secret: push next deadline forward (+180 days).
     * Does not require a last-rotated column — only updates next* if that is all you map.
     */
    async markClientSecretRotated(id, { newClientSecret, intervalDays } = {}) {
      const existing = await loadOne(id);
      if (!existing) throw new Error(`Credential not found: ${id}`);

      const interval =
        intervalDays ||
        getField(existing, fields, 'clientSecretRotationIntervalDays') ||
        DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;
      const now = new Date();
      const patch = {};

      if (isMapped(fields, 'nextClientSecretRotationAt')) {
        patch[fields.nextClientSecretRotationAt] = computeNextRotation(now, interval);
      }
      if (isMapped(fields, 'lastClientSecretRotatedAt')) {
        patch[fields.lastClientSecretRotatedAt] = now;
      }
      if (newClientSecret && isMapped(fields, 'clientSecret')) {
        patch[fields.clientSecret] = newClientSecret;
      }
      if (isMapped(fields, 'clientSecretRotationIntervalDays') &&
          getField(existing, fields, 'clientSecretRotationIntervalDays') == null) {
        patch[fields.clientSecretRotationIntervalDays] = interval;
      }

      const saved = await persistUpdate(id, patch);
      return normalizeCredential(toPlain(saved) || { ...existing, ...patch }, fields);
    },

    async markRefreshTokenRotated(id, { newRefreshToken, intervalDays } = {}) {
      if (!isMapped(fields, 'nextRefreshTokenRotationAt') && !isMapped(fields, 'lastRefreshTokenRotatedAt')) {
        throw new Error(
          'Refresh-token tracking is disabled for this store (no refresh-token date fields mapped).'
        );
      }
      const existing = await loadOne(id);
      if (!existing) throw new Error(`Credential not found: ${id}`);

      const interval =
        intervalDays ||
        getField(existing, fields, 'refreshTokenRotationIntervalDays') ||
        DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;
      const now = new Date();
      const patch = {};

      if (isMapped(fields, 'nextRefreshTokenRotationAt')) {
        patch[fields.nextRefreshTokenRotationAt] = computeNextRotation(now, interval);
      }
      if (isMapped(fields, 'lastRefreshTokenRotatedAt')) {
        patch[fields.lastRefreshTokenRotatedAt] = now;
      }
      if (newRefreshToken && isMapped(fields, 'refreshToken')) {
        patch[fields.refreshToken] = newRefreshToken;
      }

      const saved = await persistUpdate(id, patch);
      return normalizeCredential(toPlain(saved) || { ...existing, ...patch }, fields);
    }
  };
}

module.exports = { createStore, DEFAULT_FIELDS };
