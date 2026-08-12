// mic-input.client.js — getUserMedia mic/instrument input as an audio source.
// Adds a "🎤 MIC" button next to the song file input. When clicked, requests
// mic permission and routes the stream through the existing Audio engine.
//
// The mic source is mutually exclusive with file playback: activating one
// pauses/disconnects the other. Beats/BPM detection still works because the
// FFT pipeline is unchanged — we just swap which node feeds the analyser.

(function () {
  if (window.MicInput) return;  // idempotent

  let stream = null;
  let sourceNode = null;
  let active = false;
  // Snapshot of the file-source audio before mic takes over. Used to
  // restore the user's song when the mic is stopped.
  let savedFileSnapshot = null;   // { file, wasPlaying, currentTime }

  async function start() {
    const SWR = window.SWR;
    const Audio = SWR && SWR.Audio;
    if (!Audio) {
      setStatus('mic: app not ready', 'err');
      return;
    }
    if (active) {
      stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('mic: getUserMedia not supported', 'err');
      return;
    }

    try {
      Audio.unlock();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,   // we want clean signal for FFT
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      // Tear down file source if present — but snapshot first so we can
      // restore it when the mic stops.
      if (Audio.audioEl && Audio.audioEl.src && Audio.audioEl.src.startsWith('blob:')) {
        try {
          const resp = await fetch(Audio.audioEl.src);
          const blob = await resp.blob();
          // Re-create as a File so loadFile() works without modification.
          const name = Audio.audioEl.src.split('/').pop().split('?')[0] || 'song';
          const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
          savedFileSnapshot = {
            file,
            wasPlaying: !!Audio.playing,
            currentTime: Audio.audioEl.currentTime || 0,
          };
        } catch (err) {
          // Snapshot failed — mic will still work, but stop() can't restore.
          console.warn('[mic] failed to snapshot file source:', err);
          savedFileSnapshot = null;
        }
        try { Audio.audioEl.pause(); } catch {}
        try { Audio.audioEl.src = ''; } catch {}
      }
      if (Audio.source) {
        try { Audio.source.disconnect(); } catch {}
      }

      sourceNode = Audio.ctx.createMediaStreamSource(stream);
      sourceNode.connect(Audio.analyser);
      Audio.source = sourceNode;

      // Mark as "playing" so the render loop calls Audio.sample() each frame.
      // We don't drive BPM-from-beat-times because there's no song duration.
      Audio.playing = true;
      Audio.history = { prev: null, bassAvg: 0, fluxAvg: 0 };
      Audio.beatTimes = [];
      Audio.feat.bpm = 0;

      // Update transport UI
      const playBtn = document.getElementById('play');
      if (playBtn) {
        playBtn.textContent = '🎤 Live';
        playBtn.classList.add('danger');
        playBtn.classList.remove('primary');
      }
      const songName = document.getElementById('song-name');
      if (songName) songName.innerHTML = '<b>🎤 mic input</b>';
      const bpmPill = document.getElementById('bpm-pill');
      if (bpmPill) bpmPill.textContent = 'live';
      const stageEmpty = document.getElementById('stage-empty');
      if (stageEmpty) stageEmpty.classList.add('hidden');

      // Update toggle button
      const btn = document.getElementById('mic-toggle');
      if (btn) {
        btn.textContent = '🎤 Stop';
        btn.classList.add('active');
      }

      active = true;
      setStatus('mic live — speak / play to drive visuals', 'ok');
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError'
        ? 'mic permission denied'
        : `mic error: ${err.message || err}`;
      setStatus(msg, 'err');
      active = false;
    }
  }

  function stop() {
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch {}
      sourceNode = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    const SWR = window.SWR;
    const Audio = SWR && SWR.Audio;
    if (Audio) {
      Audio.playing = false;
      // Don't disconnect Audio.analyser — file source may reconnect later
    }
    // Restore the file source if we snapshotted one when mic started.
    const snap = savedFileSnapshot;
    savedFileSnapshot = null;
    if (snap && Audio && typeof Audio.loadFile === 'function') {
      try {
        Audio.loadFile(snap.file);
        if (Audio.audioEl) {
          const restore = () => {
            try {
              if (snap.currentTime && Audio.audioEl.duration && snap.currentTime < Audio.audioEl.duration) {
                Audio.audioEl.currentTime = snap.currentTime;
              }
              if (snap.wasPlaying && Audio.play) Audio.play();
            } catch {}
          };
          if (Audio.audioEl.readyState >= 1) restore();
          else Audio.audioEl.addEventListener('loadedmetadata', restore, { once: true });
        }
        if (typeof setStatus === 'function') {
          setStatus('mic off · song restored', 'ok');
        }
      } catch (err) {
        if (typeof setStatus === 'function') {
          setStatus('mic off · song restore failed: ' + err.message, 'warn');
        }
      }
    } else {
      setStatus('mic off', 'ok');
    }
    const playBtn = document.getElementById('play');
    if (playBtn) {
      playBtn.textContent = '▶ Play';
      playBtn.classList.add('primary');
      playBtn.classList.remove('danger');
    }
    const songName = document.getElementById('song-name');
    if (songName) songName.innerHTML = '<i>no song</i>';
    const btn = document.getElementById('mic-toggle');
    if (btn) {
      btn.textContent = '🎤 MIC';
      btn.classList.remove('active');
    }
    active = false;
  }

  // Build the toggle button — inject next to the song file input
  function buildUI() {
    if (document.getElementById('mic-toggle')) return;

    // Find a sensible parent — the song input area or transport header
    const songInput = document.getElementById('song-input');
    if (!songInput) return;

    const btn = document.createElement('button');
    btn.id = 'mic-toggle';
    btn.className = 'tbtn ghost';
    btn.style.cssText = 'padding:4px 10px;font-size:9px;margin-left:4px;';
    btn.textContent = '🎤 MIC';
    btn.title = 'Use microphone or instrument as audio source';

    btn.addEventListener('click', () => {
      if (active) stop();
      else start();
    });

    // Insert immediately after the song input
    songInput.parentElement.insertBefore(btn, songInput.nextSibling);

    // Stop mic when the page unloads (release the device)
    window.addEventListener('beforeunload', stop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    setTimeout(buildUI, 100);
  }

  window.MicInput = { start, stop, get active() { return active; } };
})();