// auth/login.client.js — handle the magic-link form submit and post to /api/auth/magic.

(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('login-form');
  const emailInput = $('email');
  const errEl = $('err');
  const okEl = $('ok');
  const devLinkEl = $('dev-link');
  const enterBtn = $('enter-btn');

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
