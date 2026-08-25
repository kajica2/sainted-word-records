// tools/lib/hf-publish.client.js
// ---------------------------------------------------------------
// UI controller for /tools/hf-publish.html. Holds the token in
// sessionStorage ONLY. Posts the upload request to /api/hf-upload,
// which requires an authenticated session AND the token in the body.
// Token is wiped from sessionStorage on submit + on unload.
// ---------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const form = $('#hf-form');
const submit = $('#hf-submit');
const copyBtn = $('#hf-copy');
const out = $('#hf-out');
const state = $('#hf-state');

let lastCommand = '';

function setState(text, kind = '') {
  state.textContent = text;
  state.style.color = kind === 'err' ? '#ff6b6b' : kind === 'ok' ? '#7ee787' : '';
}

function showOutput(text, kind = '') {
  out.hidden = false;
  out.innerHTML = '';
  const span = document.createElement('span');
  if (kind) span.className = kind;
  span.textContent = text;
  out.appendChild(span);
}

function loadDefaults() {
  // Pre-fill tag from package.json fetched at runtime. The admin UI is
  // served from /tools/hf-publish, so the relative path to the repo-root
  // package.json is ../../package.json (tools/hf-publish.html → /tools/,
  // then up one more to /, then package.json).
  fetch('../../package.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((pkg) => {
      if (pkg && pkg.version) $('#hf-tag').value = `v${pkg.version}`;
    })
    .catch(() => { /* non-fatal */ });
}

async function publish(evt) {
  evt.preventDefault();
  submit.disabled = true;
  setState('Submitting…');

  const token = $('#hf-token').value.trim();
  const tag = $('#hf-tag').value.trim() || 'v0.1.0';
  const src = $('#hf-src').value.trim() || '';
  const dryRun = $('#hf-dry-run').checked;

  if (!token) {
    setState('Token required', 'err');
    submit.disabled = false;
    return;
  }

  // Stash the token for the duration of THIS request only.
  sessionStorage.setItem('hf_token', token);

  try {
    const resp = await fetch('/api/hf-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, tag, src, dryRun }),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setState(data.error || `HTTP ${resp.status}`, 'err');
      showOutput(JSON.stringify(data, null, 2), 'err');
      submit.disabled = false;
      return;
    }

    setState(dryRun ? 'Dry-run complete' : 'Published', 'ok');
    lastCommand = data.command || '';
    showOutput(
      `${dryRun ? '[dry-run] ' : ''}${lastCommand}\n\nView: ${data.url || 'n/a'}\n\n${data.output || ''}`,
      'ok'
    );
    copyBtn.disabled = !lastCommand;
  } catch (e) {
    setState(`Network error: ${e.message}`, 'err');
    showOutput(String(e), 'err');
  } finally {
    // Wipe the token from sessionStorage — never persist beyond the request.
    sessionStorage.removeItem('hf_token');
    $('#hf-token').value = '';
    submit.disabled = false;
  }
}

async function copyCommand() {
  if (!lastCommand) return;
  try {
    await navigator.clipboard.writeText(lastCommand);
    setState('Command copied', 'ok');
  } catch (e) {
    setState('Copy failed — select & copy from the box below', 'err');
  }
}

form.addEventListener('submit', publish);
copyBtn.addEventListener('click', copyCommand);

// Defense-in-depth: wipe token on unload so a parked tab can't leak it.
window.addEventListener('beforeunload', () => sessionStorage.removeItem('hf_token'));
window.addEventListener('pagehide',     () => sessionStorage.removeItem('hf_token'));

loadDefaults();
