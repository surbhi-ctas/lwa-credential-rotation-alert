# lwa-credential-rotation-alert

Track Amazon **LWA client-secret** rotation deadlines from **your own database**
(any collection / table name), across **all stores** in a project, and get
**alerts** (email, Slack, webhook, console) until you mark the credential rotated.

| Credential | Amazon deadline | Package default |
|---|---|---|
| LWA **client secret** | every **180 days** | alert from your **next rotation date** |
| Refresh token | every **365 days** | **off** (optional opt-in) |

**You only need a next-rotation date.** `lastRotatedAt` is optional.
Refresh-token tracking is off unless you enable it.

---

## Install

```bash
npm install lwa-credential-rotation-alert
```

---

## Does it check all stores?

**Yes.** Point `createStore` at your model (e.g. `tbl_store_details`).
`getAllCredentials()` loads **every matching document**, and the monitor
evaluates each store independently. New stores added later are picked up
on the next cron run automatically.

---

## OMS / `tbl_store_details` (MongoDB)

Your schema already has `client_id`, `client_secret`, `store_name`, etc.
Add **one Date field** for the next client-secret deadline (name can differ):

```js
client_secret_next_rotation_at: { type: Date }
```

Wire the package once in your OMS app:

```js
const { RotationMonitor, createStore } = require('lwa-credential-rotation-alert');
const StoreDetails = require('./models/storeDetails.model'); // tbl_store_details

const store = createStore({
  model: StoreDetails,
  filter: { status: 1, is_amazon_store: true }, // all active Amazon stores
  fields: {
    id: '_id',
    label: 'store_name',
    marketplace: 'marketplace_id',
    clientId: 'client_id',
    clientSecret: 'client_secret',
    nextClientSecretRotationAt: 'client_secret_next_rotation_at', // YOUR column
    // not used — disable so package never asks for them:
    lastClientSecretRotatedAt: false,
    lastRefreshTokenRotatedAt: false,
    nextRefreshTokenRotationAt: false,
    projectName: false
  }
});

const monitor = new RotationMonitor({
  store,
  alertBeforeDays: 7,              // email when ≤ 7 days left
  cronExpression: '0 9,21 * * *',  // 2× per day
  timezone: 'Asia/Kolkata',        // cron clock timezone
  trackClientSecret: true,
  trackRefreshToken: false,        // secret only
  email: true,
  console: true
});

monitor.start();
```

Full copy-paste: `examples/oms-mongoose.js`.

After you rotate a secret:

```js
await store.markClientSecretRotated(storeId, {
  newClientSecret: 'amzn.secret...',
  intervalDays: 180   // sets next = now + 180 days
});
```

---

## How alerts work (next date only)

```
DB: client_secret_next_rotation_at = 2026-07-20

Today 2026-07-13, alertBeforeDays=7  →  alert (7 days left)
Today 2026-07-19                     →  alert (1 day left)
Today 2026-07-21                     →  OVERDUE alert
... keeps alerting each cron run until markClientSecretRotated()
```

Cron timezone (`Asia/Kolkata`) only controls **when** checks run — the Date
in Mongo is compared in absolute UTC time.

---

## Recommended OMS monitor config

```js
const monitor = new RotationMonitor({
  store,

  // schedule
  cronExpression: '0 9,21 * * *',
  timezone: 'Asia/Kolkata',
  runOnStart: true,

  // tracking
  trackClientSecret: true,
  trackRefreshToken: false,
  projectName: 'OMS',

  // milestones + continuous window
  alertBeforeDays: 7,                    // every check while ≤ 7 days (or overdue)
  alertMilestones: [30, 14, 7, 3, 1],     // also fire on these exact days-left

  // noise control
  minRepeatHours: 12,                    // don't re-spam same store within 12h
  warnMissingNextDate: true,

  // channels
  email: true,
  console: true,

  // ops
  enabled: true,
  dryRun: false,                         // true = check only, no email
  onCheckComplete: (summary) => console.log(summary)
});

monitor.start();
await monitor.checkNow(); // manual anytime
```

### Parameters

| option | default | description |
|---|---|---|
| `store` | required | from `createStore` |
| `alertBeforeDays` | `7` | continuous alerts when days left ≤ this |
| `alertMilestones` | `[30,14,7,3,1]` | also alert on these exact days-left |
| `cronExpression` | `'0 9 * * *'` | when to check |
| `timezone` | — | e.g. `'Asia/Kolkata'` |
| `runOnStart` | `true` | check once on boot |
| `trackClientSecret` | `true` | client-secret alerts |
| `trackRefreshToken` | `false` | refresh-token alerts |
| `projectName` | — | shown in emails when store has none |
| `minRepeatHours` | `0` | dedupe window (severity escalation still sends) |
| `warnMissingNextDate` | `true` | log stores with no next date |
| `email` | `false` | `true` / `false` / SMTP config |
| `console` | `true` | log alerts |
| `slackWebhook` / `webhookUrl` | — | optional channels |
| `enabled` | `true` | master switch |
| `dryRun` | `false` | evaluate but do not send |
| `onAlert` | — | custom alert handler |
| `onCheckComplete` | — | `(summary, results)` after each run |

---

## Quick local test

```js
const { RotationMonitor, MemoryStore } = require('lwa-credential-rotation-alert');

const store = new MemoryStore();
await store.saveCredential({
  id: 'us-1',
  label: 'US',
  nextClientSecretRotationAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000)
});

const monitor = new RotationMonitor({
  store,
  runOnStart: false,
  email: false,
  console: true
});

await monitor.checkNow();
```

```bash
npm test
```

---

## Notes

- This package does **not** call Amazon — it reads your next dates and alerts.
- Missing the LWA client-secret deadline can block SP-API for that app/store.
- Old secret may keep working ~7 days after you rotate in Seller Central.
