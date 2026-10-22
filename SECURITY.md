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
6. **Rate limits** - per-IP on `/api/auth/magic` (10/min), per-user on `/api/storage/sign-upload` (60/min) and `sign-download` (120/min), per-user on `/api/projects` writes (30/min), per-user on `/api/connect` create (10/min) and onboard-link (30/min), per-user on `/api/catalogue` create (30/min), update (60/min) and delete (30/min), per-user on `/api/checkout` (10/min), per-IP on `/api/catalogue/public` (120/min), per-IP on `/api/invite/redeem` (30/min), per-IP on `/api/license/verify` (60/min), per-IP on `/api/pt/verify` (5 per 2s), per-IP on `/api/early-access` (5/hour). All return 429 with `Retry-After`.
7. **Client IP** - the per-IP bucket key is `clientIp(req)` from `api/_lib/http.js`, and every handler calls it instead of reading a header. `x-forwarded-for` is a request header, so it is only read when a proxy we trust wrote it (see "Where the client IP comes from" below).
8. **Project ownership** - `getProject(userId, id)` returns null unless the project belongs to that user. Tested in `scripts/test-api.mjs`.
9. **Storage backend** - two interchangeable backends, selected by env:
   - **Vercel Blob** (`BLOB_READ_WRITE_TOKEN` set — production): blobs persist on Vercel's CDN. Written with `access: 'public'`, so the CDN URL is unauthenticated. The pathname embeds the user's UUID (`<userId>/<key>`), so URLs aren't enumerable in practice — but anyone with the URL can read the blob. **Deferred:** `access: 'private'` + signed URLs for defence-in-depth; requires re-signing on every read.
   - **Local-fs** (token unset — dev only): writes under `SWRC_DATA_DIR/storage/<userId>/`. Ephemeral on Vercel.
   Both backends share the same guards (key scoping, `safeKey`, rate limits); the verifier exercises them per backend.
10. **Email** - magic-link emails are sent via SMTP (any provider) if `SMTP_HOST` is set, or via Resend's HTTPS API if `RESEND_API_KEY` is set. SMTP takes precedence when both are configured. Otherwise links are printed to stdout (dev only). Never logged in production with credentials present. SMTP credentials should be app-specific (e.g. Mailgun SMTP relay key), not the provider account password.
11. **Cookies** - `Secure` flag added when `NODE_ENV=production`. The dev server runs with HTTP, so `Secure` is omitted locally.

### What M1 does NOT defend against

- **CSRF on write endpoints** — SameSite=Lax is the only line of defense. Adding explicit CSRF tokens is a v2 task once we have user reports of abuse.
- **Email enumeration** — `/api/auth/magic` returns `{ ok: true }` for every email to avoid leaking which addresses are signed up. The trade-off: an attacker can spray magic-link emails to arbitrary addresses; the per-IP rate limit is the cap.
- **Session fixation** — sessions are server-side and only minted after token verification, so this isn't a concern yet.
- **Magic-link forwarding** — anyone with the email can sign in. We rely on email-account security for this.
- **A misconfigured proxy list collapses the limits, it does not remove them** - see "Where the client IP comes from" below. The failure mode of a wrong `TRUSTED_PROXIES` is one shared bucket (429s), never a bypass.

### Where the client IP comes from

Every per-IP rate limit takes its bucket key from `clientIp(req)` in
`api/_lib/http.js`. No handler reads a header to decide who the client is,
and `scripts/check-trusted-proxies-unit.mjs` fails the build if one starts
again.

The rule, in order:

1. **`TRUSTED_PROXIES` is the whole trust configuration.** A comma- or
   space-separated list of the reverse proxies in front of this deployment,
   as exact IPs or CIDR ranges (`10.0.0.7`, `172.16.0.0/12`, `2001:db8::/32`).
2. **The immediate peer is `req.socket.remoteAddress`, and the header is
   ignored unless that peer is on the list.** This is the gate. A header is
   only evidence of anything when something behind us put it there.
3. **The chain is walked from the right.** Each proxy appends the address of
   the hop in front of it, so the right-hand entries are the ones our proxies
   wrote and everything to the left of the client is whatever the client
   prepended. Entries that are trusted proxies are skipped; the first entry
   that is not one is the client. With N trusted proxies that is the (N+1)th
   entry from the right. A walk from the left is the vulnerability, not the
   fix.
4. **Fail closed.** An absent, blank or unparseable `TRUSTED_PROXIES` trusts
   nothing. A single bad entry is skipped (with a warning naming it) rather
   than invalidating the list, so a typo cannot disable the proxy in front of
   the app; it also cannot make the header more trusted.
5. **On Vercel the platform is the proxy, so no list is needed.** Vercel's
   edge overwrites `x-forwarded-for` with the client's public IP and does not
   forward external IPs. `clientIp()` therefore honours the leftmost entry
   when `VERCEL` is set, because on that platform it is a single value the
   edge wrote. Everywhere else, with no list, the peer is used and the header
   is discarded.

Why 5 is the way round: inside a Vercel function the socket is the edge, not
the browser, so the peer is one address shared by every visitor. Trusting
nothing there would put every user in one bucket and have the site rate-limit
itself. A limit that is too strict fails loudly with 429s; a limit that is too
loose fails silently. The rule picks the loud failure.

Set `TRUSTED_PROXIES` whenever the app is deployed behind anything at all that
is not Vercel: a VPS with nginx, a container behind an ALB or a CloudFront
distribution, the `serve-repo` mirror on a LAN. Deploying without it off
Vercel is not a bypass; it means every client shares the peer's bucket, so the
per-IP limits become per-deployment limits. Set it to the published ranges of
whatever terminates the connection.

## Hall of Fame

No external reports yet. Be the first.

---

Built on Vite, deployed on Vercel, runs in your browser. The engine remains fully local-first; cloud sync (M1) is opt-in.