const nodemailer = require('nodemailer');
const logger = require('./logger');

/* Gmail SMTP. Requires a Google account with 2-Step Verification enabled and a
   16-character App Password (a normal account password will be rejected):
     SMTP_USER=you@gmail.com
     SMTP_PASS=abcd efgh ijkl mnop
   Without those the app still runs and emails are logged to the console instead,
   which is what local development uses. */

let transporter = null;
let transportError = null;

function getTransporter() {
  if (transporter || transportError) return transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    transportError = 'SMTP_USER / SMTP_PASS not configured';
    return null;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/* ── Branded template ─────────────────────────────────────────────────────
   Mail clients strip <style> blocks and ignore CSS variables, so the palette
   from frontend/public/css/style.css is inlined here by hand. Table layout is
   deliberate, because Outlook does not support flexbox or grid. */

const PALETTE = {
  forest: '#1B4332',
  moss: '#2D6A4F',
  leaf: '#52B788',
  cream: '#FFFDF5',
  mist: '#EEF5F0',
  ink: '#1A1A1A',
  slate: '#3D4F47',
  quiet: '#7A9088',
  border: '#D4E6DB',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTemplate({ heading, intro, bodyHtml = '', ctaLabel, ctaUrl, footnote }) {
  const button = ctaUrl
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0">
      <tr><td style="border-radius:8px;background:${PALETTE.forest}">
        <a href="${escapeHtml(ctaUrl)}"
           style="display:inline-block;padding:13px 28px;font-family:Inter,Helvetica,Arial,sans-serif;
                  font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">
          ${escapeHtml(ctaLabel || 'Continue')}
        </a>
      </td></tr>
    </table>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${PALETTE.mist}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.mist};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:${PALETTE.cream};border:1px solid ${PALETTE.border};border-radius:16px;overflow:hidden">

        <tr><td style="background:${PALETTE.forest};padding:22px 32px">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#ffffff;letter-spacing:.3px">KejaHub</span>
          <span style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:${PALETTE.leaf};display:block;margin-top:3px">
            Student housing, made simple
          </span>
        </td></tr>

        <tr><td style="padding:32px">
          <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;
                     font-weight:400;color:${PALETTE.ink}">${escapeHtml(heading)}</h1>
          <p style="margin:0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;
                    line-height:1.6;color:${PALETTE.slate}">${escapeHtml(intro)}</p>
          ${bodyHtml}
          ${button}
          ${
            footnote
              ? `<p style="margin:22px 0 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;
                                   line-height:1.6;color:${PALETTE.quiet}">${escapeHtml(footnote)}</p>`
              : ''
          }
        </td></tr>

        <tr><td style="padding:18px 32px;background:${PALETTE.mist};border-top:1px solid ${PALETTE.border}">
          <p style="margin:0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${PALETTE.quiet}">
            You received this because someone used this address on KejaHub.
            Questions? Reply to this email and our team will help.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendMail({
  to,
  subject,
  heading,
  intro,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  footnote,
  text,
}) {
  const html = renderTemplate({ heading, intro, bodyHtml, ctaLabel, ctaUrl, footnote });
  const plain = text || [intro, ctaUrl, footnote].filter(Boolean).join('\n\n');
  const transport = getTransporter();

  if (!transport) {
    logger.info('Mailer not configured, logging email instead of sending', { to, subject, plain });
    return { delivered: false, reason: 'not_configured' };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || `KejaHub <${process.env.SMTP_USER}>`,
    to,
    subject,
    text: plain,
    html,
  });
  return { delivered: true };
}

function sendPasswordResetEmail(to, resetUrl) {
  return sendMail({
    to,
    subject: 'Reset your KejaHub password',
    heading: 'Reset your password',
    intro:
      'We received a request to reset the password on your KejaHub account. Click the button below to choose a new one.',
    ctaLabel: 'Choose a new password',
    ctaUrl: resetUrl,
    footnote:
      'This link expires in 1 hour and can only be used once. If you did not request a reset, you can safely ignore this email. Your password will not change.',
  });
}

function sendVerificationEmail(to, verifyUrl) {
  return sendMail({
    to,
    subject: 'Verify your KejaHub email address',
    heading: 'Confirm your email address',
    intro:
      'Thanks for signing up for KejaHub. Click the button below to verify your email address and finish setting up your account.',
    ctaLabel: 'Verify my email',
    ctaUrl: verifyUrl,
    footnote:
      'This link expires in 24 hours and can only be used once. If you did not create a KejaHub account, you can safely ignore this email.',
  });
}

function sendBookingRequestEmail(to, { studentName, houseTitle, houseUrl }) {
  return sendMail({
    to,
    subject: `New booking request: ${houseTitle}`,
    heading: 'You have a new booking request',
    intro: `${studentName} has requested a viewing or booking for "${houseTitle}". Log in to accept or decline the request.`,
    ctaLabel: 'View the request',
    ctaUrl: houseUrl,
  });
}

function sendBookingStatusEmail(to, { houseTitle, status, houseUrl }) {
  const verb = status === 'accepted' ? 'accepted' : 'declined';
  return sendMail({
    to,
    subject: `Your booking request was ${verb}: ${houseTitle}`,
    heading: `Your request was ${verb}`,
    intro: `The landlord for "${houseTitle}" has ${verb} your booking request.`,
    ctaLabel: 'View the listing',
    ctaUrl: houseUrl,
  });
}

// Test seam. Swapping in a collector transport lets a test assert on the reset
// link that was actually mailed, rather than reaching for real SMTP. Passing
// null restores the normal lazy lookup of SMTP_USER / SMTP_PASS.
function __setTransport(fake) {
  transporter = fake;
  transportError = null;
}

module.exports = {
  sendMail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendBookingRequestEmail,
  sendBookingStatusEmail,
  renderTemplate,
  isConfigured,
  __setTransport,
};
