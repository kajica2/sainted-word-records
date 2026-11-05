// lib/walkthrough-auto.client.js — master switch for auto-showing onboarding / walkthrough UI.
//
// When false (the default), these do NOT auto-open on first visit:
//   - HyperFrames cinematic tour (swr-onboarding-hf.client.js)
//   - Welcome shortcuts modal (#swr-onboard inline controller on engine.html)
//   - Persona picker overlay (persona-onboarding.js)
//   - Basic-mode welcome overlay (engine-basic-mode.client.js)
//
// Manual re-open paths stay live: SWR_ONBOARD_HF.play(), SWR_ONBOARD.open(),
// SWR_PERSONA.show(), ? keyboard help (SWR_KEYS), etc.
//
// Re-enable auto-show: set window.SWR_WALKTHROUGH_AUTO = true in this file
// (or inject true before onboarding scripts load) and rebuild.
(function () {
  'use strict';
  if (typeof window.SWR_WALKTHROUGH_AUTO !== 'boolean') {
    window.SWR_WALKTHROUGH_AUTO = false;
  }
  window.SWR_WALKTHROUGH = {
    autoEnabled: function () {
      return window.SWR_WALKTHROUGH_AUTO === true;
    },
  };
})();
