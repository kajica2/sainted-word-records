// Remix Studio (Phase 3): progressive enhancement over the existing engine.
// Decode user-selected loops locally, plan candidate arrangements, render one
// selected candidate, and send the WAV to the existing Audio clock + analyzer.
import { planRemix } from '../remix-planner.js';
import { renderRemix, encodeWav } from '../remix-renderer.js';
import { describeLoop, validateLoopFiles } from '../remix-workflow.js';

const host = document.getElementById('transport');
if (host && !document.getElementById('swr-remix-open')) {

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.id = 'swr-remix-open';
  launch.className = 'tbtn ghost';
  launch.textContent = '✦ Remix Studio';
  launch.title = 'Turn short loops into longer music and drive the visual engine';
  const songButton = document.getElementById('load-song');
  songButton?.after(launch);

  const modal = document.createElement('section');
  modal.id = 'swr-remix-dialog';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'swr-remix-title');
  modal.innerHTML = [
    "<div class=\"swr-remix-box\" role=\"document\">",
    "  <header class=\"swr-remix-head\">",
    "    <div class=\"swr-remix-head-main\">",
    "      <span class=\"swr-remix-mark\" aria-hidden=\"true\">✳</span>",
    "      <div>",
    "        <div class=\"swr-remix-eyebrow\">Sainted Word Records / Creative Instruments</div>",
    "        <h2 id=\"swr-remix-title\">Remix <em>Studio.</em></h2>",
    "        <p>Cut, reshape and extend ideas. From fragments to a full arrangement.</p>",
    "      </div>",
    "    </div>",
    "    <div class=\"swr-remix-head-actions\">",
    "      <span class=\"swr-remix-live\">LOCAL SESSION</span>",
    "      <button type=\"button\" class=\"swr-remix-close\" data-remix=\"close\" aria-label=\"Close Remix Studio\" title=\"Close (Esc)\">×</button>",
    "    </div>",
    "  </header>",
    "  <nav class=\"swr-remix-stages\" aria-label=\"Remix workflow\">",
    "    <span class=\"swr-remix-stage\" data-rx-stage=\"1\" data-active=\"true\"><b>01</b> Import loops</span>",
    "    <span class=\"swr-remix-arrow\" aria-hidden=\"true\">›</span>",
    "    <span class=\"swr-remix-stage\" data-rx-stage=\"2\"><b>02</b> Compose</span>",
    "    <span class=\"swr-remix-arrow\" aria-hidden=\"true\">›</span>",
    "    <span class=\"swr-remix-stage\" data-rx-stage=\"3\"><b>03</b> Render &amp; listen</span>",
    "    <span class=\"swr-remix-arrow\" aria-hidden=\"true\">›</span>",
    "    <span class=\"swr-remix-stage\" data-rx-stage=\"4\"><b>04</b> Visualize</span>",
    "  </nav>",
    "  <div class=\"swr-remix-content\">",
    "    <aside class=\"swr-remix-pane swr-remix-pane--sources\" aria-label=\"Source loop library\">",
    "      <span class=\"swr-remix-section-label\">01 / MATERIAL</span>",
    "      <h3>Source rack</h3>",
    "      <p class=\"swr-remix-description\">Your sounds are the raw material. Each color belongs to one imported loop.</p>",
    "      <label class=\"swr-remix-drop\">",
    "        <span class=\"swr-remix-drop-icon\" aria-hidden=\"true\">⇧</span>",
    "        <strong>Drop loops to start</strong>",
    "        <small>Or choose files from your device</small>",
    "        <input id=\"swr-remix-files\" type=\"file\" multiple aria-label=\"Choose audio loops\" accept=\"audio/*,.wav,.mp3,.m4a,.aac,.flac,.aif,.aiff,.ogg,.opus,.webm\">",
    "      </label>",
    "      <p class=\"swr-remix-foot\">Up to 8 audio loops · 50 MB each · 180s max per source. Importing a new batch replaces the rack.</p>",
    "      <div class=\"swr-remix-subrow\">",
    "        <span class=\"swr-remix-sub\">Loaded material</span>",
    "        <span class=\"swr-remix-count\" id=\"swr-remix-source-count\">0 / 8 loops</span>",
    "      </div>",
    "      <ul class=\"swr-remix-loops\" id=\"swr-remix-loops\">",
    "        <li class=\"swr-remix-empty\">Your source loops will appear here with miniature waveforms.</li>",
    "      </ul>",
    "      <p class=\"swr-remix-session-note\">Decoded locally. No cloud upload. The original source files are not modified.</p>",
    "    </aside>",
    "    <section class=\"swr-remix-pane swr-remix-pane--canvas\" aria-label=\"Arrangements and timeline\">",
    "      <div class=\"swr-remix-canvas-head\">",
    "        <div>",
    "          <span class=\"swr-remix-section-label\">02 / COMPOSITION</span>",
    "          <h3>Arrangement canvas</h3>",
    "        </div>",
    "        <span class=\"swr-remix-dur-tag\" id=\"swr-remix-dur-tag\">03:00 TARGET</span>",
    "      </div>",
    "      <p class=\"swr-remix-description\">Four seeded takes. Pick a direction, listen, then send it to your visuals.</p>",
    "      <div class=\"swr-remix-subrow\">",
    "        <span class=\"swr-remix-sub\">Generated takes</span>",
    "        <span class=\"swr-remix-count\">A / B / C / D</span>",
    "      </div>",
    "      <div class=\"swr-remix-candidates\" id=\"swr-remix-candidates\" role=\"group\" aria-label=\"Arrangement candidates\">",
    "        <div class=\"swr-remix-empty-arrangement\">Add source loops and choose Generate to discover four new variations.</div>",
    "      </div>",
    "      <div class=\"swr-remix-timeline-shell\">",
    "        <div class=\"swr-remix-timeline-header\">",
    "          <strong>Composition timeline</strong>",
    "          <span id=\"swr-remix-cut-info\">Awaiting a take</span>",
    "        </div>",
    "        <div class=\"swr-remix-ruler\" aria-hidden=\"true\">",
    "          <span>00:00</span><span id=\"swr-remix-midpoint\">01:30</span><span id=\"swr-remix-endpoint\">03:00</span>",
    "        </div>",
    "        <div class=\"swr-remix-track\" id=\"swr-remix-track\" aria-label=\"Empty arrangement map\" role=\"img\"></div>",
    "        <div class=\"swr-remix-energy-head\"><span>ENERGY CONTOUR</span><span>quiet → intense → release</span></div>",
    "        <svg id=\"swr-remix-energy\" class=\"swr-remix-energy-svg\" viewBox=\"0 0 800 108\" preserveAspectRatio=\"none\" role=\"img\" aria-label=\"Energy contour of selected remix\">",
    "          <line x1=\"0\" x2=\"800\" y1=\"28\" y2=\"28\"></line>",
    "          <line x1=\"0\" x2=\"800\" y1=\"54\" y2=\"54\"></line>",
    "          <line x1=\"0\" x2=\"800\" y1=\"80\" y2=\"80\"></line>",
    "          <polyline id=\"swr-remix-energy-line\" points=\"\"></polyline>",
    "        </svg>",
    "      </div>",
    "      <div class=\"swr-remix-summary\" aria-label=\"Arrangement statistics\">",
    "        <div><strong id=\"swr-remix-stat-cuts\">—</strong><small>Loop events</small></div>",
    "        <div><strong id=\"swr-remix-stat-sources\">—</strong><small>Source colors</small></div>",
    "        <div><strong id=\"swr-remix-stat-length\">—</strong><small>Length</small></div>",
    "      </div>",
    "    </section>",
    "    <aside class=\"swr-remix-pane swr-remix-pane--controls\" aria-label=\"Remix parameters\">",
    "      <span class=\"swr-remix-section-label\">03 / DIRECTION</span>",
    "      <h3>Shape the music</h3>",
    "      <p class=\"swr-remix-description\">Choose the space and level of experimentation. These controls shape the arrangement, not the sound.</p>",
    "      <div class=\"swr-remix-grid\">",
    "        <label>",
    "          <span>Target duration <output id=\"swr-remix-duration-display\">03:00</output></span>",
    "          <input id=\"swr-remix-duration\" type=\"number\" min=\"5\" max=\"600\" step=\"5\" value=\"180\">",
    "          <div class=\"swr-remix-presets\" role=\"group\" aria-label=\"Duration presets\">",
    "            <button type=\"button\" data-duration=\"60\">1 min</button>",
    "            <button type=\"button\" data-duration=\"180\">3 min</button>",
    "            <button type=\"button\" data-duration=\"300\">5 min</button>",
    "          </div>",
    "        </label>",
    "        <label>",
    "          <span>Tempo in BPM <small>optional</small></span>",
    "          <input id=\"swr-remix-bpm\" type=\"number\" min=\"40\" max=\"240\" step=\"1\" value=\"105\" aria-describedby=\"swr-remix-bpm-note\">",
    "          <small id=\"swr-remix-bpm-note\" class=\"swr-remix-foot\">Used for cut alignment, not tempo shifting.</small>",
    "        </label>",
    "        <label>",
    "          <span>Creative intensity <output id=\"swr-remix-creativity-display\">65%</output></span>",
    "          <input id=\"swr-remix-creativity\" type=\"range\" min=\"0\" max=\"100\" value=\"65\">",
    "          <div class=\"swr-remix-presets\" role=\"group\" aria-label=\"Creative intensity presets\">",
    "            <button type=\"button\" data-creativity=\"20\">Subtle</button>",
    "            <button type=\"button\" data-creativity=\"65\">Exploratory</button>",
    "            <button type=\"button\" data-creativity=\"95\">Wild</button>",
    "          </div>",
    "        </label>",
    "        <label>",
    "          <span>Variation seed <small>reproducible</small></span>",
    "          <input id=\"swr-remix-seed\" type=\"number\" min=\"1\" max=\"4294967295\" step=\"1\" value=\"43172\">",
    "          <div class=\"swr-remix-presets\"><button type=\"button\" data-remix=\"shuffle\">↻ New seed</button></div>",
    "        </label>",
    "      </div>",
    "      <div class=\"swr-remix-actions\">",
    "        <button type=\"button\" class=\"primary\" data-remix=\"generate\" disabled>✳ Generate four takes</button>",
    "      </div>",
    "      <div class=\"swr-remix-control-note\">No artificial audio filters. No pitch or tempo changes. The current engine reuses the same musical clock when you send a rendered take to your visuals.</div>",
    "    </aside>",
    "  </div>",
    "  <footer class=\"swr-remix-bottom\">",
    "    <div>",
    "      <span class=\"swr-remix-bottom-label\">SESSION STATUS</span>",
    "      <p class=\"swr-remix-status\" role=\"status\" aria-live=\"polite\" id=\"swr-remix-status\">Import your audio loops to begin.</p>",
    "    </div>",
    "    <div>",
    "      <audio class=\"swr-remix-preview\" id=\"swr-remix-preview\" controls preload=\"none\" hidden aria-label=\"Rendered arrangement preview\"></audio>",
    "      <div class=\"swr-remix-bottom-note\" id=\"swr-remix-preview-hint\">Preview player becomes available after rendering.</div>",
    "    </div>",
    "    <div class=\"swr-remix-bottom-actions\">",
    "      <button type=\"button\" data-remix=\"render\" disabled>◎ Render take</button>",
    "      <button type=\"button\" data-remix=\"download\" disabled>↓ WAV</button>",
    "      <button type=\"button\" class=\"primary\" data-remix=\"send\" disabled>↗ Visual engine</button>",
    "    </div>",
    "  </footer>",
    "</div>",
  ].join('\n');
  document.body.appendChild(modal);

  const $ = id => document.getElementById(id);
  const fileInput = $('swr-remix-files');
  const loopList = $('swr-remix-loops');
  const candidatesHost = $('swr-remix-candidates');
  const track = $('swr-remix-track');
  const status = $('swr-remix-status');
  const preview = $('swr-remix-preview');
  const generateButton = modal.querySelector('[data-remix=generate]');
  const renderButton = modal.querySelector('[data-remix=render]');
  const sendButton = modal.querySelector('[data-remix=send]');
  const downloadButton = modal.querySelector('[data-remix=download]');
  const state = { buffers: new Map(), loops: [], plans: [], selected: 0, busy: false, rendered: -1, file: null, url: null };
  let restoreFocus = null;
  const stages = Array.from(modal.querySelectorAll('[data-rx-stage]'));
  const count = $('swr-remix-source-count');
  const energyLine = $('swr-remix-energy-line');
  const previewHint = $('swr-remix-preview-hint');
  const swatches = ['#ff79bd', '#64d8dc', '#f6c773', '#b69afd', '#6ddfa6', '#ef9776', '#829fff', '#ecaddc'];
  const formatTime = value => {
    const secs = Math.max(0, Math.round(value || 0));
    return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
  };
  function updateSteps() {
    const active = state.rendered === state.selected && state.file ? 4
      : state.plans.length ? 3 : state.loops.length ? 2 : 1;
    for (const step of stages) {
      const number = Number(step.dataset.rxStage);
      step.dataset.active = String(number === active);
      step.dataset.complete = String(number < active);
    }
  }
  function resetArrangements() {
    clearPreview();
    state.plans = [];
    state.selected = 0;
    candidatesHost.replaceChildren();
    const hint = document.createElement('div');
    hint.className = 'swr-remix-empty-arrangement';
    hint.textContent = 'Generate four arrangements from the loaded loops.';
    candidatesHost.appendChild(hint);
    showTrack();
    buttons();
  }
  function invalidateParameters() {
    if (!state.plans.length && !state.file) return;
    resetArrangements();
    tell('Parameters changed. Generate fresh arrangements.');
  }
  function renderMiniWave(buffer, container, color) {
    const data = buffer.getChannelData(0);
    const columns = 32;
    container.style.setProperty('--wave', color);
    for (let i = 0; i < columns; i++) {
      const begin = Math.floor(i * data.length / columns);
      const end = Math.max(begin + 1, Math.floor((i + 1) * data.length / columns));
      const stride = Math.max(1, Math.ceil((end - begin) / 200));
      let peak = 0;
      for (let k = begin; k < end; k += stride) peak = Math.max(peak, Math.abs(data[k] || 0));
      const bar = document.createElement('span');
      bar.style.height = Math.max(2, Math.round(Math.pow(peak, .6) * 100)) + '%';
      container.appendChild(bar);
    }
  }

  function tell(message, error = false) {
    status.textContent = message;
    status.style.color = error ? '#ff919e' : '#9eeadd';
  }
  function clearPreview() {
    preview.pause();
    preview.removeAttribute('src');
    preview.hidden = true;
    previewHint.textContent = 'Preview player becomes available after rendering.';
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    state.file = null;
    state.rendered = -1;
  }
  function buttons() {
    generateButton.disabled = state.busy || !state.loops.length;
    renderButton.disabled = state.busy || !state.plans.length;
    sendButton.disabled = state.busy || state.rendered !== state.selected || !state.file;
    downloadButton.disabled = sendButton.disabled;
    fileInput.disabled = state.busy;
    for (const button of modal.querySelectorAll('[data-duration],[data-creativity],[data-remix=shuffle]')) {
      button.disabled = state.busy;
    }
    updateSteps();
  }
  function openDialog() {
    restoreFocus = document.activeElement;
    modal.hidden = false;
    modal.querySelector('[data-remix=close]').focus();
  }
  function closeDialog() {
    modal.hidden = true;
    preview.pause();
    if (restoreFocus && typeof restoreFocus.focus === 'function') restoreFocus.focus();
  }
  function showLoops() {
    loopList.replaceChildren();
    count.textContent = state.loops.length + ' / 8 loops';
    state.loops.forEach((item, index) => {
      const li = document.createElement('li');
      const heading = document.createElement('div'); heading.className = 'swr-remix-loop-heading';
      const title = document.createElement('span'); title.className = 'swr-remix-loop-name';
      title.title = item.name; title.textContent = String(index + 1).padStart(2,'0') + '  ' + item.name;
      const duration = document.createElement('span'); duration.className = 'swr-remix-loop-duration';
      duration.textContent = formatTime(item.duration);
      heading.append(title, duration);
      const wave = document.createElement('div'); wave.className = 'swr-remix-wave';
      wave.setAttribute('aria-hidden', 'true');
      const buffer = state.buffers.get(item.id);
      if (buffer) renderMiniWave(buffer, wave, swatches[index % swatches.length]);
      const bottom = document.createElement('div'); bottom.className = 'swr-remix-loop-bottom';
      const sourceTag = document.createElement('span'); sourceTag.textContent = 'SOURCE ' + String(index + 1).padStart(2,'0');
      const energy = document.createElement('span'); energy.className = 'swr-remix-loop-energy';
      energy.textContent = 'ENERGY ' + Math.round(item.energy * 100) + '%';
      bottom.append(sourceTag, energy);
      li.append(heading, wave, bottom);
      loopList.appendChild(li);
    });
    if (!state.loops.length) {
      const li = document.createElement('li');
      li.className = 'swr-remix-empty';
      li.textContent = 'Your source loops will appear here with miniature waveforms.';
      loopList.appendChild(li);
    }
  }
  function showTrack() {
    track.replaceChildren();
    const plan = state.plans[state.selected];
    energyLine.setAttribute('points', '');
    $('swr-remix-cut-info').textContent = plan ? 'Take ' + (state.selected + 1) : 'Awaiting a take';
    $('swr-remix-stat-cuts').textContent = plan ? String(plan.events.length) : '—';
    $('swr-remix-stat-sources').textContent = plan ? String(new Set(plan.events.map(e => e.sourceId)).size) : '—';
    $('swr-remix-stat-length').textContent = plan ? formatTime(plan.duration) : '—';
    const duration = plan?.duration || Number($('swr-remix-duration').value) || 180;
    $('swr-remix-dur-tag').textContent = formatTime(duration) + ' TARGET';
    $('swr-remix-midpoint').textContent = formatTime(duration / 2);
    $('swr-remix-endpoint').textContent = formatTime(duration);
    if (!plan) {
      track.setAttribute('aria-label', 'Empty arrangement map');
      return;
    }
    const points = ['0,95'];
    for (const event of plan.events) {
      const segment = document.createElement('span');
      segment.style.flex = String(event.duration) + ' 0 0';
      const index = state.loops.findIndex(l => l.id === event.sourceId);
      segment.style.background = swatches[Math.max(0, index) % swatches.length];
      segment.title = (state.loops[index]?.name || event.sourceId) + ' · ' + formatTime(event.start);
      track.appendChild(segment);
      points.push((800 * (event.start + event.duration / 2) / plan.duration).toFixed(1) + ',' +
        (95 - event.energy * 80).toFixed(1));
    }
    points.push('800,95');
    energyLine.setAttribute('points', points.join(' '));
    track.setAttribute('aria-label', 'Arrangement ' + (state.selected + 1) + ' with ' + plan.events.length + ' loop events');
  }
  function selectCandidate(i) {
    if (state.busy) return;
    state.selected = i;
    clearPreview();
    for (const button of candidatesHost.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.index) === i));
    }
    showTrack();
    buttons();
    tell('Arrangement ' + (i + 1) + ' selected. Render to hear it.');
  }
  async function importFiles(files) {
    if (state.busy) return;
    let validated;
    try { validated = validateLoopFiles(files); }
    catch (e) { tell(e.message, true); return; }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { tell('Web Audio is not supported in this browser.', true); return; }
    state.busy = true; buttons(); resetArrangements();
    const context = new Context(), buffers = new Map(), loops = [];
    let decodedBytes = 0;
    try {
      for (let i = 0; i < validated.length; i++) {
        const file = validated[i];
        tell('Decoding ' + (i + 1) + '/' + validated.length + ': ' + file.name);
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        decodedBytes += buffer.length * buffer.numberOfChannels * 4;
        if (decodedBytes > 160 * 1024 * 1024) throw new Error('Decoded loops exceed the 160 MB memory budget');
        const id = 'loop-' + i;
        const loop = describeLoop(id, buffer);
        loops.push({ ...loop, name: file.name });
        buffers.set(id, buffer);
      }
      state.buffers = buffers;
      state.loops = loops;
      showLoops();
      tell('Ready: ' + loops.length + ' loop(s). Generate four arrangements.');
    } catch (e) {
      state.buffers = new Map();
      state.loops = [];
      showLoops();
      tell('Could not load loops: ' + e.message, true);
    } finally {
      try { await context.close(); } catch (_) {}
      state.busy = false; buttons();
    }
  }
  function generate() {
    if (state.busy || !state.loops.length) return;
    try {
      const seconds = Number($('swr-remix-duration').value);
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) throw new Error('Duration must be 5–600 seconds');
      const rawBpm = $('swr-remix-bpm').value.trim();
      const rawSeed = Number($('swr-remix-seed').value);
      if (!Number.isInteger(rawSeed) || rawSeed < 1 || rawSeed > 4294967295) throw new Error('Seed must be a whole number from 1 to 4294967295');
      const bpm = rawBpm === '' ? null : Number(rawBpm);
      if (bpm !== null && (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)) throw new Error('BPM must be 40–240');
      state.plans = planRemix(state.loops, {
        targetDuration: seconds, bpm,
        creativity: Number($('swr-remix-creativity').value) / 100,
        candidates: 4, seed: rawSeed,
      });
      clearPreview();
      candidatesHost.replaceChildren();
      state.plans.forEach((plan, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.index = String(i);
        const title = document.createElement('span');
        title.className = 'swr-remix-candidate-name';
        title.textContent = 'Take ' + String(i + 1).padStart(2, '0');
        const detail = document.createElement('span');
        detail.className = 'swr-remix-candidate-meta';
        detail.textContent = plan.events.length + ' events  ·  seed ' + plan.seed;
        button.append(title, detail);
        button.setAttribute('aria-pressed', String(i === 0));
        button.addEventListener('click', () => selectCandidate(i));
        candidatesHost.appendChild(button);
      });
      state.selected = 0;
      showTrack(); buttons();
      tell('Four seeded arrangements ready. Select a take and render it.');
    } catch (e) { tell(e.message, true); }
  }
  async function renderSelected() {
    if (state.busy || !state.plans.length) return;
    state.busy = true; buttons(); clearPreview();
    try {
      const plan = state.plans[state.selected];
      tell('Rendering take ' + (state.selected + 1) + ' locally. This may use significant memory.');
      const result = await renderRemix(plan, state.buffers, { sampleRate: 44100, channels: 2, fadeSeconds: 0.04 });
      const blob = encodeWav(result);
      state.file = new File([blob], 'sainted-remix-take-' + (state.selected + 1) + '.wav', { type: 'audio/wav' });
      state.url = URL.createObjectURL(blob);
      state.rendered = state.selected;
      preview.src = state.url;
      preview.hidden = false;
      previewHint.textContent = 'Local stereo WAV · ' + formatTime(plan.duration);
      tell('Take ' + (state.selected + 1) + ' rendered. Preview it or send it to the visual engine.');
    } catch (e) { tell('Render failed: ' + e.message, true); }
    finally { state.busy = false; buttons(); }
  }
  async function sendToEngine() {
    if (state.busy || !state.file || state.selected !== state.rendered) return;
    const engine = window.Audio;
    if (!engine || typeof engine.loadFile !== 'function') {
      tell('The Sainted Word audio engine is not ready.', true); return;
    }
    state.busy = true; buttons();
    try {
      preview.pause();
      // Keep an existing video: its picture will slave to this new master
      // audio, so recording and visual reactions use the SAME existing clock.
      if (engine.mediaIsVideo && typeof engine.loadExternalAudio === 'function') {
        await engine.loadExternalAudio(state.file);
      } else {
        await engine.loadFile(state.file);
      }
      const plan = state.plans[state.selected];
      window.SWR_REMIX_TIMELINE = { duration: plan.duration, bpm: plan.bpm, events: plan.events };
      window.dispatchEvent(new CustomEvent('swr:remix-loaded', { detail: window.SWR_REMIX_TIMELINE }));
      tell('Remix sent to the engine. Press ▶ Play in the transport.');
      closeDialog();
    } catch (e) { tell('Engine load failed: ' + e.message, true); }
    finally { state.busy = false; buttons(); }
  }
  function download() {
    if (!state.url || !state.file || state.selected !== state.rendered) return;
    const link = document.createElement('a');
    link.href = state.url;
    link.download = state.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  launch.addEventListener('click', openDialog);
  modal.querySelector('[data-remix=close]').addEventListener('click', closeDialog);
  modal.addEventListener('click', e => { if (e.target === modal) closeDialog(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    if (e.key === 'Tab') {
      const focusable = Array.from(modal.querySelectorAll('button:not(:disabled),input:not(:disabled),audio[controls]'))
        .filter(node => node.getClientRects().length && node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  fileInput.addEventListener('change', e => {
    const files = e.target.files;
    void importFiles(files);
    e.target.value = '';
  });
  const drop = modal.querySelector('.swr-remix-drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('is-drag-over');
    void importFiles(e.dataTransfer.files);
  });
  $('swr-remix-creativity').addEventListener('input', e => {
    $('swr-remix-creativity-display').textContent = e.target.value + '%';
    invalidateParameters();
  });
  $('swr-remix-duration').addEventListener('input', e => {
    $('swr-remix-duration-display').textContent = formatTime(Number(e.target.value));
    if (!state.plans.length) showTrack();
    invalidateParameters();
  });
  $('swr-remix-bpm').addEventListener('input', invalidateParameters);
  $('swr-remix-seed').addEventListener('input', invalidateParameters);
  for (const item of modal.querySelectorAll('[data-duration]')) {
    item.addEventListener('click', () => {
      const input = $('swr-remix-duration');
      input.value = item.dataset.duration;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  for (const item of modal.querySelectorAll('[data-creativity]')) {
    item.addEventListener('click', () => {
      const input = $('swr-remix-creativity');
      input.value = item.dataset.creativity;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  modal.querySelector('[data-remix=shuffle]').addEventListener('click', () => {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const input = $('swr-remix-seed');
    input.value = String(bytes[0] || 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  generateButton.addEventListener('click', generate);
  renderButton.addEventListener('click', () => void renderSelected());
  sendButton.addEventListener('click', () => void sendToEngine());
  downloadButton.addEventListener('click', download);
  showTrack();
  buttons();
}
