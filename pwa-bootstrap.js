// INTEGRATION: <script type="module" src="pwa-bootstrap.js"></script>
// Sainted Word Records — PWA bootstrap. Plain ES module (top-level).
// - Registers /sw.js on load (skips file:// + unsupported browsers)
// - Stashes beforeinstallprompt, shows an amber glassmorphism install card
// - appinstalled hides the card
// - SW updatefound → top-right "↻ new version · refresh" toast; click posts
//   {type:'SKIP_WAITING'} to the waiting worker and reloads on controllerchange
// - iOS Safari (non-standalone) → one-time "Tap Share → Add to Home Screen" hint
//   (dismissal persisted in localStorage so it only shows once)
// - online/offline → "· offline" pill appended to the status bar
// - Every CSS var uses var(--name, fallback) so the card works even if the
//   page's tokens aren't defined.

// ---- feature detection (top-level, ES module) ----
const hasSW = 'serviceWorker' in navigator;
const isFileProtocol = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
const isStandalone = (typeof window !== 'undefined'
  && (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true));
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// ---- module-scoped state ----
let deferredPrompt = null;
let installCard = null;
let updateToast = null;
let offlinePill = null;
let swRegistration = null;

const STORAGE_IOS_DISMISS = 'swr.iosInstallHintDismissed';
const TITLE_OFFLINE_TAG = ' · offline';

// ---- styles (injected once) ----
function injectStyle() {
  if (document.getElementById('pwa-bootstrap-style')) return;
  const s = document.createElement('style');
  s.id = 'pwa-bootstrap-style';
  s.textContent = `
    .pwa-install-card, .pwa-update-toast, .pwa-ios-hint, .pwa-offline-pill {
      font-family: var(--font-mono, 'JetBrains Mono', system-ui, monospace);
      font-size: 12px;
      color: var(--fg-0, #e7ecf3);
      background: linear-gradient(180deg, rgba(245, 165, 36, 0.10), rgba(10, 13, 18, 0.85));
      border: 1px solid var(--amber, #f5a524);
      box-shadow: var(--glass, 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 32px rgba(0, 0, 0, 0.45));
      border-radius: 10px;
      padding: 12px 16px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 9999;
      box-sizing: border-box;
    }
    .pwa-install-card {
      position: fixed; left: 16px; bottom: 16px; max-width: 340px;
      display: none; flex-direction: column; gap: 8px;
    }
    .pwa-install-card .pwa-title {
      font-weight: 600; color: var(--amber, #f5a524);
    }
    .pwa-install-card .pwa-sub {
      color: var(--fg-1, #b9c2cf); font-size: 11px; line-height: 1.4;
    }
    .pwa-install-card .pwa-row {
      display: flex; gap: 8px; align-items: center; margin-top: 4px;
    }
    .pwa-install-card button {
      font: inherit; cursor: pointer; border: 0; padding: 6px 14px;
      border-radius: 999px;
      background: var(--amber, #f5a524);
      color: #0a0d12; font-weight: 600;
    }
    .pwa-install-card .pwa-dismiss {
      background: transparent; color: var(--fg-1, #b9c2cf);
      font-size: 16px; line-height: 1; padding: 2px 8px;
    }
    .pwa-update-toast {
      position: fixed; right: 16px; top: 16px;
      display: none; cursor: pointer; max-width: 280px;
    }
    .pwa-update-toast .pwa-refresh {
      color: var(--amber, #f5a524); font-weight: 600;
    }
    .pwa-ios-hint {
      position: fixed; left: 16px; right: 16px; bottom: 16px;
      display: none; text-align: center;
    }
    .pwa-offline-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 11px; margin-left: 8px; color: var(--amber, #f5a524);
    }
    @media (prefers-reduced-motion: no-preference) {
      .pwa-install-card, .pwa-update-toast, .pwa-ios-hint {
        animation: pwa-fade-in 240ms var(--ease, cubic-bezier(0.16, 1, 0.3, 1)) both;
      }
      @keyframes pwa-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: none; }
      }
    }
  `;
  document.head.appendChild(s);
}

