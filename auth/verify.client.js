// auth/verify.client.js — consume the magic-link token, set the session
// cookie, then route the user into the engine.

(function () {
  const $ = (id) => document.getElementById(id);
  const h = $('h');
  const msg = $('msg');
  const hint = $('hint');

  async function run() {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const email = params.get('email');
    const next = params.get('next') || '/engine/';

    if (!token || !email) {
      h.textContent = 'Invalid link';
      msg.innerHTML = '<span class="err">Missing token or email. <a href="/auth/login">Request a new link.</a></span>';
      return;
    }

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        h.textContent = 'Link expired';
        msg.innerHTML = '<span class="err">' + (body.error || 'invalid') + '</span>. <a href="/auth/login">Request a new link.</a>';
        return;
      }
      const body = await res.json();
      h.textContent = 'Welcome, ' + (body.user && body.user.name ? body.user.name : 'friend');
      msg.innerHTML = '<span class="ok">Signed in. Redirecting to the engine…</span>';
      hint.innerHTML = 'If nothing happens, <a href="' + next + '">click here</a>.';
      setTimeout(() => { window.location.href = next; }, 600);
    } catch (e) {
      h.textContent = 'Network error';
      msg.innerHTML = '<span class="err">Could not reach the server. <a href="/auth/login">Try again.</a></span>';
    }
  }

  run();
})();
