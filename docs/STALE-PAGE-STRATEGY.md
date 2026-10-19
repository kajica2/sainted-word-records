# Plan: Proactive Stale-Page Detection

> Generated 2026-10-13. Addresses the gap between "ship new version" and "user notices a refresh is needed."

## The gap

The current flow has three load-bearing pieces, all of which require the user to reload before they take effect:

1. **`lib/app-version-bust.js`** — runs in `<head>` on every page load. If the version in localStorage differs from the freshly-loaded `SWR_APP_VERSION`, it clears local state and forces a hard reload. **Requires a page load to fire.**
2. **`pwa-bootstrap.js`** — registers `/sw.js`, shows a `↻ new version · refresh` toast when the SW detects a new version (via `updatefound` + `statechange === 'installed'`). **Requires the SW to update AND the page to load to discover it.**
3. **Service worker cache** — uses stale-while-revalidate, so the *next* page load after deploy gets the fresh bundle. **Same constraint: requires a load.**

The user with the engine open for 6 hours straight, doing one long recording, never sees any of this. They will only ever reload on their own.

## What we need

A heartbeat that runs while the page is open and notices a new version, then prompts the user to refresh. Two delivery channels:

- **Periodic poll** (every 60s when the tab is visible) — catches the case where a long-running recording session is underway.
- **`visibilitychange` check** (tab becomes visible / focused) — catches the case where the user comes back to the tab after a deploy.

Both channels fetch `/lib/app-version.js` (a tiny file, ~250 bytes), parse the `window.SWR_APP_VERSION = "X"` value, and compare to the in-memory constant. If they differ, show a non-intrusive toast.

## Design decisions

- **No WebSocket / SSE.** Vercel serverless has no long-lived connections; the periodic fetch is the simplest reliable channel.
- **No BroadcastChannel for tab sync.** Out of scope; the per-tab fetch is cheap.
- **Pair with the existing PWA toast.** When the toast is shown, the click handler posts `SKIP_WAITING` to any waiting SW worker (so the new SW activates), then reloads. This is the same flow `pwa-bootstrap.js` already implements for SW-detected updates.
- **Throttle to visible tabs only.** A backgrounded tab polling every 60s wastes battery; the `visibilitychange` handler covers the return-to-foreground case.
- **Don't break long recordings.** The toast is dismissable, not blocking. A user can keep recording for an hour; the prompt just sits in the corner until they decide.
- **One toast, not a banner.** Use the existing `pwa-update-toast` styling so it matches the SW update flow visually — same CSS class, same position (top-right).

## File plan

### New: `lib/version-watcher.client.js`

Self-contained module that:

1. Reads `window.SWR_APP_VERSION` as the current version.
2. Every 60s (when `document.visibilityState === 'visible'`), `fetch('/lib/app-version.js', { cache: 'no-store' })`, extract the new version string, compare.
3. On `visibilitychange → 'visible'`, do one immediate check.
4. On mismatch, show a top-right toast with a refresh button.
5. Click handler: `swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })` if a waiting SW exists, then `location.reload()`. The existing `controllerchange` listener in `pwa-bootstrap.js` will reload anyway, so this is belt-and-suspenders.

```js
// lib/version-watcher.client.js — proactive stale-page detector.
//
// Catches the case where a user has the page open across a deploy:
// the version chrome (lib/app-version-bust.js) only fires on page
// load, the SW update toast only fires when the SW itself updates,
// and a user who never reloads would otherwise see the old version
// indefinitely. This module polls /lib/app-version.js every 60s
// while the tab is visible, and once on tab focus. A version
// mismatch shows the same top-right toast the PWA uses for SW
// updates, so the visual language is consistent and the click
// handler reuses the existing SKIP_WAITING + reload flow.

(function () {
  'use strict';
  if (window.SWR_VERSION_WATCHER) return;
  window.SWR_VERSION_WATCHER = true;

  const POLL_MS = 60_000;
  const VERSION_URL = '/lib/app-version.js';
  // The version we observed at page load. May be 'dev' in `npm run dev`.
  const currentVersion = window.SWR_APP_VERSION;

  // Bail in dev — no point polling a dev server for "new versions"
  // (every save re-emits a new build artifact with a fresh timestamp).
  if (currentVersion === 'dev' || currentVersion === undefined) return;

  let toastEl = null;
  let lastSeen = currentVersion;
  let pollTimer = null;

  function parseVersion(text) {
    // The file is the auto-generated Vite output:
    //   window.SWR_APP_VERSION = "2026.10.13.1";
    // Extract the string literal without eval.
    const m = text.match(/window\.SWR_APP_VERSION\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  }

  async function check() {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!res || !res.ok) return;
      const text = await res.text();
      const next = parseVersion(text);
      if (!next || next === lastSeen) return;
      // Version changed since the last check (or since page load).
      lastSeen = next;
      showToast(next);
    } catch (_) {
      // Offline / network error — silently ignore. The next tick
      // will try again. The version bust on next page load is the
      // safety net.
    }
  }

  function showToast(nextVersion) {
    if (toastEl) return;  // already showing
    toastEl = document.createElement('div');
    toastEl.className = 'pwa-update-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.style.display = 'block';
    toastEl.innerHTML = '<span class="pwa-refresh">↻ new version</span> · refresh';

    const reload = async () => {
      // If the SW has a waiting worker, let it take over first so the
      // new bundle is in place by the time the reload lands. The
      // existing pwa-bootstrap.js controllerchange listener will also
      // reload; this is the explicit path.
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            // Give the new worker a tick to claim, then reload.
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      } catch (_) { /* noop */ }
      location.reload();
    };

    toastEl.addEventListener('click', reload);
    document.body.appendChild(toastEl);
  }

  function start() {
    // Page lifecycle hooks.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('focus', check);

    // 60s tick — only checks when the tab is visible (the function
    // early-returns otherwise).
    pollTimer = setInterval(check, POLL_MS);

    // Stop polling when the page is about to be unloaded; otherwise
    // we'd leak timers during a fast navigate.
    window.addEventListener('beforeunload', () => {
      if (pollTimer) clearInterval(pollTimer);
    }, { once: true });
  }

  // Don't fight pwa-bootstrap — if it shows a toast first (because
  // the SW itself updated), the user already knows. We still poll
  // so we catch the case where the SW hasn't updated yet but the
  // server has a new build.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
```

