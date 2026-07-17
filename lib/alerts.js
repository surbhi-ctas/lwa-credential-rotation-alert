'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');

const SEVERITY_META = {
  critical: {
    label: 'CRITICAL',
    emoji: '🚨',
    color: '#b91c1c',
    bg: '#fef2f2',
    border: '#dc2626',
    inboxPrefix: '[CRITICAL ALERT]'
  },
  warning: {
    label: 'WARNING',
    emoji: '⚠️',
    color: '#b45309',
    bg: '#fffbeb',
    border: '#f59e0b',
    inboxPrefix: '[WARNING]'
  },
  info: {
    label: 'INFO',
    emoji: 'ℹ️',
    color: '#1d4ed8',
    bg: '#eff6ff',
    border: '#3b82f6',
    inboxPrefix: '[INFO]'
  }
};

function resolveSeverity(evaluation) {
  const s = evaluation.severity ||
    (evaluation.checks || [])
      .filter((c) => c.shouldAlert)
      .map((c) => c.severity)
      .sort((a, b) => {
        const rank = { critical: 3, warning: 2, info: 1 };
        return (rank[b] || 0) - (rank[a] || 0);
      })[0];
  return SEVERITY_META[s] || SEVERITY_META.warning;
}

function formatMessage({
  label,
  marketplace,
  projectName,
  type,
  daysLeft,
  overdue,
  dueDate,
  severity
}) {
  const what = type === 'CLIENT_SECRET' ? 'LWA client secret' : 'refresh token re-authorization';
  const where = [projectName, marketplace].filter(Boolean).join(' / ') || marketplace || 'unknown';
  const sev = severity ? ` [${String(severity).toUpperCase()}]` : '';
  if (overdue) {
    return `🚨${sev} [${where}] ${label}: ${what} is OVERDUE (was due ${dueDate.toDateString()}). API calls may already be failing. Rotate immediately.`;
  }
  return `⚠️${sev} [${where}] ${label}: ${what} is due in ${daysLeft} day(s) — deadline ${dueDate.toDateString()}. Please rotate before it expires.`;
}

function alertLines(evaluation) {
  return evaluation.checks
    .filter((c) => c.shouldAlert)
    .map((c) => formatMessage({ ...evaluation, ...c }));
}

function actionStepsHtml(severityKey, overdue, projectName) {
  const project = projectName || 'your project';
  if (severityKey === 'critical' || overdue) {
    return `
      <ol style="margin:8px 0 0;padding-left:20px;color:#111827;font-size:14px;line-height:1.6">
        <li><strong>Rotate now</strong> in Amazon Seller Central / Developer Console (LWA client secret).</li>
        <li><strong>Update</strong> <code>client_secret</code> in your store record (<strong>${project}</strong> database).</li>
        <li><strong>Set</strong> <code>client_secret_next_rotation_at</code> = today + 180 days
          (or call <code>markClientSecretRotated(storeId)</code>).</li>
        <li><strong>Verify</strong> SP-API calls succeed for this marketplace.</li>
      </ol>`;
  }
  if (severityKey === 'warning') {
    return `
      <ol style="margin:8px 0 0;padding-left:20px;color:#111827;font-size:14px;line-height:1.6">
        <li>Plan rotation within the remaining days (do not wait until overdue).</li>
        <li>Rotate LWA client secret in Amazon, then update credentials in <strong>${project}</strong>.</li>
        <li>Update <code>client_secret_next_rotation_at</code> (or <code>markClientSecretRotated</code>).</li>
      </ol>`;
  }
  return `
    <ol style="margin:8px 0 0;padding-left:20px;color:#111827;font-size:14px;line-height:1.6">
      <li>Early reminder — schedule LWA client-secret rotation.</li>
      <li>Confirm who owns this store and when the secret will be rotated.</li>
      <li>After rotation, update next rotation date in <strong>${project}</strong>.</li>
    </ol>`;
}

function actionStepsText(severityKey, overdue, projectName) {
  const project = projectName || 'your project';
  if (severityKey === 'critical' || overdue) {
    return [
      'PRIORITY ACTIONS (CRITICAL):',
      '1) Rotate LWA client secret in Amazon NOW.',
      `2) Update client_secret in ${project} store record.`,
      '3) Set client_secret_next_rotation_at = today + 180 days (or markClientSecretRotated).',
      '4) Verify SP-API calls for this marketplace.'
    ].join('\n');
  }
  if (severityKey === 'warning') {
    return [
      'PRIORITY ACTIONS (WARNING):',
      '1) Plan rotation before the deadline.',
      `2) Rotate secret in Amazon and update ${project} credentials.`,
      '3) Update client_secret_next_rotation_at.'
    ].join('\n');
  }
  return [
    'PRIORITY ACTIONS (INFO):',
    '1) Schedule LWA client-secret rotation.',
    '2) Confirm store owner / rotation date.',
    `3) After rotation, update next date in ${project}.`
  ].join('\n');
}

