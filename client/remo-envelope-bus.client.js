// client/remo-envelope-bus.client.js
// Remo Panel 2.0 — envelope sources, triggers, and per-frame tick.

(function () {
  'use strict';
  if (window.SWR_REMO_ENV) return;

  var sources = Object.create(null);
  var order = [];
  var tempo = 120;
  var hidden = false;
  var rebuildTimer = null;

  function shapes() { return window.SWR_REMO_SHAPES; }
  function params() { return window.SWR_REMO_PARAMS; }
  function wires() { return window.SWR_REMO_WIRES; }

  function lengthSeconds(env) {
    if (env.timeBase === 'beats') {
      var beats = isFinite(+env.beats) ? +env.beats : 1;
      return beats * 60 / Math.max(tempo, 1);
    }
    return Math.max(+env.seconds || 0, 0.001);
  }

  function rebuildLut(env) {
    var S = shapes();
    if (!S) return;
    var shape = env.preset && env.preset !== 'custom' ? S.preset(env.preset) : null;
    if (!shape && env.shape) {
      shape = { kind: 'BREAKPOINT', points: env.shape, curve: env.curve || 'linear' };
    }
    if (!shape) shape = { kind: 'AD', a: 0.01, d: 0.25 };
    env.seconds = lengthSeconds(env);
    env.lut = S.buildLUT(shape, S.LUT_SIZE);
  }

  function scheduleRebuild(env) {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      rebuildLut(env);
    }, 80);
  }

  function addSource(spec) {
    if (!spec || !spec.id) return null;
    if (sources[spec.id]) removeSource(spec.id);
    var env = {
      id: spec.id,
      preset: spec.preset || 'custom',
      shape: spec.shape || null,
      timeBase: spec.timeBase === 'beats' ? 'beats' : 'seconds',
      seconds: +spec.seconds || 0.5,
      beats: isFinite(+spec.beats) ? +spec.beats : 1,
      loop: !!spec.loop,
      trigger: spec.trigger || 'manual',
      curve: spec.curve || 'linear',
      lut: null,
      state: 'idle',
      t: 0,
      value: 0,
      releaseStartValue: 0,
      releaseSeconds: 0.25,
    };
    rebuildLut(env);
    sources[env.id] = env;
    order.push(env.id);
    return env;
  }

  function removeSource(id) {
    if (!sources[id]) return false;
    delete sources[id];
    order = order.filter(function (x) { return x !== id; });
    return true;
  }

  function getSource(id) { return sources[id] || null; }

  function updateSource(id, patch) {
    var env = sources[id];
    if (!env || !patch) return false;
    var keys = Object.keys(patch);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'id' || k === 'lut' || k === 'value' || k === 't' || k === 'state') continue;
      env[k] = patch[k];
    }
    if (patch.preset || patch.shape || patch.seconds || patch.beats || patch.timeBase || patch.curve) {
      scheduleRebuild(env);
    }
    return true;
  }

  function trigger(id) {
    var env = sources[id];
    if (!env) return false;
    env.state = 'running';
    env.t = 0;
    env.value = 0;
    return true;
  }

  function release(id) {
    var env = sources[id];
    if (!env) return false;
    if (env.state === 'idle') return true;
    env.state = 'releasing';
    env.releaseStartValue = env.value;
    env.t = 0;
    return true;
  }

  function referenced(id) {
    var W = wires();
    if (!W || typeof W.referencesSource !== 'function') return true;
    return W.referencesSource(id);
  }

  function sample(env) {
    var S = shapes();
    if (!S || !env.lut) return 0;
    var dur = Math.max(env.seconds, 0.001);
    return S.readLUT(env.lut, env.t / dur);
  }

  function tick(dt) {
    if (hidden) return;
    var d = +dt;
    if (!isFinite(d) || d < 0) d = 0;
    if (d > 0.05) d = 0.05;
    for (var i = 0; i < order.length; i++) {
      var env = sources[order[i]];
      if (!env) continue;
      if (env.state === 'idle' && !referenced(env.id)) {
        env.value = 0;
        continue;
      }
      if (env.state === 'idle') {
        env.value = 0;
        continue;
      }
      if (env.state === 'releasing') {
        env.t += d;
        var r = Math.max(env.releaseSeconds, 0.001);
        var u = env.t / r;
        if (u >= 1) {
          env.value = 0;
          env.state = 'idle';
          env.t = 0;
        } else {
          env.value = env.releaseStartValue * (1 - u);
        }
        continue;
      }
      // running / held
      env.t += d;
      var dur = Math.max(env.seconds, 0.001);
      if (env.t >= dur) {
        if (env.loop) {
          env.t = env.t % dur;
          env.value = sample(env);
        } else {
          env.value = sample(env);
          env.state = 'releasing';
          env.releaseStartValue = env.value;
          env.t = 0;
        }
      } else {
        env.value = sample(env);
      }
    }
  }

  function setTempo(bpm) {
    var next = +bpm;
    if (!isFinite(next) || next <= 0) return;
    var old = tempo;
    tempo = next;
    var P = params();
    if (P) P.setBase('tempo', tempo);
    for (var i = 0; i < order.length; i++) {
      var env = sources[order[i]];
      if (!env || env.timeBase !== 'beats') continue;
      var oldSec = Math.max(env.seconds, 0.001);
      rebuildLut(env);
      env.t = env.t / oldSec * env.seconds;
    }
    void old;
  }

  function listSources() {
    return order.map(function (id) { return sources[id]; }).filter(Boolean);
  }

  function clear() {
    sources = Object.create(null);
    order = [];
  }

  function snapshot() {
    return listSources().map(function (env) {
      return {
        id: env.id,
        preset: env.preset,
        shape: env.shape,
        timeBase: env.timeBase,
        seconds: env.seconds,
        beats: env.beats,
        loop: env.loop,
        trigger: env.trigger,
      };
    });
  }

  function restore(list) {
    clear();
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) addSource(list[i]);
  }

  function onEvent(name, detail) {
    for (var i = 0; i < order.length; i++) {
      var env = sources[order[i]];
      if (!env) continue;
      if (env.trigger === name || (name === 'key' && env.trigger === 'key:space' && detail === ' ')) {
        trigger(env.id);
      }
    }
  }

  function bindEvents() {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        hidden = document.visibilityState === 'hidden';
      });
    }
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('swr-remo-event', function (ev) {
      var d = ev && ev.detail;
      if (!d || !d.name) return;
      onEvent(d.name, d.payload);
    });
    window.addEventListener('keydown', function (ev) {
      if (ev.key === ' ' && !ev.repeat && !(ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName))) {
        onEvent('key', ' ');
      }
    });
  }

  bindEvents();

  window.SWR_REMO_ENV = {
    addSource: addSource,
    removeSource: removeSource,
    getSource: getSource,
    updateSource: updateSource,
    trigger: trigger,
    release: release,
    tick: tick,
    setTempo: setTempo,
    listSources: listSources,
    clear: clear,
    snapshot: snapshot,
    restore: restore,
    onEvent: onEvent,
    getTempo: function () { return tempo; },
    _sources: sources,
  };
})();
