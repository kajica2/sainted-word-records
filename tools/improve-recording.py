#!/usr/bin/env python3
"""
Improve the recording in all 19 versions.

Line-based: finds the line "      start() {" through the matching
"      stop() {" by counting braces, replaces the whole block with the
improved start() body, leaves stop() and _save() unchanged.

Idempotent — safe to re-run. Detects already-applied versions by checking
for the `// SWR_REC_IMPROVED_v2` marker comment.
"""

import os, re

VERSIONS_DIR = 'versions'
MARKER = '// SWR_REC_IMPROVED_v2'

NEW_START_BLOCK = '''      start() {
        if (!A.el) { setStatus('load a song first', ''); return; }
        // Read user-configurable quality & fps from the toolbar selects.
        // Falls back to 30fps / high bitrate when the selects aren't in
        // the DOM (older variant pages or studio-mode layouts that hide
        // them).
        const fpsSel = $('rec-fps') ? $('rec-fps').value : '30';
        const fps = parseInt(fpsSel, 10) || 30;
        const qualSel = $('rec-quality') ? $('rec-quality').value : 'high';
        const BITRATE = { high: 12_000_000, med: 6_000_000, low: 3_000_000 }[qualSel] || 12_000_000;
        const vstream = stage.captureStream(fps);
        const dest = A.ctx.createMediaStreamDestination();
        this.mediaDest = dest;
        // Guard against double-connection: if A.an is already routed to
        // this exact dest from a previous unfinished recording, disconnect
        // first. (Has happened on hot-reload during dev.)
        try { A.an.disconnect(dest); } catch {}
        A.an.connect(dest);
        const tracks = [...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()];
        const stream = new MediaStream(tracks);
        // Prefer VP9 (best quality per bitrate, hardware decoded on most
        // platforms) over VP8 over MP4. MP4 encoders are still patchy in
        // Chrome — only Safari supports them natively, so we list MP4 last.
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
        // audioBitsPerSecond=192k for the music: video is the heavier
        // signal but audio is what the user actually hears — keep it
        // high enough that the encoder doesn't choke on treble transients.
        this.rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: BITRATE,
          audioBitsPerSecond: 192_000,
        });
        this.chunks = [];
        this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        this.rec.onstop = () => this._save();
        // timeslice 250ms — smaller than the previous 500ms so a sudden
        // tab close still yields a usable partial file (the last 250ms
        // chunk is flushed to ondataavailable). The trade-off is more
        // chunk concatenations at save time, but Blob stitching is O(n)
        // and we're talking ~24 chunks per minute.
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
        // Per-second elapsed/remaining ticker. Cleared on stop().
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

def find_start_block(lines):
    """Find the start() { ... stop() { boundary, return (start_idx, end_idx_exclusive)."""
    start_idx = None
    for i, line in enumerate(lines):
        if re.match(r'\s*start\(\)\s*\{\s*$', line):
            start_idx = i
            break
    if start_idx is None:
        return None
    # Now find the matching stop() line by counting braces
    depth = 0
    for j in range(start_idx, len(lines)):
        # Count braces in this line, ignoring strings/comments (good enough for our case)
        for ch in lines[j]:
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
        if depth == 0 and j > start_idx:
            # j is the closing brace of start(); the stop() is on next non-blank line
            for k in range(j+1, len(lines)):
                if re.match(r'\s*stop\(\)\s*\{\s*$', lines[k]):
                    return (start_idx, k)
            return None
    return None

def improve_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if MARKER in content:
        return 'already improved'
    lines = content.split('\n')
    bounds = find_start_block(lines)
    if bounds is None:
        return 'no match'
    start_idx, stop_idx = bounds
    # Replace lines [start_idx, stop_idx) with NEW_START_BLOCK
    new_lines = lines[:start_idx] + NEW_START_BLOCK.split('\n') + lines[stop_idx:]
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
