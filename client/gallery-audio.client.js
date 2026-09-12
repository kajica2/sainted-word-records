// gallery-audio.client.js
//
// Per-card audio playback for the SWR galleries. Activated by any card
// bearing `data-audio="<url>"`. The featured card (gallery-card--featured)
// auto-loops after the first user gesture on the page; standard cards
// play on hover with a small play/pause glyph that fades in over the
// art. Single shared HTMLAudioElement — only one clip plays at a time,
// hover-to-switch just swaps the src and resumes.
//
// Spec:
//   - dataset.src  — the audio URL (e.g. "./audios/bachdrop.mp3")
//   - dataset.label — optional aria-label override
//   - the parent must be .gallery-card or .gallery-card--featured
//
// Behaviour:
//   - Click anywhere on the page the first time → unlockAudio() runs.
//     Featured card auto-plays, others stay quiet until hover.
//   - Hover on standard card → crossfade 300ms into that clip.
//   - Leave the card → pause (currentTime preserved).
//   - Click on featured card → toggle play/pause of featured clip.
//   - Pause any clip when navigating away (pagehide).
//   - Reduced-motion: same behaviour, no extra animation.

(function () {
  'use strict';

  if (window.SWR && window.SWR.GalleryAudio) return;

  const STYLE_ID = 'swr-gallery-audio-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      // Play/pause glyph anchored to bottom-right of every card.
      '.gallery-card__play {',
      '  position: absolute; bottom: 12px; right: 12px;',
      '  width: 38px; height: 38px; border-radius: 999px;',
      '  background: rgba(10, 6, 4, 0.7);',
      '  color: #d4af37;',
      '  border: 1px solid rgba(212, 175, 55, 0.45);',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  opacity: 0; transform: translateY(6px);',
      '  transition: opacity 0.25s ease, transform 0.25s ease, background 0.2s ease;',
      '  backdrop-filter: blur(8px);',
      '  cursor: pointer;',
      '  padding: 0;',
      '  z-index: 2;',
      '}',
      '.gallery-card:hover .gallery-card__play,',
      '.gallery-card:focus-within .gallery-card__play {',
      '  opacity: 1; transform: translateY(0);',
      '}',
      '.gallery-card__play--featured { opacity: 1; transform: translateY(0); }',
      '.gallery-card__play:hover { background: rgba(212, 175, 55, 0.18); }',
      '.gallery-card__play--on { background: #d4af37; color: #0a0604; border-color: #d4af37; }',
      '.gallery-card--playing { border-color: #d4af37; }',
      '.gallery-card--playing .gallery-card__art::before {',
      '  content: ""; position: absolute; inset: 0;',
      '  background: radial-gradient(circle at 50% 50%, rgba(212,175,55,0.18), transparent 70%);',
      '  pointer-events: none; z-index: 1;',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  const audio = new Audio();
  audio.preload = 'none';
  audio.loop = true;
  audio.crossOrigin = 'anonymous';
  audio.volume = 0.55;

  let currentEl = null; // last card that triggered playback
  let unlocked = false;
  let isPlaying = false;

  function attach() {
    injectStyles();
    const cards = Array.from(document.querySelectorAll('.gallery-card[data-audio]'));
    if (!cards.length) return;

    const featured = cards.find((c) => c.classList.contains('gallery-card--featured')) || null;

    cards.forEach((card) => {
      const src = card.getAttribute('data-audio');
      if (!src) return;

      // Inject play glyph (small SVG) into the art element.
      const art = card.querySelector('.gallery-card__art');
      if (art && !art.querySelector('.gallery-card__play')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gallery-card__play';
        btn.setAttribute('aria-label', `Play ${card.getAttribute('data-label') || 'preview'}`);
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
          '<path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
        art.appendChild(btn);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (currentEl === card && isPlaying) {
            pause();
            return;
          }
          play(card, btn);
          swapIcon(btn, true);
        });
      }

      // Standard cards: hover/focus to preview.
      if (card !== featured) {
        const enter = () => { if (unlocked) play(card, art.querySelector('.gallery-card__play')); };
        const leave = () => { if (currentEl === card) pause(); };
        card.addEventListener('mouseenter', enter);
        card.addEventListener('focusin', enter);
        card.addEventListener('mouseleave', leave);
        card.addEventListener('focusout', leave);
      } else {
        // Featured: click to toggle.
        const fbtn = art ? art.querySelector('.gallery-card__play') : null;
        if (fbtn) fbtn.classList.add('gallery-card__play--featured');
      }
    });

    // First gesture unlocks audio + starts featured loop.
    const unlockAudio = () => {
      if (unlocked) return;
      unlocked = true;
      if (featured) {
        play(featured, featured.querySelector('.gallery-card__play'));
      }
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio, { passive: true });

    // Clean up on navigation.
    window.addEventListener('pagehide', () => {
      try { audio.pause(); audio.src = ''; } catch (_) {}
    });
  }

  function play(card, btn) {
    if (!card) return;
    const src = card.getAttribute('data-audio');
    if (!src) return;
    if (currentEl && currentEl !== card) {
      currentEl.classList.remove('gallery-card--playing');
      const prevBtn = currentEl.querySelector('.gallery-card__play');
      if (prevBtn) prevBtn.classList.remove('gallery-card__play--on');
    }
    currentEl = card;
    card.classList.add('gallery-card--playing');
    if (btn) btn.classList.add('gallery-card__play--on');

    if (audio.src !== new URL(src, location.href).href) {
      audio.src = src;
    }
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { isPlaying = true; }).catch(() => { isPlaying = false; });
    } else {
      isPlaying = true;
    }
  }

  function pause() {
    audio.pause();
    isPlaying = false;
    if (currentEl) {
      currentEl.classList.remove('gallery-card--playing');
      const btn = currentEl.querySelector('.gallery-card__play');
      if (btn) {
        btn.classList.remove('gallery-card__play--on');
        swapIcon(btn, false);
      }
    }
  }

  function swapIcon(btn, isPlaying) {
    if (!btn) return;
    const path = btn.querySelector('svg path');
    if (!path) return;
    path.setAttribute('d', isPlaying ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  window.SWR = window.SWR || {};
  window.SWR.GalleryAudio = { play, pause, audio };
})();