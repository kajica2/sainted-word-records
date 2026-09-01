#!/usr/bin/env python3
"""
Add the WebCodecs MP4 path to all variant Recorder blocks.

For each versions/*.html that has a Recorder block:
  1. Add the `<script src="../lib/recorder.client.js"></script>` include.
  2. Wrap the existing `start()` so it routes through SWR_RECORDER.start()
     when the user picks MP4 in the new #rec-format select AND the browser
     supports WebCodecs. Falls back to the existing MediaRecorder path on
     any failure (unsupported / missing audio data).
  3. Wrap `stop()` so it dispatches to either the WebCodecs or MediaRecorder
     path.

Idempotent — guarded by the marker `SWR_REC_MP4_INTEGRATION`.
"""

import os, re

VERSIONS_DIR = 'versions'
MARKER = '// SWR_REC_MP4_INTEGRATION'

WRAPPER_BODY = '''      start() {
        if (!A.el) { setStatus('load a song first', ''); return; }
        const fpsSel = $('rec-fps') ? $('rec-fps').value : '30';
        const fps = parseInt(fpsSel, 10) || 30;
        const qualSel = $('rec-quality') ? $('rec-quality').value : 'high';
        const BITRATE = { high: 12_000_000, med: 6_000_000, low: 3_000_000 }[qualSel] || 12_000_000;
        const formatSel = $('rec-format') ? $('rec-format').value : 'auto';
        const wantMp4 = formatSel === 'mp4' || (formatSel === 'auto' && window.SWR_RECORDER && window.SWR_RECORDER.canUseWebCodecs && window.SWR_RECORDER.canUseWebCodecs());
        if (wantMp4 && window.SWR_RECORDER && window.SWR_RECORDER.canUseWebCodecs && window.SWR_RECORDER.canUseWebCodecs()) {
          this._wcActive = true;
          this._wcPending = window.SWR_RECORDER.start({
            canvas: stage,
            audioSource: A.an,
            audioSampleRate: A.ctx ? A.ctx.sampleRate : 0,
            audioNumberOfChannels: 2,
            width: stage.width,
            height: stage.height,
            fps: fps,
            videoBitsPerSecond: BITRATE,
          }).then(() => {
            this.recording = true;
            this.startedAt = Date.now();
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
            const formatDur = (ms) => {
              const s = Math.max(0, Math.round(ms / 1000));
              return Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0');
            };
            if (this.autoStopAt > 0) {
              const durLabel = durSel === 'song' ? 'song' : (durSel + 's');
              setStatus('rec · MP4 · ' + formatDur(this.autoStopAt - Date.now()) + ' / ' + durLabel, 'live');
              this.autoStopTimer = setTimeout(() => { if (this.recording) Recorder.stop(); }, this.autoStopAt - Date.now());
            } else {
              setStatus('rec · MP4', 'live');
            }
            this.tickTimer = setInterval(() => {
              if (!this.recording) { clearInterval(this.tickTimer); this.tickTimer = null; return; }
              const el = formatDur(Date.now() - this.startedAt);
              if (this.autoStopAt > 0) {
                const rem = formatDur(this.autoStopAt - Date.now());
                const durSel2 = $('rec-dur') ? $('rec-dur').value : '0';
                const durLabel = durSel2 === 'song' ? 'song' : (durSel2 + 's');
                setStatus('rec · MP4 · ' + el + ' / ' + durLabel, 'live');
              } else {
                setStatus('rec · MP4 · ' + el, 'live');
              }
            }, 500);
          }).catch((err) => {
            this._wcActive = false;
            if (err && err.unsupported) {
              setStatus('WebCodecs unsupported · falling back to WebM', 'warn');
              const prev = $('rec-format') ? $('rec-format').value : formatSel;
              if ($('rec-format')) $('rec-format').value = 'webm';
              this.start();
              if ($('rec-format')) $('rec-format').value = prev;
            } else {
              setStatus('recorder start failed: ' + (err && err.message || err), 'err');
            }
          });
          return;
        }
        // === MEDIA-RECORDER (WEBM) PATH — same as before ===
        const vstream = stage.captureStream(fps);
        const dest = A.ctx.createMediaStreamDestination();
        this.mediaDest = dest;
        try { A.an.disconnect(dest); } catch {}
        A.an.connect(dest);
        const tracks = [...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()];
        const stream = new MediaStream(tracks);
        const mime = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm',
        ].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
        this.mime = mime;
        this.rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: BITRATE,
          audioBitsPerSecond: 192_000,
        });
        this.chunks = [];
        this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        this.rec.onstop = () => this._save();
        this.rec.start(250);
        this.recording = true;
        this.startedAt = Date.now();
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
        const formatDur = (ms) => {
          const s = Math.max(0, Math.round(ms / 1000));
          return Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0');
        };
        if (this.autoStopAt > 0) {
          const durLabel = durSel === 'song' ? 'song' : (durSel + 's');
          setStatus('rec · ' + ext.toUpperCase() + ' · ' + formatDur(this.autoStopAt - Date.now()) + ' / ' + durLabel, 'live');
          this.autoStopTimer = setTimeout(() => { if (this.recording) Recorder.stop(); }, this.autoStopAt - Date.now());
        } else {
          setStatus('rec · ' + ext.toUpperCase(), 'live');
        }
        this.tickTimer = setInterval(() => {
          if (!this.recording) { clearInterval(this.tickTimer); this.tickTimer = null; return; }
          const el = formatDur(Date.now() - this.startedAt);
          if (this.autoStopAt > 0) {
            const rem = formatDur(this.autoStopAt - Date.now());
            const durSel2 = $('rec-dur') ? $('rec-dur').value : '0';
            const durLabel = durSel2 === 'song' ? 'song' : (durSel2 + 's');
            setStatus('rec · ' + ext.toUpperCase() + ' · ' + el + ' / ' + durLabel, 'live');
          } else {
            setStatus('rec · ' + ext.toUpperCase() + ' · ' + el, 'live');
          }
        }, 500);
        // SWR_REC_IMPROVED_v2
      },'''

