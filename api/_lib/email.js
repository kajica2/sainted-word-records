// api/_lib/email.js — transactional + welcome email delivery via SMTP,
// Resend (HTTPS API), or stdout fallback (dev). The transport is chosen
// at call time by inspecting process.env:
//
//   SMTP_HOST set          → SMTP via nodemailer (port 587 STARTTLS by
//                            default; port 465 → secure=true)
//   else RESEND_API_KEY    → Resend
//   else                   → stdout log (dev / "no creds" fallback)
//
// Message builders (sendMagicLink, sendWelcomeEmail) compose a
// { subject, text, html, headers } payload and hand it to deliver(),
// which owns transport dispatch. Adding a new message type means adding
// a builder, not another transport branch.
//
// All sends return { ok, transport, error? } so callers can log or branch.
//
// Test indirection: when process.env.__NODEMAILER_STUB__ === '1', the
// SMTP path uses globalThis.__NODEMAILER_FACTORY__(config) instead of
// importing nodemailer. This lets unit tests inject a stub without a
// loader hook (and without forcing the test to install nodemailer in
// the test runtime).

const FROM = process.env.SWR_FROM_EMAIL
  || process.env.SMTP_FROM
  || 'SWR <noreply@saintedwordrecords.com>';

// Where replies go. The welcome email invites replies, so this must be a
// real monitored inbox — not the send-only From address.
const REPLY_TO = process.env.SWR_REPLY_TO_EMAIL || '';

// Required by CAN-SPAM in commercial email. Set via env so it can be
// corrected without a code change. Unset => the welcome email omits the
// postal block and logs a warning (see sendWelcomeEmail).
const MAILING_ADDRESS = process.env.SWR_MAILING_ADDRESS || '';

const APP_ORIGIN_FALLBACK = process.env.SWRC_APP_ORIGIN || 'http://localhost:5174';

function selectTransport() {
  if (process.env.SMTP_HOST) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'stdout';
}

// ---- Transports ------------------------------------------------------
// Each takes a fully-composed message: { to, subject, text, html, headers }.

async function smtpDeliver(msg) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  // Port 465 = implicit TLS. Port 587 (and 25, 2525) = STARTTLS.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
    : (port === 465);
  const cfg = { host, port, secure };
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (user || pass) cfg.auth = { user: user || '', pass: pass || '' };

  let transporter;
  if (process.env.__NODEMAILER_STUB__ === '1' && globalThis.__NODEMAILER_FACTORY__) {
    transporter = globalThis.__NODEMAILER_FACTORY__(cfg);
  } else {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport(cfg);
  }

  try {
    const envelope = {
      from: FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    };
    if (msg.html) envelope.html = msg.html;
    if (REPLY_TO) envelope.replyTo = REPLY_TO;
    if (msg.headers) envelope.headers = msg.headers;
    await transporter.sendMail(envelope);
    return { ok: true, transport: 'smtp' };
  } catch (e) {
    return { ok: false, transport: 'smtp', error: e.message };
  }
}

async function resendDeliver(msg) {
  const apiKey = process.env.RESEND_API_KEY;
  try {
    const payload = {
      from: FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    };
    if (msg.html) payload.html = msg.html;
    if (REPLY_TO) payload.reply_to = REPLY_TO;
    if (msg.headers) payload.headers = msg.headers;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Bound the call. The welcome send is awaited inside the request
      // lifecycle (a floating promise can be killed when a serverless
      // function returns), so an unbounded POST could stall sign-in.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`resend ${res.status}: ${txt}`);
    }
    return { ok: true, transport: 'resend' };
  } catch (e) {
    // Last-resort: log so the user isn't locked out
    process.stdout.write(`[${msg.label || 'email'} FALLBACK] to=${msg.to} subject="${msg.subject}" err=${e.message}\n`);
    return { ok: false, transport: 'resend', error: e.message };
  }
}

function stdoutDeliver(msg) {
  // Keep a greppable per-message label: the magic link is copied out of
  // the terminal by hand in dev, so `grep magic-link` must keep working.
  const label = msg.label || 'email';
  process.stdout.write(
    `\n[${label}] to=${msg.to}\n[${label}] subject=${msg.subject}\n` +
    `${msg.text}\n\n`
  );
  return { ok: true, transport: 'stdout' };
}

async function deliver(msg) {
  const transport = selectTransport();
  if (transport === 'smtp') return smtpDeliver(msg);
  if (transport === 'resend') return resendDeliver(msg);
  return stdoutDeliver(msg);
}

// ---- Message builders ------------------------------------------------

