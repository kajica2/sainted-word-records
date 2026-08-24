// lib/auth.client.js — window.SWR_AUTH: sign in/out, session polling,
// account state. Drop-in for any page that wants the current user.

(function () {
  if (window.SWR_AUTH) return;

  let cachedUser = null;
  let inflight = null;
  let lastFetched = 0;
  const TTL_MS = 30_000; // don't refetch more than once per 30s

  async function session({ force = false } = {}) {
    const now = Date.now();
    if (!force && cachedUser !== undefined && now - lastFetched < TTL_MS) {
      return cachedUser;
    }
    if (inflight) return inflight;
    inflight = fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return null;
        const body = await r.json();
        cachedUser = body && body.user ? body.user : null;
        lastFetched = Date.now();
        return cachedUser;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
    return inflight;
  }

  function setCachedUser(u) {
    cachedUser = u;
    lastFetched = Date.now();
    document.dispatchEvent(new CustomEvent('swr-auth-change', { detail: { user: u } }));
  }

  async function signOut() {
    await fetch('/api/auth/session', { method: 'POST', credentials: 'include' });
    setCachedUser(null);
  }

  function onChange(handler) {
    document.addEventListener('swr-auth-change', (e) => handler(e.detail.user));
  }

  // Optional header chip helper: returns a small DOM element that updates
  // itself whenever the user state changes. Pass { signedInLabel, signedOutLabel }.
  function renderChip(opts) {
    opts = opts || {};
    const el = document.createElement('a');
    el.href = '/auth/login';
    el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--line,#3a1f55);border-radius:6px;font:600 11px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9a8aaa);text-decoration:none;background:rgba(0,0,0,0.2);';
    async function update() {
      const u = await session();
      if (u) {
        el.textContent = '◉ ' + (u.name || u.email.split('@')[0]);
        el.href = '/engine/';
        el.title = u.email;
        el.style.color = 'var(--accent,#ff3d92)';
        el.style.borderColor = 'var(--accent,#ff3d92)';
      } else {
        el.textContent = '○ sign in';
        el.href = '/auth/login';
        el.title = '';
        el.style.color = '';
        el.style.borderColor = '';
      }
    }
    update();
    onChange(update);
    return el;
  }

  window.SWR_AUTH = {
    session,
    signOut,
    onChange,
    renderChip,
    setCachedUser,
  };
})();
