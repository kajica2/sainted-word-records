// client/scenes-keyboard.client.js — keyboard + focused-pad hold for SWR_SCENES
(function (global) {
  'use strict';

  if (global.__SWR_SCENES_KEYBOARD_LOADED) return;
  global.__SWR_SCENES_KEYBOARD_LOADED = true;

  var HOLD_MS = 1000;
  var _digitDown = null;

  function scenes() {
    return global.SWR_SCENES;
  }

  function isFormField(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function padEl(index) {
    var list = document.getElementById('scenes-list');
    if (!list) return null;
    return list.querySelector('[data-scene-index="' + index + '"]');
  }

  function setCapturing(index, on) {
    var p = padEl(index);
    if (!p) return;
    if (on) p.classList.add('swr-scene-capturing');
    else p.classList.remove('swr-scene-capturing');
  }

  function beginHold(index) {
    var S = scenes();
    if (!S || index < 0 || index >= (S.MAX_SCENES || 4)) return;
    setCapturing(index, true);
    S.startCapture(index);
    _digitDown = index;
  }

  function endHold(index) {
    var S = scenes();
    if (!S || index == null) return;
    setCapturing(index, false);
    if (S.cancelCapture()) {
      if (S.recall(index) && typeof global.setStatus === 'function') {
        global.setStatus('recalled scene ' + (index + 1), 'ok');
      }
    }
    if (_digitDown === index) _digitDown = null;
  }

  function modeArmed() {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Look-mode (T + digit) and mask-mode (T,T + digit) own the next digit.
    // This listener is capture-phase, so without this gate scenes steal 1..4.
    if (global.__swrLookModeUntil && now < global.__swrLookModeUntil) return true;
    if (global.__swrMaskModeUntil && now < global.__swrMaskModeUntil) return true;
    return false;
  }

  function onKeyDown(ev) {
    if (!ev || ev.defaultPrevented) return;
    if (isFormField(ev.target)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    if (!/^[1-4]$/.test(ev.key || '')) return;
    if (modeArmed()) return;
    if (!scenes()) return;
    var index = parseInt(ev.key, 10) - 1;
    beginHold(index);
    if (ev.preventDefault) ev.preventDefault();
  }

  function onKeyUp(ev) {
    if (isFormField(ev.target)) return;
    if (!/^[1-4]$/.test(ev.key || '')) return;
    if (!scenes()) return;
    var index = parseInt(ev.key, 10) - 1;
    if (_digitDown !== index) return;
    endHold(index);
    if (ev.preventDefault) ev.preventDefault();
  }

  function wirePad(pad, index) {
    if (!pad || pad.__swrSceneKbWired) return;
    pad.__swrSceneKbWired = true;
    pad.setAttribute('data-scene-index', String(index));
    if (!pad.hasAttribute('tabindex')) pad.setAttribute('tabindex', '0');

    pad.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if (ev.repeat) return;
      ev.preventDefault();
      beginHold(index);
    });
    pad.addEventListener('keyup', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      endHold(index);
    });
  }

  function wireAllPads() {
    var S = scenes();
    if (!S) return;
    var list = document.getElementById('scenes-list');
    if (!list) return;
    var items = S.list();
    for (var i = 0; i < items.length; i++) {
      var pad = list.children[i];
      if (pad) wirePad(pad, i);
    }
  }

  function install() {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wireAllPads);
    } else {
      wireAllPads();
    }
    global.addEventListener('swr-scenes-panel-refresh', wireAllPads);
  }

  global.SWR_SCENES_KEYBOARD = {
    HOLD_MS: HOLD_MS,
    wirePads: wireAllPads,
    helpRows: function () {
      if (!scenes()) return [];
      return [
        { keys: '1..4', label: 'scene recall (tap) · hold ~1s to save (same as scene pads)' },
        { keys: 'Enter / Space', label: 'on a focused scene pad: hold to save, release to recall' },
      ];
    },
  };

  install();
})(typeof window !== 'undefined' ? window : globalThis);