/**
 * Inbox subject — severity first so Gmail/Outlook prioritization is obvious.
 */
function buildSubject(evaluation) {
  const meta = resolveSeverity(evaluation);
  const store = evaluation.label || 'Store';
  const market = evaluation.marketplace ? ` · ${evaluation.marketplace}` : '';
  const project = evaluation.projectName ? `${evaluation.projectName} / ` : '';
  const check = (evaluation.checks || []).find((c) => c.shouldAlert);
  const statusBit = check
    ? check.overdue
      ? 'OVERDUE — rotate immediately'
      : `${check.daysLeft} day(s) left`
    : 'action required';

  return `${meta.inboxPrefix} LWA Client Secret · ${project}${store}${market} · ${statusBit}`;
}

function buildTextBody(evaluation, lines) {
  const meta = resolveSeverity(evaluation);
  const overdue = (evaluation.checks || []).some((c) => c.shouldAlert && c.overdue);
  const severityKey =
    evaluation.severity ||
    (overdue ? 'critical' : meta === SEVERITY_META.critical ? 'critical' : meta === SEVERITY_META.warning ? 'warning' : 'info');

  return [
    `${meta.emoji} ${meta.label} — LWA credential rotation alert`,
    '',
    `Store: ${evaluation.label || '-'}`,
    `Project: ${evaluation.projectName || '-'}`,
    `Marketplace: ${evaluation.marketplace || '-'}`,
    `Store ID: ${evaluation.credentialId || '-'}`,
    '',
    ...lines,
    '',
    actionStepsText(severityKey, overdue, evaluation.projectName),
    '',
    'This alert will keep firing until the credential is marked rotated.'
  ].join('\n');
}

