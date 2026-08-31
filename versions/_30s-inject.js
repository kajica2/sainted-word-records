// Add a 30s auto-stop preset to the Recorder in each of the 5 versions.
//
// Idempotent: re-running on an already-patched page is a no-op.
//
// Run from the product root:
//   node versions/_30s-inject.js
//
// Implementation note: the rec-dur <select> is prepended to the existing
// <button id="rec">. Because the replacement still contains the exact
// button text it just matched, a naive re-run would prepend a second
// rec-dur <select> on top of the first. We guard the replacement on
// `id="rec-dur"` not already being present so a second run no-ops.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const versions = ['neon', 'film', 'grid', 'smoke', 'hallucination'];

const REC_BUTTON_PATTERNS = [
  `<button class="tbtn danger" id="rec" disabled>● REC</button>`,
  `<button class="tbtn" id="rec" disabled>● REC</button>`,
  `<button class="tbtn danger" id="rec" disabled>REC</button>`,
  `<button class="tbtn" id="rec" disabled>REC</button>`,
  `<button class="tbtn" id="rec" disabled>rec</button>`,
];
const REC_BUTTON_NEW = `<select id="rec-dur" style="font-size:9px; padding:3px 4px; background:var(--panel-2); color:var(--ink); border:1px solid var(--line); border-radius:3px; font:9px ui-monospace;" title="Auto-stop recording after N seconds">
        <option value="0">manual</option>
        <option value="10">10s</option>
        <option value="15">15s</option>
        <option value="30" selected>30s</option>
        <option value="60">60s</option>
        <option value="song">song</option>
      </select>
      <button class="tbtn danger" id="rec" disabled>● REC</button>`;

// Add autoStopAt + autoStopTimer fields and start/stop logic
const RECORDER_PATCH = `
      autoStopAt: 0,
      autoStopTimer: null,
`;

const OLD_START = `        this.recording = true;
        $('rec').classList.add('live');
        $('rec').textContent = '■ STOP';
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        setStatus('recording · ' + ext.toUpperCase(), 'live');`;

const NEW_START = `        this.recording = true;
        const durSel = $('rec-dur') ? $('rec-dur').value : '0';
        let durMs = 0;
        if (durSel === 'song' && A.el && A.el.duration) {
          durMs = Math.max(0, (A.el.duration - A.el.currentTime) * 1000);
        } else if (durSel !== '0' && durSel !== 'manual') {
          durMs = parseInt(durSel) * 1000;
        }
        this.autoStopAt = durMs > 0 ? Date.now() + durMs : 0;
        $('rec').classList.add('live');
        $('rec').textContent = '■ STOP';
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        if (this.autoStopAt > 0) {
          const sec = Math.round((this.autoStopAt - Date.now()) / 1000);
          setStatus('recording · ' + ext.toUpperCase() + ' · ' + sec + 's', 'live');
          this.autoStopTimer = setTimeout(() => { if (this.recording) Recorder.stop(); }, this.autoStopAt - Date.now());
        } else {
          setStatus('recording · ' + ext.toUpperCase(), 'live');
        }`;

const OLD_STOP = `      stop() {
        if (!this.rec) return;
        this.rec.stop();
        this.recording = false;
        $('rec').classList.remove('live');
        $('rec').textContent = '● REC';
        setStatus('rendering…', '');
        if (this.mediaDest) {
          try { A.an.disconnect(this.mediaDest); } catch {}
          this.mediaDest = null;
        }
      },`;

const NEW_STOP = `      stop() {
        if (!this.rec) return;
        if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
        this.rec.stop();
        this.recording = false;
        $('rec').classList.remove('live');
        $('rec').textContent = '● REC';
        setStatus('rendering…', '');
        if (this.mediaDest) {
          try { A.an.disconnect(this.mediaDest); } catch {}
          this.mediaDest = null;
        }
      },`;

for (const v of versions) {
  const p = path.join(__dirname, `${v}.html`);
  let html = fs.readFileSync(p, 'utf8');
  let touched = false;
  // Idempotency: if the rec-dur <select> is already in the page, the
  // recorder UI has been wired up by a prior pass. Skip the button
  // replacement (which would prepend a second rec-dur) and only check
  // the autoStop* fields + start/stop methods, which are also already
  // present. Re-running still reports "already updated" so it's
  // observably a no-op rather than a silent skip.
  const alreadyHasRecDur = html.includes('id="rec-dur"');
  if (!alreadyHasRecDur) {
    for (const pat of REC_BUTTON_PATTERNS) {
      if (html.includes(pat)) {
        html = html.replace(pat, REC_BUTTON_NEW);
        touched = true;
        break;
      }
    }
  }
  if (html.includes('mediaDest: null,') && !html.includes('autoStopAt: 0,')) {
    html = html.replace('mediaDest: null,', 'mediaDest: null,\n      autoStopAt: 0,\n      autoStopTimer: null,');
    touched = true;
  }
  if (html.includes(OLD_START)) {
    html = html.replace(OLD_START, NEW_START);
    touched = true;
  }
  if (html.includes(OLD_STOP)) {
    html = html.replace(OLD_STOP, NEW_STOP);
    touched = true;
  }
  if (touched) {
    fs.writeFileSync(p, html);
    console.log(`  ${v}.html: 30s preset added`);
  } else {
    console.log(`  ${v}.html: nothing to patch (already updated?)`);
  }
}
console.log('done');
