'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');

function formatMessage({ label, marketplace, projectName, type, daysLeft, overdue, dueDate }) {
  const what = type === 'CLIENT_SECRET' ? 'LWA client secret' : 'refresh token re-authorization';
  const where = [projectName, marketplace].filter(Boolean).join(' / ') || marketplace || 'unknown';
  if (overdue) {
    return `🚨 [${where}] ${label}: ${what} is OVERDUE (was due ${dueDate.toDateString()}). API calls may already be failing. Rotate immediately.`;
  }
  return `⚠️ [${where}] ${label}: ${what} is due in ${daysLeft} day(s) — deadline ${dueDate.toDateString()}. Please rotate before it expires.`;
}

function alertLines(evaluation) {
  return evaluation.checks
    .filter((c) => c.shouldAlert)
    .map((c) => formatMessage({ ...evaluation, ...c }));
}

function buildHtmlBody(evaluation, lines) {
  const rows = evaluation.checks
    .filter((c) => c.shouldAlert)
    .map((c) => {
      const status = c.overdue
        ? '<span style="color:#b91c1c;font-weight:700">OVERDUE</span>'
        : `<span style="color:#b45309;font-weight:700">${c.daysLeft} day(s) left</span>`;
      const what = c.type === 'CLIENT_SECRET' ? 'Client secret' : 'Refresh token';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${what}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${c.dueDate.toDateString()}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${status}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827;line-height:1.5">
  <h2 style="margin:0 0 8px">LWA credential rotation alert</h2>
  <p style="margin:0 0 16px;color:#4b5563">
    <strong>${evaluation.label || 'Credential'}</strong>
    ${evaluation.projectName ? ` · project: ${evaluation.projectName}` : ''}
    ${evaluation.marketplace ? ` · marketplace: ${evaluation.marketplace}` : ''}
  </p>
  <table style="border-collapse:collapse;width:100%;max-width:560px">
    <thead>
      <tr style="text-align:left;background:#f3f4f6">
        <th style="padding:8px">Credential</th>
        <th style="padding:8px">Deadline</th>
        <th style="padding:8px">Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
    Alerts continue on every check until you mark the credential as rotated
    (<code>markClientSecretRotated</code> / <code>markRefreshTokenRotated</code>).
  </p>
  <pre style="display:none">${lines.join('\n')}</pre>
</body>
</html>`;
}

/**
 * Build SMTP transport options from a flat email config or env defaults.
 * @param {object} [emailConfig]
 */
function resolveSmtpOptions(emailConfig = {}) {
  if (emailConfig.transporter && typeof emailConfig.transporter.sendMail === 'function') {
    return { transporter: emailConfig.transporter };
  }
  if (emailConfig.transporterOptions) {
    return { transporterOptions: emailConfig.transporterOptions };
  }

  return {
    transporterOptions: {
      host: emailConfig.host || process.env.SMTP_HOST,
      port: Number(emailConfig.port || process.env.SMTP_PORT || 587),
      secure: emailConfig.secure != null
        ? Boolean(emailConfig.secure)
        : process.env.SMTP_SECURE === 'true',
      auth: emailConfig.auth || {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    }
  };
}

/**
 * Resolve { from, to, ... } mail fields from config / env.
 * @param {object} [emailConfig]
 */
function resolveMailOptions(emailConfig = {}) {
  const from =
    (emailConfig.mailOptions && emailConfig.mailOptions.from) ||
    emailConfig.from ||
    process.env.LWA_ALERT_EMAIL_FROM ||
    process.env.SMTP_USER;
  const to =
    (emailConfig.mailOptions && emailConfig.mailOptions.to) ||
    emailConfig.to ||
    process.env.LWA_ALERT_EMAIL_TO;

  return {
    ...(emailConfig.mailOptions || {}),
    from,
    to
  };
}

async function slackAlert(webhookUrl, evaluation) {
  if (!webhookUrl) throw new Error('slackAlert requires a webhookUrl');
  const lines = alertLines(evaluation);
  if (!lines.length) return;
  await axios.post(webhookUrl, { text: lines.join('\n') });
}

async function genericWebhookAlert(url, evaluation) {
  if (!url) throw new Error('genericWebhookAlert requires a url');
  await axios.post(url, evaluation);
}

/**
 * Email alert (nodemailer is bundled with this package — no extra install).
 *
 * @param {object|import('nodemailer').Transporter} transporterOrOptions
 * @param {object} mailOptions - { from, to, subject?, text?, html? }
 * @param {object} evaluation
 */
async function emailAlert(transporterOrOptions, mailOptions, evaluation) {
  if (!mailOptions || !mailOptions.to) {
    throw new Error('emailAlert requires mailOptions.to (or set LWA_ALERT_EMAIL_TO)');
  }

  const lines = alertLines(evaluation);
  if (!lines.length) return;

  const transporter =
    transporterOrOptions && typeof transporterOrOptions.sendMail === 'function'
      ? transporterOrOptions
      : nodemailer.createTransport(transporterOrOptions);

  const textBody = [mailOptions.text, lines.join('\n')].filter(Boolean).join('\n\n');
  const htmlBody = mailOptions.html || buildHtmlBody(evaluation, lines);

  await transporter.sendMail({
    ...mailOptions,
    subject:
      mailOptions.subject ||
      `LWA rotation alert: ${evaluation.label}${evaluation.marketplace ? ` (${evaluation.marketplace})` : ''}`,
    text: textBody,
    html: htmlBody
  });
}

/**
 * Send email using flat config: { to, from, host, port, auth, ... }
 * Used when RotationMonitor is created with `email: true`.
 */
async function emailAlertFromConfig(emailConfig, evaluation) {
  const { transporter, transporterOptions } = resolveSmtpOptions(emailConfig);
  const mailOptions = resolveMailOptions(emailConfig);
  await emailAlert(transporter || transporterOptions, mailOptions, evaluation);
}

function consoleAlert(evaluation) {
  alertLines(evaluation).forEach((line) => console.warn(line));
}

/**
 * Fire several alert channels for one evaluation.
 *
 * email can be:
 *   - false / omitted  → skip
 *   - true             → use SMTP_* and LWA_ALERT_EMAIL_* env vars
 *   - { to, from, host, ... } → use that config
 *
 * @param {object} channels
 * @param {boolean|object} [channels.email]
 * @param {string} [channels.slackWebhook]
 * @param {string} [channels.webhookUrl]
 * @param {boolean} [channels.console=true]
 * @param {object} evaluation
 */
async function sendAlerts(channels = {}, evaluation) {
  const tasks = [];

  if (channels.slackWebhook) {
    tasks.push(slackAlert(channels.slackWebhook, evaluation));
  }
  if (channels.webhookUrl) {
    tasks.push(genericWebhookAlert(channels.webhookUrl, evaluation));
  }

  if (channels.email) {
    const emailConfig = channels.email === true ? {} : channels.email;
    tasks.push(emailAlertFromConfig(emailConfig, evaluation));
  }

  if (channels.console !== false) {
    consoleAlert(evaluation);
  }

  await Promise.all(tasks);
}

module.exports = {
  formatMessage,
  slackAlert,
  genericWebhookAlert,
  emailAlert,
  emailAlertFromConfig,
  consoleAlert,
  sendAlerts,
  resolveSmtpOptions,
  resolveMailOptions
};
