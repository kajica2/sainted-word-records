// Sainted Word Records — Personal Tier (PT) panel
// ---------------------------------------------------------------------------
// Small floating panel for activating a PT license key and viewing credit
// balance. Mounts a "PT" chip in the #transport bar; clicking it opens the
// panel. The chip text shows current tier + credits (e.g. "PT Band · 127")
// or "Engine (free)" if no license is active.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  const PANEL_ID = 'pt-panel';
  const CHIP_ID  = 'pt-chip';

  function tierBadge() {
    const lic = window.SWR_PT && window.SWR_PT.load();
    if (!lic) return 'Engine (free)';
    return `${lic.tierName} · ${lic.credits} credits`;
  }

  function renderChip() {
    const chip = document.getElementById(CHIP_ID);
    if (!chip) return;
    const lic = window.SWR_PT && window.SWR_PT.load();
    if (lic) {
      chip.classList.add('active');
      chip.textContent = `◆ ${lic.tierName} · ${lic.credits}`;
      chip.title = `${lic.tierName} — ${lic.credits} of ${lic.creditsTotal} credits remaining. Click to manage.`;
    } else {
      chip.classList.remove('active');
      chip.textContent = 'PT — activate';
      chip.title = 'Activate a Personal Tier license. €120–€600, one-time.';
    }
  }

  function mountChip() {
    if (document.getElementById(CHIP_ID)) return;
    const chip = document.createElement('button');
    chip.id = CHIP_ID;
    chip.className = 'pt-chip';
    chip.addEventListener('click', openPanel);
    const transport = document.getElementById('transport');
    if (transport) {
      // Insert AFTER the brandkit-chip (which is the first child after mountChip)
      const bk = document.getElementById('brandkit-chip');
      if (bk && bk.nextSibling) {
        transport.insertBefore(chip, bk.nextSibling);
      } else {
        transport.appendChild(chip);
      }
    }
    renderChip();
  }

  function openPanel() {
    if (document.getElementById(PANEL_ID)) {
      document.getElementById(PANEL_ID).remove();
    }
    const lic = window.SWR_PT ? window.SWR_PT.load() : null;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'pt-panel';
    panel.innerHTML = `
      <div class="pt-backdrop"></div>
      <div class="pt-dialog" role="dialog" aria-label="Personal Tier">
        <div class="pt-head">
          <div>
            <div class="pt-title">Personal Tier</div>
            <div class="pt-sub">${lic
              ? `${escapeHtml(lic.tierName)} · ${lic.credits} of ${lic.creditsTotal} credits`
              : 'Free engine — every export carries the SWR mark'}</div>
          </div>
          <button class="pt-btn ghost" id="pt-close" title="Close (esc)">✕</button>
        </div>
        ${lic ? renderActive(lic) : renderInactive()}
        <div class="pt-foot">
          <div class="pt-foot-note">Keys are issued by the operator after payment. Stored locally; the server ledger syncs when signed in.</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.pt-backdrop').addEventListener('click', closePanel);
    panel.querySelector('#pt-close').addEventListener('click', closePanel);
    if (lic) {
      panel.querySelector('#pt-deactivate').addEventListener('click', () => {
        if (!confirm('Deactivate PT license? Credits reset. The SWR mark stays on every export.')) return;
        window.SWR_PT.deactivate();
        renderChip();
        closePanel();
        if (typeof window.setStatus === 'function') {
          window.setStatus('PT deactivated', 'warn');
        }
      });
      wireRegisterButtons(panel);
      syncServerSlots(panel); // server ledger is authoritative when reachable — best-effort
    } else {
      const keyInput = panel.querySelector('#pt-key-input');
      const activateBtn = panel.querySelector('#pt-activate-btn');
      const errEl = panel.querySelector('#pt-error');
      keyInput.focus();
      activateBtn.addEventListener('click', () => doActivate(keyInput.value, errEl));
      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doActivate(keyInput.value, errEl);
      });
    }
    document.addEventListener('keydown', onKeydown);
  }

  function renderActive(lic) {
    const used = lic.videosRegistered || 0;
    const total = lic.videoSlots || 0;
    const left = Math.max(0, total - used);
    const rows = (window.SWR_PT && window.SWR_PT.REGISTER_BATCHES) || [10, 30, 50];
    const btn = (n) => `
      <button class="pt-btn ghost" data-register="${n}" ${left < n ? 'disabled' : ''}>+ ${n}</button>
    `;
    return `
      <div class="pt-card">
        <div class="pt-card-label">Active license</div>
        <div class="pt-key-display">${escapeHtml(lic.key)}</div>
        <div class="pt-meta">
          Activated ${new Date(lic.activatedAt).toLocaleDateString()}<br>
          Tier: <b>${escapeHtml(lic.tierName)}</b> · Credits: <b>${lic.credits} / ${lic.creditsTotal}</b><br>
          Videos registered: <b>${used} / ${total}</b> (${left} slots left)<br>
          ${lic.lastDecrementAt ? `Last render: ${new Date(lic.lastDecrementAt).toLocaleString()}` : ''}
          <div class="pt-server-ledger" data-server-ledger style="margin-top:6px;color:var(--accent,#f5a524);"></div>
        </div>
        <div class="pt-register">
          <div class="pt-register-label">Register videos (10 / 30 / 50 per credit load)</div>
          <div class="pt-register-row">${rows.map(btn).join('')}</div>
          <div class="pt-register-error" data-register-err role="alert"></div>
        </div>
        <div class="pt-actions">
          <button class="pt-btn ghost" id="pt-deactivate">Deactivate</button>
          <a class="pt-btn ghost" href="/campaign.html#pt" target="_blank" rel="noopener">Top up →</a>
        </div>
      </div>
    `;
  }

  // Wire the 10/30/50 register buttons. Safe to call again after a body
  // re-render (listeners are per-node).
  function wireRegisterButtons(panel) {
    panel.querySelectorAll('[data-register]').forEach((b) => {
      b.addEventListener('click', () => {
        const err = panel.querySelector('[data-register-err]');
        err.textContent = '';
        const n = Number(b.dataset.register);
        const res = window.SWR_PT.registerVideos(n);
        if (!res.ok) {
          err.textContent = res.error + (res.remaining !== undefined ? ` (${res.remaining} slots left)` : '');
          return;
        }
        renderChip();
        // Re-render the panel body so the new counts and disabled states show.
        const body = panel.querySelector('.pt-card');
        const next = renderActive(window.SWR_PT.load());
        if (body) {
          body.outerHTML = next;
          wireRegisterButtons(panel); // re-wire on the fresh nodes
          syncServerSlots(panel);     // the fresh .pt-card has a new server-ledger slot
        }
        if (typeof window.setStatus === 'function') {
          window.setStatus(`Registered ${res.registered} videos · ${res.remaining} slots left`, 'ok');
        }
      });
    });
  }

  // Best-effort server-ledger sync (GET /api/slots — api/slots/index.js). The
  // server ledger is the authoritative payment record; the local wallet stays
  // the offline runtime. On any failure (not signed in, network, server error)
  // this silently keeps the local-only view — local is the fallback by design.
  function syncServerSlots(panel) {
    if (!panel || typeof fetch !== 'function') return;
    const target = panel.querySelector('[data-server-ledger]');
    if (!target) return;
    fetch('/api/slots', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data.totalSlots !== 'number') return;
        target.textContent =
          `Server ledger: ${data.registered} / ${data.totalSlots} registered` +
          (typeof data.remaining === 'number' ? ` (${data.remaining} free)` : '') +
          ' — authoritative when signed in.';
      })
      .catch(() => { /* offline/local fallback — silent by design */ });
  }

  function renderInactive() {
    return `
      <div class="pt-card">
        <div class="pt-card-label">Activate license</div>
        <div class="pt-key-input-row">
          <input type="text" id="pt-key-input" placeholder="swr-solo-XXXXXXXX" spellcheck="false" autocomplete="off" />
          <button class="pt-btn primary" id="pt-activate-btn">Activate</button>
        </div>
        <div class="pt-error" id="pt-error" role="alert"></div>
        <div class="pt-tiers">
          <div class="pt-tier"><b>PT Solo</b> €120 — 50 credits</div>
          <div class="pt-tier"><b>PT Band</b> €280 — 150 credits</div>
          <div class="pt-tier"><b>PT Label</b> €600 — 500 credits</div>
        </div>
        <div class="pt-hint">
          No license? <a href="/campaign.html#pt" target="_blank" rel="noopener">See pricing on the campaign page →</a>
        </div>
      </div>
    `;
  }

  function doActivate(rawKey, errEl) {
    errEl.textContent = '';
    const res = window.SWR_PT.activate(rawKey);
    if (res.error) {
      errEl.textContent = res.error;
      return;
    }
    renderChip();
    closePanel();
    if (typeof window.setStatus === 'function') {
      window.setStatus('PT activated: ' + (res.license.tierName), 'ok');
    }
  }

  function closePanel() {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closePanel();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Public init
  window.SWR_PT_Panel = { mountChip, openPanel, closePanel, renderChip };

  // Listen for license changes (activate, deactivate, credit consumption)
  window.addEventListener('swr-pt-changed', () => {
    renderChip();
  });

  // Auto-mount when transport is ready
  function tryMount() {
    if (document.getElementById('transport')) {
      mountChip();
    } else {
      setTimeout(tryMount, 60);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount);
  } else {
    tryMount();
  }
})();
