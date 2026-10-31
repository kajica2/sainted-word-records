// lib/image-lane.client.js — dedicated still-image stack for engine.html / play.html
//
// Still images live here, separate from the video layer stack. Automix image
// mode drives this lane whenever it holds images (no 55% ratio gate).

(function () {
  'use strict';

  if (window.__SWR_IMAGE_LANE_LOADED) return;
  window.__SWR_IMAGE_LANE_LOADED = true;

  function $(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function motionKill() {
    return window.SWR_MOTION_KILL || null;
  }

  function isStillImageAsset(asset) {
    if (!asset || asset.kind === 'text') return false;
    var mk = motionKill();
    if (mk && typeof mk.isImageAsset === 'function') return mk.isImageAsset(asset);
    if (asset.type === 'image') return true;
    if (asset.mime && String(asset.mime).indexOf('image/') === 0) return true;
    return false;
  }

  function emitChanged() {
    try {
      document.dispatchEvent(new CustomEvent('swr-image-lane-changed', {
        detail: { count: ImageLane.visibleList().length },
      }));
    } catch (_) {}
  }

  function applyImageSafety(layer, slot) {
    var mk = motionKill();
    if (mk && typeof mk.applyImageAutomixReactors === 'function') {
      mk.applyImageAutomixReactors(layer, slot);
    } else if (mk && typeof mk.sanitizeLayer === 'function') {
      mk.sanitizeLayer(layer);
    }
    layer.rotationEnabled = false;
    layer.algo = 'none';
    layer.algoIntensity = 0;
  }

  function newLayerFromAsset(asset, index) {
    var layer = {
      id: 'I' + (index + 1) + '-' + Date.now().toString(36).slice(-4),
      asset: asset,
      blend: 'source-over',
      opacity: 1,
      baseScale: 1,
      hue: 0,
      brightness: 1,
      contrast: 1,
      pos: { x: 0, y: 0, rot: 0 },
      rotOffset: 0,
      rotationEnabled: false,
      z: index,
      reactors: [],
      snapBeat: false,
      algo: 'none',
      algoIntensity: 0,
      _imageLane: true,
    };
    applyImageSafety(layer, index);
    return layer;
  }

  function adoptVideoStackLayer(vl, index) {
    var layer = Object.assign({}, vl, {
      id: vl.id || ('I' + (index + 1)),
      _imageLane: true,
      pos: vl.pos ? { x: vl.pos.x || 0, y: vl.pos.y || 0, rot: 0 } : { x: 0, y: 0, rot: 0 },
      rotOffset: 0,
      rotationEnabled: false,
      z: index,
    });
    if (layer.pos) layer.pos.rot = 0;
    applyImageSafety(layer, index);
    return layer;
  }

  var ImageLane = {
    list: [],
    selected: null,
    visible: true,
    blend: 'source-over',
    opacity: 1,
    stackOrder: 'above',

    visibleList() {
      if (!this.visible) return [];
      return this.list.filter(function (l) { return !l.hidden; });
    },

    add(asset) {
      if (!asset || !isStillImageAsset(asset)) return null;
      var layer = newLayerFromAsset(asset, this.list.length);
      this.list.push(layer);
      this.selected = layer;
      this.render();
      emitChanged();
      var se = typeof window.stageEmpty === 'function' ? window.stageEmpty() : null;
      if (se && se.classList && (this.list.length || (window.Layers && window.Layers.list && window.Layers.list.length))) {
        se.classList.add('hidden');
      }
      return layer;
    },

    remove(id) {
      var i = this.list.findIndex(function (l) { return l.id === id; });
      if (i < 0) return false;
      this.list.splice(i, 1);
      if (this.selected && this.selected.id === id) {
        this.selected = this.list[0] || null;
      }
      this.render();
      emitChanged();
      return true;
    },

    select(layer) {
      this.selected = layer || null;
      this.render();
    },

    setVisible(on) {
      this.visible = !!on;
      this.render();
      emitChanged();
    },

    setStackOrder(order) {
      this.stackOrder = order === 'below' ? 'below' : 'above';
      this.render();
      emitChanged();
    },

    /** Pull image layers off the shared video stack (legacy projects / boot). */
    migrateFromVideoStack() {
      var Layers = window.Layers;
      if (!Layers || !Array.isArray(Layers.list)) return 0;
      var moved = 0;
      for (var i = Layers.list.length - 1; i >= 0; i--) {
        var l = Layers.list[i];
        if (!l || l.kind === 'text' || !isStillImageAsset(l.asset)) continue;
        Layers.list.splice(i, 1);
        this.list.push(adoptVideoStackLayer(l, this.list.length));
        moved++;
      }
      if (moved) {
        if (Layers.render) Layers.render();
        this.render();
        emitChanged();
        try {
          document.dispatchEvent(new CustomEvent('swr-layers-changed', {
            detail: { count: Layers.visibleList ? Layers.visibleList().length : Layers.list.length },
          }));
        } catch (_) {}
      }
      return moved;
    },

    /** Draw all visible image-lane layers (call from Renderer loop). */
    drawStack(ctx, drawLayerFn, w, h) {
      if (!ctx || typeof drawLayerFn !== 'function') return;
      if (!this.visible) return;
      var sorted = this.visibleList().slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
      if (!sorted.length) return;
      var laneOp = this.opacity != null ? this.opacity : 1;
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha != null ? ctx.globalAlpha : 1) * laneOp;
      for (var i = 0; i < sorted.length; i++) {
        var layer = sorted[i];
        var prevBlend = layer.blend;
        if (this.blend) layer.blend = this.blend;
        drawLayerFn(layer, ctx, w, h);
        layer.blend = prevBlend;
      }
      ctx.restore();
    },

    render() {
      var host = $('image-lane-list');
      if (!host) return;
      var self = this;
      host.innerHTML = '';
      if (!this.list.length) {
        var empty = document.createElement('div');
        empty.className = 'muted';
        empty.style.cssText = 'font-size:10px;padding:6px 8px;color:var(--muted);';
        empty.textContent = 'No stills — add images from the library';
        host.appendChild(empty);
        return;
      }
      this.list.forEach(function (l) {
        var row = document.createElement('div');
        row.className = 'layer-card' + (self.selected && self.selected.id === l.id ? ' selected' : '');
        row.style.cssText = 'padding:4px 8px;font-size:10px;cursor:pointer;border-bottom:1px solid var(--line);';
        var name = (l.asset && l.asset.name) ? l.asset.name : 'image';
        row.textContent = name.length > 28 ? name.slice(0, 26) + '…' : name;
        row.addEventListener('click', function () { self.select(l); });
        host.appendChild(row);
      });
      var visBtn = $('image-lane-visible');
      if (visBtn) visBtn.textContent = this.visible ? 'Hide' : 'Show';
      var orderSel = $('image-lane-order');
      if (orderSel) orderSel.value = this.stackOrder;
      var blendSel = $('image-lane-blend');
      if (blendSel) blendSel.value = this.blend;
      var op = $('image-lane-opacity');
      var opV = $('image-lane-opacity-v');
      if (op) op.value = String(this.opacity);
      if (opV) opV.textContent = (this.opacity != null ? this.opacity : 1).toFixed(2);
    },

    toJSON() {
      return {
        visible: this.visible,
        blend: this.blend,
        opacity: this.opacity,
        stackOrder: this.stackOrder,
        layers: this.list.map(function (l) {
          return {
            id: l.id,
            assetId: l.asset ? l.asset.id : null,
            assetName: l.asset ? l.asset.name : null,
            blend: l.blend,
            opacity: l.opacity,
            baseScale: l.baseScale,
            hue: l.hue,
            brightness: l.brightness,
            contrast: l.contrast,
            reactors: (l.reactors || []).map(function (r) { return Object.assign({}, r); }),
            pos: l.pos ? { x: l.pos.x, y: l.pos.y, rot: l.pos.rot } : { x: 0, y: 0, rot: 0 },
            z: l.z,
            hidden: !!l.hidden,
          };
        }),
      };
    },

    restoreFromJSON(block, libMap, byName) {
      this.list = [];
      if (!block || !Array.isArray(block.layers)) {
        this.visible = block ? block.visible !== false : true;
        this.blend = (block && block.blend) || 'source-over';
        this.opacity = block && block.opacity != null ? block.opacity : 1;
        this.stackOrder = block && block.stackOrder === 'below' ? 'below' : 'above';
        this.render();
        return;
      }
      this.visible = block.visible !== false;
      this.blend = block.blend || 'source-over';
      this.opacity = block.opacity != null ? block.opacity : 1;
      this.stackOrder = block.stackOrder === 'below' ? 'below' : 'above';
      var self = this;
      block.layers.forEach(function (pl, i) {
        var asset = null;
        if (pl.assetId && libMap.has(pl.assetId)) asset = libMap.get(pl.assetId);
        else if (pl.assetName && byName.has(pl.assetName)) asset = byName.get(pl.assetName);
        if (!asset) return;
        var layer = newLayerFromAsset(asset, i);
        layer.id = pl.id || layer.id;
        Object.assign(layer, {
          blend: pl.blend,
          opacity: pl.opacity,
          baseScale: pl.baseScale,
          hue: pl.hue,
          brightness: pl.brightness,
          contrast: pl.contrast,
          reactors: (pl.reactors || []).map(function (r) { return Object.assign({}, r); }),
          pos: pl.pos ? { x: pl.pos.x, y: pl.pos.y, rot: 0 } : layer.pos,
          z: pl.z != null ? pl.z : i,
          hidden: !!pl.hidden,
        });
        applyImageSafety(layer, i);
        self.list.push(layer);
      });
      this.selected = this.list[0] || null;
      this.render();
      emitChanged();
    },
  };

  window.SWR_IMAGE_LANE = ImageLane;

  function bootMigrate() {
    try {
      ImageLane.migrateFromVideoStack();
    } catch (_) {}
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(bootMigrate, 0);
      });
    } else {
      setTimeout(bootMigrate, 0);
    }
  }
})();
