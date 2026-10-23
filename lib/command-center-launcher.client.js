// lib/command-center-launcher.client.js — the tiny half of the Studio
// Command Center.
//
// WHY THIS IS A SEPARATE FILE
// --------------------------
// The Command Center is ~47 KB of implementation. Injecting it into every
// engine variant made every variant's FIRST page load parse 47 KB it almost
// never uses — the feature is opened deliberately, by a person who wants it.
//
// That is not free: check:variants-smoke walks the variants in order, and
// NEON is first. The extra parse cost meant neon's render loop had not
// ticked twice inside the smoke's two-frame window, and the assertion
// "neon: drawFx not called (run() invoked 0x in 2 frames)" failed — while
// all 21 other variants passed, because by then the browser was warm.
//
// The fix is not a looser test; it is not shipping 47 KB to every visitor
// for a panel they did not ask for. This file is ~2 KB: it draws the ◈
// button, and loads the implementation the first time the button is used
// (or immediately, when the URL carries ?cc=1).

(function () {
  'use strict';

  var SCRIPT = '/lib/command-center.client.js';

  var CSS = '.swr-cc-launch {\n  position: fixed;\n  right: 14px;\n  bottom: 14px;\n  z-index: 9400;\n  width: 40px;\n  height: 40px;\n  border-radius: 12px;\n  border: 1px solid rgba(255, 138, 61, .5);\n  background: linear-gradient(180deg, rgba(48, 26, 14, .94), rgba(22, 12, 7, .94));\n  color: #ff9a4d;\n  font-size: 17px;\n  line-height: 1;\n  cursor: pointer;\n  box-shadow: 0 6px 22px rgba(0, 0, 0, .6), 0 0 16px rgba(255, 122, 40, .18);\n  transition: transform .12s ease, box-shadow .12s ease;\n}\n.swr-cc-launch:hover {\n  transform: translateY(-1px);\n  box-shadow: 0 10px 28px rgba(0, 0, 0, .7), 0 0 22px rgba(255, 122, 40, .32);\n}\n.swr-cc-launch[aria-pressed="true"] {\n  color: #ffd66b;\n  border-color: rgba(255, 214, 107, .75);\n}\n';

  function loadImplementation() {
    if (document.querySelector('script[data-swr-cc]')) return;
    window.__swrCCRequested = true;
    var btn = document.getElementById('swr-cc-launch');
    if (btn) btn.setAttribute('aria-pressed', 'true');
    var s = document.createElement('script');
    s.src = SCRIPT;
    s.defer = true;
    s.setAttribute('data-swr-cc', '');
    document.head.appendChild(s);
  }

  // The launcher's own styles, injected here rather than shipped in
  // lib/command-center.css: that file now loads on demand, so the button
  // would be unstyled until the implementation arrives.
  function installStyle() {
    if (document.getElementById('swr-cc-launch-style')) return;
    var s = document.createElement('style');
    s.id = 'swr-cc-launch-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function install() {
    installStyle();
    if (document.getElementById('swr-cc-launch')) return;
    var b = document.createElement('button');
    b.id = 'swr-cc-launch';
    b.className = 'swr-cc-launch';
    b.type = 'button';
    b.setAttribute('aria-label', 'Open the Studio Command Center');
    b.setAttribute('aria-pressed', 'false');
    b.title = 'Studio Command Center';
    b.textContent = '◈';
    b.addEventListener('click', function () {
      loadImplementation();
      b.setAttribute('aria-pressed', 'true');
    });
    document.body.appendChild(b);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }

  // ?cc=1 opens it straight away — no click, no round trip to discover the
  // feature exists.
  try {
    if (new URLSearchParams(location.search).get('cc') === '1') loadImplementation();
  } catch (_) {}
})();
