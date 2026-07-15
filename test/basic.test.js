'use strict';

const assert = require('assert');
const {
  MemoryStore,
  RotationMonitor,
  evaluateCredential,
  computeNextRotation,
  daysUntil,
  normalizeCredential,
  createStore,
  DEFAULTS,
  alerts
} = require('..');

async function run() {
  // --- computeNextRotation / daysUntil ---
  const base = new Date('2026-01-01T00:00:00Z');
  const next = computeNextRotation(base, 180);
  assert.strictEqual(next.toISOString(), '2026-06-30T00:00:00.000Z');

  // --- evaluate with next* dates ---
  const dueTomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
  const far = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);
  let ev = evaluateCredential(
    {
      id: '1',
      projectName: 'SellerHub',
      marketplace: 'US',
      nextClientSecretRotationAt: dueTomorrow,
      nextRefreshTokenRotationAt: far
    },
    2
  );
  assert.strictEqual(ev.shouldAlert, true);
  assert.strictEqual(ev.projectName, 'SellerHub');
  assert.strictEqual(ev.checks.find((c) => c.type === 'CLIENT_SECRET').shouldAlert, true);
  assert.strictEqual(ev.checks.find((c) => c.type === 'REFRESH_TOKEN').shouldAlert, false);

  // --- fallback: only lastRotatedAt (no next* stored yet) ---
  const almostExpired = new Date(Date.now() - 179 * 24 * 60 * 60 * 1000);
  ev = evaluateCredential(
    {
      id: '2',
      marketplace: 'UK',
      lastClientSecretRotatedAt: almostExpired,
      clientSecretRotationIntervalDays: 180
    },
    2
  );
  assert.strictEqual(ev.shouldAlert, true);
  assert.ok(ev.checks[0].daysLeft <= 2);

  // --- normalize Mongo-style _id + custom columns ---
  const normalized = normalizeCredential(
    {
      _id: 'abc123',
      app_name: 'ProjA',
      region_code: 'IN',
      secret_due_at: dueTomorrow
    },
    {
      id: 'id',
      projectName: 'app_name',
      marketplace: 'region_code',
      nextClientSecretRotationAt: 'secret_due_at',
      lastClientSecretRotatedAt: 'secret_rotated_at',
      lastRefreshTokenRotatedAt: 'token_rotated_at',
      nextRefreshTokenRotationAt: 'token_due_at',
      clientSecretRotationIntervalDays: 'secret_interval_days',
      refreshTokenRotationIntervalDays: 'token_interval_days',
      label: 'label',
      clientId: 'clientId',
      clientSecret: 'clientSecret',
      refreshToken: 'refreshToken'
    }
  );
  assert.strictEqual(normalized.id, 'abc123');
  assert.strictEqual(normalized.projectName, 'ProjA');
  assert.strictEqual(normalized.marketplace, 'IN');

  // --- MemoryStore multi-marketplace ---
  const store = new MemoryStore();
  await store.saveCredential({
    id: 'us-1',
    projectName: 'MultiStoreApp',
    marketplace: 'US',
    label: 'US store',
    lastClientSecretRotatedAt: almostExpired
  });
  await store.saveCredential({
    id: 'uk-1',
    projectName: 'MultiStoreApp',
    marketplace: 'UK',
    label: 'UK store',
    lastClientSecretRotatedAt: new Date() // fresh — should not alert
  });
  await store.saveCredential({
    id: 'in-1',
    projectName: 'MultiStoreApp',
    marketplace: 'IN',
    label: 'IN store',
    lastClientSecretRotatedAt: almostExpired
  });

  const alertsFired = [];
  const monitor = new RotationMonitor({
    store,
    alertBeforeDays: 2,
    runOnStart: false,
    onAlert: async (evaluation) => {
      alertsFired.push(evaluation.marketplace);
    }
  });

  const results = await monitor.checkNow();
  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(alertsFired.sort(), ['IN', 'US']);

  // after mark rotated — alert stops
  await store.markClientSecretRotated('us-1', { newClientSecret: 'new-secret' });
  alertsFired.length = 0;
  await monitor.checkNow();
  assert.deepStrictEqual(alertsFired, ['IN']);

  // --- createStore with fake model ---
  const rows = [
    {
      id: 10,
      marketplace: 'DE',
      lastClientSecretRotatedAt: almostExpired,
      clientSecretRotationIntervalDays: 180,
      lastRefreshTokenRotatedAt: new Date(),
      refreshTokenRotationIntervalDays: 365
    }
  ];
  const fakeModel = {
    async find() {
      return {
        lean: async () => rows
      };
    },
    async findById(id) {
      const row = rows.find((r) => String(r.id) === String(id));
      return {
        lean: async () => row,
        ...row,
        async save() {
          return this;
        }
      };
    },
    async create(data) {
      rows.push(data);
      return data;
    },
    async findByIdAndUpdate(id, patch) {
      const row = rows.find((r) => String(r.id) === String(id));
      Object.assign(row, patch);
      return row;
    }
  };

  // Mongoose-style: find().lean() — our createStore awaits model.find().lean()
  // Need find to return thenable with lean
  fakeModel.find = () => ({
    lean: () => Promise.resolve(rows)
  });

  const adapted = createStore({ model: fakeModel });
  const all = await adapted.getAllCredentials();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].marketplace, 'DE');
  assert.ok(all[0].nextClientSecretRotationAt || all[0].lastClientSecretRotatedAt);

  // --- formatMessage / consoleAlert smoke ---
  assert.ok(typeof alerts.formatMessage === 'function');
  assert.ok(typeof alerts.emailAlert === 'function');
  assert.ok(typeof alerts.sendAlerts === 'function');
  alerts.consoleAlert(ev);

  assert.strictEqual(DEFAULTS.CLIENT_SECRET_ROTATION_DAYS, 180);
  assert.strictEqual(DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS, 365);
  assert.ok(typeof daysUntil === 'function');

  console.log('All tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