### Edit: codemod + every shipped HTML page

The `migrate-html.mjs --add-version-chrome` flag should also inject `<script src="/lib/version-watcher.client.js" defer></script>` after the home-link + version-badge injection. Same idempotency rules.

The watcher is for the **engine and version pages** only — these are the surfaces where a user could be doing real work. Marketing pages (`landing.html`, `personas.html`, etc.) don't need it; a reload there is harmless. So gate the injection on `filePath === 'engine.html' || filePath.startsWith('versions/')`.

### Edit: tests

- `tests/unit/version-watcher.test.mjs` — node:vm unit coverage:
  - Polls at the expected interval
  - Visibility hidden → no fetch
  - Visibility visible → fetch + parse
  - Mismatch → toast mounted
  - Click on toast → `SKIP_WAITING` posted + reload called
  - `currentVersion === 'dev'` → module bails, no polling

- `tests/smoke/version-watch.smoke.mjs` — Puppeteer against `dist/engine`:
  - Boot engine, set `window.SWR_APP_VERSION = 'force-mismatch'`
  - Trigger the 60s tick manually (or expose a debug hook in the module)
  - Assert toast is mounted
  - Click toast, assert reload called

Wire the unit test into `check` group, the smoke into `check:full`.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Polling every 60s on every tab wastes battery | Bails early when `document.visibilityState !== 'visible'` |
| Module fires while page is mid-recording → reload destroys work | Toast is non-blocking; user dismisses or refreshes on their terms |
| `lastSeen` updates on every mismatch → toast can't re-appear if user dismisses and a SECOND new version ships | Track `dismissedFor = next`; only re-show if `next !== dismissedFor` |
| Dev server hot-reload triggers a phantom "new version" | Bail when `window.SWR_APP_VERSION === 'dev'` |
| Two modules show the same toast (PWA-bootstrap + this) | Each guards with its own `if (toastEl) return` check; one wins, the other no-ops |
| `/lib/app-version.js` cached by SW → poll never sees new content | The fetch is `cache: 'no-store'`; SW falls through to the network |
| 60s cadence is too slow for some teams | The cadence is constant — not configurable per page — so the docs are the source of truth |

## Migration order

1. **Add `lib/version-watcher.client.js` + unit test** (TDD: write the test, make it green).
2. **Wire into `migrate-html.mjs`** under the `isVersionPage || engine.html` branch.
3. **Run codemod on engine.html + versions/*.html** (`--add-version-chrome` is already idempotent; the new inject step uses the same pattern).
4. **Add the smoke test** and wire it into `check:full`.
5. **Manual test in production:** deploy, open the engine in two tabs, push a version bump, watch the toast appear within 60s.
6. **Run `npm run check:full`** to confirm everything is green.

## Success metrics

- [ ] Engine and version pages poll every 60s while visible
- [ ] A version bump triggers a toast within 60s of deploy (no manual reload needed)
- [ ] Clicking the toast reloads to the new version
- [ ] Background tabs don't poll
- [ ] `dev` mode bails cleanly
- [ ] Unit test asserts every branch

## Out of scope (future work)

- A `BroadcastChannel` so multiple tabs in the same browser share the latest version instead of each polling.
- A `?v=...` query string on every internal link so a stale page that navigates internally still gets a fresh fetch.
- A "force update" admin endpoint for the owner (`/api/force-update`) that forces every connected tab to reload.

These are nice-to-haves. The periodic poll + visibility check is the minimum that closes the gap.
