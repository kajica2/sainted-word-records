/* lib/bench-suite.client.js — the shared benchmark & A/V sync suite.
 *
 * One implementation, two hosts:
 *   - /bench          measures the lab's own stage
 *   - /preset-editor  measures the EDITOR's stage and the editor's own
 *                     preset, and applies the advisor's suggestions to
 *                     that preset
 *
 * The host supplies four things:
 *   host.tests()            → [{ name, desc, cfg }]         what to measure
 *   host.sample(tSec)       → { features, audioTime }      the feature source
 *   host.reportConfig()     → {...}                        what goes in a report
 *   host.supports(id)       → bool                         can it apply this?
 *   host.apply(id, value)   → bool                         apply it
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
     THE A/V SYNC BUFFER

     Features are pushed in with the time they REPRESENT; the render
     loop samples the buffer at video time with linear interpolation,
     so the audio and video clocks never have to agree — drift is
     measured, not assumed.
     ============================================================ */
  function AVSyncBuffer(capacity) {
    this.capacity = capacity || 128;
    this.buf = [];
    this.pushes = 0;
    this.driftSamples = [];
  }
  AVSyncBuffer.prototype.push = function (features, tAudio) {
    this.pushes++;
    this.buf.push({ t: tAudio, f: Object.assign({}, features) });
    while (this.buf.length > this.capacity) this.buf.shift();
  };
  AVSyncBuffer.prototype.sampleAt = function (tVideo, interpolate) {
    if (!this.buf.length) return { f: null, t: -1, drift: 0 };
    var a = null, b = null;
    for (var i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= tVideo && this.buf[i + 1].t >= tVideo) { a = this.buf[i]; b = this.buf[i + 1]; break; }
    }
    if (!a) a = tVideo < this.buf[0].t ? this.buf[0] : this.buf[this.buf.length - 1];
    var result;
    if (interpolate && a && b) {
      var alpha = clamp((tVideo - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
      var f = {};
      for (var k in a.f) f[k] = a.f[k] + (b.f[k] - a.f[k]) * alpha;
      result = { f: f, t: a.t + (b.t - a.t) * alpha };
    } else {
      result = { f: Object.assign({}, a.f), t: a.t };
    }
    var drift = Math.abs(tVideo - result.t) * 1000;
    this.driftSamples.push(drift);
    if (this.driftSamples.length > 500) this.driftSamples.shift();
    return { f: result.f, t: result.t, drift: drift };
  };
  AVSyncBuffer.prototype.clear = function () {
    this.buf.length = 0; this.pushes = 0; this.driftSamples.length = 0;
  };

  /* ============================================================
     THE SUITE
     ============================================================ */
  function createSuite(host) {
    var REPORT_KEY = 'swr.bench.reports.v1';
    var AUDIO_HZ = 60;
    var AUDIO_PERIOD = 1000 / AUDIO_HZ;

    var state = {
      cfg: { interpolate: true, injectAudioDrift: 0, dpr: 0, smoothing: 0.7, trails: 0.4, reactivity: 1.5, layers: [] },
      buffer: new AVSyncBuffer(128),
      startAt: performance.now(),
      lastNow: 0,
      recording: false,
      dtSamples: [],
      driftSamples: [],
      featureDiffs: [],
      lastFeature: null,
      audioTimer: null,
      activeTest: null,
      runToken: 0,
      reports: [],
      mounted: false
    };

    var els = {};
    var sparkData = [];

    /* ---------- the audio clock ---------- */
    function pushAudio() {
      var tSec = (performance.now() - state.startAt) / 1000;
      var s = host.sample(tSec);
      if (!s) return;
      state.buffer.push(s.features, s.audioTime);
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
    var lastSampleAt = 0;
    function sampleFrame(now) {
      var dt = now - lastSampleAt;
      lastSampleAt = now;
      if (state.recording && dt > 0) state.dtSamples.push(dt);
      requestAnimationFrame(sampleFrame);
    }
    requestAnimationFrame(sampleFrame);

    /* ---------- the report ---------- */
    function scoreReport(m) {
      var render = clamp(m.fpsAvg / 60 * 100, 0, 100);
      var stability = clamp(100 - Math.max(0, m.frameP99 - 16.67) * 2, 0, 100);
      var sync = clamp(100 - m.driftAvg * 4, 0, 100);
      var total = render * 0.4 + stability * 0.3 + sync * 0.3;
      var grade = total >= 95 ? 'A+' : total >= 90 ? 'A' : total >= 80 ? 'B'
                : total >= 70 ? 'C' : total >= 60 ? 'D' : 'F';
      return { render: render, stability: stability, sync: sync, total: total, grade: grade };
    }

    function buildReport(testName, startWall, tag) {
      var fs = computeStats(state.dtSamples);
      var ds = computeStats(state.driftSamples);
      var xd = computeStats(state.featureDiffs);
      var metrics = {
        duration: (Date.now() - startWall) / 1000,
        videoSamples: state.dtSamples.length,
        audioSamples: state.buffer.pushes,
        fpsAvg: fs ? 1000 / fs.mean : 0,
        fpsP50: fs ? 1000 / fs.p50 : 0,
        fpsP95: fs ? 1000 / fs.p95 : 0,
        fpsP99: fs ? 1000 / fs.p99 : 0,
        frameAvg: fs ? fs.mean : 0,
        frameP50: fs ? fs.p50 : 0,
        frameP95: fs ? fs.p95 : 0,
        frameP99: fs ? fs.p99 : 0,
        jitter: fs ? fs.sd : 0,
        driftAvg: ds ? ds.mean : 0,
        driftP95: ds ? ds.p95 : 0,
        driftMax: state.driftSamples.length ? Math.max.apply(null, state.driftSamples) : 0,
        featureJitter: xd ? xd.sd : 0,
        bufferFill: state.buffer.buf.length / state.buffer.capacity,
        memoryMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null
      };
      var report = {
        id: uid(),
        version: tag || ('v-' + new Date(startWall).toISOString().slice(0, 16).replace(/[:T]/g, '-')),
        testName: testName,
        timestamp: startWall,
        config: host.reportConfig(),
        metrics: metrics,
        scores: scoreReport(metrics)
      };
      report.ai = analyze(report);
      return report;
    }

    /* ---------- the advisor (heuristic, rules-based) ---------- */
    function analyze(r) {
      var m = r.metrics;
      var suggestions = [];
      var bottlenecks = [];
      if (m.fpsP95 < 50) {
        bottlenecks.push({ kind: 'render', severity: 'high', detail: 'P95 FPS ' + m.fpsP95.toFixed(1) });
        suggestions.push({ id: 'reduce-count', label: 'Reduce particle / grid density', delta: '-40%',
          detail: 'Heavy layers dominate frame time. Cut particle count and grid rows/cols.' });
        if (r.config.dpr > 1.25) {
          suggestions.push({ id: 'cap-dpr', label: 'Cap device pixel ratio at 1.25', delta: '1.25',
            detail: 'DPR halves fill cost per pixel — biggest single win on retina.' });
        }
      }
      if (m.frameP99 > 28) {
        bottlenecks.push({ kind: 'stability', severity: 'medium', detail: 'Frame P99 ' + m.frameP99.toFixed(1) + 'ms' });
        suggestions.push({ id: 'increase-trails', label: 'Increase motion trails', delta: '+0.15',
          detail: 'Trails reuse the previous buffer — longer fades cost less than fresh redraws.' });
      }
      if (m.driftAvg > 12) {
        bottlenecks.push({ kind: 'sync', severity: 'high', detail: 'A/V drift ' + m.driftAvg.toFixed(1) + 'ms' });
        if (!r.config.interpolate) {
          suggestions.push({ id: 'enable-interp', label: 'Enable frame interpolation', delta: 'on',
            detail: 'Buffer samples between audio ticks so video never sees stale features.' });
        }
        suggestions.push({ id: 'increase-buffer', label: 'Increase buffer capacity', delta: '256',
          detail: 'More samples decouples audio jitter from video timing at minimal memory cost.' });
      }
      if (m.featureJitter > 0.015) {
        bottlenecks.push({ kind: 'smoothness', severity: 'medium', detail: 'Feature jitter ' + m.featureJitter.toFixed(4) });
        suggestions.push({ id: 'increase-smoothing', label: 'Raise audio smoothing', delta: '+0.1',
          detail: 'Dampens per-frame jitter in feature values without affecting the base look.' });
      }
      if (m.driftMax > 40) {
        bottlenecks.push({ kind: 'sync-spike', severity: 'medium', detail: 'Drift peak ' + m.driftMax.toFixed(0) + 'ms' });
      }
      // a suggestion the host cannot act on is not offered
      suggestions = suggestions.filter(function (s) { return !host.supports || host.supports(s.id); });
      return { grade: r.scores.grade, score: r.scores.total, bottlenecks: bottlenecks, suggestions: suggestions };
    }

    function applySuggestions(suggestions) {
      var applied = [];
      for (var i = 0; i < suggestions.length; i++) {
        var s = suggestions[i];
        // the suite's own knobs first
        if (s.id === 'increase-buffer') {
          state.buffer.capacity = Math.max(state.buffer.capacity, 256);
          applied.push(s.id);
          continue;
        }
        if (s.id === 'enable-interp') {
          state.cfg.interpolate = true;
          applied.push(s.id);
          continue;
        }
        if (host.apply && host.apply(s.id, s) === true) applied.push(s.id);
      }
      return applied;
    }

    /* ---------- persistence ---------- */
    function loadReports() {
      try {
        var raw = localStorage.getItem(REPORT_KEY);
        if (raw) state.reports = JSON.parse(raw);
      } catch (e) { state.reports = []; }
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
        state.cfg = Object.assign({}, state.cfg, cfgOverride || {});
        state.buffer.clear();
        state.startAt = performance.now();
        state.lastNow = 0;
        state.lastFeature = null;
        state.dtSamples = [];
        state.driftSamples = [];
        state.featureDiffs = [];
        state.recording = true;
        if (host.onTestStart) host.onTestStart(state.cfg);

        var startWall = Date.now();
        var tag = (els.tag && els.tag.value.trim()) || (els.version && els.version.value.trim()) || null;
        var t0 = performance.now();
        var iv = setInterval(function () {
          if (token !== state.runToken) { clearInterval(iv); resolve(null); return; }
          if (els.bar) els.bar.style.width = (clamp((performance.now() - t0) / durationMs, 0, 1) * 100).toFixed(0) + '%';
        }, 60);

        setTimeout(function () {
          clearInterval(iv);
          if (token !== state.runToken) { resolve(null); return; }
          state.recording = false;
          var report = buildReport(name, startWall, tag);
          saveReport(report);
          renderReportList();
          renderCompareSelects();
          renderAdvisor(report);
          resolve(report);
        }, durationMs);
      });
    }

    function currentDuration() {
      return els.mode && els.mode.value === 'quick' ? 1500 : 3000;
    }

    async function runSingle(t) {
      state.activeTest = t.name;
      if (els.indicator) els.indicator.classList.add('on');
      if (els.runLabel) els.runLabel.textContent = 'running · ' + t.name;
      if (els.bar) els.bar.style.width = '0%';
      if (els.runAll) els.runAll.disabled = true;
      try {
        var r = await runTest(t.name, t.cfg, currentDuration());
        if (r && host.onReport) host.onReport(r);
        return r;
      } finally {
        state.activeTest = null;
        if (els.indicator) els.indicator.classList.remove('on');
        if (els.runAll) els.runAll.disabled = false;
      }
    }

    async function runAll() {
      if (state.activeTest) return;
      var duration = currentDuration();
      var results = [];
      if (els.runAll) els.runAll.disabled = true;
      if (els.indicator) els.indicator.classList.add('on');
      var tests = host.tests ? host.tests() : [];
      for (var i = 0; i < tests.length; i++) {
        state.activeTest = tests[i].name;
        if (els.runLabel) els.runLabel.textContent = 'running · ' + tests[i].name;
        if (els.bar) els.bar.style.width = '0%';
        var r = await runTest(tests[i].name, tests[i].cfg, duration);
        if (r) results.push(r);
      }
      state.activeTest = null;
      if (els.indicator) els.indicator.classList.remove('on');
      if (els.runAll) els.runAll.disabled = false;
      if (results.length) {
        var last = results[results.length - 1];
        renderAdvisor(last);
        if (host.onReport) host.onReport(last);
      }
      return results;
    }

    /* ---------- the panel UI ---------- */
    var PANEL_HTML = [
      '<div class="tabs" role="tablist">',
      '<button class="on" data-tab="run" role="tab">Run</button>',
      '<button data-tab="buffer" role="tab">Buffer</button>',
      '<button data-tab="reports" role="tab">Reports</button>',
      '<button data-tab="compare" role="tab">Compare</button>',
      '<button data-tab="ai" role="tab">Advisor</button>',
      '</div>',
      '<div class="panels">',
      '<div class="panel on" data-panel="run">',
      '<div class="sec">Configuration</div>',
      '<div class="row"><span>mode</span><select id="benchRunMode" aria-label="Run mode">',
      '<option value="quick">quick · 1.5s / test</option>',
      '<option value="full" selected>full · 3s / test</option></select></div>',
      '<div class="row"><span>tag</span><input type="text" id="benchTagInput" placeholder="auto (YYYYMMDD-HHmm)"></div>',
      '<div class="btnrow"><button id="benchRunAll" class="primary">▶ Run all tests</button><button id="benchStop" disabled>■ Stop</button></div>',
      '<div class="sec">Individual tests</div><div id="benchTestList"></div>',
      '<div class="sec">What is measured</div>',
      '<div class="hint">Per-test: FPS (avg / p50 / p95 / p99), frame time (avg / p95 / p99), jitter (stddev),',
      ' A/V drift (avg / max, ms), feature jitter, buffer fill, memory (Chrome only). Each report is',
      ' scored across <b>render</b>, <b>stability</b> and <b>sync</b>, then graded A+ → F.</div>',
      '</div>',
      '<div class="panel" data-panel="buffer">',
      '<div class="sec">A/V sync buffer</div>',
      '<div class="buf-tag">Auto-created · always running</div>',
      '<div class="hint" style="margin-top:8px">Features are pushed into a ring buffer with the time they',
      ' represent. The render samples the buffer at video time with linear interpolation, so the two',
      ' clocks never have to agree — drift is measured, not assumed.</div>',
      '<div class="buf-stats">',
      '<div class="stat"><div class="stat-label">Buffer fill</div><div class="stat-val" id="benchBufFill">0%</div><div class="fill-bar"><b id="benchBufFillBar"></b></div></div>',
      '<div class="stat"><div class="stat-label">Interpolation</div><div class="stat-val" id="benchBufInterp">on</div></div>',
      '<div class="stat"><div class="stat-label">Drift avg</div><div class="stat-val" id="benchBufDriftAvg">0.0 <small>ms</small></div></div>',
      '<div class="stat"><div class="stat-label">Drift max</div><div class="stat-val" id="benchBufDriftMax">0.0 <small>ms</small></div></div>',
      '</div>',
      '<div class="sec">Live drift</div><canvas id="benchSpark"></canvas>',
      '<div class="sec">Controls</div>',
      '<div class="btnrow"><button id="benchToggleInterp">Toggle interpolation</button><button id="benchResetBuffer">Clear buffer</button></div>',
      '</div>',
      '<div class="panel" data-panel="reports">',
      '<div class="sec">Saved reports</div>',
      '<div class="hint">Every run is compiled into a versioned report saved to localStorage.</div>',
      '<div class="btnrow"><button id="benchExport">↧ Export all</button><button id="benchClearReports" style="color:var(--bad); border-color:rgba(255,90,90,.4)">✕ Clear all</button></div>',
      '<div id="benchReportList"></div>',
      '</div>',
      '<div class="panel" data-panel="compare">',
      '<div class="sec">Compare two versions</div>',
      '<div class="compare-sel">',
      '<div><label style="font-size:10px;color:var(--dim);letter-spacing:.1em">BASELINE</label><select id="benchCmpA" aria-label="Baseline report"></select></div>',
      '<div><label style="font-size:10px;color:var(--dim);letter-spacing:.1em">CANDIDATE</label><select id="benchCmpB" aria-label="Candidate report"></select></div>',
      '</div><div id="benchCmpTable"></div>',
      '</div>',
      '<div class="panel" data-panel="ai"><div class="sec">Advisor</div><div id="benchAdvisor">',
      '<div class="hint">Run the benchmarks, then the advisor will grade the result, list the bottlenecks, and propose optimizations you can apply and re-run.</div>',
      '</div></div>',
      '</div>'
    ].join('\n');

    var gradeClass = function (g) { return 'grade-' + String(g).replace('+', 'pos'); };

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
      if (!state.reports.length) {
        els.reportList.innerHTML = '<div class="hint">No reports yet — run a test.</div>';
        return;
      }
      els.reportList.innerHTML = state.reports.map(function (r) {
        return '<div class="report-card" data-id="' + r.id + '"><div class="report-head"><b>' +
          escapeHtml(r.version) + '</b><span class="grade-badge ' + gradeClass(r.scores.grade) + '">' +
          r.scores.grade + '</span></div><div class="report-meta">' +
          escapeHtml(r.testName) + ' · ' + r.metrics.fpsAvg.toFixed(1) + ' fps · p99 ' +
          r.metrics.frameP99.toFixed(1) + 'ms · drift ' + r.metrics.driftAvg.toFixed(1) + 'ms</div></div>';
      }).join('');
      $$('.report-card', els.reportList).forEach(function (c) {
        c.addEventListener('click', function () {
          var r = state.reports.find(function (x) { return x.id === c.dataset.id; });
          if (r) { renderAdvisor(r); selectTab('ai'); }
        });
      });
    }

    function renderCompareSelects() {
      if (!els.cmpA || !els.cmpB) return;
      var options = state.reports.map(function (r) {
        return '<option value="' + r.id + '">' + escapeHtml(r.version) + ' · ' + escapeHtml(r.testName) + ' · ' + r.scores.grade + '</option>';
      }).join('');
      els.cmpA.innerHTML = '<option value="">— baseline —</option>' + options;
      els.cmpB.innerHTML = '<option value="">— candidate —</option>' + options;
      if (state.reports.length >= 2) {
        els.cmpA.value = state.reports[1].id;
        els.cmpB.value = state.reports[0].id;
      }
      renderCompareTable();
    }

    function gradeNumeric(r) {
      var g = r.scores.grade;
      return g === 'A+' ? 6 : g === 'A' ? 5 : g === 'B' ? 4 : g === 'C' ? 3 : g === 'D' ? 2 : 1;
    }

    function renderCompareTable() {
      if (!els.cmpA) return;
      var a = state.reports.find(function (r) { return r.id === els.cmpA.value; });
      var b = state.reports.find(function (r) { return r.id === els.cmpB.value; });
      if (!a || !b) { els.cmpTable.innerHTML = '<div class="hint">Select two reports to compare.</div>'; return; }
      showCompare(a, b);
    }

    function showCompare(a, b) {
      var rows = [
        { label: 'Grade', get: function (r) { return r.scores.grade; }, fmt: function (v) { return v; }, unit: '' },
        { label: 'FPS avg', get: function (r) { return r.metrics.fpsAvg; }, fmt: function (v) { return v.toFixed(1); }, unit: 'fps', higherBetter: true },
        { label: 'FPS p95', get: function (r) { return r.metrics.fpsP95; }, fmt: function (v) { return v.toFixed(1); }, unit: 'fps', higherBetter: true },
        { label: 'Frame p99', get: function (r) { return r.metrics.frameP99; }, fmt: function (v) { return v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Jitter', get: function (r) { return r.metrics.jitter; }, fmt: function (v) { return v.toFixed(2); }, unit: 'ms', higherBetter: false },
        { label: 'Drift avg', get: function (r) { return r.metrics.driftAvg; }, fmt: function (v) { return v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Drift max', get: function (r) { return r.metrics.driftMax; }, fmt: function (v) { return v.toFixed(1); }, unit: 'ms', higherBetter: false },
        { label: 'Feature jitter', get: function (r) { return r.metrics.featureJitter; }, fmt: function (v) { return v.toFixed(4); }, unit: '', higherBetter: false },
        { label: 'Buffer fill', get: function (r) { return r.metrics.bufferFill; }, fmt: function (v) { return (v * 100).toFixed(0); }, unit: '%', higherBetter: true }
      ];
      var html = '<table class="delta-table"><thead><tr><th>Metric</th><th class="num">Baseline</th><th class="num">Candidate</th><th class="num">Delta</th></tr></thead><tbody>';
      html += '<tr><td colspan="4" style="color:var(--dim); font-size:10px; padding:4px 8px">' +
        escapeHtml(a.version) + ' (' + escapeHtml(a.testName) + ') → ' +
        escapeHtml(b.version) + ' (' + escapeHtml(b.testName) + ') ' +
        '<span style="color:var(--dim)">— ' + escapeHtml(a.config.layerPreset || '') + ' → ' +
        escapeHtml(b.config.layerPreset || '') + '</span></td></tr>';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var va = r.get(a), vb = r.get(b);
        var deltaStr, cls;
        if (r.label === 'Grade') {
          var dg = gradeNumeric(b) - gradeNumeric(a);
          deltaStr = dg > 0 ? '+' + dg : dg < 0 ? String(dg) : '—';
          cls = dg > 0 ? 'delta-good' : dg < 0 ? 'delta-bad' : 'delta-neutral';
        } else {
          var d = vb - va;
          if (Math.abs(d) < 1e-9) { deltaStr = '—'; cls = 'delta-neutral'; }
          else {
            deltaStr = (d > 0 ? '+' : '−') + r.fmt(Math.abs(d));
            cls = r.higherBetter ? (d > 0 ? 'delta-good' : 'delta-bad') : (d < 0 ? 'delta-good' : 'delta-bad');
          }
        }
        html += '<tr><td>' + r.label + '</td><td class="num">' + r.fmt(va) +
          '<span style="color:var(--dim)"> ' + (r.unit || '') + '</span></td><td class="num">' + r.fmt(vb) +
          '<span style="color:var(--dim)"> ' + (r.unit || '') + '</span></td><td class="num ' + cls + '">' + deltaStr + '</td></tr>';
      }
      els.cmpTable.innerHTML = html + '</tbody></table>';
    }

    function renderAdvisor(report) {
      if (!els.advisor) return;
      var ai = report.ai || analyze(report);
      var sc = report.scores;
      els.advisor.innerHTML =
        '<div class="grade-card"><div class="grade-big ' + gradeClass(sc.grade) +
        '" style="display:inline-block; padding:6px 18px; border-radius:10px; border:1px solid rgba(255,255,255,.1)">' +
        sc.grade + '</div><div class="grade-score">' + sc.total.toFixed(1) + ' / 100 · ' + escapeHtml(report.testName) + '</div>' +
        '<div class="score-bars">' +
        '<div><div class="score-bar-label">Render</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + sc.render.toFixed(0) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--txt)">' + sc.render.toFixed(0) + '</div></div>' +
        '<div><div class="score-bar-label">Stability</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + sc.stability.toFixed(0) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--txt)">' + sc.stability.toFixed(0) + '</div></div>' +
        '<div><div class="score-bar-label">Sync</div><div class="score-bar-track"><div class="score-bar-fill" style="width:' + sc.sync.toFixed(0) + '%"></div></div><div class="score-bar-label" style="margin-top:3px; color:var(--txt)">' + sc.sync.toFixed(0) + '</div></div>' +
        '</div></div>' +
        '<div class="sec">Bottlenecks</div>' +
        (ai.bottlenecks.length ? ai.bottlenecks.map(function (b) {
          return '<div class="bottleneck ' + b.severity + '"><div class="kind">' + escapeHtml(b.kind) + ' · ' + escapeHtml(b.severity) + '</div><div class="detail">' + escapeHtml(b.detail) + '</div></div>';
        }).join('') : '<div class="hint">No bottlenecks detected — the run is within target.</div>') +
        '<div class="sec">Suggestions</div>' +
        (ai.suggestions.length ? ai.suggestions.map(function (s, i) {
          return '<div class="suggestion"><input type="checkbox" data-bench-sug="' + i + '" checked><div class="body">' +
            '<div class="label">' + escapeHtml(s.label) + '</div><div class="detail">' + escapeHtml(s.detail) +
            '</div><div class="delta">' + escapeHtml(s.delta) + '</div></div></div>';
        }).join('') : '<div class="hint">Nothing to apply — this configuration is already optimal.</div>') +
        '<div class="btnrow" style="margin-top:12px"><button id="benchApply" class="primary" ' +
        (ai.suggestions.length ? '' : 'disabled') + '>✓ Apply selected &amp; re-run</button>' +
        '<button id="benchAutoOpt">⚡ Auto-optimize loop</button></div>';

      var applyBtn = $('#benchApply');
      if (applyBtn) applyBtn.addEventListener('click', async function () {
        var checked = $$('[data-bench-sug]:checked', els.advisor).map(function (c) { return ai.suggestions[Number(c.dataset.benchSug)]; });
        if (!checked.length) { host.toast && host.toast('Select at least one suggestion'); return; }
        var applied = applySuggestions(checked);
        if (host.toast) host.toast('Applied: ' + (applied.join(', ') || 'nothing'));
        if (els.indicator) els.indicator.classList.add('on');
        if (els.runLabel) els.runLabel.textContent = 're-running · optimized';
        if (els.bar) els.bar.style.width = '0%';
        var before = report;
        var r = await runTest('optimized', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (els.indicator) els.indicator.classList.remove('on');
        if (r) {
          if (host.toast) host.toast('Optimized run · grade ' + r.scores.grade + ' (was ' + ai.grade + ')');
          renderAdvisor(r);
          renderCompareSelects();
          showCompare(before, r);
          selectTab('compare');
        }
      });

      var autoBtn = $('#benchAutoOpt');
      if (autoBtn) autoBtn.addEventListener('click', async function () {
        var pass1 = await runTest('auto-pass-1', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (!pass1) return;
        var sug = (pass1.ai || analyze(pass1)).suggestions;
        var applied = applySuggestions(sug);
        if (host.toast) host.toast('Applied: ' + (applied.join(', ') || 'none'));
        var pass2 = await runTest('auto-pass-2', host.optimizedConfig ? host.optimizedConfig() : state.cfg, currentDuration());
        if (!pass2) return;
        renderAdvisor(pass2);
        renderCompareSelects();
        showCompare(pass1, pass2);
        selectTab('compare');
      });
    }

    /* ---------- the buffer view ---------- */
    function updateBufferView(sample) {
      if (!els.spark) return;
      if (!els.spark.width) {
        var r = els.spark.getBoundingClientRect();
        els.spark.width = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1)));
        els.spark.height = Math.max(1, Math.round(r.height * (window.devicePixelRatio || 1)));
      }
      sparkData.push(sample.drift);
      if (sparkData.length > 120) sparkData.shift();
      var sctx = els.spark.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var w = els.spark.width, h = els.spark.height;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var ww = w / dpr, hh = h / dpr;
      sctx.clearRect(0, 0, ww, hh);
      sctx.fillStyle = '#060a10';
      sctx.fillRect(0, 0, ww, hh);
      var max = Math.max(20, Math.max.apply(null, sparkData), 5);
      var bw = ww / sparkData.length;
      for (var i = 0; i < sparkData.length; i++) {
        var v = sparkData[i];
        var bh = clamp(v / max, 0, 1) * (hh - 6);
        sctx.fillStyle = v > 16 ? '#ff5a5a' : v > 8 ? '#ffb454' : '#4de3d0';
        sctx.fillRect(i * bw, hh - bh, Math.max(1, bw - 0.5), bh);
      }
      if (Math.random() < 0.1) {
        if (els.bufFill) {
          els.bufFill.innerHTML = Math.round(state.buffer.buf.length / state.buffer.capacity * 100) + '%';
          els.bufFillBar.style.width = (state.buffer.buf.length / state.buffer.capacity * 100) + '%';
        }
        if (els.bufInterp) els.bufInterp.textContent = state.cfg.interpolate ? 'on' : 'off';
        var drifts = state.buffer.driftSamples;
        if (drifts.length) {
          var avg = drifts.reduce(function (s, x) { return s + x; }, 0) / drifts.length;
          var mx = Math.max.apply(null, drifts);
          if (els.bufDriftAvg) {
            els.bufDriftAvg.innerHTML = avg.toFixed(1) + ' <small>ms</small>';
            els.bufDriftMax.innerHTML = mx.toFixed(1) + ' <small>ms</small>';
            els.bufDriftAvg.className = 'stat-val ' + (avg > 16 ? 'bad' : avg > 8 ? '' : 'ok');
            els.bufDriftMax.className = 'stat-val ' + (mx > 40 ? 'bad' : mx > 20 ? '' : 'ok');
          }
        }
        if (els.bufferBadge) {
          els.bufferBadge.textContent = '◉ buffer ' + Math.round(state.buffer.buf.length / state.buffer.capacity * 100) + '%';
        }
      }
    }

    function selectTab(name) {
      $$('.tabs button', els.root).forEach(function (x) { x.classList.toggle('on', x.dataset.tab === name); });
      $$('.panel', els.root).forEach(function (p) { p.classList.toggle('on', p.dataset.panel === name); });
    }

    /* ---------- mount ---------- */
    function mount(root) {
      if (state.mounted) return api;
      els.root = root;
      root.innerHTML = PANEL_HTML;
      els.mode = $('#benchRunMode', root);
      els.tag = $('#benchTagInput', root);
      els.version = $('#benchVersionInput', root);
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
      els.bufDriftAvg = $('#benchBufDriftAvg', root);
      els.bufDriftMax = $('#benchBufDriftMax', root);
      els.bufferBadge = $('#benchBufferBadge', root);

      $$('.tabs button', root).forEach(function (b) {
        b.addEventListener('click', function () { selectTab(b.dataset.tab); });
      });
      if (els.runAll) els.runAll.addEventListener('click', function () { runAll(); });
      if (els.stop) els.stop.addEventListener('click', function () {
        state.runToken++;
        state.recording = false;
        state.activeTest = null;
        if (els.indicator) els.indicator.classList.remove('on');
        if (els.runAll) els.runAll.disabled = false;
        if (host.toast) host.toast('Stopped');
      });
      var toggle = $('#benchToggleInterp', root);
      if (toggle) toggle.addEventListener('click', function () {
        state.cfg.interpolate = !state.cfg.interpolate;
        if (els.bufInterp) els.bufInterp.textContent = state.cfg.interpolate ? 'on' : 'off';
        if (host.toast) host.toast('Interpolation ' + (state.cfg.interpolate ? 'on' : 'off'));
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
      state.mounted = true;
      return api;
    }

    var api = {
      mount: mount,
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
      /* The VIDEO side of the buffer: the host's render loop calls this with
         the current video time and gets the interpolated features plus the
         measured drift. The drift is recorded here because the host is the
         only party that knows when it drew. */
      sampleAt: function (tVideo) {
        var sample = state.buffer.sampleAt(tVideo, state.cfg.interpolate);
        if (state.recording) state.driftSamples.push(sample.drift);
        return sample;
      },
      get driftAvg() {
        var d = state.driftSamples;
        if (!d.length) return 0;
        return d.reduce(function (s, x) { return s + x; }, 0) / d.length;
      },
    };
    return api;
  }

  window.SWR_BENCH = {
    AVSyncBuffer: AVSyncBuffer,
    createSuite: createSuite,
  };
})();
