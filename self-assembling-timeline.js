// self-assembling-timeline.js
// Compact on-screen section timeline for the Self-Assembling Director.
//
// Drop in after self-assembling-wire.js:
//   <script src="/self-assembling-timeline.js"></script>
//
// Renders a slim bar at the bottom of the stage showing the song structure.
// Current section is highlighted. Hover shows reason. Click a block to seek.
// Toggle with the small "SA" pill or console:
//   SWR_SELF_ASSEMBLING_TIMELINE.toggle()

(function () {
  if (window.SWR_SELF_ASSEMBLING_TIMELINE) return;
  window.SWR_SELF_ASSEMBLING_TIMELINE = true;

  const COLORS = {
    intro:        '#5a4a6a',
    verse:        '#3a2a4a',
    prechorus:    '#ff3d92',
    chorus:       '#ff3d92',
    drop:         '#00e5ff',
    breakdown:    '#1a1226',
    bridge:       '#ffd24a',
    outro:        '#5a4a6a',
    instrumental: '#00ffa3',
    unknown:      '#2a1d3a',
  };

  function getAudio() {
    return window.Audio || (window.SWR && window.SWR.Audio) || null;
  }

  function getPlan() {
    return window.SWR_SELF_ASSEMBLING && window.SWR_SELF_ASSEMBLING.plan;
  }

  // ─── DOM — dock inside the stage ──────────────────────────────────────
  function findStage() {
    return document.getElementById('stage') ||
           document.getElementById('basic-stage') ||
           document.querySelector('[id*="stage"]');
  }

  const root = document.createElement('div');
  root.id = 'sa-timeline';
  root.style.cssText = `
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    height: 32px;
    background: rgba(5, 3, 8, 0.82);
    border: 1px solid #2a1d3a;
    border-radius: 4px;
    backdrop-filter: blur(6px);
    z-index: 20;
    display: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: #f5e9ff;
    overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    pointer-events: auto;
  `;

  const track = document.createElement('div');
  track.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    align-items: stretch;
  `;
  root.appendChild(track);

  const playhead = document.createElement('div');
  playhead.style.cssText = `
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    background: #fff;
    box-shadow: 0 0 6px #fff;
    pointer-events: none;
    z-index: 2;
    left: 0%;
  `;
  root.appendChild(playhead);

  const label = document.createElement('div');
  label.style.cssText = `
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 3;
    pointer-events: none;
    text-shadow: 0 1px 2px #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: calc(100% - 16px);
  `;
  root.appendChild(label);

  const tooltip = document.createElement('div');
  tooltip.id = 'sa-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    background: rgba(5, 3, 8, 0.95);
    border: 1px solid #ff3d92;
    border-radius: 4px;
    padding: 6px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: #f5e9ff;
    pointer-events: none;
    z-index: 50;
    display: none;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    line-height: 1.4;
  `;
  document.body.appendChild(tooltip);

  function showTooltip(sec, x, y) {
    const reason = sec.reason || `${sec.label} · prefers ${sec.persona}`;
    const dur = (sec.end - sec.start).toFixed(1);
    tooltip.innerHTML = `
      <div style="color:#ff3d92;font-weight:bold">${sec.label.toUpperCase()}</div>
      <div>${sec.persona} · ${(sec.intensity * 100).toFixed(0)}%</div>
      <div style="opacity:0.7">${dur}s · energy ${(sec.energy || 0).toFixed(2)}</div>
      <div style="opacity:0.55;margin-top:2px">${reason}</div>
    `;
    tooltip.style.display = 'block';
    const rect = tooltip.getBoundingClientRect();
    let left = x + 12;
    let top = y - rect.height - 8;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - 12;
    if (top < 8) top = y + 16;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = 'SA';
  toggleBtn.title = 'Toggle Self-Assembling timeline';
  toggleBtn.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    background: #11091a;
    color: #ff3d92;
    border: 1px solid #ff3d92;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 9px;
    font-family: inherit;
    cursor: pointer;
    z-index: 21;
    opacity: 0.75;
  `;
  toggleBtn.addEventListener('click', () => {
    const visible = root.style.display !== 'none';
    root.style.display = visible ? 'none' : 'block';
    toggleBtn.style.opacity = visible ? '0.4' : '1';
    if (visible) hideTooltip();
  });

  function mount() {
    const stage = findStage();
    if (stage) {
      if (getComputedStyle(stage).position === 'static') {
        stage.style.position = 'relative';
      }
      stage.appendChild(root);
      stage.appendChild(toggleBtn);
    } else {
      // fallback to body if stage isn't ready yet
      document.body.appendChild(root);
      document.body.appendChild(toggleBtn);
      root.style.position = 'fixed';
      root.style.bottom = '52px';
      root.style.left = '50%';
      root.style.right = 'auto';
      root.style.transform = 'translateX(-50%)';
      root.style.width = 'min(720px, 90vw)';
      toggleBtn.style.position = 'fixed';
      toggleBtn.style.bottom = '94px';
      toggleBtn.style.right = 'auto';
      toggleBtn.style.left = '50%';
      toggleBtn.style.transform = 'translateX(-50%)';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // ─── Render ───────────────────────────────────────────────────────────
  function renderPlan(plan) {
    track.innerHTML = '';
    if (!plan || !plan.sections || !plan.sections.length) {
      root.style.display = 'none';
      return;
    }
    root.style.display = 'block';
    const total = plan.duration || plan.sections[plan.sections.length - 1].end || 1;

    plan.sections.forEach((sec, i) => {
      const el = document.createElement('div');
      const w = ((sec.end - sec.start) / total) * 100;
      const color = COLORS[sec.label] || COLORS.unknown;
      el.style.cssText = `
        flex: 0 0 ${w}%;
        background: ${color};
        opacity: 0.55;
        border-right: 1px solid rgba(0,0,0,0.4);
        position: relative;
        cursor: pointer;
        transition: opacity 0.15s;
      `;
      el.dataset.start = sec.start;
      el.dataset.idx = i;

      el.addEventListener('click', () => {
        const audio = getAudio();
        if (audio && audio.audioEl && isFinite(audio.audioEl.duration)) {
          const t = parseFloat(el.dataset.start);
          audio.audioEl.currentTime = Math.min(t, audio.audioEl.duration - 0.1);
          if (audio.externalEl && audio.audioSource === 'external') {
            audio.externalEl.currentTime = t;
          }
        }
      });

      el.addEventListener('mouseenter', (ev) => {
        el.style.opacity = '0.9';
        const p = getPlan();
        if (p && p.sections[i]) showTooltip(p.sections[i], ev.clientX, ev.clientY);
      });

      el.addEventListener('mousemove', (ev) => {
        if (tooltip.style.display === 'block') {
          const rect = tooltip.getBoundingClientRect();
          let left = ev.clientX + 12;
          let top = ev.clientY - rect.height - 8;
          if (left + rect.width > window.innerWidth - 8) left = ev.clientX - rect.width - 12;
          if (top < 8) top = ev.clientY + 16;
          tooltip.style.left = left + 'px';
          tooltip.style.top = top + 'px';
        }
      });

      el.addEventListener('mouseleave', () => {
        if (!el.classList.contains('active')) el.style.opacity = '0.55';
        hideTooltip();
      });

      track.appendChild(el);
    });
  }

  function updatePlayhead() {
    const plan = getPlan();
    const audio = getAudio();
    if (!plan || !audio || !audio.playing) return;

    const t = audio.clock || 0;
    const total = plan.duration || 1;
    const pct = Math.min(100, Math.max(0, (t / total) * 100));
    playhead.style.left = pct + '%';

    const sections = plan.sections || [];
    let activeIdx = -1;
    for (let i = 0; i < sections.length; i++) {
      if (t >= sections[i].start && t < sections[i].end) {
        activeIdx = i;
        break;
      }
    }

    const bars = track.children;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (i === activeIdx) {
        bar.classList.add('active');
        bar.style.opacity = '1';
        bar.style.boxShadow = 'inset 0 0 0 1px #fff';
      } else {
        bar.classList.remove('active');
        bar.style.opacity = '0.55';
        bar.style.boxShadow = 'none';
      }
    }

    if (activeIdx >= 0) {
      const s = sections[activeIdx];
      label.textContent = `${s.label.toUpperCase()}  ·  ${s.persona}  ·  ${(s.intensity * 100).toFixed(0)}%`;
    } else {
      label.textContent = '';
    }
  }

  // ─── Loop ─────────────────────────────────────────────────────────────
  let lastPlanRef = null;
  function loop() {
    const plan = getPlan();
    if (plan !== lastPlanRef) {
      lastPlanRef = plan;
      renderPlan(plan);
    }
    updatePlayhead();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Public
  window.SWR_SELF_ASSEMBLING_TIMELINE = {
    toggle() { toggleBtn.click(); },
    show() { root.style.display = 'block'; },
    hide() { root.style.display = 'none'; hideTooltip(); },
  };

  console.log('[self-assembling] timeline ready (with hover reasons)');
})();
