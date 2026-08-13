import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
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
// to the Vite-resolved outDir. Files are copied in `buildStart` (BEFORE Vite
// emits its own output) so that Vercel's build snapshot, which is taken
// right after Vite finishes, includes everything in dist/.
//
// The outDir must be read from `configResolved` because Vercel's Vite
// preset may rewrite it to `.vercel/output/static/` and ignore any hardcoded
// value passed at plugin-construction time.
function copyStatic() {
  let outDir = 'dist';
  function doCopy() {
    const log = (m) => process.stdout.write('[copy-static] ' + m + '\n');
    log('outDir = ' + outDir);
    const dirs = [
      { src: resolve('library'), dst: resolve(outDir, 'library') },
      { src: resolve('versions'), dst: resolve(outDir, 'versions') },
    ];
    // Style preview thumbnails referenced from landing.html (5 small PNGs)
    const styleThumbs = ['neon','film','grid','smoke','hallucination'].map((n) => ({
      src: resolve('verify-screenshots', n + '.png'),
      dst: resolve(outDir, 'verify-screenshots', n + '.png'),
    }));
    for (const { src, dst } of [...dirs, ...styleThumbs]) {
      if (!existsSync(src)) continue;
      if (statSync(src).isDirectory()) {
        copyDirRecursive(src, dst);
      } else {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    }
    // Copy root-level project files
    const rootFiles = [
      'landing.html', 'interactive-howto.html', 'market-study.html',
      'profit-plan.html', 'campaign.html', 'personas.html',
      'landing-personas-v1-editorial.html',
      'landing-personas-v2-dark.html',
      'landing-personas-v3-friendly.html',
      'landing-personas-v4-dashboard.html',
      'landing-personas-v5-brutalist.html',
      'personas.json',
      'README.md', 'LICENSE', 'HOWTO-30s-VIDEO.md', 'og.png',
      'tutorial-30s.html',
      'swr-tutorial-30s.mp4',
      'versions-presets.js',
      ];
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
        input: 'index_app.html',
      },
    },
  };
});
