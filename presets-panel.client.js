// presets-panel.client.js — UI for the engine's self-evolving presets.
// Phase 2 of the self-evolving engine roadmap.
//
// Renders:
//   - A small "N new personalities" pill in the footer, when the manifest has
//     presets the user hasn't seen
//   - A popup panel with a list of new presets (thumbnail, name, description,
//     [Apply] [Dismiss] buttons)
//   - Each preset card shows: SVG thumb, name, family tag, description, the
//     palette as 4 color dots, and the audio-reactivity summary
//
// Listens to swr-presets-loaded to (re)render. Dispatches apply via
// window.SWR_PRESETS.apply(id) and dismiss via markSeen(id).
//
// Mount is automatic: the script self-runs on DOMContentLoaded and
// re-mounts the pill on every swr-presets-loaded event. Idempotent.

(function () {
  'use strict';
  if (window.SWR_PRESETS_PANEL) return;

  const PILL_ID = 'presets-pill';
  const PANEL_ID = 'presets-panel';

  function $(id) { return document.getElementById(id); }

  function findMountPoint() {
    // The footer is the cleanest place — we want the pill visible on every
    // screen but not in the way of the main controls. Look for an existing
    // footer or status row first; fall back to the body.
    return document.getElementById('status-pill')
        || document.getElementById('status')
        || document.getElementById('audioStatus')
        || document.querySelector('.status-pill')
        || document.querySelector('.status')
        || document.body;
  }

  function buildPill(count) {
    const pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.className = 'presets-pill';
    pill.type = 'button';
    pill.setAttribute('aria-label', count + ' new personalit' + (count === 1 ? 'y' : 'ies'));
    pill.innerHTML = `
      <span class="presets-pill-dot" aria-hidden="true"></span>
      <span class="presets-pill-text">${count} new personalit${count === 1 ? 'y' : 'ies'}</span>
    `;
    pill.addEventListener('click', togglePanel);
    return pill;
  }

  function buildPanel(presets) {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'presets-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'New audio-reactive personalities');
    panel.innerHTML = `
      <div class="presets-panel-head">
        <div class="presets-panel-title">New personalities</div>
        <button class="presets-panel-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="presets-panel-list"></div>
      <div class="presets-panel-foot">
        <button class="presets-dismiss-all" type="button">Dismiss all</button>
        <span class="presets-panel-meta">${presets.length} new · ${presets.length === 0 ? 'no' : 'audio-reactive'} preset${presets.length === 1 ? '' : 's'}</span>
      </div>
    `;
    const list = panel.querySelector('.presets-panel-list');
    for (const p of presets) list.appendChild(buildCard(p));
    panel.querySelector('.presets-panel-close').addEventListener('click', closePanel);
    panel.querySelector('.presets-dismiss-all').addEventListener('click', () => {
      if (window.SWR_PRESETS) window.SWR_PRESETS.markAllSeen();
      closePanel();
      removePill();
    });
    return panel;
  }

  function buildCard(p) {
    const card = document.createElement('div');
    card.className = 'presets-card';
    card.dataset.id = p.id;
    const palette = p.palette || {};
    const audio = p.audio_reactivity || {};
    const audioSummary = [
      audio.bass && audio.bass.length ? 'bass: ' + audio.bass.join(',') : '',
      audio.onset && audio.onset.length ? 'onset: ' + audio.onset.join(',') : '',
    ].filter(Boolean).join(' · ');
    const tags = (p.preview && p.preview.tags) || [];
    const safeThumb = (p.preview && p.preview.thumbnail_svg) || '<svg width="80" height="80" xmlns="http://www.w3.org/2000/svg"></svg>';
    card.innerHTML = `
      <div class="presets-card-thumb">${safeThumb}</div>
      <div class="presets-card-body">
        <div class="presets-card-name">${escapeHtml(p.name || p.id)}</div>
        <div class="presets-card-meta">
          <span class="presets-card-family">${escapeHtml(p.family || 'GENERATIVE')}</span>
          ${p._meta && p._meta.basePersona ? `<span class="presets-card-personalized" title="Personalized variant · generated from your usage of ${escapeAttr(p._meta.basePersona)}">★ personal</span>` : ''}
          ${tags.slice(0, 3).map(t => `<span class="presets-card-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div class="presets-card-desc">${escapeHtml(p.description || '')}</div>
        <div class="presets-card-palette" aria-label="palette">
          <span class="presets-color" style="background:${palette.bg || '#000'}"></span>
          <span class="presets-color" style="background:${palette.primary || '#888'}"></span>
          <span class="presets-color" style="background:${palette.secondary || '#888'}"></span>
          <span class="presets-color" style="background:${palette.accent || '#888'}"></span>
        </div>
        <div class="presets-card-audio">${escapeHtml(audioSummary)}</div>
      </div>
      <div class="presets-card-actions">
        <button class="presets-apply" type="button" data-id="${escapeAttr(p.id)}">Apply</button>
        <button class="presets-dismiss" type="button" data-id="${escapeAttr(p.id)}">Dismiss</button>
      </div>
    `;
    card.querySelector('.presets-apply').addEventListener('click', () => {
      if (!window.SWR_PRESETS) return;
      const r = window.SWR_PRESETS.apply(p.id);
      if (r && r.ok) {
        window.SWR_PRESETS.markSeen(p.id);
        card.classList.add('presets-card-applied');
        refreshPill();
      }
    });
    card.querySelector('.presets-dismiss').addEventListener('click', () => {
      if (!window.SWR_PRESETS) return;
      window.SWR_PRESETS.markSeen(p.id);
      card.remove();
      refreshPill();
    });
    return card;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function togglePanel() {
    const panel = $(PANEL_ID);
    if (!panel) return;
    panel.hidden = !panel.hidden;
  }
  function closePanel() {
    const panel = $(PANEL_ID);
    if (panel) panel.hidden = true;
  }
  function removePill() {
    const pill = $(PILL_ID);
    if (pill) pill.remove();
  }
  function refreshPill() {
    if (!window.SWR_PRESETS) return;
    const fresh = window.SWR_PRESETS.getNew();
    const pill = $(PILL_ID);
    if (fresh.length === 0) { if (pill) pill.remove(); return; }
    if (pill) {
      pill.querySelector('.presets-pill-text').textContent =
        fresh.length + ' new personalit' + (fresh.length === 1 ? 'y' : 'ies');
    } else {
      mountPill(fresh.length);
    }
  }
  function mountPill(count) {
    const mount = findMountPoint();
    if (!mount) return;
    // If the mount point is the body, append to a fixed-position slot
    let host = mount;
    if (host === document.body) {
      host = document.createElement('div');
      host.className = 'presets-host';
      document.body.appendChild(host);
    } else {
      // Wrap the pill in a slot so it doesn't disturb the host's layout
      host = document.createElement('span');
      host.className = 'presets-host';
      host.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;gap:6px;';
      mount.appendChild(host);
    }
    host.appendChild(buildPill(count));
  }

  function onLoaded(e) {
    const fresh = (e && e.detail && e.detail.fresh) || [];
    // Replace any existing UI
    const oldPill = $(PILL_ID); if (oldPill) oldPill.remove();
    const oldPanel = $(PANEL_ID); if (oldPanel) oldPanel.remove();
    if (fresh.length === 0) return;
    mountPill(fresh.length);
    const panel = buildPanel(fresh);
    document.body.appendChild(panel);
  }

  function onApplied(e) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    // Move the just-applied preset into the "known" set so the pill refreshes
    if (window.SWR_PRESETS) {
      window.SWR_PRESETS.markSeen(id);
      // small delay so the user sees the "applied" state on the card
      setTimeout(refreshPill, 200);
    }
  }

  function onError(e) {
    // Soft failure — log to console, never show a scary error to the user
    console.warn('[presets]', (e && e.detail && e.detail.error) || 'unknown error');
  }

  function init() {
    window.addEventListener('swr-presets-loaded', onLoaded);
    window.addEventListener('swr-preset-applied', onApplied);
    window.addEventListener('swr-presets-error', onError);
    // Escape closes the panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });
    // Click outside closes the panel
    document.addEventListener('click', (e) => {
      const panel = $(PANEL_ID);
      const pill = $(PILL_ID);
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target)) return;
      if (pill && pill.contains(e.target)) return;
      closePanel();
    });
  }

  window.SWR_PRESETS_PANEL = { init, refresh: refreshPill };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
