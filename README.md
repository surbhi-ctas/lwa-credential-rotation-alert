# lwa-credential-rotation-alert

Track Amazon **Login with Amazon (LWA)** credential rotation deadlines in
**your own database** (any table name, any column names), across
**all Amazon marketplaces / stores in a project**, and get
**continuous alerts** (email, Slack, webhook, console) until you mark
the credential as rotated.

| Credential | Amazon deadline | This package default |
|---|---|---|
| LWA **client secret** | every **180 days** | alert starts `alertBeforeDays` before (default 2) |
| **Refresh token** (public apps) | re-authorize every **365 days** | same |

> Rotating the client secret does **not** require sellers to re-authorize.
> Refresh-token re-auth is a separate cycle. Both are tracked independently.

---

## Is this useful?

**Yes**, if you:

- Run **multiple Node projects**, each with Amazon SP-API credentials
- Have **multiple Amazon stores / marketplaces** (US, UK, IN, …) in one project
- Use **different DB table names** per project
- Want alerts that **keep firing** until someone actually rotates

Amazon already emails you (~90 / ~30 days out). This package is for
**your ops timeline** — e.g. start 2–7 days before, every day, into Slack/email
your team already watches — and it reads dates from **your** DB.

---

## Install

```bash
npm install lwa-credential-rotation-alert
```

Public package on npm — install works in any project, same as any other npm package.

`nodemailer` is included — you do **not** need to install it separately.
Turn email on/off per project with `email: true` / `email: false`.

---

## How it works

1. Add rotation **date fields** to whatever table already holds your Amazon credentials.
2. Wrap that model with **`createStore({ model, fields? })`** — works with any table name.
3. Start **`RotationMonitor`** once in the app. It cron-checks all rows (all stores)
   and alerts via email / Slack / webhook / console until you mark rotated.
   Use `email: true` or `email: false` — nodemailer is already inside the package.

---

## 1. Rotation fields to add (any table)

Add these columns to your existing credentials table (names can differ — map them later):

| Field | Purpose |
|---|---|
| `lastClientSecretRotatedAt` | when you last rotated the LWA secret |
| `nextClientSecretRotationAt` | deadline (= last + 180 days, auto-computed) |
| `clientSecretRotationIntervalDays` | default `180` |
| `lastRefreshTokenRotatedAt` | when seller last re-authorized |
| `nextRefreshTokenRotationAt` | deadline (= last + 365 days) |
| `refreshTokenRotationIntervalDays` | default `365` |
| `marketplace` | `US` / `UK` / `IN` / … — **one row per Amazon store** |
| `projectName` | optional, shows up in alerts |

Copy-paste schemas: `examples/mongoose.model.js`, `examples/sequelize.model.js`.

---

## 2. Wire the monitor (once per project)

```js
const { RotationMonitor, createStore } = require('lwa-credential-rotation-alert');
const { AmazonCred } = require('./models/AmazonCred'); // YOUR model / table

const store = createStore({ model: AmazonCred });

const monitor = new RotationMonitor({
  store,
  alertBeforeDays: 2,
  cronExpression: '0 9 * * *',
  timezone: 'Asia/Kolkata',
  runOnStart: true,

  email: true,   // ← true = send email, false = no email
  console: true,
  // slackWebhook: process.env.LWA_ALERT_SLACK_WEBHOOK,
});

monitor.start();
```

Env when `email: true`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
LWA_ALERT_EMAIL_FROM=alerts@yourcompany.com
LWA_ALERT_EMAIL_TO=ops@yourcompany.com
```

Or pass SMTP inline:

```js
email: {
  to: 'ops@yourcompany.com',
  from: 'alerts@yourcompany.com',
  host: 'smtp.example.com',
  port: 587,
  auth: { user: '...', pass: '...' }
}
```

In `app.js` / `server.js`:

```js
require('./monitor/lwaRotationMonitor');
```

---

## 3. Different table names & column names

**Different table per project** — just pass that project's model:

```js
// Project A
createStore({ model: ProjectAAmazonCred }); // collection/table: project_a_creds

