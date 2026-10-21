// Sainted Word Records - Personal Tier (PT) license + credit ledger
// ---------------------------------------------------------------------------
// Local-first PT system. License keys are issued by the operator (Kai) after
// Stripe payment, or by the Stripe webhook when a PT tier is paid for. The
// local wallet stores the key + tier + credit grant in localStorage and
// decrements credits on each export; the server ledger (api/license/verify.js)
// confirms the key, so localStorage is a cache rather than the source of
// truth.
//
// Key format: `swr-{tier}-{8chars}` where tier is one of {solo, band, label}.
// Example: `swr-solo-A1B2C3D4`. The format is opaque to the client, but it is
// no longer the ONLY check: since P0.3 of the architecture audit the client
// asks POST /api/license/verify, which looks the key up in the server ledger
// that api/webhooks/stripe.js writes. localStorage is now a cache of that
// answer, not the source of truth. See `verifyLicense` / `verifyOnBoot` below.
//
// Storage:
//   localStorage["swr.license"] = {
//     key: "swr-band-A1B2C3D4",
//     tier: "band",                  // "solo" | "band" | "label"
//     tierName: "PT Band",            // display name
//     credits: 150,                   // remaining
//     creditsTotal: 150,              // initial grant
//     videoSlots: 30,                 // video registration quota for this tier
//     videosRegistered: 0,            // videos registered against the quota
//     activatedAt: 1786618680000,
//     lastDecrementAt: 1786618680000,
//     verifiedAt: 1786618680000,      // last server-confirmed verify
//   }
//   localStorage["swr.license.cache"] = {
//     valid: true, tier: "band", creditsRemaining: 150, slotCount: 30,
//     checkedAt: 1786618680000,
//   }                                  // the 5 minute verify cache
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  const STORAGE_KEY = 'swr.license';
  const CACHE_KEY = 'swr.license.cache';
  const VERIFY_URL = '/api/license/verify';
  // The server confirms the key on load and after every credits-debit. A short
  // cache absorbs that without hammering the endpoint: 5 minutes is long
  // enough to make a burst of exports one round-trip, short enough that a
  // revoked key stops working within the same coffee break.
  const CACHE_TTL_MS = 5 * 60 * 1000;
  // How long a *successful* answer may still be trusted when the server cannot
  // be reached at all (offline, airplane mode, the API on a deploy). This is
  // the offline-first fallback: the product's promise is that an unreleased
  // track never needs the network, so a network outage must not confiscate a
  // license a customer already paid for. Past this window the answer is not
  // "recent" any more and the client locks rather than guess.
  const STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  const TIERS = {
    solo:  { name: 'PT Solo',  credits: 50,  price: '€120', videoSlots: 10 },
    band:  { name: 'PT Band',  credits: 150, price: '€280', videoSlots: 30 },
    label: { name: 'PT Label', credits: 500, price: '€600', videoSlots: 50 },
  };
  // Credits per minute of rendered video (1080p baseline)
  const CREDITS_PER_MIN_1080P = 1;
  const CREDITS_PER_MIN_4K    = 2;
  // Registration batches allowed per call (in videos).
  const REGISTER_BATCHES = [10, 30, 50];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const lic = JSON.parse(raw);
      if (!lic.key || !lic.tier) return null;
      return lic;
    } catch (_) { return null; }
  }

  function save(lic) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lic)); }
    catch (_) { /* noop */ }
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (_) { /* noop */ }
    clearCache();
    try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: null })); } catch (_) { /* noop */ }
  }

  // ---- server-side verification (P0.3) --------------------------------
  //
  // `unlocked` is the entitlement the UI should trust. It is deliberately NOT
  // `!!load()`: a license record sitting in localStorage proves nothing, since
  // anyone can write one with devtools. `unlocked` only becomes true after the
  // server has said the key is real (or after a still-fresh cache of that
  // answer, or a still-recent answer from just before the network dropped).
  const state = { unlocked: false, reason: null, checkedAt: 0 };

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || typeof c.valid !== 'boolean') return null;
      return c;
    } catch (_) { return null; }
  }

  function writeCache(entry) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.assign({ checkedAt: Date.now() }, entry)));
    } catch (_) { /* noop */ }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* noop */ }
  }

  // Apply a verified:true answer to the stored license. The server owns the
  // tier table, so its `tier` / `tierName` / `slotCount` win. Its
  // `creditsRemaining` is deliberately NOT applied: there is no server-side
  // credit ledger, so that field is only the static tier grant (50 / 150 /
  // 500). Writing it back would refund every client-side debit on every
  // verify, which is infinite free credits. Credits stay purely client-side,
  // seeded by activate() from the same tier table. The route still returns the
  // value for diagnostics and for a future server-side debit.
  function applyVerified(res) {
    const lic = load();
    if (!lic) return null;
    const meta = TIERS[res.tier] || lic;
    const next = Object.assign({}, lic, {
      tier: res.tier,
      tierName: res.tierName || meta.name || lic.tierName,
      verifiedAt: Date.now(),
    });
    if (Number.isFinite(res.slotCount)) next.videoSlots = res.slotCount;
    save(next);
    return next;
  }

  function markUnlocked(valid, reason, checkedAt) {
    state.unlocked = !!valid;
    state.reason = reason || null;
    state.checkedAt = checkedAt || Date.now();
  }

  // Re-lock. The stored license is dropped, because leaving it in place is
  // exactly what made the old scheme forgeable: any consumer reading `load()`
  // would still see a PT license. Exactly one swr-pt-changed fires, whether or
  // not there was a record to remove.
  function lock(reason) {
    markUnlocked(false, reason);
    clearCache();
    const had = !!load();
    if (had) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* noop */ }
    }
    try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: null })); } catch (_) { /* noop */ }
    return had;
  }

  function canFetch() {
    return typeof fetch === 'function';
  }

  // The canonical form of a key: `swr-{tier}-{8 upper alnum}`. This mirrors
  // exactly what api/license/verify.js normalises to, so the code this client
  // POSTs is byte-identical to the code it caches under, and a key the user
  // typed in lowercase still compares equal to one the server wrote uppercase.
  function canonicalKey(key) {
    const s = String(key == null ? '' : key).trim();
    const m = /^swr-(solo|band|label)-([A-Za-z0-9]{4,12})$/i.exec(s);
    if (!m) return null;
    return `swr-${m[1].toLowerCase()}-${m[2].toUpperCase()}`;
  }

  // Ask the server about `key`. Resolves to the decoded body on an HTTP 200,
  // or null when the answer is unusable (offline, 404 on a build where the
  // route has not deployed yet, non-JSON, an HTML error page). null means
  // "could not verify", which is NOT the same as "invalid" and must never
  // confiscate a paid license.
  async function askServer(code) {
    if (!canFetch()) return null;
    let res;
    try {
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch (_) {
      return null;
    }
    if (!res || res.status !== 200) return null;
    try {
      const body = await res.json();
      return body && typeof body.valid === 'boolean' ? body : null;
    } catch (_) {
      return null;
    }
  }

  // Verify one key against the server and apply the outcome.
  // Resolves to { ok, reason?, fromCache? }.
  //
  // Concurrent calls for the same key share one request. The three triggers
  // (activate, the debits, the boot hook) can easily overlap, and a double
  // POST would burn the per-code rate-limit budget for nothing.
  let inflight = null;
  let inflightCode = null;
  async function verifyLicense(key) {
    const target = key != null ? key : (load() || {}).key;
    if (!target) {
      markUnlocked(false, 'no_license');
      return { ok: false, reason: 'no_license' };
    }
    const upper = canonicalKey(target);
    if (!upper) {
      markUnlocked(false, 'invalid_format');
      return { ok: false, reason: 'invalid_format' };
    }
    if (inflight && inflightCode === upper) return inflight;

    const run = verifyLicenseInner(target, upper);
    inflight = run;
    inflightCode = upper;
    try {
      return await run;
    } finally {
      if (inflight === run) { inflight = null; inflightCode = null; }
    }
  }

  async function verifyLicenseInner(target, upper) {
    // A fresh cache hit is the whole point of the cache: no round-trip.
    const cached = readCache();
    if (cached && cached.key === upper) {
      const age = Date.now() - (cached.checkedAt || 0);
      if (age < CACHE_TTL_MS) {
        if (cached.valid) applyVerified(cached);
        else lock(cached.reason || 'unknown_code');
        markUnlocked(cached.valid, cached.reason, cached.checkedAt);
        return { ok: !!cached.valid, reason: cached.reason, fromCache: true };
      }
    }

    const body = await askServer(upper);

    if (body && body.valid === true) {
      const lic = applyVerified(body);
      if (!lic) {
        // The key is real but there is no license record to unlock (it was
        // cleared underneath us). Nothing to grant.
        markUnlocked(false, 'no_license');
        return { ok: false, reason: 'no_license' };
      }
      writeCache({
        key: upper,
        valid: true,
        tier: body.tier,
        tierName: body.tierName,
        creditsRemaining: body.creditsRemaining,
        slotCount: body.slotCount,
      });
      markUnlocked(true, null);
      try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: lic })); } catch (_) { /* noop */ }
      return { ok: true };
    }

    if (body && body.valid === false) {
      // Authoritative negative: the server looked and the key is not real.
      // lock() drops the stored record and fires the change event.
      lock(body.reason === 'expired' ? 'expired' : 'unknown_code');
      return { ok: false, reason: body.reason || 'unknown_code' };
    }

    // Could not reach a verdict. Fall back to a recent successful answer; when
    // there is not one, lock rather than guess.
    if (cached && cached.valid && cached.key === upper &&
        Date.now() - (cached.checkedAt || 0) < STALE_GRACE_MS) {
      applyVerified(cached);
      markUnlocked(true, null, cached.checkedAt);
      return { ok: true, reason: 'stale_cache', fromCache: true };
    }
    markUnlocked(false, 'unverified');
    return { ok: false, reason: 'unverified' };
  }

  // Boot hook. Fires once on load and is deliberately not awaited, so it can
  // never delay first paint or the engine's own init. Silently no-ops when
  // there is no license (nothing to verify) or when fetch is unavailable.
  let bootVerify = null;
  function verifyOnBoot() {
    const lic = load();
    if (!lic || !lic.key || !canFetch()) return Promise.resolve({ ok: false, reason: 'skipped' });
    bootVerify = verifyLicense(lic.key).catch(() => ({ ok: false, reason: 'error' }));
    return bootVerify;
  }

  // Parse a license key. Format: `swr-{tier}-{8chars}` (tier ∈ TIERS).
  // Returns { tier, key } or null.
  function parseKey(key) {
    if (!key) return null;
    const trimmed = String(key).trim().toLowerCase();
    const m = /^swr-(solo|band|label)-([a-z0-9]{4,12})$/i.exec(trimmed);
    if (!m) return null;
    return { tier: m[1].toLowerCase(), key: trimmed };
  }

  // Activate a license key. If already active for the same tier, refresh credits.
  // Returns the new license object, or { error: '...' }.
  //
  // Still synchronous: pt-panel.client.js and check-pt-unit.mjs read
  // `res.license` on the next line. Server confirmation therefore happens in
  // the background (fire-and-forget). A key the server rejects wipes the
  // record a round-trip later; a key it cannot be asked about leaves the
  // record in place but leaves `isVerified()` false.
  function activate(key) {
    const parsed = parseKey(key);
    if (!parsed) return { error: 'Invalid key format. Expected: swr-{solo|band|label}-{code}' };
    const t = TIERS[parsed.tier];
    if (!t) return { error: 'Unknown tier: ' + parsed.tier };
    const existing = load();
    // If same key already active, no-op (idempotent)
    if (existing && existing.key === parsed.key) {
      verifyLicense(parsed.key);
      return { license: existing, message: 'already active' };
    }
    // If different key for same tier, treat as a top-up: add credits to the
    // existing license. Otherwise create a fresh one.
    let lic;
    if (existing && existing.tier === parsed.tier) {
      lic = Object.assign({}, existing, {
        key: parsed.key,
        credits: (existing.credits || 0) + t.credits,
        creditsTotal: (existing.creditsTotal || 0) + t.credits,
        videoSlots: (existing.videoSlots || 0) + t.videoSlots,
        lastDecrementAt: Date.now(),
      });
    } else {
      lic = {
        key: parsed.key,
        tier: parsed.tier,
        tierName: t.name,
        credits: t.credits,
        creditsTotal: t.credits,
        videoSlots: t.videoSlots,
        videosRegistered: 0,
        activatedAt: Date.now(),
        lastDecrementAt: Date.now(),
      };
    }
    save(lic);
    // Ask the server whether this key is real. Not awaited, so activate()
    // keeps its synchronous contract.
    verifyLicense(parsed.key);
    // Notify any listeners (e.g. pt-panel) that the license state changed.
    try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: lic })); } catch (_) { /* noop */ }
    return { license: lic };
  }

  function deactivate() {
    clear();
  }

  // Decrement credits for a render. `durationSec` is the export length.
  // `resolution` ∈ {'1080p', '4k'}. Returns { ok, creditsAfter, error? }.
  function consumeForRender(durationSec, resolution) {
    const lic = load();
    if (!lic) return { ok: false, error: 'no license' };
    const minutes = Math.max(1, Math.ceil(durationSec / 60));
    const perMin = resolution === '4k' ? CREDITS_PER_MIN_4K : CREDITS_PER_MIN_1080P;
    const cost = minutes * perMin;
    if (lic.credits < cost) {
      return { ok: false, error: 'insufficient credits', needed: cost, have: lic.credits };
    }
    lic.credits -= cost;
    lic.lastDecrementAt = Date.now();
    save(lic);
    // Re-confirm with the server after every debit (the plan's contract for
    // this route). Not awaited, and the 5 minute cache means a burst of
    // exports collapses into a single round-trip.
    verifyLicense(lic.key);
    return { ok: true, creditsAfter: lic.credits, cost, tier: lic.tier };
  }

  // Register videos against the license's slot quota. `count` must be one of
  // the allowed batches (10 / 30 / 50). Returns { ok, remaining, error? }.
  function registerVideos(count) {
    const lic = load();
    if (!lic) return { ok: false, error: 'no license' };
    const batches = REGISTER_BATCHES.map(String);
    if (!batches.includes(String(count))) {
      return { ok: false, error: 'invalid batch: ' + count + ' (allowed: ' + REGISTER_BATCHES.join(', ') + ')' };
    }
    const used = lic.videosRegistered || 0;
    const total = lic.videoSlots || 0;
    if (used + count > total) {
      return { ok: false, error: 'no slots left', needed: count, remaining: total - used };
    }
    lic.videosRegistered = used + count;
    save(lic);
    try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: lic })); } catch (_) { /* noop */ }
    return { ok: true, registered: count, remaining: total - lic.videosRegistered, total };
  }

  // Public API on window
  window.SWR_PT = {
    TIERS,
    REGISTER_BATCHES,
    CACHE_TTL_MS,
    VERIFY_URL,
    load,
    save,
    clear,
    parseKey,
    activate,
    deactivate,
    consumeForRender,
    registerVideos,
    // --- server-side verification (P0.3) ---
    // verifyLicense(key) → Promise<{ ok, reason?, fromCache? }>
    verifyLicense,
    // verifyOnBoot() runs the same thing; it is also kicked off automatically
    // at the bottom of this module.
    verifyOnBoot,
    // The entitlement a UI should gate on. True only after the server (or a
    // still-valid cache of it) confirmed the key. `isActive()` stays a pure
    // localStorage read for backwards compatibility; new call sites should use
    // this one.
    isVerified() { return state.unlocked; },
    getVerifyState() { return { unlocked: state.unlocked, reason: state.reason, checkedAt: state.checkedAt }; },
    readCache,
    clearCache,
    isActive() { return !!load(); },
    getTier() { const l = load(); return l ? l.tier : null; },
    getCredits() { const l = load(); return l ? l.credits : 0; },
    getVideoSlots() { const l = load(); return l ? (l.videoSlots || 0) : 0; },
    getVideosRegistered() { const l = load(); return l ? (l.videosRegistered || 0) : 0; },
  };

  // Boot verify. No license means nothing to verify, so this is a no-op for
  // every free user; a stored key gets confirmed against the ledger on load.
  // Wrapped in try/catch because the module is also loaded in node:vm unit
  // sandboxes that have no fetch at all.
  try {
    if (typeof fetch === 'function' && load()) verifyOnBoot();
  } catch (_) { /* noop */ }
})();
