// Remix Studio (Phase 3): progressive enhancement over the existing engine.
// Decode user-selected loops locally, plan candidate arrangements, render one
// selected candidate, and send the WAV to the existing Audio clock + analyzer.
import { planRemix } from '../remix-planner.js';
import { renderRemix, encodeWav } from '../remix-renderer.js';
import { describeLoop, validateLoopFiles } from '../remix-workflow.js';

const host = document.getElementById('transport');
if (host && !document.getElementById('swr-remix-open')) {
  const styles = document.createElement('style');
  styles.id = 'swr-remix-studio-css';
  styles.textContent = [
    '#swr-remix-dialog[hidden]{display:none!important}',
    '#swr-remix-dialog{position:fixed;inset:0;z-index:25000;display:grid;place-items:center;padding:16px;background:rgba(3,2,8,.88);backdrop-filter:blur(8px);}',
    '.swr-remix-box{width:min(720px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#120e20;color:#f6eaff;border:1px solid #56416d;border-radius:16px;box-shadow:0 30px 100px #000c;padding:22px;font:13px/1.5 system-ui,sans-serif;}',
    '.swr-remix-head{display:flex;justify-content:space-between;gap:14px;align-items:start}.swr-remix-head h2{font-size:21px;margin:0 0 4px}.swr-remix-head p{margin:0;color:#b5a6c7}',
    '.swr-remix-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}',
    '.swr-remix-grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#d2c3e5}',
    '.swr-remix-grid input{width:100%;accent-color:#ff3d92;background:#251b37;color:#fff;border:1px solid #70547f;border-radius:7px;padding:8px}',
    '.swr-remix-drop{display:block;padding:18px;margin-top:16px;border:2px dashed #80558f;border-radius:10px;text-align:center;background:#1b1328;cursor:pointer}',
    '.swr-remix-drop:hover,.swr-remix-drop:focus-within{border-color:#ff3d92}',
    '.swr-remix-drop input{width:100%;max-width:360px;margin:8px auto 0;display:block;font-size:12px}',
    '.swr-remix-sub{font-size:12px;color:#bdaccd;margin:12px 0 5px}.swr-remix-loops{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}',
    '.swr-remix-loops li{background:#30213e;border:1px solid #5a3f69;border-radius:9px;padding:5px 9px;font-size:11px;max-width:100%;overflow-wrap:anywhere}',
    '.swr-remix-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.swr-remix-actions button,.swr-remix-actions a,.swr-remix-candidates button{background:#2c1c3e;color:#fff;border:1px solid #6a4c7c;border-radius:8px;padding:9px 12px;cursor:pointer;text-decoration:none;font:inherit}',
    '.swr-remix-actions button.primary{background:#ff3d92;border-color:#ff3d92;color:#160816;font-weight:700}',
    '.swr-remix-actions :disabled,.swr-remix-candidates :disabled{opacity:.4;cursor:not-allowed}',
    '.swr-remix-candidates{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}',
    '.swr-remix-candidates button[aria-pressed=true]{outline:2px solid #00e5ff;background:#49305a}',
    '.swr-remix-track{height:28px;display:flex;width:100%;overflow:hidden;border-radius:6px;background:#140c1c;margin-top:10px}',
    '.swr-remix-track span{height:100%;min-width:1px;border-right:1px solid #180b26;opacity:.9}',
    '.swr-remix-preview{width:100%;margin-top:12px;accent-color:#ff3d92}',
    '.swr-remix-status{min-height:22px;margin:10px 0 0;color:#9eeadd;font-size:12px;overflow-wrap:anywhere}',
    '.swr-remix-foot{margin-top:10px;font-size:11px;color:#a996ba}',
    '@media(max-width:560px){.swr-remix-box{padding:14px}.swr-remix-grid{grid-template-columns:1fr 1fr}.swr-remix-grid label:last-child{grid-column:1/-1}}'
  ].join('\n');
  document.head.appendChild(styles);

  const launch = document.createElement('button');
  launch.type = 'button';
  launch.id = 'swr-remix-open';
  launch.className = 'tbtn ghost';
  launch.textContent = '✦ Remix';
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
    '<div class="swr-remix-box">',
    '<div class="swr-remix-head"><div><h2 id="swr-remix-title">✦ Generative Remix Studio</h2>',
    '<p>Turn short musical loops into a long-form arrangement. Everything stays in your browser.</p></div>',
    '<button type="button" class="tbtn ghost" data-remix="close" aria-label="Close Remix Studio">✕</button></div>',
    '<label class="swr-remix-drop">Choose audio loops (or drop files here)',
    '<input id="swr-remix-files" type="file" multiple accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.aif,.aiff,.ogg,.opus,.webm"></label>',
    '<p class="swr-remix-foot">Up to 8 loops, 50 MB each, 3 minutes maximum per loop. Stereo WAV export. No upload or cloud processing.</p>',
    '<div class="swr-remix-sub">Loaded loops</div><ul class="swr-remix-loops" id="swr-remix-loops"><li>No loops selected</li></ul>',
    '<div class="swr-remix-grid">',
    '<label>Duration (seconds)<input id="swr-remix-duration" type="number" min="5" max="600" step="5" value="180"></label>',
    '<label>Creativity <output id="swr-remix-creativity-display">65%</output><input id="swr-remix-creativity" type="range" min="0" max="100" value="65"></label>',
    '<label>BPM (optional)<input id="swr-remix-bpm" type="number" min="40" max="240" step="1" value="105"></label>',
    '</div>',
    '<div class="swr-remix-actions"><button type="button" class="primary" data-remix="generate" disabled>Generate 4 arrangements</button></div>',
    '<div class="swr-remix-candidates" id="swr-remix-candidates" role="group" aria-label="Arrangement candidates"></div>',
    '<div class="swr-remix-track" id="swr-remix-track" aria-label="Arrangement map" role="img"></div>',
    '<div class="swr-remix-actions">',
    '<button type="button" data-remix="render" disabled>Render selected</button>',
    '<button type="button" data-remix="send" disabled>Send to visual engine</button>',
    '<button type="button" data-remix="download" disabled>Download WAV</button></div>',
    '<audio class="swr-remix-preview" id="swr-remix-preview" controls preload="none" hidden></audio>',
    '<p class="swr-remix-status" role="status" aria-live="polite" id="swr-remix-status">Load loops to begin.</p>',
    '</div>'
  ].join('');
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

  function tell(message, error = false) {
    status.textContent = message;
    status.style.color = error ? '#ff919e' : '#9eeadd';
  }
  function clearPreview() {
    preview.pause();
    preview.removeAttribute('src');
    preview.hidden = true;
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
    for (const item of state.loops) {
      const li = document.createElement('li');
      li.textContent = item.name + ' · ' + item.duration.toFixed(1) + 's';
      loopList.appendChild(li);
    }
    if (!state.loops.length) {
      const li = document.createElement('li');
      li.textContent = 'No loops selected';
      loopList.appendChild(li);
    }
  }
  function showTrack() {
    track.replaceChildren();
    const plan = state.plans[state.selected];
    if (!plan) return;
    const swatches = ['#ff3d92', '#00cdd9', '#ffc64d', '#b790fb', '#70dd99', '#ef7b55', '#7f9fff', '#f2abd2'];
    for (const event of plan.events) {
      const segment = document.createElement('span');
      segment.style.flex = String(event.duration) + ' 0 0';
      const index = state.loops.findIndex(l => l.id === event.sourceId);
      segment.style.background = swatches[Math.max(0, index) % swatches.length];
      segment.title = event.sourceId + ' · ' + event.start.toFixed(1) + 's';
      track.appendChild(segment);
    }
    track.setAttribute('aria-label', 'Arrangement ' + (state.selected + 1) + ' with ' + plan.events.length + ' loop sections');
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
    state.busy = true; buttons(); clearPreview();
    state.plans = []; candidatesHost.replaceChildren(); track.replaceChildren();
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
      const bpm = rawBpm === '' ? null : Number(rawBpm);
      if (bpm !== null && (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)) throw new Error('BPM must be 40–240');
      state.plans = planRemix(state.loops, {
        targetDuration: seconds, bpm,
        creativity: Number($('swr-remix-creativity').value) / 100,
        candidates: 4, seed: 43172,
      });
      clearPreview();
      candidatesHost.replaceChildren();
      state.plans.forEach((plan, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.index = String(i);
        button.textContent = 'Take ' + (i + 1) + ' · ' + plan.events.length + ' cuts';
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
  });
  fileInput.addEventListener('change', e => {
    const files = e.target.files;
    void importFiles(files);
    e.target.value = '';
  });
  const drop = modal.querySelector('.swr-remix-drop');
  drop.addEventListener('dragover', e => e.preventDefault());
  drop.addEventListener('drop', e => {
    e.preventDefault();
    void importFiles(e.dataTransfer.files);
  });
  $('swr-remix-creativity').addEventListener('input', e => {
    $('swr-remix-creativity-display').textContent = e.target.value + '%';
  });
  generateButton.addEventListener('click', generate);
  renderButton.addEventListener('click', () => void renderSelected());
  sendButton.addEventListener('click', () => void sendToEngine());
  downloadButton.addEventListener('click', download);
  buttons();
}
