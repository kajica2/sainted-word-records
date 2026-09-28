#!/usr/bin/env node
// targeting-pipeline/build-rules.mjs
//
// Emits targeting/rules.json — the persona → UI-affinity table the runtime
// TargetingRules module reads. Everything here is derived from repo sources at
// build time, never hand-edited in the artifact:
//
//   • persona ids      ← targeting/ontology.json   (parse-personas.mjs)
//   • segment ids      ← targeting/segments.json   (parse-scripts.mjs)
//   • variant ids      ← client/variant-switcher.client.js  (the #variant select)
//   • transition ids   ← engine-transitions.client.js       (the #swr-tx-pick select)
//
// The two lookup tables below (SEGMENT_BY_PERSONA / VARIANT_AFFINITY) are the
// only authored data in this file. They are the machine-readable mirror of the
// persona narratives' "Surfaces" + "What they're trying to do" sections, and
// are validated for totality by verify.mjs — a persona that exists in
// ontology.json but is missing from SEGMENT_BY_PERSONA fails the build.
//
// NOTE (repo reality, verified 2026-09-28): the engine's #variant <select> is
// populated by client/variant-switcher.client.js with exactly five variant ids
// — neon, film, grid, smoke, hallucination. The 29 files under versions/ are
// standalone pages, not #variant options. Reordering therefore operates on
// these five ids, and VARIANT_AFFINITY lists a top-2 per persona which is
// expanded into a full five-id ordering.
//
// Usage: node targeting-pipeline/build-rules.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBanned } from './build-voice-lint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'targeting');
const ONTOLOGY = path.join(OUT_DIR, 'ontology.json');
const SEGMENTS = path.join(OUT_DIR, 'segments.json');
const OUT_PATH = path.join(OUT_DIR, 'rules.json');

// ── authored tables ──────────────────────────────────────────────────────────

// persona id → segment id | null. null = cross-cutting persona with no
// marketing segment (Appendix A of the persona PRD): they live across all four
// audiences, so no segment-level banner copy is shown for them.
const SEGMENT_BY_PERSONA = {
  // music creators
  'fx-surgeon': 'music-creators',
  'audio-theorist': 'music-creators',
  'bedroom-producer': 'music-creators',
  'theory-sonifier': 'music-creators',
  'album-cover-designer': 'music-creators',
  'data-sonifier': 'music-creators',
  'anchor-curator': 'music-creators',
  'music-therapist': 'music-creators',
  // video creators
  'ar-loop-poster': 'video-creators',
  'storyboard-editor': 'video-creators',
  'version-hopper': 'video-creators',
  'recorder-renderer': 'video-creators',
  'film-composer': 'video-creators',
  'short-film-scorer': 'video-creators',
  'touring-visualist': 'video-creators',
  'podcast-visual-editor': 'video-creators',
  'ad-creative-director': 'video-creators',
  'wedding-videographer': 'video-creators',
  'choreographer': 'video-creators',
  // educators
  'online-music-teacher': 'educators',
  'ar-storyboard-reviewer': 'educators',
  // casual creators
  'ar-poster-artist': 'casual-creators',
  'ar-flashcards': 'casual-creators',
  'gallery-curator': 'casual-creators',
  // cross-cutting — no segment
  'live-vj': null,
  'transition-choreo': null,
  'auth-projects': null,
  'tag-janitor': null,
};

