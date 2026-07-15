'use strict';

/**
 * Default logical field names used by the package.
 * Map YOUR table's column names onto these via createStore({ fields: {...} }).
 */
const DEFAULT_FIELDS = {
  id: 'id',
  projectName: 'projectName',
  marketplace: 'marketplace',
  label: 'label',
  clientId: 'clientId',
  clientSecret: 'clientSecret',
  refreshToken: 'refreshToken',
  clientSecretRotationIntervalDays: 'clientSecretRotationIntervalDays',
  lastClientSecretRotatedAt: 'lastClientSecretRotatedAt',
  nextClientSecretRotationAt: 'nextClientSecretRotationAt',
  refreshTokenRotationIntervalDays: 'refreshTokenRotationIntervalDays',
  lastRefreshTokenRotatedAt: 'lastRefreshTokenRotatedAt',
  nextRefreshTokenRotationAt: 'nextRefreshTokenRotationAt'
};

/**
 * Merge user field overrides with defaults.
 * @param {object} [fields]
 * @returns {object}
 */
function resolveFields(fields = {}) {
  return { ...DEFAULT_FIELDS, ...fields };
}

/**
 * Read a value from a raw DB row using the field map.
 * Also accepts Mongo `_id` when the logical id field is `id`.
 */
function getField(row, fields, logicalName) {
  if (!row) return undefined;
  const key = fields[logicalName] || logicalName;
  if (row[key] !== undefined && row[key] !== null) return row[key];
  // mongoose lean() / toObject() often expose `_id` instead of `id`
  if (logicalName === 'id' && row._id !== undefined) return row._id;
  return undefined;
}

/**
 * Write logical fields onto a plain object using the mapped column names.
 */
function toDbPayload(data, fields) {
  const out = {};
  for (const [logical, column] of Object.entries(fields)) {
    if (data[logical] !== undefined) out[column] = data[logical];
    // also allow callers to pass already-mapped column names
    if (data[column] !== undefined && out[column] === undefined) out[column] = data[column];
  }
  // pass through unknown keys (meta, sellerId, etc.) under their own names
  for (const [k, v] of Object.entries(data)) {
    if (out[k] === undefined && !Object.keys(fields).includes(k) && !Object.values(fields).includes(k)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Normalize any DB row into the package's canonical credential shape.
 */
function normalizeCredential(row, fields = DEFAULT_FIELDS) {
  if (!row) return null;
  const f = resolveFields(fields);
  const id = getField(row, f, 'id');
  return {
    id: id != null ? String(id) : undefined,
    projectName: getField(row, f, 'projectName'),
    marketplace: getField(row, f, 'marketplace'),
    label: getField(row, f, 'label'),
    clientId: getField(row, f, 'clientId'),
    clientSecret: getField(row, f, 'clientSecret'),
    refreshToken: getField(row, f, 'refreshToken'),
    clientSecretRotationIntervalDays: getField(row, f, 'clientSecretRotationIntervalDays'),
    lastClientSecretRotatedAt: getField(row, f, 'lastClientSecretRotatedAt'),
    nextClientSecretRotationAt: getField(row, f, 'nextClientSecretRotationAt'),
    refreshTokenRotationIntervalDays: getField(row, f, 'refreshTokenRotationIntervalDays'),
    lastRefreshTokenRotatedAt: getField(row, f, 'lastRefreshTokenRotatedAt'),
    nextRefreshTokenRotationAt: getField(row, f, 'nextRefreshTokenRotationAt'),
    // keep original row for advanced onAlert handlers
    _raw: row
  };
}

module.exports = {
  DEFAULT_FIELDS,
  resolveFields,
  getField,
  toDbPayload,
  normalizeCredential
};
