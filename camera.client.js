// camera.client.js — getUserMedia camera as a library-style layer asset.
//
// Adds a "CAM" toggle button next to the MIC button. On click: requests
// camera permission, captures a MediaStream, creates a <video> element
// bound to that stream, and registers it as a 'camera'-typed item in
// the Library. From there, the user adds it to a layer like any other
// asset — opacity slider on the layer panel controls transparency,
// blend modes work normally, reactors work normally.
//
// Self-cleanup: stopping the camera releases the MediaStream tracks and
// removes the library item.

(function () {
  if (window.CameraInput) return;  // idempotent

  let stream = null;
  let videoEl = null;
  let libraryItem = null;
  let active = false;

  async function start() {
    const SWR = window.SWR;
    const Library = SWR && SWR.Library;
    if (!Library) {
      setStatus('camera: app not ready', 'err');
      return;
    }
    if (active) {
      stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('camera: getUserMedia not supported', 'err');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError'
        ? 'camera permission denied'
        : `camera error: ${err.message || err}`;
      setStatus(msg, 'err');
      return;
    }

    // Build a <video> element bound to the stream
    videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;

    try {
      await videoEl.play();
    } catch (err) {
      // Some browsers block autoplay until user gesture; we already are
      // in a click handler so this should succeed, but guard anyway.
      setStatus(`camera: play failed: ${err.message || err}`, 'warn');
    }

    // Wait for the video to produce at least one frame
    await new Promise(resolve => {
      if (videoEl.readyState >= 2) return resolve();
      videoEl.addEventListener('loadeddata', resolve, { once: true });
      // Safety timeout
      setTimeout(resolve, 2000);
    });

    // Build the library item. We expose the video element via _el so
    // drawLayer can use it directly, and we set the natural dimensions so
    // cover-fit math works without re-querying the video each frame.
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;

    libraryItem = {
      id: Library.nextId++,
      name: '📷 Camera (live)',
      type: 'camera',
      url: null,        // no URL; src is _el.srcObject
      blob: null,
      thumb: null,      // no static thumbnail; first frame sampled below
      motion: 0.5,
      luma: 0.5,
      hue: 0,
      w, h,
      duration: 0,
      added: Date.now(),
      _el: videoEl,     // cached drawable
      _stream: stream,  // kept so we can stop tracks on dispose
    };

    // Capture a thumbnail from the first frame (non-blocking)
    captureThumb(videoEl, w, h).then(thumbDataURL => {
      libraryItem.thumb = thumbDataURL;
      Library.items.push(libraryItem);
      Library.render();
      setStatus(`camera live · ${w}×${h} — drag to layer`, 'ok');
    });

    // Update toggle button
    const btn = document.getElementById('cam-toggle');
    if (btn) {
      btn.textContent = '📷 Stop';
      btn.classList.add('active');
    }
    active = true;
  }

  function captureThumb(video, w, h) {
    return new Promise(resolve => {
      try {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 90;
        const ctx = c.getContext('2d');
        // Cover-fit
        const ar = w / h;
        const cAR = 160 / 90;
        let dw, dh, dx, dy;
        if (ar > cAR) { dh = 90; dw = dh * ar; dx = (160 - dw) / 2; dy = 0; }
        else          { dw = 160; dh = dw / ar; dx = 0; dy = (90 - dh) / 2; }
        ctx.drawImage(video, dx, dy, dw, dh);
        resolve(c.toDataURL('image/jpeg', 0.6));
      } catch (err) {
        resolve(null);
      }
    });
  }

  function stop() {
    if (videoEl) {
      try { videoEl.pause(); } catch {}
      videoEl.srcObject = null;
      videoEl = null;
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (libraryItem) {
      const SWR = window.SWR;
      const Library = SWR && SWR.Library;
      if (Library && Library.items) {
        const i = Library.items.indexOf(libraryItem);
        if (i >= 0) Library.items.splice(i, 1);
        // Also remove any layers that pointed to this asset
        if (Library.byId && window.SWR.Layers && window.SWR.Layers.list) {
          const layers = window.SWR.Layers.list;
          for (let j = layers.length - 1; j >= 0; j--) {
            if (layers[j].asset === libraryItem) {
              window.SWR.Layers.remove(layers[j].id);
            }
          }
        }
        if (Library.render) Library.render();
      }
      libraryItem = null;
    }
    const btn = document.getElementById('cam-toggle');
    if (btn) {
      btn.textContent = '📷 CAM';
      btn.classList.remove('active');
    }
    active = false;
    setStatus('camera off', 'ok');
  }

  function buildUI() {
    if (document.getElementById('cam-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'cam-toggle';
    btn.className = 'tbtn ghost';
    btn.style.cssText = 'padding:4px 10px;font-size:9px;margin-left:4px;';
    btn.textContent = '📷 CAM';
    btn.title = 'Add a live camera feed as a layer asset';

    btn.addEventListener('click', () => {
      if (active) stop();
      else start();
    });

    // Insert next to the MIC toggle
    const micBtn = document.getElementById('mic-toggle');
    if (micBtn && micBtn.parentElement) {
      micBtn.parentElement.insertBefore(btn, micBtn.nextSibling);
    } else {
      const songInput = document.getElementById('song-input');
      if (songInput) songInput.parentElement.insertBefore(btn, songInput.nextSibling);
    }

    // Stop on page unload
    window.addEventListener('beforeunload', stop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    setTimeout(buildUI, 100);
  }

  // ---- Hook into Library so 'camera' type renders correctly ----
  // Library.render() iterates items and builds a card per asset. It already
  // handles 'video' and 'image'; we patch the render to add 'camera' support.
  // We do this by overriding Library._renderItem via a small wrapper.
  function patchLibraryRender() {
    const SWR = window.SWR;
    const Library = SWR && SWR.Library;
    if (!Library || !Library.render) {
      setTimeout(patchLibraryRender, 200);
      return;
    }
    // Monkey-patch the inner card rendering by wrapping render(). When a camera
    // item is present, the existing video branch already handles _el.srcObject
    // because drawImage(videoEl) works for any HTMLVideoElement regardless of
    // how its source was set. So no Library code change is needed — we just
    // verify that the camera item is included in items[] (we push directly).
  }
  patchLibraryRender();

  window.CameraInput = { start, stop, get active() { return active; }, get item() { return libraryItem; } };
})();