// ---- builders ----
function buildInstallCard() {
  const el = document.createElement('div');
  el.className = 'pwa-install-card';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Install Sainted Word Records');
  el.innerHTML = `
    <div class="pwa-title">Install Sainted Word Records</div>
    <div class="pwa-sub">drop in a song, drop in a library — works offline</div>
    <div class="pwa-row">
      <button type="button" data-action="install">Install</button>
      <button type="button" class="pwa-dismiss" data-action="dismiss" aria-label="Dismiss">×</button>
    </div>
  `;
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.action === 'dismiss') {
      el.style.display = 'none';
      return;
    }
    if (t.dataset.action === 'install' && deferredPrompt) {
      try { deferredPrompt.prompt(); } catch (_) { /* noop */ }
      try {
        const c = await deferredPrompt.userChoice;
        console.log('[pwa] install:', c && c.outcome);
      } catch (_) { /* noop */ }
      deferredPrompt = null;
      el.style.display = 'none';
    }
  });
  document.body.appendChild(el);
  return el;
}

function buildUpdateToast() {
  const el = document.createElement('div');
  el.className = 'pwa-update-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="pwa-refresh">↻ new version</span> · refresh';
  el.addEventListener('click', () => {
    if (!swRegistration || !swRegistration.waiting) {
      location.reload();
      return;
    }
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  document.body.appendChild(el);
  return el;
}

function buildIOSHint() {
  const el = document.createElement('div');
  el.className = 'pwa-ios-hint';
  el.setAttribute('role', 'note');
  el.innerHTML = `
    Tap the Share button, then "Add to Home Screen".
    <button type="button" data-action="dismiss" aria-label="Dismiss"
      style="margin-left:12px;background:transparent;color:var(--fg-1,#b9c2cf);border:0;font:inherit;cursor:pointer">×</button>
  `;
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-action="dismiss"]')) {
      el.style.display = 'none';
      try { localStorage.setItem(STORAGE_IOS_DISMISS, '1'); } catch (_) { /* noop */ }
    }
  });
  document.body.appendChild(el);
  return el;
}

// ---- offline pill (appends to status bar, falls back to title suffix) ----
function findStatusEl() {
  return document.getElementById('status-pill')
      || document.getElementById('status')
      || document.getElementById('audioStatus')
      || document.querySelector('.status-pill')
      || document.querySelector('.status');
}

function showOffline() {
  if (offlinePill && offlinePill.isConnected) return;
  const host = findStatusEl();
  if (host) {
    const p = document.createElement('span');
    p.className = 'pwa-offline-pill';
    p.textContent = '· offline';
    host.appendChild(p);
    offlinePill = p;
  } else if (!document.title.endsWith(TITLE_OFFLINE_TAG)) {
    document.title += TITLE_OFFLINE_TAG;
  }
}

function hideOffline() {
  if (offlinePill && offlinePill.parentNode) {
    offlinePill.parentNode.removeChild(offlinePill);
  }
  offlinePill = null;
  if (document.title.endsWith(TITLE_OFFLINE_TAG)) {
    document.title = document.title.slice(0, -TITLE_OFFLINE_TAG.length);
  }
}

// ---- service worker registration + update flow ----
function registerSW() {
  if (isFileProtocol || !hasSW) return;
  const onLoad = () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        swRegistration = reg;
        if (reg.waiting && updateToast) updateToast.style.display = 'block';
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              if (updateToast) updateToast.style.display = 'block';
            }
          });
        });
      })
      .catch((err) => console.warn('[pwa] SW registration failed:', err));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      if (updateToast) updateToast.style.display = 'none';
      location.reload();
    });
  };
  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad, { once: true });
}

// ---- main init ----
function init() {
  injectStyle();
  installCard = buildInstallCard();
  updateToast = buildUpdateToast();

  // iOS one-time hint
  if (isIOS && !isStandalone) {
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(STORAGE_IOS_DISMISS); } catch (_) { /* noop */ }
    if (!dismissed) {
      const h = buildIOSHint();
      h.style.display = 'block';
    }
  }

  // install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone || isIOS) return;
    if (installCard) installCard.style.display = 'flex';
  });

  // install confirmed
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installCard) installCard.style.display = 'none';
    console.log('[pwa] app installed');
  });

  // online/offline
  window.addEventListener('online', hideOffline);
  window.addEventListener('offline', showOffline);
  if (!navigator.onLine) showOffline();

  registerSW();
}

// bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
