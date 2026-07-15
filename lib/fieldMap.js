'use strict';

/**
 * Default logical field names. Map YOUR columns via createStore({ fields: {...} }).
 *
 * Only `nextClientSecretRotationAt` is required for alerts.
 * Set a field to `false` / `null` to disable reading/writing it.
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

function resolveFields(fields = {}) {
  const merged = { ...DEFAULT_FIELDS, ...fields };
  // drop disabled mappings
  for (const [k, v] of Object.entries(merged)) {
    if (v === false || v === null) delete merged[k];
  }
  return merged;
}

function isMapped(fields, logicalName) {
  return Boolean(fields && fields[logicalName]);
}

/**
 * Read a value from a raw DB row using the field map.
 * Also accepts Mongo `_id` when the logical id field is `id`.
 */
function getField(row, fields, logicalName) {
  if (!row || !isMapped(fields, logicalName)) return undefined;
  const key = fields[logicalName];
  if (row[key] !== undefined && row[key] !== null) return row[key];
  if (logicalName === 'id' && row._id !== undefined) return row._id;
  return undefined;
}

/**
 * Write logical fields onto a plain object using the mapped column names.
 * Skips unmapped / disabled fields.
 */
function toDbPayload(data, fields) {
  const out = {};
  for (const [logical, column] of Object.entries(fields)) {
    if (data[logical] !== undefined) out[column] = data[logical];
    if (data[column] !== undefined && out[column] === undefined) out[column] = data[column];
  }
  for (const [k, v] of Object.entries(data)) {
    if (
      out[k] === undefined &&
      !Object.keys(fields).includes(k) &&
      !Object.values(fields).includes(k)
    ) {
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
    _raw: row
  };
}

module.exports = {
  DEFAULT_FIELDS,
  resolveFields,
  isMapped,
  getField,
  toDbPayload,
  normalizeCredential
};
