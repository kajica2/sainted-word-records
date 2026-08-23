import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

function copyDirRecursive(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    if (f.startsWith('_') || f.endsWith('.bak')) continue;
    const sp = join(src, f);
    const dp = join(dst, f);
    const st = statSync(sp);
    if (st.isDirectory()) {
      copyDirRecursive(sp, dp);
    } else if (st.isFile()) {
      copyFileSync(sp, dp);
    }
  }
}

// Vite plugin: copy ./library/*, ./versions/*, and the GitHub project files
// to the Vite-resolved outDir.
//
// Two-phase copy strategy:
//   1) buildStart — wipe outDir, then copy our root-level + dir-tree files
//      in BEFORE Vite emits its own output (so emptyOutDir: false doesn't
//      wipe them mid-build).
//   2) closeBundle — Vite copies ./public/* into outDir as part of
//      `copyPublicDir` (default: true), which OVERWRITES any of our files
//      that have a stale counterpart in ./public/. We re-copy from the
//      project root so the canonical (fresh) source wins.
//
// The outDir must be read from `configResolved` because Vercel's Vite
// preset may rewrite it to `.vercel/output/static/` and ignore any hardcoded
// value passed at plugin-construction time.
function copyStatic() {
  let outDir = 'dist';
  const rootFiles = [
    'landing.html', 'interactive-howto.html', 'market-study.html',
    'profit-plan.html', 'campaign.html', 'personas.html',
    'landing-personas-v1-editorial.html',
    'landing-personas-v2-dark.html',
    'landing-personas-v3-friendly.html',
    'landing-personas-v4-dashboard.html',
    'landing-personas-v5-brutalist.html',
    'landing-personas-v6-wireframe.html',
    'personas.json',
    'README.md', 'LICENSE', 'HOWTO-30s-VIDEO.md', 'og.png',
    'tutorial-30s.html',
    'swr-tutorial-30s.mp4',
    'versions-presets.js',
    'audio-analysis-v2.js',
    'swr-intro-10s.html',
    'swr-intro-10s-script.txt',
    'swr-intro-10s.mp4',
    'swr-intro-10s-voice.mp4',
    'thanks.html',
    'swr-watermark-a.svg', 'swr-watermark-b.svg', 'swr-watermark-c.svg',
    'swr-watermark-a.png', 'swr-watermark-b.png', 'swr-watermark-c.png',
    'watermark-monogram.svg',
    'video-fx.css',
    'login.html',
    'brandkit.css',
    'brandkit.client.js',
    'manifest.webmanifest',
    'sw.js',
    'pwa-bootstrap.js',
    'offline.html',
    'pt.client.js',
    'pt-panel.client.js',
    'presets.client.js',
    'presets-evolve.client.js',
    'presets-panel.client.js',
    'presets-panel.css',
    'persona-preview.client.js',
    'favicon.ico',
    'apple-touch-icon.png',
    '404.html',
    'changelog.html',
    'press.html',
    'about.html',
    'status.html',
    'versions.html',
    'versions.client.js',
    'director-mode-sainted-word.html',
    'intro.html',
  ];
  const dirs = [
    { src: 'library', dst: 'library' },
    { src: 'versions', dst: 'versions' },
    { src: 'icons', dst: 'icons' },
    { src: 'presets', dst: 'presets' },
    { src: 'press', dst: 'press' },
    { src: 'legal', dst: 'legal' },
    { src: 'style-graphics', dst: 'style-graphics' },
    { src: 'style-videos', dst: 'style-videos' },
  ];
  // Style preview thumbnails referenced from versions/*.html (13 small PNGs)
  const styleThumbs = ['neon','film','grid','smoke','hallucination',
                       'glitch','aurora','pulse','void','chrome','watercolor','fractal',
                       'eclipse'].map((n) => ({
    src: resolve('verify-screenshots', n + '.png'),
    dst: resolve(outDir, 'verify-screenshots', n + '.png'),
  }));
  function doCopy() {
    const log = (m) => process.stdout.write('[copy-static] ' + m + '\n');
    log('outDir = ' + outDir);
    // If library/ doesn't exist on disk, the build is running in CI without
    // demo assets. The prebuild step (scripts/fetch-library.mjs) should have
    // already downloaded it from Vercel Blob. If we get here without it, the
    // engine will still build — just with no bundled library. Log loudly.
    if (!existsSync(resolve('library'))) {
      log('WARNING: ./library not present — engine will ship without demo assets.');
      log('  Local dev: this is fine (engine has no library to demo).');
      log('  Production: prebuild should have fetched it from LIBRARY_BLOB_URL.');
    }
    for (const { src, dst } of dirs.map((d) => ({ src: resolve(d.src), dst: resolve(outDir, d.dst) }))) {
      if (!existsSync(src)) continue;
      if (statSync(src).isDirectory()) {
        copyDirRecursive(src, dst);
      } else {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    }
    for (const { src, dst } of styleThumbs) {
      if (!existsSync(src)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    for (const f of rootFiles) {
      const sp = resolve(f);
      if (!existsSync(sp)) continue;
      copyFileSync(sp, resolve(outDir, f));
      log('copied ' + f);
    }
  }
  return {
    name: 'copy-static',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    buildStart() {
      // Wipe outDir ourselves (we set emptyOutDir: false below to keep
      // Vite from wiping the copyStatic plugin's output mid-build).
      const fullOutDir = resolve(outDir);
      if (existsSync(fullOutDir)) {
        rmSync(fullOutDir, { recursive: true, force: true });
      }
      // Copy our extras first so they're in place before Vite emits
      // its own output (and before Vercel snapshots the directory).
      doCopy();
    },
    closeBundle() {
      // After Vite finishes — including the copyPublicDir phase that
      // copies ./public/* → outDir — re-copy the canonical root files
      // so a stale ./public/<name>.html cannot overwrite a fresh one
      // at the project root. (Vite's public-dir copy is unguarded and
      // will silently shadow our freshly-copied files if a same-named
      // file exists in public/.)
      doCopy();
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const outDir = mode === 'development' ? 'dist-dev' : 'dist';
  return {
    plugins: [copyStatic()],
    server: {
      port: 5174,
      host: '0.0.0.0',
      strictPort: false,
    },
    build: {
      target: 'es2022',
      outDir,
      assetsInlineLimit: 0,
      // Vite's emptyOutDir wipes our copyStatic plugin's output. Disable
      // it; the plugin wipes dist/ itself before its buildStart run.
      emptyOutDir: false,
      rollupOptions: {
        input: 'engine.html',
      },
    },
  };
});
