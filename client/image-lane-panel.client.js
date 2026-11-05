// client/image-lane-panel.client.js — image lane controls in the layers aside

(function () {
  'use strict';

  if (window.__SWR_IMAGE_LANE_PANEL) return;
  window.__SWR_IMAGE_LANE_PANEL = true;

  function $(id) {
    return document.getElementById(id);
  }

  function mount() {
    var lane = window.SWR_IMAGE_LANE;
    if (!lane) return;
    var visBtn = $('image-lane-visible');
    if (visBtn && !visBtn.__bound) {
      visBtn.__bound = true;
      visBtn.addEventListener('click', function () {
        lane.setVisible(!lane.visible);
      });
    }
    var orderSel = $('image-lane-order');
    if (orderSel && !orderSel.__bound) {
      orderSel.__bound = true;
      orderSel.addEventListener('change', function () {
        lane.setStackOrder(orderSel.value);
      });
    }
    var blendSel = $('image-lane-blend');
    if (blendSel && !blendSel.__bound) {
      blendSel.__bound = true;
      blendSel.addEventListener('change', function () {
        lane.blend = blendSel.value;
        lane.render();
      });
    }
    var op = $('image-lane-opacity');
    if (op && !op.__bound) {
      op.__bound = true;
      op.addEventListener('input', function () {
        lane.opacity = parseFloat(op.value) || 1;
        var opV = $('image-lane-opacity-v');
        if (opV) opV.textContent = lane.opacity.toFixed(2);
      });
    }
    lane.render();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }
})();
