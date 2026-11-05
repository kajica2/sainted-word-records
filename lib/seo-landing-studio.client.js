// lib/seo-landing-studio.client.js — SEO landing pages: studio iframe + CTA wiring.
(function () {
  'use strict';

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function buildFrameSrc(base, params) {
    const url = new URL(base, window.location.origin);
    url.searchParams.set('embed', '1');
    if (params) {
      Object.keys(params).forEach((k) => {
        if (params[k] != null && params[k] !== '') url.searchParams.set(k, params[k]);
      });
    }
    return url.pathname + url.search;
  }

  function mountStudio(section) {
    const frame = qs('[data-seo-studio-frame]', section);
    if (!frame) return;
    const base = section.getAttribute('data-studio-base') || '/make-video';
    const canvas = section.getAttribute('data-studio-canvas');
    const recSize = section.getAttribute('data-studio-rec-size');
    const recDur = section.getAttribute('data-studio-rec-dur');
    const format = section.getAttribute('data-studio-format');
    const params = {};
    if (canvas === '1') params.canvas = '1';
    if (recSize) params['rec-size'] = recSize;
    if (recDur) {
      params['rec-dur'] = recDur;
      params.dur = recDur;
    }
    if (format) params.format = format;
    frame.src = buildFrameSrc(base, params);
    frame.removeAttribute('hidden');
  }

  function wireScrollCtas() {
    const studio = document.getElementById('seo-studio');
    if (!studio) return;
    document.querySelectorAll('[data-seo-scroll-studio]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (el.tagName === 'A' && el.getAttribute('href') === '#seo-studio') {
          e.preventDefault();
        }
        studio.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const frame = qs('[data-seo-studio-frame]', studio);
        if (frame && !frame.src) mountStudio(studio);
      });
    });
  }

  function wireLazyMount() {
    const section = document.getElementById('seo-studio');
    if (!section) return;
    const eager = section.getAttribute('data-studio-eager') === '1';
    if (eager) {
      mountStudio(section);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      mountStudio(section);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          mountStudio(section);
          obs.disconnect();
        });
      },
      { rootMargin: '120px 0px' }
    );
    obs.observe(section);
  }

  function boot() {
    wireScrollCtas();
    wireLazyMount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
