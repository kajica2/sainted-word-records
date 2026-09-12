// api/_lib/email.js — magic-link send via SMTP, Resend (HTTPS API),
// or stdout fallback (dev). The transport is chosen at call time by
// inspecting process.env:
//
//   SMTP_HOST set          → SMTP via nodemailer (port 587 STARTTLS by
//                            default; port 465 → secure=true)
//   else RESEND_API_KEY    → Resend (unchanged from prior behaviour)
//   else                   → stdout log (dev / "no creds" fallback)
//
// All transports return { ok, transport, error? } so callers can log
// or branch on the result.
//
// Test indirection: when process.env.__NODEMAILER_STUB__ === '1', the
// SMTP path uses globalThis.__NODEMAILER_FACTORY__(config) instead of
// importing nodemailer. This lets unit tests inject a stub without a
// loader hook (and without forcing the test to install nodemailer in
// the test runtime).

const FROM = process.env.SWR_FROM_EMAIL
  || process.env.SMTP_FROM
  || 'SWR <noreply@saintedwordrecords.com>';

function selectTransport() {
  if (process.env.SMTP_HOST) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'stdout';
}

async function sendViaSmtp({ to, url }) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  // Port 465 = implicit TLS. Port 587 (and 25, 2525) = STARTTLS.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
    : (port === 465);
  const cfg = {
    host,
    port,
    secure,
  };
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
    await transporter.sendMail({
      from: FROM,
      to,
      subject: 'Sign in to Sainted Word Records',
      text:
        `Click the link below to sign in to Sainted Word Records.\n\n` +
        `${url}\n\n` +
        `This link expires in 24 hours.\n`,
    });
    return { ok: true, transport: 'smtp' };
  } catch (e) {
    return { ok: false, transport: 'smtp', error: e.message };
  }
}

async function sendViaResend({ to, url, appOrigin }) {
  const apiKey = process.env.RESEND_API_KEY;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: 'Sign in to Sainted Word Records',
        text:
          `Click the link below to sign in to Sainted Word Records.\n\n` +
          `${url}\n\n` +
          `This link expires in 24 hours.\n`,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`resend ${res.status}: ${txt}`);
    }
    return { ok: true, transport: 'resend' };
  } catch (e) {
    // Last-resort: log so the user isn't locked out
    process.stdout.write(`[magic-link FALLBACK] to=${to} url=${url} err=${e.message}\n`);
    return { ok: false, transport: 'resend', error: e.message };
  }
}

function sendViaStdout({ to, url, appOrigin }) {
  process.stdout.write(
    `\n[magic-link] to=${to}\n[magic-link] url=${url}\n[magic-link] appOrigin=${appOrigin}\n\n`
  );
  return { ok: true, transport: 'stdout' };
}

export async function sendMagicLink({ to, url, appOrigin }) {
  const transport = selectTransport();
  if (transport === 'smtp') return sendViaSmtp({ to, url });
  if (transport === 'resend') return sendViaResend({ to, url, appOrigin });
  return sendViaStdout({ to, url, appOrigin });
}
