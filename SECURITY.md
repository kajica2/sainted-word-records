# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark:  |
| < 0.1.0 | :x:                |

The deployed instance on Vercel is treated as the latest commit on `main`.

## Reporting a Vulnerability

**Please don't open a public GitHub issue for security bugs.** It gives attackers a heads-up before a fix ships.

Instead, email **kai.djuric@gmail.com** with:

1. A short description of the issue
2. Reproduction steps (URL, account state if relevant, browser)
3. Impact (what can an attacker do? auth bypass, XSS, data leak, …)
4. Any known workarounds

You should get an acknowledgement within **72 hours**. Expect a fix or status update within **7 days** for anything that affects logged-in users or production data.

## Scope

This codebase runs primarily client-side, with a thin serverless backend (added in M1, 2026-08-24):

- **In scope**:
  - XSS via stored songs / library assets / persona names, IndexedDB poisoning, third-party CDN compromise (Google Fonts, Vercel, ElevenLabs), Vite build pipeline tampering, service worker abuse.
  - Auth: magic-link email flow, session cookie handling, ownership checks on per-user resources.
  - Storage: signed URL scoping, path-traversal prevention on upload/download keys.
  - API abuse: rate limits on `/api/auth/*` and `/api/storage/*`.
- **Out of scope**:
  - Self-XSS (paste a payload into your own browser, get owned — that's on you).
  - DoS against the magic-link endpoint (mitigated by per-IP rate limit; persistent abuse should be reported).

## M1 backend threat model

The M1 backend adds:

1. **Session cookies** — HttpOnly, SameSite=Lax, Secure in production. 30-day rolling TTL. Cookie name: `swrc_session`.
2. **Magic-link tokens** — 32-byte base64url secrets, one-shot (consumed on use), 24h TTL. Stored server-side.
3. **Signed URLs** — all storage operations go through `/api/storage/sign-upload` + `/api/storage/sign-download`, which scope every key under `userId/...`. The handler also re-checks the prefix on every request to defend against tampered queries.
4. **Path traversal** — `safeKey()` rejects keys containing `..`, leading `/`, or any `\`. Tested in `scripts/test-api.mjs`.
5. **Cross-user scope** — verified end-to-end (see `verify-cloud-auth.mjs`). A user requesting `/api/storage/object?key=<otherUserId>/...` returns 403.
6. **Rate limits** — per-IP on `/api/auth/magic` (10/min), per-user on `/api/storage/sign-upload` (60/min) and `sign-download` (120/min), per-user on `/api/projects` writes (30/min). All return 429 with `Retry-After`.
7. **Project ownership** — `getProject(userId, id)` returns null unless the project belongs to that user. Tested in `scripts/test-api.mjs`.
8. **Local-fs backing (dev only)** — `SWRC_DATA_DIR` defaults to `./data`. On Vercel prod, this is read-only; the M1 local-fs store is replaced by Postgres + R2 in M2 (per `.hermes/decisions/001-auth-provider.md`).
9. **Email** — magic-link emails are sent via SMTP (any provider) if `SMTP_HOST` is set, or via Resend's HTTPS API if `RESEND_API_KEY` is set. SMTP takes precedence when both are configured. Otherwise links are printed to stdout (dev only). Never logged in production with credentials present. SMTP credentials should be app-specific (e.g. Mailgun SMTP relay key), not the provider account password.
10. **Cookies** — `Secure` flag added when `NODE_ENV=production`. The dev server runs with HTTP, so `Secure` is omitted locally.

### What M1 does NOT defend against

- **CSRF on write endpoints** — SameSite=Lax is the only line of defense. Adding explicit CSRF tokens is a v2 task once we have user reports of abuse.
- **Email enumeration** — `/api/auth/magic` returns `{ ok: true }` for every email to avoid leaking which addresses are signed up. The trade-off: an attacker can spray magic-link emails to arbitrary addresses; the per-IP rate limit is the cap.
- **Session fixation** — sessions are server-side and only minted after token verification, so this isn't a concern yet.
- **Magic-link forwarding** — anyone with the email can sign in. We rely on email-account security for this.
- **Magic-link IP spoofing via `x-forwarded-for`** — the rate limit on `/api/auth/magic` uses the leftmost entry in `x-forwarded-for` as the bucket key. On Vercel this is safe (Vercel sets the header from a trusted edge). If the API is ever deployed behind a different proxy (or no proxy) without the `TRUSTED_PROXIES` env var, an attacker can spoof the header and bypass the per-IP rate limit. Add `process.env.TRUSTED_PROXIES` gating before exposing this endpoint outside Vercel.

## Hall of Fame

No external reports yet. Be the first.

---

Built on Vite, deployed on Vercel, runs in your browser. The engine remains fully local-first; cloud sync (M1) is opt-in.