export async function sendMagicLink({ to, url, appOrigin }) {
  return deliver({
    to,
    label: 'magic-link',
    subject: 'Sign in to Sainted Word Records',
    text:
      `Click the link below to sign in to Sainted Word Records.\n\n` +
      `${url}\n\n` +
      `This link expires in 24 hours.\n`,
  });
}

/**
 * Welcome email for a first-time sign-up.
 *
 * Sent once per account (the caller gates on user.welcomedAt), after the
 * user has actually verified — not when they merely requested a link.
 *
 * @param {object} args
 * @param {string} args.to        Recipient address.
 * @param {string} [args.name]    First name / handle for the greeting.
 * @param {string} [args.appOrigin] Origin for the product links.
 */
export async function sendWelcomeEmail({ to, name, appOrigin }) {
  const origin = (appOrigin || APP_ORIGIN_FALLBACK).replace(/\/$/, '');
  const first = (name || '').trim().split(/[\s@]/)[0] || 'there';

  // The body invites replies, so an unsubscribe affordance is required
  // (and a Reply-To that actually reaches a human). Both are built from
  // env so they can be corrected without touching this file.
  const unsubMailto = REPLY_TO || FROM.replace(/^.*</, '').replace(/>.*$/, '');
  const unsubLine = `Unsubscribe: mailto:${unsubMailto}?subject=unsubscribe`;

  if (!MAILING_ADDRESS) {
    // Loud, once per send: the footer is legally required for commercial
    // email, and silently shipping without it is worse than a noisy log.
    process.stdout.write(
      '[email] WARNING: SWR_MAILING_ADDRESS is unset — the welcome email is ' +
      'missing its postal address (required by CAN-SPAM for commercial email).\n'
    );
  }

  const textBody = [
    `Hey ${first},`,
    '',
    "I'm Kai Djuric — I run Sainted Word Records.",
    '',
    'I built it because I wanted to make music videos without a timeline, a render farm, or a subscription. You drop in a song, you drop in your clips, and the audio drives everything.',
    '',
    'Here are 3 tips to get started.',
    '',
    '1. Make your first video',
    'Open the engine, load a song, add a couple of clips, hit play.',
    `   ${origin}/engine`,
    '',
    '2. Try a visual style',
    '24 preset looks — neon, film, grid, hallucination and more. Pick one and apply it to your clips.',
    `   ${origin}/versions`,
    '',
    '3. Sign in and keep your library',
    'Uploads now follow you across devices instead of living in one browser.',
    `   ${origin}/engine`,
    '',
    'P.S. What are you trying to make? Hit Reply and tell me — I read every one.',
    '',
    'Cheers,',
    'Kai Djuric',
    '',
    '---',
    "You're receiving this because you created an account at Sainted Word Records.",
    unsubLine,
    ...(MAILING_ADDRESS ? ['', MAILING_ADDRESS] : []),
  ].join('\n');

  // Minimal HTML mirror — the links are the only element that needs markup.
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#111;">
<p>Hey ${escapeHtml(first)},</p>
<p>I'm Kai Djuric — I run Sainted Word Records.</p>
<p>I built it because I wanted to make music videos without a timeline, a render farm, or a subscription. You drop in a song, you drop in your clips, and the audio drives everything.</p>
<p>Here are 3 tips to get started.</p>
<p><strong>1. Make your first video</strong><br>
Open the engine, load a song, add a couple of clips, hit play.<br>
<a href="${escapeHtml(origin)}/engine">${escapeHtml(origin)}/engine</a></p>
<p><strong>2. Try a visual style</strong><br>
24 preset looks — neon, film, grid, hallucination and more. Pick one and apply it to your clips.<br>
<a href="${escapeHtml(origin)}/versions">${escapeHtml(origin)}/versions</a></p>
<p><strong>3. Sign in and keep your library</strong><br>
Uploads now follow you across devices instead of living in one browser.<br>
<a href="${escapeHtml(origin)}/engine">${escapeHtml(origin)}/engine</a></p>
<p>P.S. What are you trying to make? Hit <strong>Reply</strong> and tell me — I read every one.</p>
<p>Cheers,<br>Kai Djuric</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#666;">You're receiving this because you created an account at Sainted Word Records.<br>
<a href="mailto:${escapeHtml(unsubMailto)}?subject=unsubscribe" style="color:#666;">Unsubscribe</a>${
    MAILING_ADDRESS ? `<br>${escapeHtml(MAILING_ADDRESS)}` : ''
  }</p>
</body></html>`;

  return deliver({
    to,
    label: 'welcome',
    subject: 'Welcome to Sainted Word Records',
    text: textBody,
    html,
    headers: {
      // Lets Gmail/Outlook render a native unsubscribe control, which
      // materially helps deliverability for bulk-ish senders.
      'List-Unsubscribe': `<mailto:${unsubMailto}?subject=unsubscribe>`,
    },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
