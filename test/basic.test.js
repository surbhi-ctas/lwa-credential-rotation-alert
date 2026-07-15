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
  const base = new Date('2026-01-01T00:00:00Z');
  const next = computeNextRotation(base, 180);
  assert.strictEqual(next.toISOString(), '2026-06-30T00:00:00.000Z');

  // --- next date ONLY (no last) — primary OMS path ---
  const dueTomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
  const far = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000);

  let ev = evaluateCredential(
    {
      id: '1',
      label: 'US Store',
      marketplace: 'ATVPDKIKX0DER',
      nextClientSecretRotationAt: dueTomorrow
    },
    2
  );
  assert.strictEqual(ev.shouldAlert, true);
  assert.strictEqual(ev.checks.length, 1);
  assert.strictEqual(ev.checks[0].type, 'CLIENT_SECRET');
  assert.strictEqual(ev.checks[0].shouldAlert, true);
  assert.strictEqual(ev.checks[0].severity, 'critical'); // 1 day left

  // --- alert milestone: exact day 30 (outside continuous window of 7) ---
  const dueIn30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  ev = evaluateCredential(
    { id: 'm30', label: 'Milestone', nextClientSecretRotationAt: dueIn30 },
    7,
    { alertMilestones: [30, 14, 7, 3, 1] }
  );
  assert.strictEqual(ev.shouldAlert, true);
  assert.strictEqual(ev.checks[0].severity, 'info');
  assert.strictEqual(ev.checks[0].milestone, 30);

  // day 20 — not a milestone, not in continuous window
  const dueIn20 = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  ev = evaluateCredential(
    { id: 'm20', nextClientSecretRotationAt: dueIn20 },
    7,
    { alertMilestones: [30, 14, 7, 3, 1] }
  );
  assert.strictEqual(ev.shouldAlert, false);

  // refresh token present but ignored by default
  ev = evaluateCredential(
    {
      id: '1b',
      nextClientSecretRotationAt: far,
      nextRefreshTokenRotationAt: dueTomorrow
    },
    2
  );
  assert.strictEqual(ev.shouldAlert, false);
  assert.strictEqual(ev.checks.length, 1);

  // opt-in refresh tracking
  ev = evaluateCredential(
    {
      id: '1c',
      nextClientSecretRotationAt: far,
      nextRefreshTokenRotationAt: dueTomorrow
    },
    2,
    { trackRefreshToken: true }
  );
  assert.strictEqual(ev.shouldAlert, true);
  assert.ok(ev.checks.find((c) => c.type === 'REFRESH_TOKEN').shouldAlert);

  // --- fallback: lastRotatedAt still works ---
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

  // --- no dates → no alert ---
  ev = evaluateCredential({ id: 'empty', label: 'No dates' }, 2);
  assert.strictEqual(ev.shouldAlert, false);
  assert.strictEqual(ev.checks.length, 0);

  // --- normalize Mongo-style + next-only field map ---
  const normalized = normalizeCredential(
    {
      _id: 'abc123',
      store_name: 'UK FBA',
      marketplace_id: 'A1F83G8C2ARO7P',
      client_secret_next_rotation_at: dueTomorrow
    },
    {
      id: '_id',
      label: 'store_name',
      marketplace: 'marketplace_id',
      nextClientSecretRotationAt: 'client_secret_next_rotation_at',
      lastClientSecretRotatedAt: false,
      lastRefreshTokenRotatedAt: false,
      nextRefreshTokenRotationAt: false
    }
  );
  assert.strictEqual(normalized.id, 'abc123');
  assert.strictEqual(normalized.label, 'UK FBA');
  assert.strictEqual(normalized.marketplace, 'A1F83G8C2ARO7P');
  assert.ok(normalized.nextClientSecretRotationAt);
  assert.strictEqual(normalized.lastClientSecretRotatedAt, undefined);

  // --- MemoryStore multi-store, next-date only ---
  const store = new MemoryStore();
  await store.saveCredential({
    id: 'us-1',
    marketplace: 'US',
    label: 'US store',
    nextClientSecretRotationAt: dueTomorrow
  });
  await store.saveCredential({
    id: 'uk-1',
    marketplace: 'UK',
    label: 'UK store',
    nextClientSecretRotationAt: far
  });
  await store.saveCredential({
    id: 'in-1',
    marketplace: 'IN',
    label: 'IN store',
    nextClientSecretRotationAt: dueTomorrow
  });

  const alertsFired = [];
  const monitor = new RotationMonitor({
    store,
    alertBeforeDays: 2,
    alertMilestones: [], // exact continuous-window only for this test
    runOnStart: false,
    trackRefreshToken: false,
    warnMissingNextDate: false,
    onAlert: async (evaluation) => {
      alertsFired.push(evaluation.marketplace);
    }
  });

  const results = await monitor.checkNow();
  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(alertsFired.sort(), ['IN', 'US']);

  await store.markClientSecretRotated('us-1', { newClientSecret: 'new-secret' });
  alertsFired.length = 0;
  await monitor.checkNow();
  assert.deepStrictEqual(alertsFired, ['IN']);

  // --- createStore with filter + disabled last fields ---
  const rows = [
    {
      _id: '10',
      store_name: 'DE',
      marketplace_id: 'A1PA6795UKMFR9',
      client_secret_next_rotation_at: dueTomorrow,
      status: 1,
      is_amazon_store: true
    },
    {
      _id: '11',
      store_name: 'deleted',
      marketplace_id: 'X',
      client_secret_next_rotation_at: dueTomorrow,
      status: 2,
      is_amazon_store: true
    }
  ];

  const fakeModel = {
    find(query = {}) {
      const filtered = rows.filter((r) => {
        if (query.status != null && r.status !== query.status) return false;
        if (query.is_amazon_store != null && r.is_amazon_store !== query.is_amazon_store) {
          return false;
        }
        return true;
      });
      return { lean: () => Promise.resolve(filtered) };
    },
    findById(id) {
      const row = rows.find((r) => String(r._id) === String(id));
      return {
        lean: () => Promise.resolve(row),
        ...row,
        async save() {
          return this;
        }
      };
    },
    async findByIdAndUpdate(id, patch) {
      const row = rows.find((r) => String(r._id) === String(id));
      Object.assign(row, patch);
      return row;
    },
    async create(data) {
      rows.push(data);
      return data;
    }
  };

  const adapted = createStore({
    model: fakeModel,
    filter: { status: 1, is_amazon_store: true },
    fields: {
      id: '_id',
      label: 'store_name',
      marketplace: 'marketplace_id',
      nextClientSecretRotationAt: 'client_secret_next_rotation_at',
      lastClientSecretRotatedAt: false,
      lastRefreshTokenRotatedAt: false,
      nextRefreshTokenRotationAt: false
    }
  });

  const all = await adapted.getAllCredentials();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].label, 'DE');
  assert.ok(all[0].nextClientSecretRotationAt);
  assert.strictEqual(all[0].lastClientSecretRotatedAt, undefined);

  const marked = await adapted.markClientSecretRotated('10', {
    newClientSecret: 'rotated',
    intervalDays: 180
  });
  assert.ok(marked.nextClientSecretRotationAt);
  assert.ok(daysUntil(marked.nextClientSecretRotationAt) >= 179);

  // --- dedupe + dryRun + onCheckComplete ---
  const dedupeStore = new MemoryStore();
  await dedupeStore.saveCredential({
    id: 'd1',
    marketplace: 'US',
    nextClientSecretRotationAt: dueTomorrow
  });
  let summarySeen = null;
  let fireCount = 0;
  const dedupeMonitor = new RotationMonitor({
    store: dedupeStore,
    alertBeforeDays: 7,
    alertMilestones: [],
    runOnStart: false,
    minRepeatHours: 24,
    warnMissingNextDate: false,
    onAlert: async () => {
      fireCount += 1;
    },
    onCheckComplete: async (summary) => {
      summarySeen = summary;
    }
  });
  await dedupeMonitor.checkNow();
  await dedupeMonitor.checkNow(); // should be skipped by dedupe
  assert.strictEqual(fireCount, 1);
  assert.ok(summarySeen);
  assert.strictEqual(summarySeen.total, 1);
  assert.strictEqual(summarySeen.skippedDedupe, 1);

  const dryMonitor = new RotationMonitor({
    store: dedupeStore,
    alertBeforeDays: 7,
    alertMilestones: [],
    runOnStart: false,
    dryRun: true,
    minRepeatHours: 0,
    warnMissingNextDate: false,
    onAlert: async () => {
      fireCount += 1;
    }
  });
  dryMonitor.clearAlertHistory();
  const before = fireCount;
  await dryMonitor.checkNow();
  assert.strictEqual(fireCount, before); // dryRun does not call onAlert channels via _dispatch... wait, dryRun returns before onAlert. Good.

  assert.ok(typeof alerts.formatMessage === 'function');
  assert.ok(typeof alerts.emailAlert === 'function');
  assert.ok(typeof alerts.sendAlerts === 'function');
  alerts.consoleAlert(
    evaluateCredential(
      { id: 'x', label: 'X', nextClientSecretRotationAt: dueTomorrow },
      2
    )
  );

  assert.strictEqual(DEFAULTS.CLIENT_SECRET_ROTATION_DAYS, 180);
  assert.ok(typeof daysUntil === 'function');

  console.log('All tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
