#!/usr/bin/env node
// verify.mjs — check manifest.json + presets/*.json against the swr-preset/v1 schema.
// Run after every daily generate. CI-friendly: exits 1 on any failure.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Presets live in a sibling folder (../presets) so the engine can fetch
// /presets/manifest.json same-origin from the deployed engine.
const PRESETS_DIR = join(__dirname, '..', 'presets');
const MANIFEST = join(PRESETS_DIR, 'manifest.json');

const FX_KEYS = [
  'liquid','pearl','glitch','grain','chroma','bloom','vignette','sepia',
  'glow','grayscale','blur','mut','mutAlgo','temp','posterize',
];
const AUDIO_BANDS = ['bass','mid','treble','onset'];
const FAMILIES = ['GENERATIVE','MORPHA','TRAIN','CSSFX'];
const ID_RE = /^swr-preset-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

function validate(p) {
  const errs = [];
  const required = ['id','schema','created_at','name','family','description',
                    'inspiration','fx_state','motion','palette','audio_reactivity','preview'];
  for (const f of required) if (!(f in p)) errs.push(`missing field: ${f}`);
  if (p.schema !== 'swr-preset/v1') errs.push(`schema ${p.schema} (want swr-preset/v1)`);
  if (!FAMILIES.includes(p.family)) errs.push(`family ${p.family} not in ${FAMILIES}`);
  if (!ID_RE.test(p.id || '')) errs.push(`id ${p.id} does not match ${ID_RE}`);
  const fx = p.fx_state || {};
  for (const k of FX_KEYS) {
    if (!(k in fx)) errs.push(`fx_state missing ${k}`);
  }
  if (fx.posterize !== undefined && !(fx.posterize >= 1 && fx.posterize <= 16)) {
    errs.push(`posterize out of [1,16]: ${fx.posterize}`);
  }
  for (const [k, v] of Object.entries(fx)) {
    if (k === 'posterize') continue;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > 1) errs.push(`fx_state.${k}=${v} not in [0,1]`);
  }
  const pal = p.palette || {};
  for (const k of ['primary','secondary','accent','bg']) {
    if (!HEX_RE.test(String(pal[k] || ''))) errs.push(`palette.${k} ${pal[k]} not 6-digit hex`);
  }
  const ar = p.audio_reactivity || {};
  for (const b of AUDIO_BANDS) {
    if (!(b in ar)) errs.push(`audio_reactivity missing band: ${b}`);
    else if (!Array.isArray(ar[b])) errs.push(`audio_reactivity.${b} not a list`);
  }
  if (!ar.bass || ar.bass.length === 0) errs.push('audio_reactivity.bass must have at least one entry');
  const svg = p.preview?.thumbnail_svg || '';
  if (!svg.startsWith('<svg')) errs.push('preview.thumbnail_svg missing <svg root');
  if (svg.length > 4096) errs.push(`preview.thumbnail_svg ${svg.length}B > 4096`);
  if (!svg.includes('</svg>')) errs.push('preview.thumbnail_svg missing </svg>');
  const wsum = (p.inspiration || []).reduce((s, i) => s + Number(i.weight || 0), 0);
  if (wsum < 0.5 || wsum > 1.0) errs.push(`inspiration weights sum ${wsum} not in [0.5,1.0]`);
  return errs;
}

console.log('=== Preset spec verifier (swr-preset/v1) ===');

// manifest
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  pass('manifest.json parses');
} catch (e) {
  fail(`manifest.json parse: ${e.message}`);
  process.exit(1);
}
if (manifest.version !== 1) fail(`manifest.version ${manifest.version} (want 1)`); else pass('manifest.version = 1');
if (!Array.isArray(manifest.presets)) fail('manifest.presets not an array');
else pass(`manifest.presets has ${manifest.presets.length} entr${manifest.presets.length === 1 ? 'y' : 'ies'}`);

// each preset in manifest
for (const p of manifest.presets || []) {
  const errs = validate(p);
  if (errs.length === 0) pass(`${p.id}`);
  else { fail(`${p.id}`); for (const e of errs) console.log('     -', e); }
}

// each preset on disk
let diskCount = 0;
try {
  const files = readdirSync(PRESETS_DIR).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  diskCount = files.length;
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(PRESETS_DIR, f), 'utf8'));
    const errs = validate(p);
    if (errs.length === 0) pass(`disk:${f}`);
    else { fail(`disk:${f}`); for (const e of errs) console.log('     -', e); }
  }
} catch (e) {
  fail(`presets/ read: ${e.message}`);
}

// manifest vs disk sync
const manifestIds = new Set((manifest.presets || []).map(p => p.id));
const diskIds = new Set();
try {
  for (const f of readdirSync(PRESETS_DIR).filter(x => x.endsWith('.json') && x !== 'manifest.json')) {
    const p = JSON.parse(readFileSync(join(PRESETS_DIR, f), 'utf8'));
    diskIds.add(p.id);
  }
} catch {}
for (const id of manifestIds) if (!diskIds.has(id)) fail(`manifest has ${id} but no file on disk`);
for (const id of diskIds) if (!manifestIds.has(id)) fail(`disk has ${id} but not in manifest`);
if (manifestIds.size === diskIds.size) pass(`manifest and disk agree on ${manifestIds.size} ids`);

// unique ids
const seen = new Set();
for (const p of manifest.presets || []) {
  if (seen.has(p.id)) fail(`duplicate id in manifest: ${p.id}`);
  seen.add(p.id);
}
if (seen.size === (manifest.presets || []).length) pass('all manifest ids are unique');

// unique names
const nameSeen = new Set();
for (const p of manifest.presets || []) {
  if (nameSeen.has(p.name)) fail(`duplicate name in manifest: ${p.name}`);
  nameSeen.add(p.name);
}
if (nameSeen.size === (manifest.presets || []).length) pass('all manifest names are unique');

const failed = checks.filter(c => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