// Project B
createStore({ model: ProjectBSellerCred }); // collection/table: seller_tokens
```

**Different column names** — map them:

```js
const store = createStore({
  model: MyExistingModel,
  fields: {
    marketplace: 'region_code',
    projectName: 'app_name',
    lastClientSecretRotatedAt: 'secret_rotated_at',
    nextClientSecretRotationAt: 'secret_due_at',
    lastRefreshTokenRotatedAt: 'token_rotated_at',
    nextRefreshTokenRotationAt: 'token_due_at'
  }
});
```

See `examples/custom-fields.js`.

---

## Multi-store (multiple Amazon marketplaces)

One row per store/marketplace. `getAllCredentials()` returns all of them;
the monitor evaluates each independently:

```
projectName: SellerHub, marketplace: US  → own rotation dates
projectName: SellerHub, marketplace: UK  → own rotation dates
projectName: SellerHub, marketplace: IN  → own rotation dates
```

Only stores inside the alert window trigger alerts.

---

## Continuous alerting until rotated

```
Day -2: alert
Day -1: alert again
Day  0: OVERDUE alert
Day +1: still alerting
... await store.markClientSecretRotated(id, { newClientSecret: '...' })
... next check: silent (deadline pushed +180 days)
```

```js
await store.markClientSecretRotated(id, { newClientSecret: 'amzn.secret...' });
await store.markRefreshTokenRotated(id, { newRefreshToken: 'Atzr|...' });
```

---

## Alert channels

```js
// Built into RotationMonitor — no custom onAlert needed:
new RotationMonitor({
  store,
  email: true,                          // or false
  console: true,
  slackWebhook: 'https://hooks.slack.com/...',
  webhookUrl: 'https://your-hook.example.com'
});

// Or use helpers manually:
const { alerts } = require('lwa-credential-rotation-alert');
await alerts.sendAlerts({ email: true, console: true }, evaluation);
await alerts.emailAlert(smtpOptions, { from, to }, evaluation);
await alerts.slackAlert(webhookUrl, evaluation);
```

`onAlert` receives:

```js
{
  credentialId: '…',
  projectName: 'SellerHub',
  marketplace: 'US',
  label: 'SellerHub - US',
  shouldAlert: true,
  checks: [
    { type: 'CLIENT_SECRET', dueDate, daysLeft, overdue, shouldAlert },
    { type: 'REFRESH_TOKEN', dueDate, daysLeft, overdue, shouldAlert }
  ]
}
```

---

## API

| Export | Description |
|---|---|
| `createStore({ model, fields? })` | Wrap any Mongoose/Sequelize model (any table name) |
| `new RotationMonitor({ ... })` | Cron checker — see options below |
| `MemoryStore` | In-memory store for tests |
| `computeNextRotation(lastRotatedAt, intervalDays)` | `Date` |
| `daysUntil(date)` | number (negative if overdue) |
| `evaluateCredential(credential, alertBeforeDays)` | evaluation object |
| `DEFAULTS.CLIENT_SECRET_ROTATION_DAYS` | `180` |
| `DEFAULTS.REFRESH_TOKEN_ROTATION_DAYS` | `365` |
| `alerts.*` | email / Slack / webhook / console / `sendAlerts` |

### `RotationMonitor` options

| option | default | description |
|---|---|---|
| `store` | required | your adapter from `createStore` |
| `alertBeforeDays` | `2` | start alerting this many days before deadline |
| `cronExpression` | `'0 9 * * *'` | when to check |
| `timezone` | — | e.g. `'Asia/Kolkata'` |
| `runOnStart` | `true` | check once on boot |
| `email` | `false` | `true` / `false` / `{ to, from, host, port, auth }` — nodemailer included |
| `console` | `true` | log alerts to console |
| `slackWebhook` | — | Slack incoming webhook URL |
| `webhookUrl` | — | generic POST webhook |
| `onAlert` | — | optional custom handler (overrides built-in channels if set) |

Methods on a store: `.getAllCredentials()`, `.getCredential(id)`, `.saveCredential(data)`,
`.markClientSecretRotated(id, opts)`, `.markRefreshTokenRotated(id, opts)`.

Manual check: `await monitor.checkNow()`.

---

## Quick local test (no DB)

```js
const { RotationMonitor, MemoryStore } = require('lwa-credential-rotation-alert');

const store = new MemoryStore();
await store.saveCredential({
  id: 'us-1',
  projectName: 'Demo',
  marketplace: 'US',
  lastClientSecretRotatedAt: new Date(Date.now() - 179 * 24 * 60 * 60 * 1000)
});

const monitor = new RotationMonitor({
  store,
  runOnStart: false,
  email: false,   // no SMTP needed for local test
  console: true
});

await monitor.checkNow();
```

```bash
npm test
```

---

## Notes (Amazon SP-API)

- Client secret rotation is mandatory every 180 days; Amazon notifies ~90 days prior.
- Old secret may keep working up to ~7 days after you rotate.
- Missing the deadline blocks SP-API calls for that application.
- This package does **not** call Amazon — it only tracks dates in your DB and alerts.
  Pair with Amazon's rotate-client-secret API if you want to automate rotation itself.
