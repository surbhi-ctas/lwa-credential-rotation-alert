'use strict';

const { computeNextRotation, DEFAULTS } = require('./rotation');
const {
  DEFAULT_FIELDS,
  resolveFields,
  getField,
  toDbPayload,
  normalizeCredential
} = require('./fieldMap');

/**
 * Wrap YOUR existing model / table — any name — as a RotationMonitor store.
 *
 * Works with Mongoose models, Sequelize models, or any object that exposes
 * find/findAll/findById/findByPk/create/save-style methods. You only need
 * to point at your model and (optionally) map your column names.
 *
 * @example Different table name, same field names
 *   const store = createStore({ model: AmazonStoreCred });
 *
 * @example Custom column names
 *   const store = createStore({
 *     model: MyWeirdTable,
 *     fields: {
 *       id: '_id',
 *       marketplace: 'region_code',
 *       lastClientSecretRotatedAt: 'secret_rotated_at',
 *       nextClientSecretRotationAt: 'secret_due_at',
 *       lastRefreshTokenRotatedAt: 'token_rotated_at',
 *       nextRefreshTokenRotationAt: 'token_due_at'
 *     }
 *   });
 *
 * @param {object} opts
 * @param {object} opts.model - Mongoose or Sequelize model (or compatible)
 * @param {object} [opts.fields] - map package fields → your column names
 * @param {function} [opts.getAll] - custom loader if your ORM differs
 * @param {function} [opts.getOne] - custom single-row loader
 * @param {function} [opts.create] - custom create
 * @param {function} [opts.updateById] - custom update
 */
function createStore(opts = {}) {
  const { model } = opts;
  if (!model && !opts.getAll) {
    throw new Error('createStore requires `model` or a custom `getAll` function.');
  }

  const fields = resolveFields(opts.fields);

  async function loadAll() {
    if (typeof opts.getAll === 'function') return opts.getAll();
    if (typeof model.find === 'function' && !model.findAll) {
      // Mongoose
      return model.find().lean ? model.find().lean() : model.find();
    }
    if (typeof model.findAll === 'function') {
      // Sequelize
      return model.findAll({ raw: true });
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

      // ensure next-dates are set if last-dates are present
      const lastSecret =
        payload[fields.lastClientSecretRotatedAt] ||
        data.lastClientSecretRotatedAt ||
        new Date();
      const secretInterval =
        payload[fields.clientSecretRotationIntervalDays] ||
        data.clientSecretRotationIntervalDays ||
        DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;
      const lastToken =
        payload[fields.lastRefreshTokenRotatedAt] ||
        data.lastRefreshTokenRotatedAt ||
        new Date();
      const tokenInterval =
        payload[fields.refreshTokenRotationIntervalDays] ||
        data.refreshTokenRotationIntervalDays ||
        DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;

      if (!payload[fields.nextClientSecretRotationAt]) {
        payload[fields.nextClientSecretRotationAt] = computeNextRotation(lastSecret, secretInterval);
      }
      if (!payload[fields.nextRefreshTokenRotationAt]) {
        payload[fields.nextRefreshTokenRotationAt] = computeNextRotation(lastToken, tokenInterval);
      }
      if (!payload[fields.lastClientSecretRotatedAt]) {
        payload[fields.lastClientSecretRotatedAt] = new Date(lastSecret);
      }
      if (!payload[fields.lastRefreshTokenRotatedAt]) {
        payload[fields.lastRefreshTokenRotatedAt] = new Date(lastToken);
      }
      if (!payload[fields.clientSecretRotationIntervalDays]) {
        payload[fields.clientSecretRotationIntervalDays] = secretInterval;
      }
      if (!payload[fields.refreshTokenRotationIntervalDays]) {
        payload[fields.refreshTokenRotationIntervalDays] = tokenInterval;
      }

      const id = data.id || payload[fields.id];
      let saved;
      if (id) {
        try {
          saved = await persistUpdate(id, payload);
        } catch (_) {
          saved = await persistNew({ ...payload, [fields.id]: id });
        }
      } else {
        saved = await persistNew(payload);
      }

      // Sequelize create returns instance; mongoose may return doc
      const plain =
        saved && typeof saved.toJSON === 'function'
          ? saved.toJSON()
          : saved && typeof saved.toObject === 'function'
            ? saved.toObject()
            : saved;
      return normalizeCredential(plain, fields);
    },

    async markClientSecretRotated(id, { newClientSecret } = {}) {
      const existing = await loadOne(id);
      if (!existing) throw new Error(`Credential not found: ${id}`);

      const interval =
        getField(existing, fields, 'clientSecretRotationIntervalDays') ||
        DEFAULTS.CLIENT_SECRET_ROTATION_DAYS;
      const now = new Date();
      const patch = {
        [fields.lastClientSecretRotatedAt]: now,
        [fields.nextClientSecretRotationAt]: computeNextRotation(now, interval)
      };
      if (newClientSecret) patch[fields.clientSecret] = newClientSecret;

      const saved = await persistUpdate(id, patch);
      const plain =
        saved && typeof saved.toJSON === 'function'
          ? saved.toJSON()
          : saved && typeof saved.toObject === 'function'
            ? saved.toObject()
            : saved || { ...existing, ...patch };
      return normalizeCredential(plain, fields);
    },

    async markRefreshTokenRotated(id, { newRefreshToken } = {}) {
      const existing = await loadOne(id);
      if (!existing) throw new Error(`Credential not found: ${id}`);

      const interval =
        getField(existing, fields, 'refreshTokenRotationIntervalDays') ||
        DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS;
      const now = new Date();
      const patch = {
        [fields.lastRefreshTokenRotatedAt]: now,
        [fields.nextRefreshTokenRotationAt]: computeNextRotation(now, interval)
      };
      if (newRefreshToken) patch[fields.refreshToken] = newRefreshToken;

      const saved = await persistUpdate(id, patch);
      const plain =
        saved && typeof saved.toJSON === 'function'
          ? saved.toJSON()
          : saved && typeof saved.toObject === 'function'
            ? saved.toObject()
            : saved || { ...existing, ...patch };
      return normalizeCredential(plain, fields);
    }
  };
}

module.exports = { createStore, DEFAULT_FIELDS };
