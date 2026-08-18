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

    // Wire the randomize button
    wireRandomize(presets);

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

  // ---- Randomize (inside IIFE so init() can call it) ----------------------

  let _picks = [];
  let _presets = [];

  function wireRandomize(presets) {
    _presets = presets;
    const btn = $('rbtn-randomize');
    const again = $('r-again');
    const copyBtn = $('r-copy');
    if (!btn) return;
    if (!presets || !presets.length) {
      btn.disabled = true;
      btn.title = 'No presets in manifest yet';
      return;
    }
    btn.addEventListener('click', () => pickRandom());
    if (again) again.addEventListener('click', () => pickRandom());
    const prevBtn = $('r-prev');
    const nextBtn = $('r-next');
    if (prevBtn) prevBtn.addEventListener('click', () => pickRandom());
    if (nextBtn) nextBtn.addEventListener('click', () => pickRandom());
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const id = $('r-id')?.textContent?.trim() || '';
        try {
          await navigator.clipboard.writeText(id);
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = 'Copy id'; }, 1200);
        } catch (_) {
          copyBtn.textContent = 'Copy failed';
          setTimeout(() => { copyBtn.textContent = 'Copy id'; }, 1200);
        }
      });
    }
    // Pick one on initial load so the card is visible
    setTimeout(pickRandom, 600);
  }

  function pickRandom() {
    if (!_presets.length) return;
    let p;
    let attempts = 0;
    do {
      p = _presets[Math.floor(Math.random() * _presets.length)];
      attempts++;
    } while (_picks[_picks.length - 1] && _picks[_picks.length - 1] === p.id && _presets.length > 1 && attempts < 8);
    _picks.push(p.id);
    if (_picks.length > 50) _picks = _picks.slice(-50);
    renderPick(p, _picks.length);
  }

  function renderPick(p, pickNum) {
    const card = $('rand-card');
    if (!card) return;
    card.classList.add('is-rolling');
    setTimeout(() => card.classList.remove('is-rolling'), 500);

    const ins = (p.inspiration || []);
    const shader = (ins.find(i => i.kind === 'shader_ref') || {}).name || '—';
    const palette = (ins.find(i => i.kind === 'palette_ref') || {}).name || '—';
    const motion = (ins.find(i => i.kind === 'motion_ref') || {}).name || '—';
    const audio = p.audio_reactivity || {};
    const audioSummary = Object.entries(audio).filter(([_, v]) => v && v.length).map(([k, v]) => `${k}→${v.join('+')}`).join(' · ') || '—';
    const fx = p.fx_state || {};
    const fxKeys = Object.keys(fx).length;
    const tags = (p.preview && p.preview.tags) || [];

    if ($('r-picknum')) $('r-picknum').textContent = `pick #${pickNum}`;
    if ($('r-name')) $('r-name').textContent = p.name || p.id || '—';
    if ($('r-id')) $('r-id').textContent = p.id || '—';
    if ($('r-created')) $('r-created').textContent = (p.created_at || '').slice(0, 10) || '—';
    if ($('r-desc')) $('r-desc').textContent = p.description || '—';
    if ($('r-fam')) $('r-fam').textContent = p.family || '—';
    if ($('r-shader')) $('r-shader').textContent = shader;
    if ($('r-palette-name')) $('r-palette-name').textContent = palette;
    if ($('r-motion')) $('r-motion').textContent = motion;
    if ($('r-fxkeys')) $('r-fxkeys').textContent = `${fxKeys} of 15`;
    if ($('r-audio')) $('r-audio').textContent = audioSummary;

    const swRoot = $('r-swatches');
    if (swRoot && p.palette) {
      swRoot.innerHTML = ['primary', 'secondary', 'accent', 'bg']
        .filter(k => p.palette[k])
        .map(k => `<span class="sw" style="background:${p.palette[k]}" title="${k}: ${p.palette[k]}"></span>`)
        .join('') + ` <span style="margin-left:8px;">${p.palette.primary || ''} · ${p.palette.secondary || ''}</span>`;
    }
    const tagsRoot = $('r-tags');
    if (tagsRoot) {
      tagsRoot.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');
    }

    card.classList.add('show');
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    renderDemo(p);
  }

  function renderDemo(p) {
    const demoRoot = $('r-demo');
    if (!demoRoot) return;
    if (!p.demo) {
      demoRoot.innerHTML = '';
      demoRoot.style.display = 'none';
      return;
    }
    demoRoot.style.display = '';
    const audio = (p.demo.audio || '').split('/').pop().replace(/\.[^.]+$/, '');
    const style = p.demo.style_name || (p.demo.style || '').replace('.html', '');
    demoRoot.innerHTML = `
      <a class="rand-demo-link" href="${p.demo.audio || '#'}" download title="Download demo song">
        <span class="rand-demo-lbl">♪ song</span>
        <span class="rand-demo-val">${audio}</span>
      </a>
      <span class="rand-demo-sep">·</span>
      <a class="rand-demo-link" href="/versions/${p.demo.style || ''}" target="_blank" rel="noopener" title="Open in ${style} style">
        <span class="rand-demo-lbl">◐ style</span>
        <span class="rand-demo-val">${style}</span>
      </a>
    `;
  }
})();
