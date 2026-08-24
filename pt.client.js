// Sainted Word Records — Personal Tier (PT) license + credit ledger
// ---------------------------------------------------------------------------
// Local-first PT system. License keys are issued by the operator (Kai) after
// Stripe payment. Activation stores the key + tier + credit grant in
// localStorage. Credits are decremented on each export. The watermark is
// skipped when a PT license is active.
//
// Key format (MVP): `swr-{tier}-{8chars}` where tier ∈ {solo, band, label}.
// Example: `swr-solo-A1B2C3D4`. The format is opaque to the client — there
// is no signature check, so this is trivially forgeable. That's fine for an
// MVP. Replace with a signed license + server validation when Stripe webhooks
// are wired up.
//
// Storage:
//   localStorage["swr.license"] = {
//     key: "swr-band-A1B2C3D4",
//     tier: "band",                  // "solo" | "band" | "label"
//     tierName: "PT Band",            // display name
//     credits: 150,                   // remaining
//     creditsTotal: 150,              // initial grant
//     activatedAt: 1786618680000,
//     lastDecrementAt: 1786618680000,
//   }
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  const STORAGE_KEY = 'swr.license';
  const TIERS = {
    solo:  { name: 'PT Solo',  credits: 50,  price: '€120' },
    band:  { name: 'PT Band',  credits: 150, price: '€280' },
    label: { name: 'PT Label', credits: 500, price: '€600' },
  };
  // Credits per minute of rendered video (1080p baseline)
  const CREDITS_PER_MIN_1080P = 1;
  const CREDITS_PER_MIN_4K    = 2;

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
    try { window.dispatchEvent(new CustomEvent('swr-pt-changed', { detail: null })); } catch (_) { /* noop */ }
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
  function activate(key) {
    const parsed = parseKey(key);
    if (!parsed) return { error: 'Invalid key format. Expected: swr-{solo|band|label}-{code}' };
    const t = TIERS[parsed.tier];
    if (!t) return { error: 'Unknown tier: ' + parsed.tier };
    const existing = load();
    // If same key already active, no-op (idempotent)
    if (existing && existing.key === parsed.key) {
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
        lastDecrementAt: Date.now(),
      });
    } else {
      lic = {
        key: parsed.key,
        tier: parsed.tier,
        tierName: t.name,
        credits: t.credits,
        creditsTotal: t.credits,
        activatedAt: Date.now(),
        lastDecrementAt: Date.now(),
      };
    }
    save(lic);
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
    return { ok: true, creditsAfter: lic.credits, cost, tier: lic.tier };
  }

  // Public API on window
  window.SWR_PT = {
    TIERS,
    load,
    save,
    clear,
    parseKey,
    activate,
    deactivate,
    consumeForRender,
    isActive() { return !!load(); },
    getTier() { const l = load(); return l ? l.tier : null; },
    getCredits() { const l = load(); return l ? l.credits : 0; },
  };
})();