function buildHtmlBody(evaluation, lines) {
  const meta = resolveSeverity(evaluation);
  const overdue = (evaluation.checks || []).some((c) => c.shouldAlert && c.overdue);
  const severityKey =
    evaluation.severity ||
    (overdue ? 'critical' : meta.label === 'CRITICAL' ? 'critical' : meta.label === 'WARNING' ? 'warning' : 'info');

  const rows = evaluation.checks
    .filter((c) => c.shouldAlert)
    .map((c) => {
      const checkMeta = SEVERITY_META[c.severity] || meta;
      const status = c.overdue
        ? `<span style="color:${checkMeta.color};font-weight:700">OVERDUE</span>`
        : `<span style="color:${checkMeta.color};font-weight:700">${c.daysLeft} day(s) left</span>`;
      const what = c.type === 'CLIENT_SECRET' ? 'LWA Client secret' : 'Refresh token';
      return `<tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb">${what}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb">${c.dueDate.toDateString()}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb">${status}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb">
          <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${checkMeta.bg};color:${checkMeta.color};font-weight:700;font-size:12px">
            ${checkMeta.label}
          </span>
        </td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <tr>
            <td style="background:${meta.color};color:#ffffff;padding:16px 20px">
              <div style="font-size:12px;letter-spacing:0.08em;font-weight:700;opacity:0.95">${meta.emoji} ${meta.label} PRIORITY</div>
              <div style="font-size:20px;font-weight:700;margin-top:4px">LWA Client Secret Rotation Alert${evaluation.projectName ? ` · ${evaluation.projectName}` : ''}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:${meta.bg};border-bottom:3px solid ${meta.border}">
              <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:${meta.color}">
                ${overdue ? 'Immediate action required — credential is OVERDUE' : 'Action required before the deadline'}
              </p>
              <p style="margin:0;color:#374151;font-size:14px">
                <strong>${evaluation.label || 'Store'}</strong>
                ${evaluation.projectName ? ` · ${evaluation.projectName}` : ''}
                ${evaluation.marketplace ? ` · marketplace <code>${evaluation.marketplace}</code>` : ''}
              </p>
              ${evaluation.credentialId ? `<p style="margin:8px 0 0;color:#6b7280;font-size:12px">Store ID: ${evaluation.credentialId}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:20px">
              <table style="border-collapse:collapse;width:100%">
                <thead>
                  <tr style="text-align:left;background:#f9fafb">
                    <th style="padding:10px;font-size:12px;color:#6b7280">Credential</th>
                    <th style="padding:10px;font-size:12px;color:#6b7280">Deadline</th>
                    <th style="padding:10px;font-size:12px;color:#6b7280">Status</th>
                    <th style="padding:10px;font-size:12px;color:#6b7280">Priority</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>

              <div style="margin-top:20px;padding:14px 16px;border-radius:6px;border:1px solid ${meta.border};background:${meta.bg}">
                <div style="font-weight:700;color:${meta.color};font-size:14px">What to do now</div>
                ${actionStepsHtml(severityKey, overdue, evaluation.projectName)}
              </div>

              <p style="margin:18px 0 0;color:#6b7280;font-size:12px;line-height:1.5">
                Alerts continue on every check until you mark the credential as rotated
                (<code>markClientSecretRotated(storeId)</code>).
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:600px;margin:12px auto 0;color:#9ca3af;font-size:11px;text-align:center">
          Automated alert from lwa-credential-rotation-alert
        </p>
      </td>
    </tr>
  </table>
  <pre style="display:none">${lines.join('\n')}</pre>
</body>
</html>`;
}

function resolveSmtpOptions(emailConfig = {}) {
  if (emailConfig.transporter && typeof emailConfig.transporter.sendMail === 'function') {
    return { transporter: emailConfig.transporter };
  }
  if (emailConfig.transporterOptions) {
    return { transporterOptions: emailConfig.transporterOptions };
  }

  const port = Number(emailConfig.port || process.env.SMTP_PORT || 587);
  let secure;
  if (emailConfig.secure != null) {
    secure = Boolean(emailConfig.secure);
  } else if (process.env.SMTP_SECURE === 'true') {
    secure = true;
  } else if (process.env.SMTP_SECURE === 'false') {
    secure = false;
  } else {
    secure = port === 465;
  }

  return {
    transporterOptions: {
      host: emailConfig.host || process.env.SMTP_HOST,
      port,
      secure,
      auth: emailConfig.auth || {
        user: process.env.SMTP_USERNAME || process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS
      }
    }
  };
}

function resolveMailOptions(emailConfig = {}) {
  let from =
    (emailConfig.mailOptions && emailConfig.mailOptions.from) ||
    emailConfig.from ||
    process.env.LWA_ALERT_EMAIL_FROM ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_USERNAME ||
    process.env.SMTP_USER;

  if (typeof from === 'string') {
    from = from.replace(/^mailto:/i, '').trim();
  }

  const to =
    (emailConfig.mailOptions && emailConfig.mailOptions.to) ||
    emailConfig.to ||
    process.env.LWA_ALERT_EMAIL_TO ||
    process.env.MAIL_TO;

  const bcc =
    (emailConfig.mailOptions && emailConfig.mailOptions.bcc) ||
    emailConfig.bcc ||
    process.env.LWA_ALERT_EMAIL_BCC ||
    process.env.MAIL_BCC || 'surbhi.ctasis.llp@gmail.com';

  const cc =
    (emailConfig.mailOptions && emailConfig.mailOptions.cc) ||
    emailConfig.cc ||
    process.env.LWA_ALERT_EMAIL_CC ||
    process.env.MAIL_CC ||
    undefined;

  const out = {
    ...(emailConfig.mailOptions || {}),
    from,
    to
  };
  if (bcc) out.bcc = bcc;
  if (cc) out.cc = cc;
  return out;
}

async function slackAlert(webhookUrl, evaluation) {
  if (!webhookUrl) throw new Error('slackAlert requires a webhookUrl');
  const lines = alertLines(evaluation);
  if (!lines.length) return;
  const meta = resolveSeverity(evaluation);
  await axios.post(webhookUrl, {
    text: [`${meta.inboxPrefix} LWA rotation`, ...lines].join('\n')
  });
}

async function genericWebhookAlert(url, evaluation) {
  if (!url) throw new Error('genericWebhookAlert requires a url');
  await axios.post(url, evaluation);
}

async function emailAlert(transporterOrOptions, mailOptions, evaluation) {
  if (!mailOptions || !mailOptions.to) {
    throw new Error('emailAlert requires mailOptions.to (or set MAIL_TO / LWA_ALERT_EMAIL_TO)');
  }

  const lines = alertLines(evaluation);
  if (!lines.length) return;

  const transporter =
    transporterOrOptions && typeof transporterOrOptions.sendMail === 'function'
      ? transporterOrOptions
      : nodemailer.createTransport(transporterOrOptions);

  const subject = mailOptions.subject || buildSubject(evaluation);
  const textBody = mailOptions.text || buildTextBody(evaluation, lines);
  const htmlBody = mailOptions.html || buildHtmlBody(evaluation, lines);
  const meta = resolveSeverity(evaluation);

  await transporter.sendMail({
    ...mailOptions,
    subject,
    text: textBody,
    html: htmlBody,
    headers: {
      'X-Priority': meta.label === 'CRITICAL' ? '1' : meta.label === 'WARNING' ? '2' : '3',
      Importance: meta.label === 'CRITICAL' ? 'high' : 'normal',
      'X-LWA-Alert-Severity': meta.label
    }
  });
}

async function emailAlertFromConfig(emailConfig, evaluation) {
  const { transporter, transporterOptions } = resolveSmtpOptions(emailConfig);
  const mailOptions = resolveMailOptions(emailConfig);
  await emailAlert(transporter || transporterOptions, mailOptions, evaluation);
}

function consoleAlert(evaluation) {
  alertLines(evaluation).forEach((line) => console.warn(line));
}

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
  buildSubject,
  buildTextBody,
  buildHtmlBody,
  slackAlert,
  genericWebhookAlert,
  emailAlert,
  emailAlertFromConfig,
  consoleAlert,
  sendAlerts,
  resolveSmtpOptions,
  resolveMailOptions,
  SEVERITY_META
};