// persona id → top-2 preferred #variant ids, best first. Expanded into a full
// ordering against the canonical variant list.
const VARIANT_AFFINITY = {
  'ar-loop-poster': ['smoke', 'film'],
  'storyboard-editor': ['film', 'smoke'],
  'version-hopper': ['neon', 'film'],
  'fx-surgeon': ['film', 'smoke'],
  'transition-choreo': ['neon', 'grid'],
  'recorder-renderer': ['film', 'grid'],
  'anchor-curator': ['neon', 'film'],
  'audio-theorist': ['smoke', 'film'],
  'tag-janitor': ['grid', 'film'],
  'auth-projects': ['film', 'grid'],
  'ar-poster-artist': ['smoke', 'hallucination'],
  'live-vj': ['hallucination', 'neon'],
  'film-composer': ['film', 'smoke'],
  'theory-sonifier': ['smoke', 'hallucination'],
  'ar-flashcards': ['grid', 'neon'],
  'short-film-scorer': ['film', 'smoke'],
  'touring-visualist': ['hallucination', 'neon'],
  'data-sonifier': ['grid', 'hallucination'],
  'gallery-curator': ['film', 'smoke'],
  'podcast-visual-editor': ['film', 'grid'],
  'music-therapist': ['smoke', 'film'],
  'ad-creative-director': ['neon', 'grid'],
  'online-music-teacher': ['grid', 'film'],
  'bedroom-producer': ['neon', 'film'],
  'choreographer': ['neon', 'hallucination'],
  'wedding-videographer': ['film', 'smoke'],
  'album-cover-designer': ['film', 'smoke'],
  'ar-storyboard-reviewer': ['grid', 'film'],
};

// persona id → pinned transition ids (highest-interest first). Optional: a
// persona absent from this table gets no transition pins.
const TRANSITION_PINS = {
  'live-vj': ['glitch-block', 'chromatic-split', 'chroma-burst', 'vhs-tracking', 'negative-pop', 'snap-zoom'],
  'transition-choreo': ['whip-blur', 'zoom-through', 'swivel', 'circle-wipe', 'iris-in', 'warp-dissolve', 'kaleidoscope-burst'],
  'fx-surgeon': ['chromatic-split', 'glitch-block', 'pure-crossfade', 'negative-pop'],
  'version-hopper': ['whip-blur', 'snap-zoom', 'zoom-through', 'fade-to-black'],
  'touring-visualist': ['vhs-tracking', 'chromatic-split', 'chroma-burst', 'particle-wipe'],
  'ad-creative-director': ['flash-cover', 'snap-zoom', 'linear-wipe-lr', 'whip-blur'],
  'wedding-videographer': ['pure-crossfade', 'fade-to-black', 'lens-flare', 'glow-burst'],
  'ar-flashcards': ['iris-in', 'circle-wipe', 'pure-crossfade'],
  'recorder-renderer': ['fade-to-black', 'pure-crossfade'],
  'choreographer': ['swivel', 'circle-wipe', 'whip-blur', 'snap-zoom'],
};

// persona id → in-engine surface hint (a route the persona should be nudged
// toward), or omitted for none.
const SURFACE_HINT = {
  'ar-loop-poster': '/ar-loop',
  'ar-poster-artist': '/ar-loop',
  'ar-flashcards': '/ar-loop',
  'fx-surgeon': '/versions/film.html',
  'film-composer': '/versions/film.html',
  'version-hopper': '/versions/',
};

// persona id → banner copy shown when that persona is classified. Must pass
// voice lint (verify.mjs lints every note against voice-lint.json) and must
// carry a CTA line ("Free, no signup.") per PRD FR-19.
const PERSONA_NOTES = {
  'fx-surgeon': 'Your existing folder suddenly feels alive. Free, no signup.',
  'live-vj': 'Build the set list. Free, no signup.',
  'bedroom-producer': 'Reacts to your actual song, not templates. Free, no signup.',
  'tag-janitor': 'Tag-only mode is on. Free, no signup.',
  'ar-loop-poster': 'Post it straight from your phone. Free, no signup.',
  'transition-choreo': 'Every transition waits for your hand. Free, no signup.',
  'audio-theorist': 'BPM, key and chromagram, right on the panel. Free, no signup.',
  'version-hopper': 'Twenty-nine looks, one song. Free, no signup.',
  'storyboard-editor': 'Scenes on a timeline, not a spreadsheet. Free, no signup.',
  'recorder-renderer': 'Ten-second WebMs, straight to disk. Free, no signup.',
  'gallery-curator': 'Everything stays on your machine. Free, no signup.',
};

// segment id → fallback banner copy when the persona has no PERSONA_NOTES entry.
const SEGMENT_NOTES = {
  'music-creators': 'Drop in your song and watch it move. Free, no signup.',
  'video-creators': 'Drop in your clips and watch them move. Free, no signup.',
  'educators': 'Your lecture finally has a pulse. Free, no signup.',
  'casual-creators': 'Make something cool in a minute. Free, no signup.',
};

