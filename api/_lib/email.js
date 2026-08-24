// api/_lib/email.js — magic-link send via Resend (or stdout in dev).
// Default behavior in dev: print the link to stdout. Set RESEND_API_KEY
// to switch to real email sending.

const FROM = process.env.SWR_FROM_EMAIL || 'SWR <noreply@saintedwordrecords.com>';

export async function sendMagicLink({ to, url, appOrigin }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Dev fallback: log to stdout. The Vercel function logs surface in
    // the dashboard; locally they appear in `npm run dev`.
    process.stdout.write(
      `\n[magic-link] to=${to}\n[magic-link] url=${url}\n[magic-link] appOrigin=${appOrigin}\n\n`
    );
    return { ok: true, transport: 'stdout' };
  }
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
    return { ok: false, error: e.message };
  }
}
