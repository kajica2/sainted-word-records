/* lib/bench-suite.client.js — the shared benchmark & A/V sync suite.
 *
 * One implementation, two hosts:
 *   - /bench          measures the lab's own stage
 *   - /preset-editor  measures the EDITOR's stage and the editor's own
 *                     preset, and applies the advisor's suggestions to
 *                     that preset
 *
 * THE HOST CONTRACT (v2)
 *   host.tests()            → [{ name, desc, cfg }]    what to measure
 *   host.sample(tSec)       → { features, audioTime }  the feature source.
 *                              audioTime MUST equal host.audioClock(tSec).
 *   host.audioClock(tSec)   → number (seconds)         the audio clock's
 *                              reading at wall time tSec, on the same epoch
 *                              as tSec. It is the DETERMINISTIC offset of the
 *                              audio clock from the wall clock. Per-sample
 *                              jitter belongs in the features, never here.
 *                              Optional: without it the suite falls back to
 *                              host.sample(tSec).audioTime.
 *   host.reportConfig()     → {...}                   what goes in a report
 *   host.supports(id)       → bool                     can it apply this?
 *   host.apply(id, value)   → bool                     apply it
 *   host.verify(id)         → number|string           optional: the current
 *                              value of the thing a suggestion changes. The
 *                              suite reads it before and after an apply to
 *                              prove the change took effect.
 *   host.versionTag()       → string|null              optional: the version
 *                              label for new reports
 *   host.onTestStart(cfg)   · host.onReport(report)   · host.optimizedConfig()
 *   host.toast(msg)
 *
 * THE MEASUREMENT MODEL (v2) — two quantities, kept apart on purpose:
 *   offset — the A/V CLOCK OFFSET: how far the audio clock is from the
 *            video clock (signed, ms). A host with a 12ms audio lag reads
 *            12ms every frame, whatever the buffer does. No suite
 *            suggestion can fix it: it is the host's own clock.
 *   quant  — the SAMPLING ERROR: how far the presented content is from the
 *            ideal label (signed, ms). With interpolation the blend is
 *            placed on the ideal label (quant ~ 0); without it the newest
 *            sample is presented, up to one audio period (16.7ms) old.
 *
 * The suite owns the ring buffer, the measurement, the report compiler,
 * the advisor and the panel UI. The host owns only what it draws.
 *
 * Global script (no module): it is loaded with `defer` by two pages and
 * attaches `window.SWR_BENCH`. See lib/audio.client.js for the pattern.
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var uid = function () { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); };
  var escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var maxOf = function (arr) {
    var m = 0;
    for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  };

  /* ---------- stats ---------- */
  function variance(arr) {
    if (arr.length < 2) return 0;
    var m = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
    return arr.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / arr.length;
  }
  function pct(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }
  function computeStats(arr) {
    if (!arr.length) return null;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mean = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
    return { mean: mean, sd: Math.sqrt(variance(arr)), p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), p99: pct(sorted, 0.99) };
  }

  /* ============================================================
     THE A/V SYNC BUFFER (v2)

     Samples are pushed in with the LABEL of the audio content they
     represent (the audio clock's reading at push time). The render
     side asks for the content at a label; the buffer blends the two
     samples that bracket it (interpolating their features AND their
     labels with the same alpha) or, without interpolation, hands back
     the newest sample at or before that label.

     The buffer knows nothing about clocks: it maps labels to content.
     The suite owns the clock arithmetic (offset / quant).
     ============================================================ */
  function AVSyncBuffer(capacity) {
    this.capacity = capacity || 128;
    this.buf = [];
    this.pushes = 0;
  }
  /* push the features that represent the audio content labelled `label` */
  AVSyncBuffer.prototype.push = function (features, label) {
    this.pushes++;
    this.buf.push({ t: label, f: Object.assign({}, features) });
    while (this.buf.length > this.capacity) this.buf.shift();
  };
  /* the content at `label`:
     - interpolated: the two samples that bracket the label are blended and
       the result is PLACED ON the label (the presented label is the label).
     - not interpolated: the newest sample whose label is <= the label.
     Returns { f, t, quant } where t is the presented label and quant is
     (presented label - requested label) in ms. */
  AVSyncBuffer.prototype.sampleAtLabel = function (label, interpolate) {
    var n = this.buf.length;
    if (!n) return { f: null, t: null, quant: null };
    var i = n - 1;
    while (i > 0 && this.buf[i].t > label) i--;
    if (this.buf[i].t > label) i = 0;            // the label predates the buffer
    var a = this.buf[i];
    if (!interpolate) {
      return { f: Object.assign({}, a.f), t: a.t, quant: (a.t - label) * 1000 };
    }
    var b = i + 1 < n ? this.buf[i + 1] : null;  // the sample above the label
    if (!b) {
      // nothing above the label yet: the newest content, placed on the
      // requested label (the interpolation is what makes the presentation
      // current — the underlying features are the newest ones available).
      return { f: Object.assign({}, a.f), t: label, quant: 0 };
    }
    var span = b.t - a.t;
    if (Math.abs(span) < 1e-9) {
      return { f: Object.assign({}, a.f), t: label, quant: 0 };
    }
    var alpha = clamp((label - a.t) / span, 0, 1);
    var f = {};
    for (var k in a.f) {
      var av = typeof a.f[k] === 'number' ? a.f[k] : 0;
      var bv = typeof b.f[k] === 'number' ? b.f[k] : 0;
      f[k] = av + (bv - av) * alpha;
    }
    return { f: f, t: label, quant: 0 };
  };
  AVSyncBuffer.prototype.clear = function () {
    this.buf.length = 0;
    this.pushes = 0;
  };

  /* ============================================================
     THE SUITE
     ============================================================ */
  function createSuite(host) {
    var REPORT_KEY = 'swr.bench.reports.v1';
    var AUDIO_HZ = 60;
    var AUDIO_PERIOD = 1000 / AUDIO_HZ;
    var MAX_SAMPLES = 500;          // the drift/quant arrays are bounded
    var MAX_LIVE = 500;

    var state = {
      cfg: { interpolate: true, injectAudioDrift: 0, dpr: 0, smoothing: 0.7, trails: 0.4, reactivity: 1.5, layers: [] },
      interpDefault: true,          // the panel's toggle — the default for
                                     // tests that do not name their own
      buffer: new AVSyncBuffer(128),
      startAt: performance.now(),
      recording: false,
      dtSamples: [],                 // frame times (ms) of the run
      driftSamples: [],              // |offset| (ms) of the run
      quantSamples: [],              // |quant| (ms) of the run
      featureDiffs: [],              // per-frame feature change of the run
      counts: { dt: 0, drift: 0, feature: 0 },
      driftMax: 0,
      quantMax: 0,
      live: { offsets: [], quants: [] },
      lastFeature: null,             // the previous frame's features (jitter)
      audioTimer: null,
      activeTest: null,
      runToken: 0,
      reports: [],
      selectedReportId: null,
      applyLog: [],
      droppedReports: 0,
      mounted: false
    };

    var els = {};
    var sparkData = [];
    var lastSampleAt = null;        // the frame sampler is primed on its
                                     // first frame — the first frame
                                     // contributes no interval
    var samplerPrimed = false;

    /* ---------- the audio clock ---------- */
    /* the audio clock's reading at wall time tSec. Deterministic when the
       host provides audioClock(); hosts that only expose sample() fall back
       to the audioTime of the sample (which is allowed to carry jitter). */
    function audioClockAt(tSec) {
      if (typeof host.audioClock === 'function') {
        var v = host.audioClock(tSec);
        if (isNum(v)) return v;
      }
      if (typeof host.sample === 'function') {
        var s = host.sample(tSec);
        if (s && isNum(s.audioTime)) return s.audioTime;
      }
      return tSec;
    }
    function pushAudio() {
      var tSec = (performance.now() - state.startAt) / 1000;
      var s = host.sample(tSec);
      if (!s) return;
      var label = isNum(s.audioTime) ? s.audioTime : tSec;
      state.buffer.push(s.features, label);
    }
    function startClock() {
      if (state.audioTimer) return;
      state.audioTimer = setInterval(pushAudio, AUDIO_PERIOD);
    }
    function stopClock() {
      if (!state.audioTimer) return;
      clearInterval(state.audioTimer);
      state.audioTimer = null;
    }

    /* ---------- the frame sampler: the host's own rAF cadence ---------- */
    function sampleFrame(now) {
      if (!samplerPrimed) {
        // prime the sampler: the first frame has no interval behind it
        samplerPrimed = true;
        lastSampleAt = now;
        requestAnimationFrame(sampleFrame);
        return;
      }
      var dt = now - lastSampleAt;
      lastSampleAt = now;
      if (state.recording && dt > 0) {
        state.dtSamples.push(dt);
        state.counts.dt++;
      }
      requestAnimationFrame(sampleFrame);
    }
    requestAnimationFrame(sampleFrame);

    /* ---------- the report ---------- */
    /* Each of the three sub-scores is only computed when its input was
       measured: a missing measurement is NOT a perfect score. A run with
       no samples at all gets no grade. */
    function scoreReport(m) {
      var render = null, stability = null, sync = null;
      if (m.videoSamples > 0) {
        render = clamp(m.fpsAvg / 60 * 100, 0, 100);
        stability = clamp(100 - Math.max(0, m.frameP99 - 16.67) * 2, 0, 100);
      }
      if (m.avSamples > 0) sync = clamp(100 - m.driftAvg * 4, 0, 100);
      var parts = [
        { w: 0.4, v: render },
        { w: 0.3, v: stability },
        { w: 0.3, v: sync }
      ];
      var wsum = 0, total = 0, scored = 0;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].v == null) continue;
        wsum += parts[i].w;
        total += parts[i].v * parts[i].w;
        scored++;
      }
      if (!scored) {
        return { render: null, stability: null, sync: null, total: null, grade: null, invalid: true, reason: 'no samples collected' };
      }
      total = total / wsum;
      var grade = total >= 95 ? 'A+' : total >= 90 ? 'A' : total >= 80 ? 'B'
                : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';
      return { render: render, stability: stability, sync: sync, total: total, grade: grade, invalid: false, reason: null };
    }

    function buildReport(testName, startWall, tag, interpSource) {
      var fs = computeStats(state.dtSamples);
      var ds = computeStats(state.driftSamples);
      var qs = computeStats(state.quantSamples);
      var xd = computeStats(state.featureDiffs);
      /* the frame RATE distribution — the percentiles of 1000/dt, not the
         reciprocal of the frame-TIME percentiles */
      var fpsArr = state.dtSamples.map(function (dt) { return dt > 0 ? 1000 / dt : 0; });
      var fstats = computeStats(fpsArr);
      var metrics = {
        duration: (Date.now() - startWall) / 1000,
        videoSamples: state.counts.dt,
        avSamples: state.counts.drift,
        audioSamples: state.buffer.pushes,
        fpsAvg: fs ? 1000 / fs.mean : 0,
        fpsP50: fstats ? fstats.p50 : 0,
        fpsP95: fstats ? fstats.p95 : 0,
        fpsP99: fstats ? fstats.p99 : 0,
        frameAvg: fs ? fs.mean : 0,
        frameP50: fs ? fs.p50 : 0,
        frameP95: fs ? fs.p95 : 0,
        frameP99: fs ? fs.p99 : 0,
        jitter: fs ? fs.sd : 0,
        driftAvg: ds ? ds.mean : 0,
        driftMax: state.driftMax,
        quantAvg: qs ? qs.mean : 0,
        quantMax: state.quantMax,
        /* the feature jitter is the mean of the per-frame feature deltas.
           With no feature samples there is NO measurement — null, not 0
           (a zero would read as "the features did not jitter"). */
        featureJitter: xd ? xd.mean : null,
        featureSamples: state.counts.feature,
        bufferFill: state.buffer.buf.length / state.buffer.capacity,
        memoryMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null
      };
      var report = {
        id: uid(),
        version: tag || ('v-' + new Date(startWall).toISOString().slice(0, 16).replace(/[:T]/g, '-')),
        testName: testName,
        timestamp: startWall,
        config: reportConfig(interpSource),
        metrics: metrics,
        scores: scoreReport(metrics)
      };
      report.ai = analyze(report);
      report.ai.applyNotes = state.applyLog.length
        ? state.applyLog.filter(function (l) { return !l.ok; }).map(function (l) {
            return l.label + ': apply had no effect (' + l.reason + ')';
          })
        : [];
      return report;
    }

    /* the report's config — the host's own view of the configuration, with
       the interpolate flag the run ACTUALLY used (the suite owns it). */
    function reportConfig(interpSource) {
      var cfg = (typeof host.reportConfig === 'function') ? (host.reportConfig() || {}) : {};
      cfg = Object.assign({}, cfg);
      cfg.interpolate = !!state.cfg.interpolate;
      cfg.interpolateSource = interpSource || 'toggle';
      return cfg;
    }

    /* ---------- the advisor (heuristic, rules-based) ---------- */
    function analyze(r) {
      var m = r.metrics;
      var out = {
        grade: r.scores ? r.scores.grade : null,
        score: r.scores ? r.scores.total : null,
        invalid: !r.scores || !!r.scores.invalid,
        measurements: [],
        bottlenecks: [],
        suggestions: [],
        notes: [],
        applyNotes: []
      };
      if (out.invalid) {
        out.notes.push('no data — this run collected no samples, so it is not graded.');
        return out;
      }

      /* suggestions are collected with the bottleneck they target, so that a
         bottleneck left without a suggestion can say so */
      var sug = [];
      function add(id, label, delta, detail, owner, target) {
        for (var i = 0; i < sug.length; i++) {
          if (sug[i].id === id) {
            if (sug[i].targets.indexOf(target) < 0) sug[i].targets.push(target);
            return;
          }
        }
        sug.push({ id: id, label: label, delta: delta, detail: detail, owner: owner, targets: [target] });
      }

      if (m.fpsP95 < 50) {
        out.bottlenecks.push({ kind: 'render', severity: 'high', detail: 'FPS p95 ' + m.fpsP95.toFixed(1) + ' fps' });
        add('reduce-count', 'Reduce particle / grid density', 'reduce density',
          'Heavy layers dominate the frame time. How far the density is cut is the host\'s decision — apply it and read the new numbers in the host\'s own UI.',
          'host', 'render');
        if (r.config.dpr > 1.25) {
          add('cap-dpr', 'Cap device pixel ratio at 1.25', '1.25',
            'DPR halves the fill cost per pixel — the biggest single win on retina.',
            'host', 'render');
        }
      }
      if (m.frameP99 > 28) {
        out.bottlenecks.push({ kind: 'stability', severity: 'medium', detail: 'Frame p99 ' + m.frameP99.toFixed(1) + 'ms' });
        add('reduce-count', 'Reduce particle / grid density', 'reduce density',
          'Fewer elements means less work per frame, which also flattens the tail.',
          'host', 'stability');
        add('increase-trails', 'Increase motion trails', '+0.15',
          'Trails raise the retention of the previous frame (the fade alpha), so a frame that ran long blends into the trail instead of snapping. They do NOT lower the per-frame work.',
          'host', 'stability');
      }
      if (m.quantAvg > 5) {
        out.bottlenecks.push({ kind: 'sampling', severity: 'medium', detail: 'Sampling error ' + m.quantAvg.toFixed(1) + 'ms (avg)' });
        if (!r.config.interpolate) {
          add('enable-interp', 'Enable frame interpolation', 'on',
            'Without interpolation the presented features are the newest sample — up to one audio period (16.7ms) old. Interpolating places the blend on the ideal label, so the sampling error goes to ~0.',
            'suite', 'sampling');
        }
        add('increase-buffer', 'Increase buffer capacity', '256',
          'A deeper buffer keeps more history, so the interpolator always finds the two samples that bracket the ideal label.',
          'suite', 'sampling');
      }
      if (isNum(m.featureJitter) && m.featureJitter > 0.015) {
        out.bottlenecks.push({ kind: 'smoothness', severity: 'medium', detail: 'Feature jitter ' + m.featureJitter.toFixed(4) + ' (mean of ' + m.featureSamples + ' frames)' });
        add('increase-smoothing', 'Raise audio smoothing', '+0.1',
          'Dampens the per-frame jitter in the feature values without changing the base look.',
          'host', 'smoothness');
      }

      /* the A/V clock offset is a MEASUREMENT of the host's clock, not a
         bottleneck: nothing the suite can do moves it. */
      out.measurements.push({
        label: 'A/V clock offset (run)',
        value: m.driftAvg,
        unit: 'ms',
        detail: 'The audio clock reads ' + m.driftAvg.toFixed(1) + 'ms from the video clock (peak ' + m.driftMax.toFixed(1) + 'ms). This is the host\'s own clock — no suggestion applies to it.'
      });

      /* a host-owned suggestion the host cannot act on is not offered */
      out.suggestions = sug.filter(function (s) {
        if (s.owner === 'suite') return true;
        return !host.supports || host.supports(s.id);
      });
      /* a bottleneck that ends up with no applicable suggestion says so */
      out.bottlenecks.forEach(function (b) {
        var covered = out.suggestions.some(function (s) { return s.targets.indexOf(b.kind) >= 0; });
        if (!covered) {
          b.note = 'no suggestion applies to this bottleneck';
          out.notes.push(b.kind + ': no suggestion applies to this bottleneck.');
        }
      });
      if (!out.suggestions.length && !out.bottlenecks.length) {
        out.notes.push('no bottleneck detected — the run is within target.');
      }
      return out;
    }

    /* ---------- applying suggestions ---------- */
    /* Every apply is verified: a host that exposes verify(id) is asked for
       the value before and after the change. A change that did not move
       the value is reported as FAILED — it is not a lie that it took. */
    function applySuggestions(suggestions) {
      var applied = [];
      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        var before = null, after = null, ok = false, reason = '';
        if (s.id === 'increase-buffer') {
          before = state.buffer.capacity;
          state.buffer.capacity = Math.max(state.buffer.capacity, 256);
          after = state.buffer.capacity;
          ok = after !== before;
          if (!ok) reason = 'the buffer was already at capacity ' + after;
        } else if (s.id === 'enable-interp') {
          before = !!state.cfg.interpolate;
          state.cfg.interpolate = true;
          state.interpDefault = true;
          after = !!state.cfg.interpolate;
          ok = after !== before;
          if (!ok) reason = 'interpolation was already on';
        } else {
          var canVerify = typeof host.verify === 'function';
          if (canVerify) before = host.verify(s.id);
          var took = typeof host.apply === 'function' && host.apply(s.id, s) === true;
          if (canVerify) after = host.verify(s.id);
          if (!took) {
            ok = false;
            reason = 'the host refused the change';
          } else if (canVerify && before != null && after != null && String(before) === String(after)) {
            ok = false;
            reason = 'the value did not change (' + String(before) + ' → ' + String(after) + ')';
          } else {
            ok = true;
          }
        }
        state.applyLog.push({
          id: s.id, label: s.label, owner: s.owner, before: before, after: after,
          ok: ok, reason: reason, at: Date.now()
        });
        if (ok) applied.push(s.id);
      }
      return applied;
    }

    /* ---------- persistence ---------- */
    function isValidReport(r) {
      if (!r || typeof r !== 'object') return false;
      if (typeof r.id !== 'string' || !r.id) return false;
      if (typeof r.version !== 'string' || !r.version) return false;
      if (typeof r.testName !== 'string') return false;
      if (!r.metrics || typeof r.metrics !== 'object') return false;
      if (!isNum(r.metrics.fpsAvg) || !isNum(r.metrics.frameP99)) return false;
      if (!r.scores || typeof r.scores !== 'object') return false;
      if (r.scores.grade != null && typeof r.scores.grade !== 'string') return false;
      if (r.scores.total != null && !isNum(r.scores.total)) return false;
      return true;
    }
    function loadReports() {
      var raw = null;
      try { raw = localStorage.getItem(REPORT_KEY); }
      catch (e) { raw = null; }
      if (!raw) { state.reports = []; state.droppedReports = 0; return; }
      var parsed = null;
      try { parsed = JSON.parse(raw); }
      catch (e) { parsed = null; }
      if (!Array.isArray(parsed)) {
        state.reports = [];
        state.droppedReports = 1;
        return;
      }
      var kept = [];
      var dropped = 0;
      for (var i = 0; i < parsed.length; i++) {
        if (isValidReport(parsed[i])) kept.push(parsed[i]);
        else dropped++;
      }
      state.reports = kept;
      state.droppedReports = dropped;
      if (dropped) saveReports();
    }
    function saveReports() {
      try { localStorage.setItem(REPORT_KEY, JSON.stringify(state.reports)); }
      catch (e) { /* the host surfaces this */ }
    }
    function saveReport(r) {
      state.reports.unshift(r);
      if (state.reports.length > 60) state.reports = state.reports.slice(0, 60);
      saveReports();
    }

    /* ---------- the runner ---------- */
    function runTest(name, cfgOverride, durationMs) {
      return new Promise(function (resolve) {
        var token = ++state.runToken;
        var base = Object.assign({}, state.cfg);
        var eff = Object.assign({}, base, cfgOverride || {});
        /* the toggle is the default; a test that names its own interpolation
           wins for that run only — the toggle is restored afterwards. */
        var fromTest = !!(cfgOverride && Object.prototype.hasOwnProperty.call(cfgOverride, 'interpolate'));
        eff.interpolate = fromTest ? !!cfgOverride.interpolate : state.interpDefault;
        state.cfg = eff;
        state.buffer.clear();
        state.startAt = performance.now();
        state.dtSamples = [];
        state.driftSamples = [];
        state.quantSamples = [];
        state.featureDiffs = [];
        state.counts = { dt: 0, drift: 0, feature: 0 };
        state.driftMax = 0;
        state.quantMax = 0;
        state.lastFeature = null;
        samplerPrimed = false;   // the run's first frame contributes no interval
        state.recording = true;
        if (host.onTestStart) host.onTestStart(state.cfg);
        setRunning(true, name);

        var startWall = Date.now();
        var tag = versionTag();
        var t0 = performance.now();
        var iv = setInterval(function () {
          if (token !== state.runToken) { clearInterval(iv); resolve(null); return; }
          if (els.bar) els.bar.style.width = (clamp((performance.now() - t0) / durationMs, 0, 1) * 100).toFixed(0) + '%';
        }, 60);

        setTimeout(function () {
          clearInterval(iv);
          if (token !== state.runToken) { resolve(null); return; }
          state.recording = false;
          var report = buildReport(name, startWall, tag, fromTest ? 'test' : 'toggle');
          /* the toggle is the default again — the next run is not silently
             bound to the last test's interpolation */
          state.cfg = Object.assign({}, base, { interpolate: state.interpDefault });
          saveReport(report);
          setRunning(false);
          renderReportList();
          renderCompareSelects();
          renderAdvisor(report);
          resolve(report);
        }, durationMs);
      });
    }

    /* the version label for a new report: the host's own tag first, then
       the panel's tag input */
    function versionTag() {
      if (typeof host.versionTag === 'function') {
        var t = host.versionTag();
        if (typeof t === 'string' && t.trim()) return t.trim();
      }
      if (els.tag && els.tag.value.trim()) return els.tag.value.trim();
      return null;
    }

    function setRunning(on, label) {
      if (els.indicator) els.indicator.classList.toggle('bench-on', !!on);
      if (els.runLabel) els.runLabel.textContent = on ? ('running · ' + (label || '')) : 'idle';
      if (els.stop) els.stop.disabled = !on;
      if (els.runAll) els.runAll.disabled = !!on;
      if (!on && els.bar) els.bar.style.width = '0%';
    }

    function currentDuration() {
      return els.mode && els.mode.value === 'quick' ? 1500 : 3000;
    }

    async function runSingle(t) {
      state.activeTest = t.name;
      try {
        var r = await runTest(t.name, t.cfg, currentDuration());
        if (r && host.onReport) host.onReport(r);
        return r;
      } finally {
        state.activeTest = null;
        setRunning(false);
      }
    }

    async function runAll() {
      if (state.activeTest) return;
      var duration = currentDuration();
      var results = [];
      var tests = host.tests ? host.tests() : [];
      for (var i = 0; i < tests.length; i++) {
        state.activeTest = tests[i].name;
        var r = await runTest(tests[i].name, tests[i].cfg, duration);
        if (!r) break;            // the run was cancelled
        results.push(r);
      }
      state.activeTest = null;
      setRunning(false);
      if (results.length) {
        var last = results[results.length - 1];
        renderAdvisor(last);
        if (host.onReport) host.onReport(last);
      }
      return results;
    }

    /* ---------- the panel UI ---------- */
    var PANEL_HTML = [
      '<div class="bench-panel">',
      '<div class="bench-run-status" id="benchRunIndicator"><span id="benchRunLabel">idle</span>',
      '<span class="bench-progress"><b id="benchRunBar"></b></span></div>',
      '<div class="bench-tabs" role="tablist">',
      '<button class="bench-on" data-bench-tab="run" role="tab">Run</button>',
      '<button data-bench-tab="buffer" role="tab">Buffer</button>',
      '<button data-bench-tab="reports" role="tab">Reports</button>',
      '<button data-bench-tab="compare" role="tab">Compare</button>',
      '<button data-bench-tab="ai" role="tab">Advisor</button>',
      '</div>',
      '<div class="bench-panels">',
      '<div class="bench-pane bench-on" data-bench-panel="run">',
      '<div class="bench-sec">Configuration</div>',
      '<div class="bench-row"><span>mode</span><select id="benchRunMode" aria-label="Run mode">',
      '<option value="quick">quick · 1.5s / test</option>',
      '<option value="full" selected>full · 3s / test</option></select></div>',
      '<div class="bench-row"><span>tag</span><input type="text" id="benchTagInput" placeholder="auto (YYYYMMDD-HHmm)"></div>',
      '<div class="bench-hint">The tag is used when the host provides no version tag of its own.</div>',
      '<div class="bench-btnrow"><button id="benchRunAll" class="bench-primary">▶ Run all tests</button><button id="benchStop" disabled>■ Stop</button></div>',
      '<div class="bench-sec">Individual tests</div><div id="benchTestList"></div>',
      '<div class="bench-sec">What is measured</div>',
      '<div class="bench-hint">Per test: FPS (avg / p50 / p95 / p99 — the percentiles are of the per-frame',
      ' rate), frame time (avg / p95 / p99), frame-time jitter (stddev), the <b>A/V clock offset</b>',
      ' (avg / max, ms — the host\'s own audio clock against the video clock) and the',
      ' <b>sampling error</b> (avg / max, ms — how far the presented content is from the ideal',
      ' label, which is what interpolation removes), plus feature jitter, buffer fill and memory',
      ' (Chrome only). Each report is scored across <b>render</b>, <b>stability</b> and',
      ' <b>sync</b>, then graded A+ → F. A run that collected no samples is reported as',
      ' "no data" and gets no grade.</div>',
      '</div>',
      '<div class="bench-pane" data-bench-panel="buffer">',
      '<div class="bench-sec">A/V sync buffer</div>',
      '<div class="buf-tag">Auto-created · always running</div>',
      '<div class="bench-hint" style="margin-top:8px">Features are pushed into a ring buffer with the',
      ' audio label they represent. The render asks for the ideal label of the current wall',
      ' time: with interpolation the blend is placed on that label, without it the newest',
      ' sample is presented (up to one audio period old). The clock offset and the sampling',
      ' error are measured separately — only the sampling error is the buffer\'s to fix.</div>',
      '<div class="buf-stats">',
      '<div class="stat"><div class="stat-label">Buffer fill</div><div class="stat-val" id="benchBufFill">0%</div><div class="fill-bar"><b id="benchBufFillBar"></b></div></div>',
      '<div class="stat"><div class="stat-label">Interpolation</div><div class="stat-val" id="benchBufInterp">on</div></div>',
      '<div class="stat"><div class="stat-label">A/V offset (live)</div><div class="stat-val" id="benchBufOffsetLive">0.0 <small>ms</small></div></div>',
      '<div class="stat"><div class="stat-label">Sampling error (live)</div><div class="stat-val" id="benchBufQuantLive">0.0 <small>ms</small></div></div>',
      '</div>',
      '<div class="bench-sec">Live A/V offset &amp; sampling error</div><canvas id="benchSpark"></canvas>',
      '<div class="bench-sec">Controls</div>',
      '<div class="bench-btnrow"><button id="benchToggleInterp">Toggle interpolation</button><button id="benchResetBuffer">Clear buffer</button></div>',
      '<div class="bench-hint">Interpolation: the toggle is the default — a test that names its own',
      ' interpolation wins for that run only, and the toggle is restored afterwards.</div>',
      '</div>',
      '<div class="bench-pane" data-bench-panel="reports">',
      '<div class="bench-sec">Saved reports</div>',
      '<div class="bench-hint">Every run is compiled into a versioned report saved to localStorage.</div>',
      '<div class="bench-btnrow"><button id="benchExport">↧ Export all</button><button id="benchClearReports" style="color:var(--suite-bad); border-color:rgba(255,90,90,.4)">✕ Clear all</button></div>',
      '<div id="benchReportList"></div>',
      '</div>',
      '<div class="bench-pane" data-bench-panel="compare">',
      '<div class="bench-sec">Compare two versions</div>',
      '<div class="compare-sel">',
      '<div><label style="font-size:10px;color:var(--suite-dim);letter-spacing:.1em">BASELINE</label><select id="benchCmpA" aria-label="Baseline report"></select></div>',
      '<div><label style="font-size:10px;color:var(--suite-dim);letter-spacing:.1em">CANDIDATE</label><select id="benchCmpB" aria-label="Candidate report"></select></div>',
      '</div><div id="benchCmpTable"></div>',
      '</div>',
      '<div class="bench-pane" data-bench-panel="ai"><div class="bench-sec">Advisor</div><div id="benchAdvisor">',
      '<div class="bench-hint">Run the benchmarks, then the advisor will grade the result, list the bottlenecks, and propose optimizations you can apply and re-run.</div>',
      '</div></div>',
      '</div>',
      '</div>'
    ].join('\n');

    var gradeClass = function (g) { return 'grade-' + String(g == null ? 'none' : g).replace('+', 'pos'); };
    var fmtScore = function (v) { return v == null ? '—' : v.toFixed(0); };
    var metricOf = function (r, key) {
      if (!r || !r.metrics || !isNum(r.metrics[key])) return null;
      return r.metrics[key];
    };

    function renderTestList() {
      if (!els.testList) return;
      var tests = host.tests ? host.tests() : [];
      els.testList.innerHTML = tests.map(function (t, i) {
        return '<div class="test-item"><div class="name">' + escapeHtml(t.name) +
          '<span class="desc">' + escapeHtml(t.desc || '') + '</span></div>' +
          '<button data-bench-test="' + i + '" aria-label="Run ' + escapeHtml(t.name) + '">▶</button></div>';
      }).join('');
      $$('[data-bench-test]', els.testList).forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.activeTest) return;
          var t = (host.tests ? host.tests() : [])[Number(b.dataset.benchTest)];
          if (t) runSingle(t);
        });
      });
    }

    function renderReportList() {
      if (!els.reportList) return;
      var head = '';
      if (state.droppedReports) {
        head += '<div class="bench-hint">Dropped ' + state.droppedReports + ' stored report(s) with an unusable shape — they could not be read back.</div>';
      }
      if (!state.reports.length) {
        els.reportList.innerHTML = head + '<div class="bench-hint">No reports yet — run a test.</div>';
        return;
      }
      els.reportList.innerHTML = head + state.reports.map(function (r) {
        var graded = r.scores && !r.scores.invalid;
        var badge = graded
          ? '<span class="grade-badge ' + gradeClass(r.scores.grade) + '">' + r.scores.grade + '</span>'
          : '<span class="grade-badge grade-none">no data</span>';
        var meta = graded
          ? escapeHtml(r.testName) + ' · ' + r.metrics.fpsAvg.toFixed(1) + ' fps · p99 ' +
            r.metrics.frameP99.toFixed(1) + 'ms · offset ' + r.metrics.driftAvg.toFixed(1) + 'ms'
          : escapeHtml(r.testName) + ' · no samples collected';
        return '<div class="report-card' + (r.id === state.selectedReportId ? ' selected' : '') +
          '" data-id="' + r.id + '"><div class="report-head"><b>' +
          escapeHtml(r.version) + '</b>' + badge + '</div><div class="report-meta">' +
          meta + '</div></div>';
      }).join('');
      $$('.report-card', els.reportList).forEach(function (c) {
        c.addEventListener('click', function () {
          var r = state.reports.find(function (x) { return x.id === c.dataset.id; });
          state.selectedReportId = c.dataset.id;
          if (r) { renderAdvisor(r); selectTab('ai'); }
          renderReportList();
        });
      });
    }

    function renderCompareSelects() {
      if (!els.cmpA || !els.cmpB) return;
      var keepA = els.cmpA.value, keepB = els.cmpB.value;
      var options = state.reports.map(function (r) {
        var g = (r.scores && !r.scores.invalid) ? r.scores.grade : 'no data';
        return '<option value="' + r.id + '">' + escapeHtml(r.version) + ' · ' + escapeHtml(r.testName) + ' · ' + g + '</option>';
      }).join('');
      els.cmpA.innerHTML = '<option value="">— baseline —</option>' + options;
      els.cmpB.innerHTML = '<option value="">— candidate —</option>' + options;
      /* keep the pair on screen when it still exists, else fall back to the
         two most recent reports */
      var has = function (id) { return !!id && state.reports.some(function (r) { return r.id === id; }); };
      if (!has(keepA)) keepA = state.reports.length >= 2 ? state.reports[1].id : (state.reports[0] ? state.reports[0].id : '');
      if (!has(keepB)) keepB = state.reports[0] ? state.reports[0].id : '';
      els.cmpA.value = keepA;
      els.cmpB.value = keepB;
      renderCompareTable();
    }

    function gradeNumeric(r) {
      if (!r || !r.scores || !r.scores.grade) return null;
      var g = r.scores.grade;
      return g === 'A+' ? 6 : g === 'A' ? 5 : g === 'B' ? 4 : g === 'C' ? 3 : g === 'D' ? 2 : 1;
    }

    function renderCompareTable() {
      if (!els.cmpA) return;
      var a = state.reports.find(function (r) { return r.id === els.cmpA.value; });
      var b = state.reports.find(function (r) { return r.id === els.cmpB.value; });
      if (!a || !b) { els.cmpTable.innerHTML = '<div class="bench-hint">Select two reports to compare.</div>'; return; }
      showCompare(a, b);
    }

    /* showCompare paints the table for a pair AND puts that same pair into
       the two dropdowns — the table and the selects never disagree. */
    function showCompare(a, b) {
      if (els.cmpA && els.cmpB) {
        els.cmpA.value = a.id;
        els.cmpB.value = b.id;
      }
      var rows = [
        { label: 'Grade', get: function (r) { return r.scores && !r.scores.invalid ? r.scores.grade : null; }, fmt: function (v) { return v == null ? '—' : v; }, unit: '' },
        { label: 'FPS avg', get: function (r) { return metricOf(r, 'fpsAvg'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'fps', higherBetter: true },
        { label: 'FPS p95', get: function (r) { return metricOf(r, 'fpsP95'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'fps', higherBetter: true },
        { label: 'Frame p99', get: function (r) { return metricOf(r, 'frameP99'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Jitter', get: function (r) { return metricOf(r, 'jitter'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(2); }, unit: 'ms', higherBetter: false },
        { label: 'A/V offset (run)', get: function (r) { return metricOf(r, 'driftAvg'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'A/V offset peak (run)', get: function (r) { return metricOf(r, 'driftMax'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Sampling error (run)', get: function (r) { return metricOf(r, 'quantAvg'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Sampling error peak (run)', get: function (r) { return metricOf(r, 'quantMax'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Feature jitter', get: function (r) { return metricOf(r, 'featureJitter'); }, fmt: function (v) { return v == null ? '—' : v.toFixed(4); }, unit: '', higherBetter: false }
      ];
      var html = '<table class="delta-table"><thead><tr><th>Metric</th><th class="num">Baseline</th><th class="num">Candidate</th><th class="num">Delta</th></tr></thead><tbody>';
      html += '<tr><td colspan="4" style="color:var(--suite-dim); font-size:10px; padding:4px 8px">' +
        escapeHtml(a.version) + ' (' + escapeHtml(a.testName) + ') → ' +
        escapeHtml(b.version) + ' (' + escapeHtml(b.testName) + ') ' +
        '<span style="color:var(--suite-dim)">— ' + escapeHtml(a.config.layerPreset || '') + ' → ' +
        escapeHtml(b.config.layerPreset || '') + '</span></td></tr>';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var va = r.get(a), vb = r.get(b);
        var deltaStr, cls;
        if (r.label === 'Grade') {
          var ga = gradeNumeric(a), gb = gradeNumeric(b);
          if (ga == null || gb == null) { deltaStr = '—'; cls = 'delta-neutral'; }
          else {
            var dg = gb - ga;
            deltaStr = dg > 0 ? '+' + dg : dg < 0 ? String(dg) : '—';
            cls = dg > 0 ? 'delta-good' : dg < 0 ? 'delta-bad' : 'delta-neutral';
          }
        } else if (va == null || vb == null) {
          deltaStr = '—'; cls = 'delta-neutral';
        } else {
          var d = vb - va;
          if (Math.abs(d) < 1e-9) { deltaStr = '—'; cls = 'delta-neutral'; }
          else {
            deltaStr = (d > 0 ? '+' : '−') + r.fmt(Math.abs(d));
            cls = r.higherBetter ? (d > 0 ? 'delta-good' : 'delta-bad') : (d < 0 ? 'delta-good' : 'delta-bad');
          }
        }
        html += '<tr><td>' + r.label + '</td><td class="num">' + r.fmt(va) +
          '<span style="color:var(--suite-dim)"> ' + (r.unit || '') + '</span></td><td class="num">' + r.fmt(vb) +
          '<span style="color:var(--suite-dim)"> ' + (r.unit || '') + '</span></td><td class="num ' + cls + '">' + deltaStr + '</td></tr>';
      }
      html += '</tbody></table>';
      /* the applied changes — a no-op apply is visible here */
      var log = state.applyLog.slice(-8).reverse();
      if (log.length) {
        html += '<div class="bench-sec">Applied changes</div>';
        html += log.map(function (l) {
          var cls = l.ok ? 'delta-good' : 'delta-bad';
          var val = l.before == null && l.after == null ? '—'
            : (l.before == null ? '—' : String(l.before)) + ' → ' + (l.after == null ? '—' : String(l.after));
          return '<div class="apply-row"><span class="apply-id">' + escapeHtml(l.label) + '</span>' +
            '<span class="apply-val">' + escapeHtml(val) + '</span>' +
            '<span class="' + cls + '">' + (l.ok ? 'applied' : 'no effect') + '</span>' +
            (l.ok ? '' : '<span class="apply-why">' + escapeHtml(l.reason || '') + '</span>') + '</div>';
        }).join('');
      }
      els.cmpTable.innerHTML = html;
    }

    function renderAdvisor(report) {
      if (!els.advisor) return;
      var ai = report.ai || analyze(report);
      var sc = report.scores;
      var html = '';
      if (!sc || sc.invalid) {
        html += '<div class="grade-card"><div class="grade-big grade-none" style="display:inline-block; padding:6px 18px; border-radius:10px; border:1px solid rgba(255,255,255,.1)">no data</div>' +
          '<div class="grade-score">no samples collected · ' + escapeHtml(report.testName) + '</div></div>';
      } else {
        html += '<div class="grade-card"><div class="grade-big ' + gradeClass(sc.grade) +
          '" style="display:inline-block; padding:6px 18px; border-radius:10px; border:1px solid rgba(255,255,255,.1)">' +
          sc.grade + '</div><div class="grade-score">' + sc.total.toFixed(1) + ' / 100 · ' + escapeHtml(report.testName) + '</div>' +
          '<div class="score-bars">' +
          '<div><div class="score-bar-label">Render</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + (sc.render == null ? 0 : sc.render.toFixed(0)) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--suite-txt)">' + fmtScore(sc.render) + '</div></div>' +
          '<div><div class="score-bar-label">Stability</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + (sc.stability == null ? 0 : sc.stability.toFixed(0)) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--suite-txt)">' + fmtScore(sc.stability) + '</div></div>' +
          '<div><div class="score-bar-label">Sync</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + (sc.sync == null ? 0 : sc.sync.toFixed(0)) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--suite-txt)">' + fmtScore(sc.sync) + '</div></div>' +
          '</div></div>';
      }
      if (ai.measurements && ai.measurements.length) {
        html += '<div class="bench-sec">Measurements</div>';
        html += ai.measurements.map(function (m) {
          return '<div class="bottleneck info"><div class="kind">' + escapeHtml(m.label) + '</div>' +
            '<div class="detail">' + escapeHtml(m.detail) + '</div></div>';
        }).join('');
      }
      html += '<div class="bench-sec">Bottlenecks</div>';
      html += (ai.bottlenecks.length ? ai.bottlenecks.map(function (b) {
        return '<div class="bottleneck ' + b.severity + '"><div class="kind">' + escapeHtml(b.kind) + ' · ' + escapeHtml(b.severity) + '</div>' +
          '<div class="detail">' + escapeHtml(b.detail) + '</div>' +
          (b.note ? '<div class="detail" style="color:var(--suite-dim)">' + escapeHtml(b.note) + '</div>' : '') + '</div>';
      }).join('') : '<div class="bench-hint">No bottlenecks detected — the run is within target.</div>');
      html += '<div class="bench-sec">Suggestions</div>';
      if (ai.suggestions.length) {
        html += ai.suggestions.map(function (s, i) {
          return '<div class="suggestion"><input type="checkbox" data-bench-sug="' + i + '" checked><div class="body">' +
            '<div class="label">' + escapeHtml(s.label) + '</div><div class="detail">' + escapeHtml(s.detail) +
            '</div><div class="delta">' + escapeHtml(s.delta) + '</div></div></div>';
        }).join('');
      } else if (ai.bottlenecks.length) {
        html += '<div class="bench-hint">No suggestion applies to the bottleneck(s) above — see the notes there.</div>';
      } else {
        html += '<div class="bench-hint">Nothing to apply — no bottleneck was detected in this run.</div>';
      }
      if (ai.notes && ai.notes.length) {
        html += '<div class="bench-sec">Notes</div>' + ai.notes.map(function (n) {
          return '<div class="bench-hint">' + escapeHtml(n) + '</div>';
        }).join('');
      }
      if (ai.applyNotes && ai.applyNotes.length) {
        html += '<div class="bench-sec">Apply log</div>' + ai.applyNotes.map(function (n) {
          return '<div class="bottleneck high"><div class="kind">apply had no effect</div><div class="detail">' + escapeHtml(n) + '</div></div>';
        }).join('');
      }
      html += '<div class="bench-btnrow" style="margin-top:12px"><button id="benchApply" class="bench-primary" ' +
        (ai.suggestions.length ? '' : 'disabled') + '>✓ Apply selected &amp; re-run</button>' +
        '<button id="benchAutoOpt">⚡ Auto-optimize loop</button></div>';
      els.advisor.innerHTML = html;

      var applyBtn = $('#benchApply', els.advisor);
      if (applyBtn) applyBtn.addEventListener('click', async function () {
        var checked = $$('[data-bench-sug]:checked', els.advisor).map(function (c) { return ai.suggestions[Number(c.dataset.benchSug)]; });
        if (!checked.length) { host.toast && host.toast('Select at least one suggestion'); return; }
        var before = report;
        var applied = applySuggestions(checked);
        var failed = state.applyLog.slice(-checked.length).filter(function (l) { return !l.ok; });
        if (host.toast) {
          host.toast('Applied: ' + (applied.join(', ') || 'nothing') +
            (failed.length ? ' · FAILED: ' + failed.map(function (l) { return l.id + ' (apply had no effect)'; }).join(', ') : ''));
        }
        var r = await runTest('optimized', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (r) {
          renderAdvisor(r);
          renderCompareSelects();
          showCompare(before, r);
          selectTab('compare');
        }
      });

      var autoBtn = $('#benchAutoOpt', els.advisor);
      if (autoBtn) autoBtn.addEventListener('click', async function () {
        var pass1 = await runTest('auto-pass-1', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (!pass1) return;
        var sug = (pass1.ai || analyze(pass1)).suggestions;
        var applied = applySuggestions(sug);
        var failed = state.applyLog.slice(-sug.length).filter(function (l) { return !l.ok; });
        if (host.toast) {
          host.toast('Applied: ' + (applied.join(', ') || 'none') +
            (failed.length ? ' · FAILED: ' + failed.map(function (l) { return l.id + ' (apply had no effect)'; }).join(', ') : ''));
        }
        var pass2 = await runTest('auto-pass-2', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (!pass2) return;
        renderAdvisor(pass2);
        renderCompareSelects();
        showCompare(pass1, pass2);
        selectTab('compare');
      });
    }

    /* ---------- the buffer view ---------- */
    /* size the backing store whenever the layout size changed (or was
       never measured — the Buffer tab is display:none until it is opened) */
    function sizeSpark() {
      var c = els.spark;
      if (!c) return null;
      var w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return null;              // no layout size yet
      var dpr = window.devicePixelRatio || 1;
      var bw = Math.max(1, Math.round(w * dpr));
      var bh = Math.max(1, Math.round(h * dpr));
      if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
      return { w: w, h: h, dpr: dpr };
    }

    function updateBufferView(sample) {
      if (!els.spark || !sample) return;
      if (sample.valid === false) return;     // no buffer data: nothing to show
      var off = Math.abs(sample.offset || 0);
      var qnt = Math.abs(sample.quant || 0);
      state.live.offsets.push(off);
      if (state.live.offsets.length > MAX_LIVE) state.live.offsets.shift();
      state.live.quants.push(qnt);
      if (state.live.quants.length > MAX_LIVE) state.live.quants.shift();
      sparkData.push({ o: off, q: qnt });
      if (sparkData.length > 120) sparkData.shift();

      var sz = sizeSpark();
      if (!sz) return;                        // the tab is hidden: nothing to paint
      var sctx = els.spark.getContext('2d');
      var w = sz.w, h = sz.h;
      sctx.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
      sctx.clearRect(0, 0, w, h);
      sctx.fillStyle = '#060a10';
      sctx.fillRect(0, 0, w, h);
      var max = Math.max(5, maxOf(sparkData.map(function (d) { return d.o; })), maxOf(sparkData.map(function (d) { return d.q; })));
      var bw = w / Math.max(1, sparkData.length);
      /* the sampling error as bars */
      for (var i = 0; i < sparkData.length; i++) {
        var v = sparkData[i].q;
        var bh = clamp(v / max, 0, 1) * (h - 6);
        sctx.fillStyle = v > 16 ? '#ff5a5a' : v > 8 ? '#ffb454' : 'rgba(120,140,170,.55)';
        sctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
      }
      /* the clock offset as a line */
      sctx.beginPath();
      sctx.strokeStyle = '#4de3d0';
      sctx.lineWidth = 1.2;
      for (var j = 0; j < sparkData.length; j++) {
        var y = h - clamp(sparkData[j].o / max, 0, 1) * (h - 6) - 3;
        var x = j * bw + bw / 2;
        if (j === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
      }
      sctx.stroke();

      if (Math.random() < 0.1) {
        if (els.bufFill) {
          var fill = state.buffer.buf.length / state.buffer.capacity * 100;
          els.bufFill.innerHTML = Math.round(fill) + '%';
          els.bufFillBar.style.width = fill + '%';
        }
        if (els.bufInterp) els.bufInterp.textContent = state.interpDefault ? 'on' : 'off';
        var offs = state.live.offsets, quants = state.live.quants;
        if (offs.length && els.bufOffsetLive) {
          var oavg = offs.reduce(function (s, x) { return s + x; }, 0) / offs.length;
          els.bufOffsetLive.innerHTML = oavg.toFixed(1) + ' <small>ms · avg, live</small>';
          els.bufOffsetLive.className = 'stat-val ' + (oavg > 16 ? 'bad' : oavg > 8 ? '' : 'ok');
        }
        if (quants.length && els.bufQuantLive) {
          var qavg = quants.reduce(function (s, x) { return s + x; }, 0) / quants.length;
          els.bufQuantLive.innerHTML = qavg.toFixed(1) + ' <small>ms · avg, live</small>';
          els.bufQuantLive.className = 'stat-val ' + (qavg > 8 ? 'bad' : qavg > 2 ? '' : 'ok');
        }
      }
    }

    function selectTab(name) {
      $$('.bench-tabs button', els.root).forEach(function (x) { x.classList.toggle('bench-on', x.dataset.benchTab === name); });
      $$('.bench-pane', els.root).forEach(function (p) { p.classList.toggle('bench-on', p.dataset.benchPanel === name); });
    }

    /* ---------- mount ---------- */
    function mount(root) {
      if (state.mounted) return api;
      els.root = root;
      root.innerHTML = PANEL_HTML;
      els.mode = $('#benchRunMode', root);
      els.tag = $('#benchTagInput', root);
      els.runAll = $('#benchRunAll', root);
      els.stop = $('#benchStop', root);
      els.indicator = $('#benchRunIndicator', root);
      els.runLabel = $('#benchRunLabel', root);
      els.bar = $('#benchRunBar', root);
      els.testList = $('#benchTestList', root);
      els.reportList = $('#benchReportList', root);
      els.cmpA = $('#benchCmpA', root);
      els.cmpB = $('#benchCmpB', root);
      els.cmpTable = $('#benchCmpTable', root);
      els.advisor = $('#benchAdvisor', root);
      els.spark = $('#benchSpark', root);
      els.bufFill = $('#benchBufFill', root);
      els.bufFillBar = $('#benchBufFillBar', root);
      els.bufInterp = $('#benchBufInterp', root);
      els.bufOffsetLive = $('#benchBufOffsetLive', root);
      els.bufQuantLive = $('#benchBufQuantLive', root);

      $$('.bench-tabs button', root).forEach(function (b) {
        b.addEventListener('click', function () { selectTab(b.dataset.benchTab); });
      });
      if (els.runAll) els.runAll.addEventListener('click', function () { runAll(); });
      if (els.stop) els.stop.addEventListener('click', function () {
        state.runToken++;          // cancels the pending run
        state.recording = false;
        state.activeTest = null;
        setRunning(false);
        if (els.runLabel) els.runLabel.textContent = 'stopped';
        if (host.toast) host.toast('Stopped — the run was cancelled.');
      });
      var toggle = $('#benchToggleInterp', root);
      if (toggle) toggle.addEventListener('click', function () {
        state.interpDefault = !state.interpDefault;
        state.cfg.interpolate = state.interpDefault;
        if (els.bufInterp) els.bufInterp.textContent = state.interpDefault ? 'on' : 'off';
        if (host.toast) host.toast('Interpolation ' + (state.interpDefault ? 'on' : 'off') + ' (default for tests that do not set their own)');
      });
      var reset = $('#benchResetBuffer', root);
      if (reset) reset.addEventListener('click', function () {
        state.buffer.clear();
        sparkData.length = 0;
        if (host.toast) host.toast('Buffer cleared');
      });
      var exp = $('#benchExport', root);
      if (exp) exp.addEventListener('click', function () {
        if (!state.reports.length) { if (host.toast) host.toast('No reports to export'); return; }
        var blob = new Blob([JSON.stringify(state.reports, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'swr-bench-reports-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        if (host.toast) host.toast('Exported ' + state.reports.length + ' reports');
      });
      var clr = $('#benchClearReports', root);
      if (clr) clr.addEventListener('click', function () {
        if (!state.reports.length) return;
        if (!confirm('Delete all saved reports?')) return;
        state.reports = [];
        state.droppedReports = 0;
        saveReports();
        renderReportList();
        renderCompareSelects();
        if (host.toast) host.toast('Reports cleared');
      });
      if (els.cmpA) els.cmpA.addEventListener('change', renderCompareTable);
      if (els.cmpB) els.cmpB.addEventListener('change', renderCompareTable);

      loadReports();
      renderTestList();
      renderReportList();
      renderCompareSelects();
      startClock();
      setRunning(false);
      state.mounted = true;
      return api;
    }

    function unmount() {
      stopClock();
      state.mounted = false;
      state.recording = false;
      els = {};
    }

    var api = {
      mount: mount,
      unmount: unmount,
      state: state,
      buffer: state.buffer,
      runTest: runTest,
      runAll: runAll,
      analyze: analyze,
      applySuggestions: applySuggestions,
      selectTab: selectTab,
      renderAdvisor: renderAdvisor,
      renderReportList: renderReportList,
      renderCompareSelects: renderCompareSelects,
      updateBufferView: updateBufferView,
      get reports() { return state.reports; },
      get applyLog() { return state.applyLog; },
      /* The VIDEO side of the buffer: the host's render loop calls this with
         the current video time and gets the features to draw plus the two
         measured quantities:
           offset — the A/V clock offset (signed, ms): how far the audio
                    clock is from the video clock. The host's own property.
           quant  — the sampling error (signed, ms): how far the presented
                    content is from the ideal label. What interpolation
                    removes.
         A frame with no buffer data is not measured at all. */
      sampleAt: function (tVideoSec) {
        var ideal = audioClockAt(tVideoSec);
        var presented = state.buffer.sampleAtLabel(ideal, state.cfg.interpolate);
        if (!presented || !presented.f) {
          return { f: null, t: null, offset: null, quant: null, valid: false };
        }
        var offset = (tVideoSec - ideal) * 1000;
        var quant = (presented.t - ideal) * 1000;
        if (state.recording) {
          state.driftSamples.push(Math.abs(offset));
          if (state.driftSamples.length > MAX_SAMPLES) state.driftSamples.shift();
          state.counts.drift++;
          if (Math.abs(offset) > state.driftMax) state.driftMax = Math.abs(offset);
          state.quantSamples.push(Math.abs(quant));
          if (state.quantSamples.length > MAX_SAMPLES) state.quantSamples.shift();
          if (Math.abs(quant) > state.quantMax) state.quantMax = Math.abs(quant);
          /* the per-frame change of the feature vector — the real signal
             behind the smoothness bottleneck */
          var f = presented.f;
          if (state.lastFeature) {
            var sum = 0, n = 0;
            for (var k in f) {
              if (isNum(f[k]) && isNum(state.lastFeature[k])) { sum += Math.abs(f[k] - state.lastFeature[k]); n++; }
            }
            if (n) {
              state.featureDiffs.push(sum / n);
              if (state.featureDiffs.length > MAX_SAMPLES) state.featureDiffs.shift();
              state.counts.feature++;
            }
          }
          state.lastFeature = Object.assign({}, f);
        } else {
          state.lastFeature = Object.assign({}, presented.f);
        }
        return { f: presented.f, t: presented.t, offset: offset, quant: quant, valid: true };
      },
      /* the run-scoped mean of |offset| — the A/V clock offset */
      get driftAvg() {
        var d = state.driftSamples;
        if (!d.length) return 0;
        return d.reduce(function (s, x) { return s + x; }, 0) / d.length;
      },
      /* the run-scoped mean of |quant| — the sampling error */
      get quantAvg() {
        var q = state.quantSamples;
        if (!q.length) return 0;
        return q.reduce(function (s, x) { return s + x; }, 0) / q.length;
      }
    };
    return api;
  }

  window.SWR_BENCH = {
    AVSyncBuffer: AVSyncBuffer,
    createSuite: createSuite,
  };
})();
