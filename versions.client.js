// versions.client.js — live data for /versions
//
// Fetches /presets/manifest.json + pings /engine, /presets/manifest.json
// and fills in the "Live state" panel + the "Daily preset timeline" section.
// No framework, no deps. ~3 KB.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  async function probe(url) {
    try {
      const t0 = performance.now();
      const r = await fetch(url, { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      return { ok: r.ok, status: r.status, ms };
    } catch (e) {
      return { ok: false, status: 0, ms: 0, err: String(e) };
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toISOString().slice(0, 10);
    } catch (_) { return iso; }
  }

  function groupByDay(presets) {
    const buckets = new Map();
    for (const p of presets) {
      const id = p.id || '';
      // swr-preset-YYYY-MM-DD-name
      const m = id.match(/(\d{4}-\d{2}-\d{2})/);
      const day = m ? m[1] : 'unknown';
      if (!buckets.has(day)) buckets.set(day, []);
      buckets.get(day).push(p);
    }
    return [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0]));  // newest first
  }

  function renderTimeline(presets) {
    const root = $('preset-list');
    if (!root) return;
    if (!presets.length) {
      root.innerHTML = '<div class="preset-day"><div class="day-head"><h4>No presets yet</h4></div><div class="items"><span class="preset-chip">empty manifest</span></div></div>';
      return;
    }
    const groups = groupByDay(presets);
    root.innerHTML = groups.map(([day, list]) => `
      <div class="preset-day">
        <div class="day-head">
          <h4>${day}</h4>
          <span class="count">${list.length} preset${list.length === 1 ? '' : 's'}</span>
        </div>
        <div class="items">
          ${list.map(p => `
            <span class="preset-chip" title="${(p.name || p.id).replace(/"/g, '&quot;')} · ${p.family || ''} · ${p.shader || ''} · ${p.motion || ''}">
              <span class="dot"></span>${p.name || p.id}
            </span>
          `).join('')}
        </div>
      </div>
    `).join('');
    $('t-count').textContent = `${presets.length} preset${presets.length === 1 ? '' : 's'} · ${groups.length} day${groups.length === 1 ? '' : 's'}`;
  }

  async function init() {
    const refresh = $('l-refresh');
    if (refresh) refresh.textContent = 'Probing…';

    // Probe the live deployment
    const [engineP, manifestP] = await Promise.all([
      probe('/engine'),
      probe('/presets/manifest.json'),
    ]);

    // HTTP code
    const httpEl = $('l-http');
    if (httpEl) {
      httpEl.textContent = engineP.status || '—';
      httpEl.style.color = engineP.ok ? 'var(--green)' : 'var(--red)';
    }

    // Fetch the manifest
    let presets = [];
    let schemaVersion = 'unknown';
    let manifestOk = false;
    try {
      const r = await fetch('/presets/manifest.json', { cache: 'no-store' });
      if (r.ok) {
        const m = await r.json();
        manifestOk = true;
        schemaVersion = m.schema || m.schemaVersion || (m.presets && m.presets[0] && m.presets[0].schema) || 'swr-preset/v1';
        presets = m.presets || (Array.isArray(m) ? m : []);
      }
    } catch (e) {
      // ignore — leave presets empty
    }

    // Live state cells
    const countEl = $('l-count');
    if (countEl) {
      countEl.textContent = String(presets.length);
      countEl.style.color = manifestOk ? 'var(--accent-2)' : 'var(--muted)';
    }
    const countSubEl = $('l-count-sub');
    if (countSubEl) {
      countSubEl.textContent = manifestOk
        ? `${schemaVersion} · ${engineP.ms}ms`
        : 'manifest offline';
    }

    const latest = presets[presets.length - 1];
    const latestEl = $('l-latest');
    if (latestEl) {
      if (latest) {
        const display = (latest.name || latest.id || '—').replace(/^swr-preset-\d{4}-\d{2}-\d{2}-/, '');
        latestEl.textContent = display;
        latestEl.title = latest.id || '';
        latestEl.style.color = 'var(--accent)';
      } else {
        latestEl.textContent = '—';
        latestEl.style.color = 'var(--muted)';
      }
    }
    const latestSubEl = $('l-latest-sub');
    if (latestSubEl) {
      latestSubEl.textContent = latest ? fmtDate(latest.created || latest.id) : 'no presets yet';
    }

    // Schema
    const schemaEl = $('l-schema');
    if (schemaEl) schemaEl.textContent = schemaVersion;

    // Render the timeline
    renderTimeline(presets);

    // Done
    if (refresh) {
      const ok = engineP.ok && manifestOk;
      refresh.textContent = `Updated ${new Date().toLocaleTimeString()} · ${ok ? 'all green' : 'partial'}`;
      refresh.style.color = ok ? 'var(--green)' : 'var(--gold)';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
