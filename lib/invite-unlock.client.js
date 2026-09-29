// lib/invite-unlock.client.js — own the "is this visitor watermark-unlocked?"
// state, talk to /api/invite/redeem, flip SWR_WATERMARK.setEnabled.
//
// Two layers of state:
//   - localStorage key 'swr.inviteUnlocked' === '1' is the source of truth
//     for "is THIS browser unlocked". Once set, the unlock is permanent
//     for this visitor until they call revoke() (or clear storage).
//   - SWR_WATERMARK.setEnabled(false) is the runtime effect — the mark
//     stops being composited onto exports for the current page. The
//     flag and the runtime effect must be kept in sync; this module is
//     the single owner of both.
//
// API:
//   window.SWR_INVITE_UNLOCK = {
//     isUnlocked():  boolean           — local flag
//     unlock(code):  Promise<boolean>  — POST /api/invite/redeem, flip flag
//                                       + watermark on success
//     revoke():      void              — clear flag, re-enable watermark
//     applyToCurrentPage(): void      — call setEnabled(false) iff isUnlocked
//   }
//
// Idempotent: applyToCurrentPage() can be called any time. unlock() with
// the wrong code leaves state untouched. revoke() is the only path that
// turns the watermark back on for an unlocked visitor.

(function () {
  if (window.SWR_INVITE_UNLOCK) return;

  var LS_KEY = 'swr.inviteUnlocked';

  function readFlag() {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch (_) { return false; }
  }
  function writeFlag(on) {
    try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (_) {}
  }

  function applyToWatermark(enabled) {
    var wm = window.SWR_WATERMARK;
    if (wm && typeof wm.setEnabled === 'function') {
      try { wm.setEnabled(enabled); } catch (_) {}
    }
  }

  function isUnlocked() {
    return readFlag();
  }

  function applyToCurrentPage() {
    applyToWatermark(!readFlag()); // setEnabled(true) = force the mark
  }

  async function unlock(code) {
    if (!code || typeof code !== 'string') return false;
    try {
      var res = await fetch('/api/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      if (!res.ok) return false;
      var body = await res.json().catch(function () { return null; });
      if (!body || body.ok !== true) return false;
      writeFlag(true);
      applyToWatermark(false);
      return true;
    } catch (_) {
      return false;
    }
  }

  function revoke() {
    writeFlag(false);
    applyToWatermark(true);
  }

  // Hydrate: if the visitor was already unlocked in a previous session,
  // the mark should not be drawn on this page either.
  applyToCurrentPage();

  window.SWR_INVITE_UNLOCK = {
    isUnlocked: isUnlocked,
    unlock: unlock,
    revoke: revoke,
    applyToCurrentPage: applyToCurrentPage,
  };
})();
