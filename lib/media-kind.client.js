// lib/media-kind.client.js — one rule for "is this file a picture or a movie?"
//
// The file picker and a drag-and-drop both hand the engine a File. On
// Linux, and for .mov / .mkv / .avi on several desktops, that File's
// `type` is "" or "application/octet-stream". Every import path used to
// keep only strings that start with "video/" or "image/", so those movies
// were skipped before they could reach the library or the layer stack.
//
// mimeFor() returns a video/* or image/* type: the browser's own type when
// it is already one of those, otherwise the type implied by the extension.
// kind() is "video", "image", or "".
//
// Loaded as a plain deferred script so both lib/library.client.js and
// lib/media-store.client.js can read window.SWR_MEDIA_KIND at call time.

(function () {
  'use strict';
  if (window.SWR_MEDIA_KIND) return;

  var EXT = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    ogv: 'video/ogg',
    mpg: 'video/mpeg',
    mpeg: 'video/mpeg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
  };

  function extOf(name) {
    var m = String(name || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function mimeFor(file) {
    if (!file) return '';
    var type = String(file.type || '').toLowerCase();
    if (type.indexOf('video/') === 0 || type.indexOf('image/') === 0) return type;
    // An unknown or generic type is not a reason to drop a movie the
    // filename already identifies. A real non-media type (text/plain,
    // application/pdf) still loses.
    if (type && type !== 'application/octet-stream') return '';
    return EXT[extOf(file.name)] || '';
  }

  function kind(file) {
    var mime = mimeFor(file);
    if (mime.indexOf('video/') === 0) return 'video';
    if (mime.indexOf('image/') === 0) return 'image';
    return '';
  }

  window.SWR_MEDIA_KIND = { EXT: EXT, mimeFor: mimeFor, kind: kind };
})();
