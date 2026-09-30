// seller.client.js — seller catalogue controller (window.SWR_SELLER).
//
// Loaded by connect.html into #seller-catalogue. Requires an ACTIVE
// connected account (/api/connect status 'active') before listing items —
// a seller without verified onboarding cannot publish.
//
// Surface: list + add/edit form for songs, videos, and media packs;
// per-item media uploads via /api/storage/sign-upload (userId-scoped
// keys); "sell together" bundle refs to the seller's own listings;
// publish / unpublish / soft-delete.
//
// Global-script IIFE per the repo's .client.js convention: attaches
// exactly one global (window.SWR_SELLER).

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var rootEl = null;
  var state = {
    connect: null,
    items: [],
    draftMedia: [], // { kind, key, name, size, featured? } — featured = posted up
    editId: null,
  };

  var TYPES = { song: 'Song', video: 'Video file', pack: 'Media pack' };
  var KIND_LABEL = { audio: 'song', video: 'video', image: 'image' };

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (json) {
        return { status: r.status, json: json };
      }).catch(function () {
        return { status: r.status, json: null };
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxx-xxxx-xxxx'.replace(/x/g, function () {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  function fmtPrice(minor) {
    return (minor / 100).toFixed(2);
  }

  // The ONE media entry flagged featured — the file that gets posted up as
  // the listing preview (a WebM). Returns its name or null when unset.
  function featuredName(item) {
    var media = (item && item.media) || [];
    for (var i = 0; i < media.length; i++) {
      if (media[i] && media[i].featured) return media[i].name || null;
    }
    return null;
  }

  function init() {
    rootEl = $('seller-catalogue');
    if (!rootEl) return;
    boot();
  }

  function boot() {
    api('/api/connect').then(function (r) {
      if (r.status !== 200 || !r.json) {
        gate('Sign in to manage your catalogue.');
        return;
      }
      state.connect = r.json.connect;
      if (!state.connect || state.connect.status !== 'active') {
        gate('Finish your seller onboarding first — your catalogue unlocks the moment Stripe confirms you.');
        return;
      }
      rootEl.innerHTML =
        '<h2 style="font-size:15px;letter-spacing:0.03em;text-transform:uppercase;color:var(--muted);margin:0 0 16px;">' +
        'Your catalogue</h2>';
      refresh();
    }).catch(function () {
      gate('Could not reach the API. Try again shortly.');
    });
  }

  function gate(msg) {
    rootEl.innerHTML =
      '<div class="card"><p class="kicker">Catalogue</p>' +
      '<p class="muted" style="margin:0">' + esc(msg) + '</p></div>';
  }

  function refresh() {
    api('/api/catalogue').then(function (r) {
      if (r.status !== 200 || !r.json) {
        rootEl.innerHTML += '<p class="muted">Could not load your catalogue.</p>';
        return;
      }
      state.items = r.json.items || [];
      render();
    });
  }

  function render() {
    var items = state.items;
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">' +
      '<p class="mini" style="margin:0">' + items.length + ' item' + (items.length === 1 ? '' : 's') +
      ' · sold individually or in bundles</p>' +
      '<button class="btn primary" id="cat-add" style="padding:9px 16px">+ Add item</button>' +
      '</div>';

    if (!items.length) {
      html += '<div class="card" style="text-align:center;color:var(--muted)">' +
        '<p style="margin:4px 0 0">No listings yet. Add a song, a video file, or a media pack —' +
        ' price it on its own or bundle it with others.</p></div>';
    } else {
      html += items.map(function (it) {
        var bundleTxt = it.bundleOf && it.bundleOf.length
          ? '<span class="mini" style="color:var(--accent)">bundled ×' + it.bundleOf.length + '</span>'
          : '';
        return '<div class="card" style="padding:18px 20px">' +
          '<div style="display:flex;align-items:flex-start;gap:14px;justify-content:space-between;flex-wrap:wrap">' +
          '<div style="min-width:0">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<span class="micro" style="color:var(--accent)">' + esc(TYPES[it.type] || it.type) + '</span>' +
          '<span class="micro" style="color:' + (it.status === 'live' ? 'var(--ok)' : 'var(--fg-faint)') + '">' +
          (it.status === 'live' ? '● live' : 'draft') + '</span>' + bundleTxt +
          (featuredName(it)
            ? '<span class="micro" style="color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:1px 6px">▲ posted · ' + esc(featuredName(it)) + '</span>'
            : '') +
          '</div>' +
          '<h3 style="margin:4px 0 2px;font-size:16px">' + esc(it.title) + '</h3>' +
          '<p class="muted" style="margin:0;font-size:13px">' + esc(it.description || '') + '</p>' +
          '<p class="mini" style="margin:6px 0 0">' +
          (it.media && it.media.length ? it.media.length + ' file' + (it.media.length === 1 ? '' : 's') + ' · ' : '') +
          '€' + fmtPrice(it.priceMinor) + ' · ' + esc(it.currency || 'EUR') +
          (it.tags && it.tags.length ? ' · #' + esc(it.tags.join(' #')) : '') +
          '</p>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-shrink:0">' +
          (it.status === 'live'
            ? '<button class="btn" data-act="unpublish" data-id="' + esc(it.id) + '" style="padding:7px 12px">Unpublish</button>'
            : '<button class="btn" data-act="publish" data-id="' + esc(it.id) + '" style="padding:7px 12px">Publish</button>') +
          '<button class="btn" data-act="edit" data-id="' + esc(it.id) + '" style="padding:7px 12px">Edit</button>' +
          '<button class="btn" data-act="delete" data-id="' + esc(it.id) + '" style="padding:7px 12px;color:var(--err)">Delete</button>' +
          '</div>' +
          '</div>' +
          '</div>';
      }).join('');
    }

    rootEl.innerHTML = rootEl.innerHTML.split('</h2>')[0] + '</h2>' +
      '<div id="cat-body">' + html + '</div>';
    bindList();
  }

  function bindList() {
    var add = $('cat-add');
    if (add) add.addEventListener('click', function () { openForm(null); });
    var body = $('cat-body');
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('button[data-act]'), function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        var id = btn.getAttribute('data-id');
        if (act === 'publish') setStatus(id, 'live');
        else if (act === 'unpublish') setStatus(id, 'draft');
        else if (act === 'edit') openForm(id);
        else if (act === 'delete') removeItem(id);
      });
    });
  }

  function setStatus(id, status) {
    api('/api/catalogue/' + encodeURIComponent(id), { method: 'PATCH', body: { status: status } })
      .then(function (r) { refresh(); })
      .catch(function () {});
  }

  function removeItem(id) {
    if (!window.confirm('Delete this listing? It will be hidden from the catalogue.')) return;
    api('/api/catalogue/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) {
        if (r.status === 200) refresh();
      });
  }

  function openForm(id) {
    var item = id ? state.items.find(function (x) { return x.id === id; }) : null;
    state.editId = id || null;
    state.draftMedia = item ? (item.media || []).slice() : [];
    var options = validBundleRefs(item);
    var bundleChecks = options.map(function (o) {
      var checked = state.items.some(function (x) { return x.id === item && x.bundleOf && x.bundleOf.indexOf(o.id) >= 0; }) ||
        (item && item.bundleOf && item.bundleOf.indexOf(o.id) >= 0);
      return '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;padding:4px 0">' +
        '<input type="checkbox" value="' + esc(o.id) + '"' + (checked ? ' checked' : '') + '> ' +
        esc(o.title) + ' <span class="mini">(' + esc(TYPES[o.type]) + ', €' + fmtPrice(o.priceMinor) + ')</span></label>';
    }).join('');

    var form =
      '<div class="card" id="cat-form" style="border-color:var(--accent)">' +
      '<p class="kicker">' + (item ? 'Edit listing' : 'New listing') + '</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div><label class="label" for="cat-type">Type</label>' +
      '<select id="cat-type" style="width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;margin-top:6px">' +
      '<option value="song"' + ((item && item.type === 'song') || !item ? ' selected' : '') + '>Song</option>' +
      '<option value="video"' + (item && item.type === 'video' ? ' selected' : '') + '>Video file</option>' +
      '<option value="pack"' + (item && item.type === 'pack' ? ' selected' : '') + '>Media pack</option>' +
      '</select></div>' +
      '<div><label class="label" for="cat-price">Price (€)</label>' +
      '<input id="cat-price" type="number" min="0.5" step="0.5" value="' + (item ? fmtPrice(item.priceMinor) : '5') + '" ' +
      'style="width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;margin-top:6px"></div>' +
      '</div>' +
      '<div style="margin-top:12px"><label class="label" for="cat-title">Title</label>' +
      '<input id="cat-title" maxlength="120" value="' + esc(item ? item.title : '') + '" placeholder="e.g. Midnight Overdrive — stems + visual pack"' +
      'style="width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;margin-top:6px"></div>' +
      '<div style="margin-top:12px"><label class="label" for="cat-desc">Description</label>' +
      '<textarea id="cat-desc" maxlength="2000" rows="3" placeholder="What buyers get, what they can remix, licence terms…"' +
      'style="width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;margin-top:6px;resize:vertical">' + esc(item ? item.description : '') + '</textarea></div>' +
      '<div style="margin-top:12px"><label class="label" for="cat-tags">Tags</label>' +
      '<input id="cat-tags" maxlength="200" value="' + esc(item && item.tags ? item.tags.join(', ') : '') + '" placeholder="jazz, 120bpm, origins"' +
      'style="width:100%;background:var(--panel-2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:inherit;margin-top:6px"></div>' +

      '<div style="margin-top:14px"><label class="label">Media files</label>' +
      '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">' +
      '<button class="btn" data-upload="webm" style="padding:7px 12px;border-color:var(--accent);color:var(--accent)">▲ Post WebM</button>' +
      '<button class="btn" data-upload="audio" style="padding:7px 12px">+ Song</button>' +
      '<button class="btn" data-upload="video" style="padding:7px 12px">+ Video</button>' +
      '<button class="btn" data-upload="image" style="padding:7px 12px">+ Image</button>' +
      '</div>' +
      '<p class="mini" style="margin:6px 0 2px;color:var(--muted)">The file marked <span class="micro" style="color:var(--accent)">posted</span> is the one shown as the listing preview. Everything else gets packaged for the buyer.</p>' +
      '<div id="cat-media" style="margin-top:8px"></div></div>' +

      (options.length
        ? '<div style="margin-top:14px"><label class="label">Sell together with (bundle)</label><div style="margin-top:4px">' + bundleChecks + '</div></div>'
        : '') +

      '<div style="margin-top:14px;display:flex;gap:10px;align-items:center">' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px">' +
      '<input type="checkbox" id="cat-live"' + ((item && item.status === 'live') ? ' checked' : '') + '> Publish now</label>' +
      '<span style="flex:1"></span>' +
      '<button class="btn" id="cat-cancel">Cancel</button>' +
      '<button class="btn primary" id="cat-save">' + (item ? 'Save changes' : 'Add to catalogue') + '</button>' +
      '</div>' +
      '</div>';

    rootEl.innerHTML = rootEl.innerHTML.split('<div id="cat-body">')[0] +
      '<div id="cat-body">' + form + '</div>';
    bindForm(item);
  }

  function validBundleRefs(item) {
    return state.items.filter(function (x) {
      return !x.deletedAt && x.id !== item;
    });
  }

  function bindForm(item) {
    renderMedia();
    var uploads = rootEl.querySelectorAll('button[data-upload]');
    Array.prototype.forEach.call(uploads, function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-upload');
        // "Post WebM" uploads a WebM and marks it as the ONE file posted up
        // (featured preview); any other file can't take its place. The rest
        // of the media gets packaged for the buyer without being featured.
        var featured = kind === 'webm';
        var input = document.createElement('input');
        input.type = 'file';
        if (featured) {
          input.accept = 'video/webm,.webm';
          input.onchange = function () {
            Array.prototype.forEach.call(input.files, function (f) { uploadMedia(f, 'video', true); });
          };
        } else {
          input.accept = kind === 'audio' ? 'audio/*' : (kind === 'video' ? 'video/*' : 'image/*');
          input.onchange = function () {
            Array.prototype.forEach.call(input.files, function (f) { uploadMedia(f, kind, false); });
          };
        }
        input.click();
      });
    });
    $('cat-cancel').addEventListener('click', render);
    $('cat-save').addEventListener('click', function () { saveForm(); });
    renderMedia();
  }

  function renderMedia() {
    var box = $('cat-media');
    if (!box) return;
    box.innerHTML = state.draftMedia.map(function (m, i) {
      var badge = m.featured
        ? '<span class="micro" style="color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:1px 6px">▲ posted</span>'
        : '<button class="btn" data-post="' + i + '" title="Show this file as the listing preview" style="padding:2px 8px">post up</button>';
      return '<div style="display:flex;gap:8px;align-items:center;background:var(--panel-2);border:1px solid ' + (m.featured ? 'var(--accent)' : 'var(--line)') + ';border-radius:6px;padding:6px 10px;margin-bottom:6px;font-size:12.5px">' +
        '<span class="micro" style="color:var(--accent)">' + esc(KIND_LABEL[m.kind]) + '</span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">' + esc(m.name) + '</span>' +
        '<span class="mini">' + fmtBytes(m.size) + '</span>' +
        '<span style="flex:1"></span>' +
        badge +
        '<button class="btn" data-rm="' + i + '" style="padding:2px 8px;color:var(--err)">remove</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button[data-rm]'), function (b) {
      b.addEventListener('click', function () {
        state.draftMedia.splice(Number(b.getAttribute('data-rm')), 1);
        renderMedia();
      });
    });
    // "post up": only one file is ever featured — reposting moves the flag.
    Array.prototype.forEach.call(box.querySelectorAll('button[data-post]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-post'));
        if (!state.draftMedia[i]) return;
        state.draftMedia.forEach(function (m) { m.featured = false; });
        state.draftMedia[i].featured = true;
        renderMedia();
      });
    });
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function uploadMedia(file, kind, featured) {
    var key = 'catalogue/' + uuid() + '.' + (file.name.split('.').pop() || 'bin').toLowerCase();
    api('/api/storage/sign-upload', { method: 'POST', body: { key: key, contentType: file.type || 'application/octet-stream' } })
      .then(function (r) {
        if (r.status !== 200 || !r.json || !r.json.uploadUrl) {
          alert('Upload failed — could not get a signed URL.');
          return;
        }
        return fetch(r.json.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
          .then(function (ur) {
            if (ur.status !== 200) throw new Error('upload rejected');
            var entry = { kind: kind, key: r.json.key, name: file.name, size: file.size };
            if (featured) {
              // Only one file can be posted up; posting a new one moves the flag.
              state.draftMedia.forEach(function (m) { m.featured = false; });
              entry.featured = true;
            }
            state.draftMedia.push(entry);
            renderMedia();
          });
      })
      .catch(function () { alert('Upload failed — please try again.'); });
  }

  function saveForm() {
    var title = $('cat-title') && $('cat-title').value.trim();
    var desc = $('cat-desc') ? $('cat-desc').value : '';
    var priceEuro = Number(($('cat-price') && $('cat-price').value) || 0);
    var type = $('cat-type') ? $('cat-type').value : 'song';
    var tags = ($('cat-tags') ? $('cat-tags').value : '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var live = $('cat-live') ? $('cat-live').checked : false;
    var bundleOf = Array.prototype.map.call(
      rootEl.querySelectorAll('#cat-form input[type=checkbox][value][checked]') || [],
      function (c) { return c.value; }
    );

    if (!title) { alert('Give the listing a title.'); return; }
    if (!priceEuro || priceEuro < 0.5) { alert('Set a price of at least €0.50.'); return; }
    var priceMinor = Math.round(priceEuro * 100);

    var body = {
      type: type,
      title: title,
      description: desc,
      priceMinor: priceMinor,
      currency: 'EUR',
      media: state.draftMedia,
      tags: tags,
      bundleOf: bundleOf,
      status: live ? 'live' : 'draft',
    };

    if (state.editId) {
      api('/api/catalogue/' + encodeURIComponent(state.editId), { method: 'PATCH', body: body })
        .then(function (r) { refresh(); });
    } else {
      api('/api/catalogue', { method: 'POST', body: body })
        .then(function (r) { refresh(); });
    }
  }

  window.SWR_SELLER = { init: init, refresh: refresh };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();