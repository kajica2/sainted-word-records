// client/tour.client.js — Driver for /tour.html.
//
// 12 stops covering the engine, the surface tools, the recent modules,
// and the api. Each step is a card with a primary CTA (open the page in
// a new tab) and an optional secondary CTA. The Sweep button opens all
// primary links in series with a short pause so the browser settles;
// progress (per-stop "visited") persists in localStorage so a half-swept
// tour resumes where you left off.
//
// The list is a list of {id, label, badge, title, body, href, optional}
// records. Adding a new stop is a one-liner; the bar/sweep machinery is
// generic.

(() => {
  'use strict';
  if (window.SWR_TOUR) return;

  // ---- the route table (one entry per feature) ------------------------
  // Each stop is also tagged with one of Jakob Nielsen's 10 usability
  // heuristics so the tour doubles as an audit trail. The badge turns
  // into the heuristic name when the user inspects the card.
  const STOPS = [
    {
      id: 'engine', heuristic: 'visibility',
      badge: 'H1', title: 'Open the engine',
      body: 'Load the audio-reactive video engine. Pick a song, drop clips from the library, watch them pulse on the beat. **Nielsen H1 — Visibility of system status:** the transport row, beat LED, onset LED, and last-frame luma all keep the user informed about state on every frame.',
      href: '/engine',
    },
    {
      id: 'versions', heuristic: 'match',
      badge: 'H2', title: 'See the visual variants',
      body: 'Every variant page is its own visual identity — film, neon, smoke, hallucination, plus 9 artistic passes. The variant dropdown cycles between them on the fly. **Nielsen H2 — Match with the real world:** the variants map onto familiar cinematic vocabulary; the dropdown reads in the same terms.',
      href: '/versions',
    },
    {
      id: 'looks', heuristic: 'recognition',
      badge: 'H6', title: 'Try the look-filter cycler',
      body: 'Press T + 1..9 on the engine for the full filter library: soft, old cinema, 5 cinematic palettes, void, echo. Bare digits 1..9 wire the same cycler without the prefix. **Nielsen H6 — Recognition over recall:** every slot has a short label that surfaces in the status line so the user remembers what was applied.',
      href: '/engine',
    },
    {
      id: 'cloud-library', heuristic: 'control',
      badge: 'H3', title: 'Cloud library menu',
      body: 'The new FAB on the library panel pushes / pulls / syncs your library. Phase 1 ships the menu + local-FS store; Firestore path comes online when SWR_PROJECTS_STORE=firestore. **Nielsen H3 — User control and freedom:** every action is reversible via the Empty-library reset and the watch toggle.',
      href: '/engine',
    },
    {
      id: 'text-layers', heuristic: 'consistency',
      badge: 'H4', title: 'User-typed text layers',
      body: 'Add a text layer in code with Layers.addText(text, opts). Position with Shift+Arrow keys. Renders with fillText + glow shadow over the stage. **Nielsen H4 — Consistency and standards:** Shift+Arrow matches the existing nudge-layer-pattern, so the keymap stays consistent.',
      href: '/engine',
    },
    {
      id: 'layer-lifecycle', heuristic: 'recognition',
      badge: 'H6', title: 'Layer lifecycle page',
      body: 'Watch retire / unretire / home in action on a self-contained demo page. Fades opacity to 0, scales to 0.4, rotates 360°, all opt-in via rotationEnabled. **Nielsen H6 — Recognition over recall:** the page labels every state (LIVE / RETIRED) so the user reads what changed rather than guessing.',
      href: '/layer-lifecycle',
    },
    {
      id: 'echo', heuristic: 'aesthetic',
      badge: 'H8', title: 'Echo — 30 min of black',
      body: 'A 30-minute meditation page. Black PNG sequences crossfading into each other. Press NEXT to skip. **Nielsen H8 — Aesthetic and minimalist design:** deliberately empty. The interrupt goes away so the eye rests.',
      href: '/echo',
    },
    {
      id: 'tiktok', heuristic: 'efficiency',
      badge: 'H7', title: 'TikTok Studio',
      body: 'BPM-locked 9:16 export. Six layers, four plans, three audio modes. **Nielsen H7 — Flexibility and efficiency of use:** keyboard shortcuts + one-click export for power users; auto layout for first-timers.',
      href: '/tiktok',
    },
    {
      id: 'spit', heuristic: 'visibility',
      badge: 'H1', title: 'Spit Live',
      body: 'Mic-driven performance mode. Live audio features drive the engine; mic toggle, beat-tap, and FX triggers. **Nielsen H1 — Visibility of system status:** mic level is always visible during a session.',
      href: '/spit',
    },
    {
      id: 'camera-enhance', heuristic: 'match',
      badge: 'H2', title: 'Camera Enhance',
      body: 'Fix exposure, grain, shake, motion — apply a look, export. **Nielsen H2 — Match with the real world:** the sliders map 1:1 to the captions they would have in a NLE (exposure, grain, hot pivot, denoise).',
      href: '/camera-enhance',
    },
    {
      id: 'marketplace', heuristic: 'standards',
      badge: 'H4', title: 'Marketplace',
      body: 'Discover, claim, and remix curated SWR packs. **Nielsen H4 — Consistency and standards:** every pack is the same .swr-set ZIP; importing through `/api/library/sign-download` reads the same manifest anywhere.',
      href: '/marketplace',
    },
    {
      id: 'site-map', heuristic: 'documentation',
      badge: 'H10', title: 'Full site map',
      body: 'Every page on the site, with search and filters. **Nielsen H10 — Help and documentation:** this is the help surface; everything in the IA is reachable in one click from here.',
      href: '/sitemap',
    },
  ];

  // ---- state ------------------------------------------------------------

  const STORAGE_KEY = 'swr.tour.progress.v1';
  let progress = loadProgress();
  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (_) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (_) {}
  }

  // ---- DOM --------------------------------------------------------------

  const stepsEl = document.getElementById('t-steps');
  const meterEl = document.getElementById('t-meter');
  const labelEl = document.getElementById('t-label');
  const endcap  = document.getElementById('t-endcap');
  const endMeta = document.getElementById('t-endcap-meta');
  if (!stepsEl || !meterEl || !labelEl) return;

  STOPS.forEach((s, i) => {
    const div = document.createElement('section');
    div.className = 'step-card';
    div.id = 't-stop-' + s.id;
    div.dataset.index = String(i);
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="meta">
        <span class="badge" title="Jakob Nielsen heuristic">${s.badge}</span>
        <span>${s.heuristic ? 'Nielsen ' + s.heuristic + ' · ' : ''}stop ${String(i + 1).padStart(2, '0')}</span>
      </div>
      <h2><span class="marker">→</span> ${s.title}</h2>
      <p>${formatBody(s.body)}</p>
      <div class="nav">
        <a class="primary target" href="${s.href}" data-href="${s.href}" data-id="${s.id}" target="_blank" rel="noopener">Open</a>
      </div>
    `;
    stepsEl.appendChild(div);
  });

  function refresh() {
    let done = 0;
    STOPS.forEach((s, i) => {
      const card = document.getElementById('t-stop-' + s.id);
      if (!card) return;
      const visited = !!progress[s.id];
      card.classList.toggle('done', visited);
      card.classList.toggle('active', !visited && i === done);
      if (visited) done++;
    });
    const total = STOPS.length;
    const pct = Math.round((done / total) * 100);
    meterEl.style.width = pct + '%';
    labelEl.textContent = done + ' / ' + total;
    if (done === total) {
      endcap.hidden = false;
      endMeta.textContent = 'Progress saved locally. Reset to start again.';
    } else {
      endcap.hidden = true;
    }
  }

  // ---- sweep ------------------------------------------------------------

  const sweepBtn = document.getElementById('t-sweep');
  const stepBtn  = document.getElementById('t-step');
  const resetBtn = document.getElementById('t-reset');

  // Tiny body formatter: **bold** → <strong>, escape everything else.
  // The tour body strings are author-controlled so HTML injection
  // from the in-page route table isn't a concern here.
  function formatBody(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  async function sweep() {
    sweepBtn.disabled = true;
    stepBtn.disabled = true;
    sweepBtn.textContent = 'Sweep in progress…';
    const SWEEP_DELAY_MS = 900; // give the new tab a moment to start
    const focusNextId = (i) => STOPS[i] && STOPS[i].id;
    for (let i = 0; i < STOPS.length; i++) {
      const s = STOPS[i];
      const a = document.querySelector('a[data-id="' + s.id + '"]');
      if (a) {
        progress[s.id] = Date.now();
        saveProgress();
        refresh();
        window.open(a.href, '_blank', 'noopener,noreferrer');
      }
      // Pause between stops; let the user stop the sweep with Esc.
      await new Promise((resolve) => {
        const t = setTimeout(resolve, SWEEP_DELAY_MS);
        document.addEventListener('keydown', function onEsc(ev) {
          if (ev.key === 'Escape') {
            clearTimeout(t);
            document.removeEventListener('keydown', onEsc);
            resolve('stopped');
          }
        }, { once: true });
      }).then((reason) => {
        if (reason === 'stopped') return 'aborted';
      });
      if (s === focusNextId(i)) { /* keep going */ }
    }
    sweepBtn.disabled = false;
    stepBtn.disabled = false;
    sweepBtn.textContent = '▶ Sweep (sequential)';
    refresh();
  }

  function stepOnce() {
    const next = STOPS.find((s) => !progress[s.id]);
    if (!next) return;
    progress[next.id] = Date.now();
    saveProgress();
    refresh();
    const a = document.querySelector('a[data-id="' + next.id + '"]');
    if (a) window.open(a.href, '_blank', 'noopener,noreferrer');
  }

  function reset() {
    progress = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    refresh();
  }

  // open links count as visited as soon as the user clicks them
  stepsEl.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[data-id]');
    if (a) {
      progress[a.dataset.id] = Date.now();
      saveProgress();
      // No need to refresh — the link opens a new tab and the user
      // returns to flip progress visually. Still safe to refresh.
      setTimeout(refresh, 0);
    }
  });

  if (sweepBtn) sweepBtn.addEventListener('click', sweep);
  if (stepBtn)  stepBtn.addEventListener('click', stepOnce);
  if (resetBtn) resetBtn.addEventListener('click', reset);

  refresh();
  window.SWR_TOUR = { stops: STOPS, get progress() { return Object.assign({}, progress); }, reset };
})();
