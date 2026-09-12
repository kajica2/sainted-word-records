#!/usr/bin/env node
// scripts/compress-gifts.mjs — Compress a curated set of GIFs into
// library/animated-gifts/ with a per-file <1MB ceiling. Two-pass palette
// generation, multiple width/FPS tiers until we hit the ceiling.
//
// Usage: node scripts/compress-gifts.mjs [srcDir] [dstDir] [limitBytes] [count]
//   defaults: srcDir=/Users/.../Downloads/Results for "gif" _ Are.na
//             dstDir=/Users/.../library/animated-gifts
//             limitBytes=1048576  (1 MB)
//             count=3

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SRC = process.argv[2]
  || '/Users/kaidejuricmasscmbook/Downloads/Results for \u201cgif\u201d _ Are.na';
const DST = process.argv[3]
  || '/Users/kaidejuricmasscmbook/Documents/sainted-word-records/library/animated-gifts';
const LIMIT = Number(process.argv[4]) || 1024 * 1024;
const COUNT = Number(process.argv[5]) || 3;

// The eleven Are.na "results for gif" GIFs.
const candidates = [
  'imgi_2_original_2224c8359a7d81c3c2628df6c54f6293.gif',
  'imgi_3_original_10a2171799dc90e3120b099f21fdeab3.gif',
  'imgi_4_original_d659fa33419e0b2d87eef2dc6ba383c1.gif',
  'imgi_5_original_aa468be511a43ddfc23d9805288dca4a.gif',
  'imgi_6_original_8e1854c12ae37359ea679752b7860f0c.gif',
  'imgi_7_original_718d3bb26567a287b0746f72e2d81e9a.gif',
  'imgi_8_original_8e82c811f2ca71ec2e0c3d51c37db5fc.gif',
  'imgi_9_original_49a484fb54f90e3296d4af4ac2b2f68a.gif',
  'imgi_10_original_0fc48222a4b48646364a174afd0e9d21.gif',
  'imgi_11_original_2c2b4f6bededd0aa31782c4a63418539.gif',
  'imgi_12_original_4bf278d76fc305ac2637d7edceb321b8.gif',
];

if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });

const sizes = candidates
  .map((c) => {
    const srcPath = path.join(SRC, c);
    return {
      name: c,
      src: srcPath,
      size: fs.existsSync(srcPath) ? fs.statSync(srcPath).size : Infinity,
    };
  })
  .filter((c) => Number.isFinite(c.size))
  .sort((a, b) => a.size - b.size);

console.log(`[gif-compress] Source: ${SRC}`);
console.log(`[gif-compress] Target: ${DST}`);
console.log(`[gif-compress] Limit: ${LIMIT} bytes (~${(LIMIT / 1024).toFixed(0)} KB)`);
console.log(`[gif-compress] Want:   ${COUNT} final gifts\n`);

const accepted = [];

function compress(srcPath, dstPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gifcomp-'));
  const palettePath = path.join(tmpDir, 'palette.png');

  // Pass 1: palette generation
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-i', srcPath,
      '-vf', 'palettegen=stats_mode=diff',
      palettePath,
    ],
    { stdio: ['inherit', 'inherit', 'inherit'] },
  );

  // Pass 2: encode with palette, scaling tiers
  const tiers = [
    { w: 320, fps: 12 },
    { w: 280, fps: 10 },
    { w: 240, fps: 10 },
    { w: 200, fps: 8 },
    { w: 160, fps: 8 },
    { w: 128, fps: 6 },
  ];

  let lastTier = tiers[tiers.length - 1];
  let lastSize = Infinity;

  for (const tier of tiers) {
    const scale = `scale=${tier.w}:-1:flags=lanczos`;
    const fps = `fps=${tier.fps}`;
    execFileSync(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-i', srcPath, '-i', palettePath,
        '-lavfi', `${fps},${scale}`,
        '-gifflags', '+transdiff',
        '-f', 'gif',
        dstPath,
      ],
      { stdio: ['inherit', 'inherit', 'inherit'] },
    );
    const sz = fs.statSync(dstPath).size;
    console.log(`  tier ${tier.w}px@${tier.fps}fps -> ${(sz / 1024).toFixed(1)} KB`);
    lastTier = tier;
    lastSize = sz;
    if (sz <= LIMIT) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { ok: true, size: sz, tier };
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { ok: false, size: lastSize, tier: lastTier };
}

for (const cand of sizes) {
  if (accepted.length >= COUNT) break;
  console.log(`\n→ ${cand.name} (${(cand.size / 1024).toFixed(1)} KB original)`);
  const stem = cand.name.replace(/\.gif$/, '');
  const dstPath = path.join(DST, stem + '.gif');
  const result = compress(cand.src, dstPath);
  if (result.ok) {
    accepted.push({
      original: cand.name,
      final: stem + '.gif',
      origKB: Math.round(cand.size / 1024),
      finalKB: Math.round(result.size / 1024),
      tier: `${result.tier.w}px@${result.tier.fps}fps`,
    });
    console.log(`  ACCEPTED ${stem}.gif (${(result.size / 1024).toFixed(1)} KB, ${result.tier.w}px@${result.tier.fps}fps)`);
  } else {
    console.log(`  SKIPPED — could not compress below 1MB without catastrophic quality loss`);
    fs.rmSync(dstPath, { force: true });
  }
}

const manifestPath = path.join(DST, 'manifest.json');
fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      pack: 'animated-gifts',
      generated: new Date().toISOString(),
      limitBytes: LIMIT,
      items: accepted,
    },
    null,
    2,
  ),
);

console.log(`\n[gif-compress] Done. Accepted ${accepted.length}/${COUNT} gifts.`);
console.log(`[gif-compress] Manifest: ${manifestPath}`);
console.log(`[gif-compress] Total shipped: ${accepted.reduce((s, i) => s + i.finalKB, 0)} KB`);
