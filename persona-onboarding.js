// persona-onboarding.js — 3-path persona selector for first-time visitors
//
// Shows a 3-card overlay once per browser (localStorage gate). Selecting
// a persona navigates to the engine with a recommended engine pre-set.
// The 3 personas map to the 3 target audiences (Designers / Musicians
// / Mixed-media creators) and pick the best-fit engine as a starting
// point. The user can switch engines anytime in the engine UI.
//
// USAGE:
//   <script src="/persona-onboarding.js" defer></script>
//   <div id="persona-onboarding"></div>     <!-- where the modal mounts -->
//
// The script auto-injects the modal UI into #persona-onboarding if
// present, or into document.body otherwise. Triggers automatically on
// DOMContentLoaded unless a persona has already been chosen.

(function () {
  if (window.SWR_PERSONA) return; // idempotent

  // Recommendation map. Each persona = { name, tagline, desc, engine, cta }.
  // The engine URL is where the user lands. FX + auto-map recommendations
  // would be applied after engine load (TODO if needed).
  const PERSONAS = [
    {
      id: 'musician',
      name: 'Musician',
      emoji: '♪',
      tagline: 'Drop a song, get a music video.',
      desc: 'You have a track. SWR makes it a video — 13 visual engines, all audio-reactive. No footage needed if you just want a pure-spectrum visualizer.',
      engine: 'spectrum',
      engineLabel: 'Spectrum',
      hint: 'best for: pure-audio tracks, EPs, singles',
      accent: '#ff6090',
    },
    {
      id: 'designer',
      name: 'Designer',
      emoji: '◼',
      tagline: 'Drop your brand kit, get motion.',
      desc: 'You have assets. SWR animates them — typography, brand-safe loops, mixed-media grids. Drag in type, logos, video clips; tell the engine what to do with them.',
      engine: 'typography',
      engineLabel: 'Typography',
      hint: 'best for: brand motion, social clips, IG stories',
      accent: '#ff3030',
    },
    {
      id: 'mixed',
      name: 'Mixed-media',
      emoji: '✦',
      tagline: 'Video + audio + type, layered.',
      desc: 'You have both. SWR does collage, magazine grid, beat-synced cuts. Best for music videos, lyric videos, social pieces where every element is reacting.',
      engine: 'collage',
      engineLabel: 'Collage',
      hint: 'best for: music videos, lyric videos, mixed reels',
      accent: '#d8232a',
    },
  ];

  const STORAGE_KEY = 'swr.persona.v1';

  function alreadyChosen() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
  }
  function recordChoice(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: p.id, name: p.name, engine: p.engine, chosenAt: new Date().toISOString()
    })); } catch (e) { /* private mode */ }
  }
  function getChosen() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function renderModal() {
    // Build DOM
    const root = document.getElementById('persona-onboarding') || document.body;
    const wrap = document.createElement('div');
    wrap.id = 'persona-onboarding-modal';
    wrap.className = 'swr-persona-modal';
    wrap.innerHTML = `
      <style>
        .swr-persona-modal { position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
          font-family: 'Inter', system-ui, sans-serif; color: #fff; }
        .swr-persona-modal .panel { max-width: 920px; width: 92%; padding: 36px 32px 28px;
          background: #0d0d10; border: 1px solid #1a1a1f; border-radius: 6px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.5); }
        .swr-persona-modal h1 { font: 800 24px/1.1 'Inter', sans-serif; margin: 0 0 6px; }
        .swr-persona-modal p.sub { font-size: 13px; opacity: 0.65; margin: 0 0 24px; }
        .swr-persona-modal .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .swr-persona-modal .card { display: flex; flex-direction: column; gap: 8px;
          padding: 18px; background: #14141a; border: 1px solid #1a1a22; border-radius: 4px;
          cursor: pointer; transition: all 0.15s ease; text-align: left;
          font-family: inherit; color: inherit; }
        .swr-persona-modal .card:hover { transform: translateY(-2px);
          border-color: var(--accent, #fff); background: #18181f; }
        .swr-persona-modal .card .emoji { font-size: 32px; line-height: 1; }
        .swr-persona-modal .card .name { font: 800 18px/1 'Inter', sans-serif; margin: 0; }
        .swr-persona-modal .card .tag { font: 600 11px/1 'Inter', sans-serif; opacity: 0.85; margin: 0; }
        .swr-persona-modal .card .desc { font-size: 12px; line-height: 1.45; opacity: 0.75; margin: 4px 0 0; }
        .swr-persona-modal .card .hint { font: 9px/1.3 'Inter', sans-serif; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.1em; margin-top: auto; }
        .swr-persona-modal .footer { display: flex; justify-content: space-between; align-items: center;
          margin-top: 22px; padding-top: 18px; border-top: 1px solid #1a1a22;
          font-size: 11px; opacity: 0.55; }
        .swr-persona-modal .footer button { font: 500 11px/1 'Inter', sans-serif; letter-spacing: 0.1em;
          text-transform: uppercase; padding: 8px 14px; background: transparent;
          color: #fff; border: 1px solid #2a2a2a; border-radius: 3px; cursor: pointer; }
        .swr-persona-modal .footer button:hover { border-color: #fff; }
        @media (max-width: 720px) { .swr-persona-modal .grid { grid-template-columns: 1fr; } }
      </style>
      <div class="panel">
        <h1>What are you making today?</h1>
        <p class="sub">Pick the path that fits. You can switch engines anytime.</p>
        <div class="grid">
          ${PERSONAS.map(p => `
            <button class="card" data-persona="${p.id}" style="--accent: ${p.accent}">
              <div class="emoji">${p.emoji}</div>
              <h2 class="name">${p.name}</h2>
              <p class="tag">${p.tagline}</p>
              <p class="desc">${p.desc}</p>
              <p class="hint">${p.hint}</p>
            </button>
          `).join('')}
        </div>
        <div class="footer">
          <span>This shows once. You can change persona from the engine menu later.</span>
          <button data-action="skip">Skip for now →</button>
        </div>
      </div>
    `;
    // Replace existing content (or append)
    if (root.id === 'persona-onboarding') {
      root.innerHTML = '';
      root.appendChild(wrap.firstElementChild);  // style
      root.appendChild(wrap.lastElementChild);   // panel
    } else {
      root.appendChild(wrap);
    }
  }

  function show() {
    if (alreadyChosen()) return false; // don't show if already chosen
    renderModal();
    const modal = document.getElementById('persona-onboarding-modal');
    if (!modal) return false;
    // Wire clicks
    modal.querySelectorAll('[data-persona]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.persona;
        const p = PERSONAS.find(x => x.id === id);
        if (!p) return;
        recordChoice(p);
        // Navigate to the engine page
        const target = '/versions/' + p.engine + '.html';
        window.location.href = target;
      });
    });
    modal.querySelector('[data-action="skip"]').addEventListener('click', () => {
      // Mark as "skipped" so we don't re-prompt; user can reset via SWR_PERSONA.reset()
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'skipped', skippedAt: new Date().toISOString() })); } catch (e) {}
      modal.remove();
    });
    return true;
  }

  // Public API
  window.SWR_PERSONA = {
    show,
    hide: () => {
      const m = document.getElementById('persona-onboarding-modal');
      if (m) m.remove();
    },
    reset: clear,
    getChosen,
    PERSONAS,
  };

  // Auto-show on first load (no choice yet)
  function init() {
    if (alreadyChosen()) return;
    show();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();