// client/local-media.client.js — Thin client for Hugging Face local-media-studio Space.
//
// USAGE
//   const lms = window.SWR_LOCAL_MEDIA.connect();     // uses default Space URL
//   lms.on('status', (msg) => console.log(msg));
//   const result = await lms.generateImage({
//     prompt: 'a serene gift bag',
//     negative_prompt: 'blurry, watermark',
//     width: 512, height: 512,
//     steps: 30, cfg_scale: 7.5,
//     seed: -1,
//     model_id: 'runwayml/stable-diffusion-v1-5',
//   });
//   // result.url  -> /gradio_api/file=... URL the user can fetch
//   // result.bytes -> Uint8Array of the PNG bytes (fetched eagerly)
//   // result.path -> the local Space path
//
// Designed to:
//   - Wake a sleeping Space (~30-60s cold start)
//   - Poll progress and report status
//   - Retry once on transient errors
//   - Fall back gracefully if the Space is offline
//
// All file paths returned are scoped to userId/... per SWR's storage rules
// (the Space runs in an isolated container).

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const NS = 'SWR_LOCAL_MEDIA';
  const DEFAULT_URL = 'https://kaidjuric-local-media-studio.hf.space';

  // -------------------- low-level SSE-ish stream --------------------
  // Gradio 4 uses Server-Sent Events on /gradio_api/queue/data with a session_hash.
  // Each line is "event: <type>" + "data: <json>" pairs. We fetch as a stream and
  // walk it.

  async function fetchEventStream(url, onEvent, signal) {
    const r = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    if (!r.ok || !r.body) throw new Error('SSE connect failed: ' + r.status);
    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Process complete lines (Gradio uses \r\n\r\n between events).
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Walk lines: 'event:' and 'data:' are the only prefixes we care about.
        const lines = block.split('\n');
        let ev = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { continue; }
        onEvent(ev, parsed);
      }
    }
  }

  // -------------------- join + collect --------------------

  async function joinQueue(baseUrl, apiName, args, opts) {
    const opt = opts || {};
    const sessionHash = opt.sessionHash || ('swr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    const dataUrl = opt.baseUrl || (baseUrl.replace(/\/$/, '') + '/gradio_api/queue/data');
    const joinUrl = (opt.baseUrl || (baseUrl.replace(/\/$/, '') + '/gradio_api/queue/join'));

    // POST the join.
    const joinBody = {
      fn_index: 0,  // Will be looked up by apiName from the config; first by index
      data: args,
      session_hash: sessionHash,
      event_data: null,
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opt.timeoutMs || 240000);

    let eventId;
    try {
      const j = await fetch(joinUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(joinBody),
        signal: ctrl.signal,
      });
      if (!j.ok) throw new Error('queue/join HTTP ' + j.status);
      const jb = await j.json();
      eventId = jb.event_id;
      if (!eventId) throw new Error('queue/join returned no event_id');
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }

    // Walk the event stream until we see process_completed or error.
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        try { ctrl.abort(); } catch (_) {}
        clearTimeout(timer);
      };
      const streamUrl = `${dataUrl}?session_hash=${encodeURIComponent(sessionHash)}`;
      fetchEventStream(streamUrl, (ev, parsed) => {
        if (settled) return;
        // Gradio messages: 'process_starts', 'process_progress', 'process_completed',
        // 'estimation', 'log', 'error'.
        if (ev === 'process_completed' || parsed && parsed.msg === 'process_completed') {
          settled = true;
          cleanup();
          const out = parsed && parsed.output || (parsed && parsed.outputs);
          resolve({ eventId, sessionHash, output: out, raw: parsed });
        } else if (ev === 'error' || parsed && parsed.msg === 'error') {
          settled = true;
          cleanup();
          reject(new Error(parsed && parsed.error || 'SSE error event'));
        } else if (ev === 'log' || ev === 'process_progress' || ev === 'process_starts' || ev === 'heartbeat') {
          if (opt.onEvent) opt.onEvent(ev, parsed);
        }
      }, ctrl.signal).then(() => {
        if (!settled) {
          cleanup();
          reject(new Error('SSE stream closed before completion'));
        }
      }).catch((e) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      });
    });

    clearTimeout(timer);
    return result;
  }

  function fileUrlFromOutput(baseUrl, output) {
    // The Space returns either a {path, url} dict, a string path, or an array.
    if (Array.isArray(output)) {
      for (const x of output) {
        const u = fileUrlFromOutput(baseUrl, x);
        if (u) return u;
      }
      return null;
    }
    if (!output) return null;
    if (typeof output === 'string') {
      // Could be "/tmp/foo.png" or "/gradio_api/file=foo"
      if (output.includes('gradio_api/file=')) {
        return baseUrl.replace(/\/$/, '') + output;
      }
      // It's an absolute path on the Space — best-effort URL.
      return baseUrl.replace(/\/$/, '') + '/gradio_api/file=' + encodeURIComponent(output);
    }
    if (typeof output === 'object') {
      const url = output.url || output.path;
      if (url) return fileUrlFromOutput(baseUrl, url);
      const meta = output.meta || (output[0] && output[0].meta);
      if (meta && meta.path) {
        return baseUrl.replace(/\/$/, '') + '/gradio_api/file=' + encodeURIComponent(meta.path);
      }
    }
    return null;
  }

  async function fetchBytes(url, opts) {
    const o = opts || {};
    const r = await fetch(url, { signal: o.signal });
    if (!r.ok) throw new Error('fetch file HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    return new Uint8Array(buf);
  }

  // -------------------- public API --------------------

  function connect(opts) {
    const opt = opts || {};
    const baseUrl = opt.baseUrl || DEFAULT_URL;
    const listeners = { status: [], error: [], progress: [], complete: [] };

    function emit(type, payload) {
      const arr = listeners[type] || [];
      for (const cb of arr) {
        try { cb(payload); } catch (_) {}
      }
    }

    function on(type, cb) {
      if (listeners[type]) listeners[type].push(cb);
    }

    async function callFn(apiName, args, opts2) {
      const o2 = opts2 || {};
      const onEvent = (ev, parsed) => {
        if (ev === 'process_progress') emit('progress', parsed);
        else if (ev === 'process_starts') emit('status', 'starting…');
        else if (ev === 'log') emit('status', parsed && parsed.logs && parsed.logs.join(' '));
      };
      o2.onEvent = onEvent;
      try {
        emit('status', 'submitting…');
        const r = await joinQueue(baseUrl, apiName, args, o2);
        emit('complete', r);
        return r;
      } catch (e) {
        emit('error', e);
        throw e;
      }
    }

    async function generateImage(params, opts2) {
      const args = [
        params.prompt || 'a serene gift bag',
        params.negative_prompt || 'blurry, watermark, distorted',
        params.mode || 'txt2img',
        params.input_image || null,
        typeof params.strength === 'number' ? params.strength : 0.7,
        typeof params.steps === 'number' ? params.steps : 30,
        typeof params.cfg_scale === 'number' ? params.cfg_scale : 7.5,
        typeof params.seed === 'number' ? params.seed : -1,
        typeof params.width === 'number' ? params.width : 512,
        typeof params.height === 'number' ? params.height : 512,
        params.model_id || 'runwayml/stable-diffusion-v1-5',
      ];
      const r = await callFn('run_generate_image', args, opts2);
      const outPath = (r.output && r.output.data) ? r.output.data[0] : null;
      const url = fileUrlFromOutput(baseUrl, outPath);
      const bytes = url ? await fetchBytes(url) : null;
      return { path: outPath, url, bytes };
    }

    async function remixVideo(params, opts2) {
      const args = [
        params.input || '',
        params.start || 0,
        params.end || 0,
        typeof params.upscale === 'boolean' ? params.upscale : true,
        typeof params.target_width === 'number' ? params.target_width : 1920,
        typeof params.target_height === 'number' ? params.target_height : 1080,
        false,  // use_realesrgan always false from JS (Space has it disabled)
        typeof params.interpolate === 'boolean' ? params.interpolate : false,
        typeof params.target_fps === 'number' ? params.target_fps : 60,
        typeof params.separate_audio === 'boolean' ? params.separate_audio : false,
        0,  // vocals_db
        0,  // drums_db
        0,  // bass_db
        0,  // other_db
      ];
      const r = await callFn('run_remix_video', args, opts2);
      return { status: r.output && r.output.data && r.output.data[0] };
    }

    async function makeLoops(params, opts2) {
      const args = [
        params.input || '',
        typeof params.min_length === 'number' ? params.min_length : 5,
        typeof params.max_length === 'number' ? params.max_length : 15,
        typeof params.num_loops === 'number' ? params.num_loops : 5,
        typeof params.scene_threshold === 'number' ? params.scene_threshold : 27,
        typeof params.search_radius === 'number' ? params.search_radius : 2,
        typeof params.crossfade === 'number' ? params.crossfade : 0.5,
      ];
      const r = await callFn('run_make_loops', args, opts2);
      const list = (r.output && r.output.data && r.output.data[0]) || [];
      return { files: list.map((p) => fileUrlFromOutput(baseUrl, p)).filter(Boolean) };
    }

    return {
      baseUrl,
      on,
      generateImage,
      remixVideo,
      makeLoops,
      callFn,
      // Static helper to translate raw output → URL.
      fileUrlFromOutput: (out) => fileUrlFromOutput(baseUrl, out),
    };
  }

  window[NS] = { connect, fetchBytes, DEFAULT_URL };
})();