// persona file surface word → runtime surface code. The persona files write
// prose surface names ("audio-analysis", "projects/auth"); the classifier
// counts codes (AUD, AAP). verify.mjs fails on a word missing from this table
// so a new persona surface cannot silently score zero.
const SURFACE_CODE = {
  'engine': 'ENG',
  'versions': 'VER',
  'FX': 'FX',
  'storyboard': 'STORY',
  'transitions': 'TX',
  'recorder': 'REC',
  'presets': 'PST',
  'library': 'LIB',
  'audio-analysis': 'AUD',
  'AR': 'AR',
  'auth': 'AAP',
  'projects/auth': 'AAP',
};

export function surfaceCodes() { return { ...SURFACE_CODE }; }

// ── derived from repo sources ───────────────────────────────────────────────

export function readVariantIds() {
  const src = fs.readFileSync(path.join(ROOT, 'client/variant-switcher.client.js'), 'utf8');
  const ids = [...src.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

export function readTransitionIds() {
  const src = fs.readFileSync(path.join(ROOT, 'engine-transitions.client.js'), 'utf8');
  const block = src.slice(src.indexOf('const TRANSITIONS = {'));
  const ids = [...block.matchAll(/^\s*'([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]);
  return [...new Set(ids)];
}

export function buildRules() {
  const ontology = JSON.parse(fs.readFileSync(ONTOLOGY, 'utf8'));
  const segments = JSON.parse(fs.readFileSync(SEGMENTS, 'utf8'));
  const canonicalVariants = readVariantIds();
  const transitions = readTransitionIds();

  const segmentIds = new Set(segments.segments.map((s) => s.id));
  const transitionSet = new Set(transitions);

  const personaToVariants = {};
  const personaToTransitions = {};
  const personaToSegment = {};
  const personaToSurfaceHint = {};
  const personaToNote = {};
  const personaSurfaces = {};

  const missing = [];
  for (const { id, surfaces } of ontology.personas) {
    if (!(id in SEGMENT_BY_PERSONA)) { missing.push(id); continue; }

    personaSurfaces[id] = (surfaces || []).map(function (w) { return SURFACE_CODE[w]; }).filter(Boolean);

    const affinity = VARIANT_AFFINITY[id] || [];
    const rest = canonicalVariants.filter((v) => !affinity.includes(v));
    personaToVariants[id] = [...affinity, ...rest];

    const seg = SEGMENT_BY_PERSONA[id];
    if (seg !== null && !segmentIds.has(seg)) {
      throw new Error(`persona ${id}: segment "${seg}" not in segments.json`);
    }
    personaToSegment[id] = seg;

    if (TRANSITION_PINS[id]) {
      for (const t of TRANSITION_PINS[id]) {
        if (!transitionSet.has(t)) throw new Error(`persona ${id}: transition "${t}" not in engine-transitions.client.js`);
      }
      personaToTransitions[id] = TRANSITION_PINS[id];
    }
    if (SURFACE_HINT[id]) personaToSurfaceHint[id] = SURFACE_HINT[id];
    personaToNote[id] = PERSONA_NOTES[id] || (seg ? SEGMENT_NOTES[seg] : null);
  }

  if (missing.length) {
    throw new Error(`SEGMENT_BY_PERSONA missing ${missing.length} persona(s): ${missing.join(', ')}`);
  }

  return {
    version: 'swr-targeting-rules/v1',
    variants: canonicalVariants,
    transitions,
    personaSurfaces,
    banned: extractBanned(),
    personaToVariants,
    personaToTransitions,
    personaToSegment,
    personaToSurfaceHint,
    personaToNote,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rules = buildRules();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(rules, null, 2) + '\n');
  process.stdout.write(`[build-rules] ${Object.keys(rules.personaToVariants).length} personas, `
    + `${rules.variants.length} variants, ${rules.transitions.length} transitions → ${path.relative(ROOT, OUT_PATH)}\n`);
}
