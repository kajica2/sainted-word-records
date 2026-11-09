// client/remo-history.client.js
// Remo Panel 2.0 — undo/redo with coalesce window.

(function () {
  'use strict';
  if (window.SWR_REMO_HISTORY) return;

  var MAX = 100;
  var COALESCE_MS = 300;
  var undoStack = [];
  var redoStack = [];
  var lastKey = null;
  var lastAt = 0;

  function push(cmd) {
    if (!cmd || typeof cmd.undo !== 'function' || typeof cmd.redo !== 'function') return;
    var now = Date.now();
    if (cmd.coalesceKey && cmd.coalesceKey === lastKey && (now - lastAt) <= COALESCE_MS && undoStack.length) {
      undoStack[undoStack.length - 1] = cmd;
    } else {
      undoStack.push(cmd);
      if (undoStack.length > MAX) undoStack.shift();
    }
    lastKey = cmd.coalesceKey || null;
    lastAt = now;
    redoStack = [];
  }

  function undo() {
    if (!undoStack.length) return false;
    var cmd = undoStack.pop();
    cmd.undo();
    redoStack.push(cmd);
    lastKey = null;
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    var cmd = redoStack.pop();
    cmd.redo();
    undoStack.push(cmd);
    lastKey = null;
    return true;
  }

  function clear() {
    undoStack = [];
    redoStack = [];
    lastKey = null;
  }

  window.SWR_REMO_HISTORY = {
    push: push,
    undo: undo,
    redo: redo,
    canUndo: function () { return undoStack.length > 0; },
    canRedo: function () { return redoStack.length > 0; },
    clear: clear,
  };
})();
