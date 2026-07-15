'use strict';

const RotationMonitor = require('./lib/RotationMonitor');
const { MemoryStore } = require('./lib/CredentialStore');
const { createStore, DEFAULT_FIELDS } = require('./lib/createStore');
const rotation = require('./lib/rotation');
const alerts = require('./lib/alerts');
const fieldMap = require('./lib/fieldMap');

module.exports = {
  RotationMonitor,
  MemoryStore,
  createStore,
  DEFAULT_FIELDS,
  ...rotation,
  ...fieldMap,
  alerts
};
