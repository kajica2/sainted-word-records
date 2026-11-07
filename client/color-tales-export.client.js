/* global window */
(function () {
  const MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42001f,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];

  function pickRecorderMime(MediaRecorder) {
    if (!MediaRecorder || !MediaRecorder.isTypeSupported) {
      return { mime: null, extension: null, supportsMp4: false };
    }
    for (const mime of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(mime)) {
        const extension = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        return { mime, extension, supportsMp4: extension === 'mp4' };
      }
    }
    return { mime: null, extension: null, supportsMp4: false };
  }

  function extensionForMime(mime) {
    if (!mime) return 'webm';
    return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  window.SWR_COLOR_TALES_EXPORT = { pickRecorderMime, extensionForMime, MIME_CANDIDATES };
})();
