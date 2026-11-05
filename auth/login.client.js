// auth/login.client.js — handle the magic-link form submit and post to /api/auth/magic,
// and wire the "Continue as guest" button (Firebase anonymous auth).

(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('login-form');
  const emailInput = $('email');
  const errEl = $('err');
  const okEl = $('ok');
  const devLinkEl = $('dev-link');
  const enterBtn = $('enter-btn');
  const googleBtn = $('google-btn');
  const guestBtn = $('guest-btn');

  // "Continue with Google" starts the OAuth flow at the API, which redirects
  // to Google and comes back through /api/auth/google/callback. The return
  // path travels in the query string: the page the visitor came from, or the
  // engine — the place where a signed-in account actually gets used.
  const GOOGLE_FALLBACK = '/engine';
  function returnPath() {
    const params = new URLSearchParams(window.location.search);
    // Both spellings are accepted: the engine and the dashboard send
    // ?redirect=, ?next= is the other name for the same thing.
    const next = params.get('next') || params.get('redirect');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    const ref = document.referrer;
    if (ref) {
      try {
        const u = new URL(ref);
        if (u.origin === window.location.origin && !u.pathname.startsWith('/auth/')) {
          return u.pathname + u.search;
        }
      } catch (_) {}
    }
    return GOOGLE_FALLBACK;
  }
  if (googleBtn) {
    googleBtn.href = '/api/auth/google?intent=signin&redirect=' + encodeURIComponent(returnPath());
  }

  // ── Guest sign-in (Firebase anonymous auth) ────────────────────────────
  // The button ships hidden. It is revealed only when the deployment
  // actually has a Firebase web config, so a deployment without one never
  // shows a dead button. The guest lands on the same place a magic-link
  // sign-in lands: returnPath().
  //
  // /lib/firebase-anon.client.js is a deferred CLASSIC script in <head>,
  // and this file is a deferred MODULE further down the document. Both go
  // into the same "execute after parsing" list, in document order, so the
  // Firebase client has already published window.SWR_FIREBASE_ANON by the
  // time this runs.
  if (guestBtn) {
    // Nothing here may throw: a failure would take the magic-link form
    // wiring above down with it.
    const firebaseApi = () => {
      const api = window.SWR_FIREBASE_ANON;
      return api && typeof api.isConfigured === 'function' ? api : null;
    };

    const api = firebaseApi();
    if (!api) {
      guestBtn.hidden = true;
    } else {
      Promise.resolve()
        .then(() => api.isConfigured())
        .then((configured) => { guestBtn.hidden = !configured; })
        .catch(() => { guestBtn.hidden = true; });
    }

    guestBtn.addEventListener('click', async () => {
      errEl.textContent = '';
      okEl.textContent = '';
      guestBtn.disabled = true;
      try {
        const fb = firebaseApi();
        if (!fb) throw new Error('firebase_not_configured');
        await fb.signIn();
        await fb.exchangeForSession();
        window.location.assign(returnPath());
      } catch (e) {
        errEl.textContent = guestErrorMessage(e);
        guestBtn.disabled = false;
      }
    });
  }

  // The server answers with an error CODE; the visitor gets a sentence.
  function guestErrorMessage(e) {
    const code = e && e.message ? String(e.message) : 'guest_signin_failed';
    const messages = {
      firebase_not_configured: 'Guest sign-in is not available on this deployment.',
      invalid_id_token: 'Guest sign-in could not be verified. Try again.',
      not_anonymous: 'Guest sign-in could not be verified. Try again.',
      no_id_token: 'Guest sign-in could not be verified. Try again.',
      exchange_failed: 'Guest sign-in failed. Try again.',
    };
    return messages[code] || 'Guest sign-in failed. Try again.';
  }

  // The callback sends the visitor back here with ?error=… when Google or
  // the token exchange refused. Say what happened instead of showing a
  // blank form.
  const errParam = new URLSearchParams(window.location.search).get('error');
  if (errParam) {
    const messages = {
      google_denied: 'Google sign-in was cancelled.',
      access_denied: 'Google sign-in was cancelled.',
      missing_code: 'Google did not return a sign-in code. Try again.',
      invalid_state: 'That sign-in link expired. Try again.',
      google_token_exchange_failed: 'Google could not complete the sign-in. Try again.',
      google_oauth_not_configured: 'Google sign-in is not configured on this deployment yet.',
    };
    errEl.textContent = messages[errParam] || 'Google sign-in failed. Try again.';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    okEl.textContent = '';
    devLinkEl.classList.remove('show');
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = "That email doesn't look right.";
      emailInput.focus();
      return;
    }
    enterBtn.disabled = true;
    try {
      const res = await fetch('/api/auth/magic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          errEl.textContent = 'Too many attempts. Wait a minute and try again.';
        } else {
          errEl.textContent = body.error || 'Could not send the link.';
        }
        return;
      }
      const body = await res.json().catch(() => ({}));
      okEl.textContent = 'Link sent. Check your email.';
      // In dev (no RESEND_API_KEY) the API prints the magic link to the
      // server stdout. We also surface a copy-paste link in the page so
      // the user can sign in without an SMTP server. The dev-link box is
      // only shown when the server hints it via a custom header.
      const devLink = res.headers.get('x-magic-link-dev');
      if (devLink) {
        devLinkEl.innerHTML = '<b>Dev:</b> paste this URL in the same browser to complete sign-in.<br>' +
          '<a href="' + devLink + '" style="color:var(--accent)">' + devLink + '</a>';
        devLinkEl.classList.add('show');
      } else if (body && body.devLink) {
        devLinkEl.innerHTML = '<b>Dev:</b> <a href="' + body.devLink + '">' + body.devLink + '</a>';
        devLinkEl.classList.add('show');
      }
    } catch (e) {
      errEl.textContent = 'Network error — try again.';
    } finally {
      enterBtn.disabled = false;
    }
  });
})();
