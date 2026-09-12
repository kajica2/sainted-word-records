# SMTP Transport for Magic-Link Email

> For: api/_lib/email.js + api/auth/magic.js + package.json
> Goal: Add an SMTP transport that can replace (or complement) the
>       existing Resend HTTPS-API path. Decision deferred to runtime via
>       env vars.

## Context

`api/_lib/email.js` currently uses Resend's HTTPS API and falls back to
stdout when `RESEND_API_KEY` is unset. No SMTP transport exists. The
user asked to "wire up smtp" — they want to send mail via raw SMTP
(port 25/465/587) so they can use any provider (Mailgun SMTP, SES SMTP,
Postmark SMTP, a self-hosted Postfix, etc.) without locking into Resend.

## Design (smallest reversible change)

1. **Add `nodemailer` to dependencies.** v7 is current; pulls in ~200 KB
   but Vite already handles treeshaking so the client bundle is unaffected
   (only the serverless `api/` functions import it).
2. **Extend `api/_lib/email.js`** with a transport chooser:
   - `SMTP_HOST` set → SMTP via nodemailer
   - else `RESEND_API_KEY` set → Resend (existing path, untouched)
   - else → stdout (existing dev fallback, untouched)
3. **Preserve the existing `sendMagicLink({to,url,appOrigin})` signature**
   so `api/auth/magic.js` doesn't change. The function returns the same
   shape `{ ok, transport, error? }` so callers can branch on `transport`
   if they want.
4. **Env vars**:
   - `SMTP_HOST` (required to enable)
   - `SMTP_PORT` (default 587 — STARTTLS submission port)
   - `SMTP_USER` / `SMTP_PASS` (optional; many relays accept unauthenticated
     local traffic)
   - `SMTP_SECURE` (default false; true for port 465 implicit TLS)
   - `SMTP_FROM` (optional override; default `SWR_FROM_EMAIL`)
5. **No new serverless function.** The Vercel Hobby 12-function cap is
   already at 12; adding `/api/auth/test-email` would push it to 13 and
   break deploys. SMTP verification is done by reading the function logs
   (`vercel logs`) or by sending a real magic-link through `/auth/login`.

## Files

- Modify: `api/_lib/email.js` (add transport chooser + SMTP path)
- Modify: `package.json` (add `nodemailer` to dependencies)
- Modify: `SECURITY.md` (document SMTP env vars)
- Modify: `.env.example` (add SMTP_* stubs)

## Risks

- **Vercel function-size limit**: each `api/*.js` is bundled with its
  imports. Adding nodemailer bumps the magic-link function's bundle
  from ~30 KB to ~200 KB. Vercel Hobby allows up to 50 MB compressed,
  so this is well within the cap. Verify with
  `find api -name "*.js" ! -path "*/_lib/*" | wc -l` (must stay ≤ 12).
- **First request is slow**: nodemailer initializes the SMTP connection
  on the first send. Vercel cold starts compound this. Acceptable for
  auth flows (one-off) but worth noting.
- **STARTTLS vs implicit TLS**: port 587 = STARTTLS (secure:false, then
  upgrade). Port 465 = implicit TLS (secure:true). The transporter
  config handles both; user just sets `SMTP_PORT` correctly.

## Verification

1. `npm run check:syntax` — must parse OK
2. `npm run check` — full gate must stay green
3. New unit test: `verify-smtp-transport.mjs`
   - Load `api/_lib/email.js` with `SMTP_HOST=localhost` set
   - Mock `nodemailer.createTransport` to return a stub
   - Verify it calls `sendMail` with the right envelope
   - Verify return value is `{ ok: true, transport: 'smtp' }`
4. Existing Resend/stdout paths unchanged — confirm via a negative test
   (no SMTP_HOST set, no RESEND_API_KEY) → stdout fires

## Rollback

Remove `nodemailer` from package.json, revert email.js. SMTP path is
purely additive — removing it leaves Resend + stdout intact.

## Out of scope

- DKIM/SPF/DMARC configuration (host the user's responsibility)
- Bounce handling / unsubscribe headers
- HTML email templates (current magic-link is plain text only)
- A test endpoint (would exceed the 12-function Hobby cap)