STOP_WRAPPER = '''      stop() {
        if (this._wcActive) {
          if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
          if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
          this._wcActive = false;
          this.recording = false;
          $('rec').classList.remove('live');
          $('rec').textContent = '● REC';
          setStatus('finalizing MP4…', '');
          window.SWR_RECORDER.stop().then((res) => {
            this.chunks = [res.blob];
            this.mime = res.mime;
            this._save();
          }).catch((err) => {
            setStatus('recorder stop failed: ' + (err && err.message || err), 'err');
          });
          return;
        }
        if (!this.rec) return;
        if (this.autoStopTimer) { clearTimeout(this.autoStopTimer); this.autoStopTimer = null; }
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
        this.rec.stop();
        this.recording = false;
        $('rec').classList.remove('live');
        $('rec').textContent = '● REC';
        setStatus('rendering…', '');
        if (this.mediaDest) {
          try { A.an.disconnect(this.mediaDest); } catch {}
          this.mediaDest = null;
        }
      },'''

FORMAT_CONTROL = '''      <select id="rec-format" class="swr-rec-extra-ctl-v2" style="font-size:9px; padding:3px 4px; background:var(--panel-2); color:var(--ink); border:1px solid var(--line); border-radius:3px; font:9px ui-monospace;" title="Recording format">
        <option value="auto" selected>MP4 auto</option>
        <option value="mp4">MP4 (H.264)</option>
        <option value="webm">WebM (VP9)</option>
      </select>
'''

RECORDER_SCRIPT_TAG = '    <script src="../lib/recorder.client.js"></script>'

def find_block_bounds(lines, key):
    """Find (start_line_idx, end_line_idx) of the key() block (between key() { and its matching closing })."""
    start_idx = None
    for i, line in enumerate(lines):
        if re.match(rf'\s*{key}\(\)\s*\{{\s*$', line):
            start_idx = i
            break
    if start_idx is None:
        return None
    depth = 0
    for j in range(start_idx, len(lines)):
        for ch in lines[j]:
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
        if depth == 0 and j > start_idx:
            return (start_idx, j)
    return None

def improve_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if MARKER in content:
        return 'already integrated'

    # 1. Add the script include if not present.
    if 'lib/recorder.client.js' not in content:
        # Insert before engine-genops / versions-presets / first lib script
        marker = '<script src="../lib/audio-damp.client.js"></script>'
        if marker in content:
            content = content.replace(marker, marker + '\n' + RECORDER_SCRIPT_TAG)
        else:
            content = re.sub(
                r'(\s*<script src="\.\./lib/[^"]+"></script>)',
                r'\1\n' + RECORDER_SCRIPT_TAG,
                content,
                count=1,
            )

    # 2. Add the format dropdown to the toolbar (before #rec-fps)
    if 'id="rec-format"' not in content and 'id="rec-fps"' in content:
        needle = '<select id="rec-fps"'
        content = content.replace(needle, FORMAT_CONTROL + '      ' + needle, 1)

    # 3. Find the existing start() and stop() bounds
    lines = content.split('\n')
    start_b = find_block_bounds(lines, 'start')
    if start_b is None:
        return 'no start()'
    stop_b = find_block_bounds(lines, 'stop')
    if stop_b is None:
        return 'no stop()'

    # Insert WRAPPER_BODY in place of start() and STOP_WRAPPER in place of stop()
    # We do start first since it's earlier in the file.
    s_start, s_end = start_b
    t_start, t_end = stop_b
    # Verify start() comes before stop()
    if s_start > t_start:
        return 'start after stop'

    new_lines = lines[:s_start] + WRAPPER_BODY.split('\n') + lines[s_end+1:]
    # Recompute stop bounds in new_lines
    stop_b2 = find_block_bounds(new_lines, 'stop')
    if stop_b2 is None:
        return 'lost stop()'
    t_start2, t_end2 = stop_b2
    new_lines = new_lines[:t_start2] + STOP_WRAPPER.split('\n') + new_lines[t_end2+1:]
    # Marker comment right before the new start()
    new_lines.insert(s_start, '    ' + MARKER)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(new_lines))
    return 'patched'

def main():
    targets = sorted(f for f in os.listdir(VERSIONS_DIR) if f.endswith('.html'))
    for fname in targets:
        path = os.path.join(VERSIONS_DIR, fname)
        with open(path) as f:
            if 'Recorder' not in f.read():
                continue
        result = improve_file(path)
        print(f'  {fname}: {result}')

if __name__ == '__main__':
    main()
