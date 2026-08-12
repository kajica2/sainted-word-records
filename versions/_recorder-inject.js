// Inject a Recorder block + REC handler into each of the 5 versions.
// Idempotent: re-runs are safe.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RECORDER_BLOCK = `
    // === RECORDER (MP4 export) ===
    const Recorder = {
      rec: null,
      chunks: [],
      recording: false,
      mime: 'video/webm',
      mediaDest: null,
      start() {
        if (!A.el) { setStatus('load a song first', ''); return; }
        const fps = 30;
        const vstream = stage.captureStream(fps);
        const dest = A.ctx.createMediaStreamDestination();
        this.mediaDest = dest;
        A.an.connect(dest);
        const tracks = [...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()];
        const stream = new MediaStream(tracks);
        const mime = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
        this.mime = mime;
        this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        this.chunks = [];
        this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        this.rec.onstop = () => this._save();
        this.rec.start(500);
        this.recording = true;
        $('rec').classList.add('live');
        $('rec').textContent = '■ STOP';
        const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        setStatus('recording · ' + ext.toUpperCase(), 'live');
      },
      stop() {
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
      },
      _save() {
        const blob = new Blob(this.chunks, { type: this.mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        a.download = 'sainted-word-' + ts + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('exported · ' + ext.toUpperCase(), 'ok');
      },
    };
`;

const REC_HANDLER = `
    $('rec').addEventListener('click', () => {
      if (Recorder.recording) Recorder.stop();
      else Recorder.start();
    });
`;

const versions = ['neon', 'film', 'grid', 'smoke', 'hallucination'];

for (const v of versions) {
  const p = path.join(__dirname, v + '.html');
  let html = fs.readFileSync(p, 'utf8');

  if (html.includes('// === RECORDER (MP4 export) ===')) {
    console.log(`  ${v}.html: already has Recorder — skipping`);
    continue;
  }

  // 1. Move the window.SWR exposure from BEFORE the IIFE close to AFTER the
  //    Recorder block, so `Recorder` is defined when the exposure runs.
  const oldSWR = `    window.SWR = { Audio: A, Library: Lib, Layers, get stage() { return stage; }, get ctx() { return ctx; } };`;
  const newSWR = `    window.SWR = { Audio: A, Library: Lib, Layers, Recorder, get stage() { return stage; }, get ctx() { return ctx; } };`;
  if (!html.includes(oldSWR)) {
    console.error(`  ${v}.html: couldn't find window.SWR exposure — manual fix needed`);
    continue;
  }
  // Remove the old SWR exposure (just the line)
  html = html.replace(oldSWR + '\n  })();', `  })();\n${RECORDER_BLOCK}\n${newSWR}`);

  // 2. Replace the stub alert() REC handler with the real one.
  const oldRec = `$('rec').addEventListener('click', () => alert('REC pressed — in a full build this would export the canvas + audio as webm. Demo build skips the encoder.'));`;
  if (html.includes(oldRec)) {
    html = html.replace(oldRec, REC_HANDLER.trim());
  } else {
    // Older versions might not have a REC handler at all
    html = html.replace(
      `    requestAnimationFrame(loop);`,
      `    requestAnimationFrame(loop);\n${REC_HANDLER}`
    );
  }

  fs.writeFileSync(p, html, 'utf8');
  console.log(`  ${v}.html: injected`);
}

console.log('done');
