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
              : 'Free engine — activate a license to remove watermark'}</div>
          </div>
          <button class="pt-btn ghost" id="pt-close" title="Close (esc)">✕</button>
        </div>
        ${lic ? renderActive(lic) : renderInactive()}
        <div class="pt-foot">
          <div class="pt-foot-note">Keys are issued by the operator after payment. Stored locally; no server call.</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.pt-backdrop').addEventListener('click', closePanel);
    panel.querySelector('#pt-close').addEventListener('click', closePanel);
    if (lic) {
      panel.querySelector('#pt-deactivate').addEventListener('click', () => {
        if (!confirm('Deactivate PT license? Watermark will return and credits reset.')) return;
        window.SWR_PT.deactivate();
        renderChip();
        closePanel();
        if (typeof window.setStatus === 'function') {
          window.setStatus('PT deactivated', 'warn');
        }
      });
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
    return `
      <div class="pt-card">
        <div class="pt-card-label">Active license</div>
        <div class="pt-key-display">${escapeHtml(lic.key)}</div>
        <div class="pt-meta">
          Activated ${new Date(lic.activatedAt).toLocaleDateString()}<br>
          Tier: <b>${escapeHtml(lic.tierName)}</b> · Credits: <b>${lic.credits} / ${lic.creditsTotal}</b><br>
          ${lic.lastDecrementAt ? `Last render: ${new Date(lic.lastDecrementAt).toLocaleString()}` : ''}
        </div>
        <div class="pt-actions">
          <button class="pt-btn ghost" id="pt-deactivate">Deactivate</button>
          <a class="pt-btn ghost" href="/campaign.html#pt" target="_blank" rel="noopener">Top up →</a>
        </div>
      </div>
    `;
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
