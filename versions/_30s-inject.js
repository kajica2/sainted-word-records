// Add a 30s auto-stop preset to the Recorder in each of the 5 versions
import fs from 'fs';
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
  const p = `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/versions/${v}.html`;
  let html = fs.readFileSync(p, 'utf8');
  let touched = false;
  for (const pat of REC_BUTTON_PATTERNS) {
    if (html.includes(pat)) {
      html = html.replace(pat, REC_BUTTON_NEW);
      touched = true;
      break;
    }
  }
  if (html.includes('mediaDest: null,')) {
    html = html.replace('mediaDest: null,', 'mediaDest: null,\n      autoStopAt: 0,\n      autoStopTimer: null,');
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
