// lib/invite-modal.client.js — invite-unlock modal.
//
// A plain-DOM modal (no shadow DOM): a unique CSS prefix (swr-im-) gives
// enough isolation, and the browser-vendored custom-element upgrade path
// has been flaky on the Chromium versions the test runners use.
//
// API:
//   window.SWR_INVITE_MODAL.show();                 // open, empty input
//   window.SWR_INVITE_MODAL.show({ code: 'X' });    // prefill
//   window.SWR_INVITE_MODAL.hide();
//
// Events (bubble to document):
//   'swr-invite-unlocked'  detail:{ code }   — code accepted
//   'swr-invite-skipped'    no detail        — user dismissed
//
// The modal owns its DOM (builds it on first show, never removed), so
// pages do not need any markup and the modal is theme-neutral.

(function () {
  if (window.SWR_INVITE_MODAL) return;

  var STATE = {
    mounted: false,
    host: null,
    els: null,
    visible: false,
  };

  function build() {
    if (STATE.mounted) return STATE.els;
    var host = document.createElement('div');
    host.id = 'swr-invite-modal-host';
    host.style.cssText = [
      'all:initial',
      'position:fixed', 'inset:0', 'display:none',
      'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)',
      'z-index:10000',
      'font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif',
      'color:#fff',
    ].join(';');

    var card = document.createElement('div');
    card.className = 'swr-im-card';
    card.style.cssText = [
      'background:#14141a', 'border:1px solid #2a2a35', 'border-radius:12px',
      'padding:24px 22px', 'width:min(420px, calc(100vw - 32px))',
      'box-shadow:0 24px 64px rgba(0,0,0,0.55)', 'box-sizing:border-box',
    ].join(';');

    var h2 = document.createElement('h2');
    h2.id = 'swr-im-title';
    h2.style.cssText = 'margin:0 0 6px;font-size:16px;font-weight:600;letter-spacing:0.02em;';
    h2.textContent = 'Unlock the export watermark';

    var desc = document.createElement('p');
    desc.style.cssText = 'margin:0 0 14px;font-size:13px;line-height:1.5;color:#b6b6c2;';
    desc.textContent = 'Enter the invite code you received. Your export will be saved without the SWR mark.';

    var label = document.createElement('label');
    label.htmlFor = 'swr-im-code';
    label.style.cssText = 'display:block;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin-bottom:6px;';
    label.textContent = 'Invite code';

    var input = document.createElement('input');
    input.id = 'swr-im-code';
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.maxLength = 40;
    input.placeholder = 'XXXXX-XXXXX-XXXXX';
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box',
      'padding:10px 12px', 'background:#0c0c12',
      'border:1px solid #2a2a35', 'border-radius:8px',
      'color:#fff',
      'font:600 14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'letter-spacing:0.06em', 'text-align:center', 'text-transform:uppercase',
    ].join(';');
    input.addEventListener('input', function () {
      var v = input.value.toUpperCase();
      if (v !== input.value) input.value = v;
      status.textContent = '';
    });

    var status = document.createElement('div');
    status.className = 'swr-im-status';
    status.style.cssText = 'margin-top:12px;font-size:12px;min-height:16px;color:#ff6b6b;text-align:center;';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:16px;';

    var skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.textContent = 'Record anyway';
    skipBtn.style.cssText = [
      'flex:1', 'padding:10px 14px', 'border-radius:8px',
      'border:1px solid #2a2a35', 'background:#1d1d27', 'color:#fff',
      'font:600 12px/1 ui-sans-serif,system-ui,sans-serif',
      'letter-spacing:0.06em', 'text-transform:uppercase',
      'cursor:pointer', 'transition:background 160ms ease',
    ].join(';');
    skipBtn.addEventListener('mouseover', function () { skipBtn.style.background = '#25252f'; });
    skipBtn.addEventListener('mouseout', function () { skipBtn.style.background = '#1d1d27'; });

    var unlockBtn = document.createElement('button');
    unlockBtn.type = 'button';
    unlockBtn.textContent = 'Unlock with code';
    unlockBtn.style.cssText = [
      'flex:1', 'padding:10px 14px', 'border-radius:8px',
      'border:1px solid #ff6b1a', 'background:#ff6b1a', 'color:#14141a',
      'font:600 12px/1 ui-sans-serif,system-ui,sans-serif',
      'letter-spacing:0.06em', 'text-transform:uppercase',
      'cursor:pointer', 'transition:background 160ms ease',
    ].join(';');
    unlockBtn.addEventListener('mouseover', function () {
      if (!unlockBtn.disabled) { unlockBtn.style.background = '#ff8245'; unlockBtn.style.borderColor = '#ff8245'; }
    });
    unlockBtn.addEventListener('mouseout', function () {
      if (!unlockBtn.disabled) { unlockBtn.style.background = '#ff6b1a'; unlockBtn.style.borderColor = '#ff6b1a'; }
    });

    actions.appendChild(skipBtn);
    actions.appendChild(unlockBtn);

    card.appendChild(h2);
    card.appendChild(desc);
    card.appendChild(label);
    card.appendChild(input);
    card.appendChild(status);
    card.appendChild(actions);

    host.appendChild(card);
    document.body.appendChild(host);

    var onSkip = function () { fire('swr-invite-skipped'); hide(); };
    var onUnlock = async function () {
      var code = (input.value || '').trim();
      if (!code) { setStatus('Enter your code to continue.'); return; }
      unlockBtn.disabled = true;
      setStatus('Checking…');
      var ok = false;
      if (window.SWR_INVITE_UNLOCK && typeof window.SWR_INVITE_UNLOCK.unlock === 'function') {
        ok = await window.SWR_INVITE_UNLOCK.unlock(code);
      }
      unlockBtn.disabled = false;
      if (!ok) { setStatus('Code not recognized. Check the spelling and try again.'); return; }
      setStatus('Unlocked! Recording without the watermark.', true);
      fire('swr-invite-unlocked', { code: code });
      setTimeout(hide, 350);
    };
    var onKey = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onUnlock(); }
      if (e.key === 'Escape') { e.preventDefault(); onSkip(); }
    };
    var onBackdropClick = function (e) {
      if (e.target === host) onSkip();
    };

    skipBtn.addEventListener('click', onSkip);
    unlockBtn.addEventListener('click', onUnlock);
    input.addEventListener('keydown', onKey);
    host.addEventListener('click', onBackdropClick);

    STATE.host = host;
    STATE.els = { input: input, status: status, unlockBtn: unlockBtn, skipBtn: skipBtn };
    STATE.mounted = true;
    return STATE.els;
  }

  function setStatus(text, ok) {
    var s = STATE.els && STATE.els.status;
    if (!s) return;
    s.textContent = text || '';
    s.style.color = ok ? '#5fd47f' : '#ff6b6b';
  }

  function fire(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: detail || null }));
  }

  function show(opts) {
    var els = build();
    els.input.value = (opts && opts.code ? opts.code : '').toUpperCase();
    setStatus('');
    els.unlockBtn.disabled = false;
    STATE.host.style.display = 'flex';
    STATE.visible = true;
    setTimeout(function () { els.input.focus(); els.input.select(); }, 50);
  }

  function hide() {
    if (!STATE.mounted) return;
    STATE.host.style.display = 'none';
    STATE.visible = false;
    setStatus('');
    STATE.els.input.value = '';
  }

  window.SWR_INVITE_MODAL = { show: show, hide: hide };
})();
