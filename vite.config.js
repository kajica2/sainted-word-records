// BUILD_MARKER_v4
import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { handleApi } from './scripts/dev-api.mjs';

function copyDirRecursive(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    // Skip dotfiles and backup files anywhere; recurse into everything else,
    // including directories like api/_lib/ (the underscore-prefix skip
    // would have silently dropped our shared helpers).
    if (f.startsWith('.') || f.endsWith('.bak')) continue;
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
    'gif-to-svg.html',
    'gif-to-svg.client.js',
    'landing-personas-v1-editorial.html',
    'landing-personas-v2-dark.html',
    'landing-personas-v3-friendly.html',
    'landing-personas-v4-dashboard.html',
    'landing-personas-v5-brutalist.html',
    'landing-personas-v6-wireframe.html',
    'landing-personas-v7-riso.html',
    'landing-personas-v8-broadcast.html',
    'landing-personas-v9-cassette.html',
    'landing-personas-v10-neon.html',
    'landing-personas-v11-zine.html',
    'personas.json',
    'README.md', 'LICENSE', 'HOWTO-30s-VIDEO.md', 'og.png',
    'tutorial-30s.html',
    'swr-tutorial-30s.mp4',
    // /package.json — /tools/hf-publish fetches this at runtime to pre-fill
    // the release tag. Ship it at the dist root so the relative URL resolves.
    'package.json',
    'versions-presets.js',
    'engine-genops.client.js',
    'engine-render.client.js',
    'engine-timing.client.js',
    'engine-timing-panel.client.js',
    'engine-lfos.client.js',
    'swr-sets.js',
    'engine-lfo-panel.client.js',
    'engine-panel-visibility.client.js',
    'engine-automap.client.js',
    'engine-settings.client.js',
    'persona-onboarding.js',
    'persona-runtime.client.js',
    'persona-demo.html',
    'swr-mascot-camera.svg',
    'swr-mascot-camera.client.js',
    'gallery-audio.client.js',
    'dropzone.client.js',
    'engine-keys.client.js',
    'engine-layout.client.js',
    'project.client.js',
    'timeline.client.js',
    'layer-scheduler.client.js',
    'layer-scheduler.worker.js',
    'engine-genops.css',
    'engine-layout.css',
    'audio-analysis-v2.js',
    'swr-intro-10s.html',
    'swr-intro-10s-script.txt',
    'swr-intro-10s.mp4',
    'swr-intro-10s-voice.mp4',
    'marketplace.html',
    'thanks.html',
    'make-video.html',
    'weddings.html',
    'weddings.css',
    'swr-watermark-a.svg', 'swr-watermark-b.svg', 'swr-watermark-c.svg',
    'swr-watermark-a.png', 'swr-watermark-b.png', 'swr-watermark-c.png',
    'watermark-monogram.svg',
    'video-fx.css',
    'login.html',
    'brandkit.css',
    'brandkit.client.js',
    'camera.client.js',
    'fx-postprocess.js',
    'media-sets.client.js',
    'mic-input.client.js',
    'personas.js',
    'project.js',
    'share.client.js',
    'timeline.client.js',
    'trim.client.js',
    'wizard.js',
    'icons/apple-touch-icon-180.png',
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
    'favicon.svg',
    'og.png',
    'apple-touch-icon.png',
    '404.html',
    'changelog.html',
    'press.html',
    'about.html',
    'status.html',
    'versions.html',
    'portfolio.html',
    'gallery-music.html',
    'gallery-generative.html',
    'gallery-cosmic.html',
    'gallery-bio.html',
    'gallery-ai.html',
    'gallery-glyphs.html',
    'gallery-vr.html',
    'gallery-tshirts.html',
    'gallery-posters.html',
    'gallery-albums.html',
    'gallery-videofx.html',
    'gallery-photoexp.html',
    'gallery-point4brand.html',
    'gallery-artist.html',
    'gallery-darkfuture.html',
    'gallery-bachdrop.html',
    'gallery-brutalist.html',
    'gallery-loops.html',
    'shop.html',
    'engine-demos.html',
    'swr-campaign-launch-plan.html',
    'swr-dm-templates.html',
    'swr-social-content.html',
    'swr-stripe-setup.html',
    'swr-watermark-plan.html',
    'auth/login.html',
    'auth/login.client.js',
    'auth/verify.html',
    'auth/verify.client.js',
    'lib/auth.client.js',
    'lib/storage.client.js',
    'lib/migrate.client.js',
    'api/auth/session.js',
    'api/auth/magic.js',
    'api/auth/verify.js',
    'api/storage/sign-upload.js',
    'api/storage/sign-download.js',
    'api/storage/object.js',
    'api/projects/index.js',
    'api/projects/[id].js',
    // Auth & membership (Stage 2): per-user profile endpoint. Vite's
    // copyStatic will mirror the directory layout, so 'api/users/[id].js'
    // becomes dist/api/users/[id].js — Vercel reads the [id] segment.
    'api/users/[id].js',
    'api/_lib/db.js',
    'api/_lib/http.js',
    'api/_lib/session.js',
    'api/_lib/email.js',
    'versions.client.js',
    'director-mode-sainted-word.html',
    'intro.html',
    'swr-app.html',
    'share-view.html',
  ];
  // Build a curated copy of library/: only ship the files the boot manifest
  // references, plus the manifest itself. The full library/ has ~58MB of
  // tracked media plus another ~76MB in public/library/ (Vite's copyPublicDir
  // ships public/* on its own). Together that's 134MB, well over the 100MB
  // Vercel Hobby cap. Curating to the manifest list keeps the deploy at
  // ~38MB, restoring the video-reactive demo content.
  let LIB_FILES = null;
  function getLibraryFiles() {
    if (LIB_FILES) return LIB_FILES;
    try {
      const m = JSON.parse(readFileSync(resolve('library', 'manifest.json'), 'utf8'));
      // Concatenate curated image/video files with the loop pack so the
      // gallery-loops.html MP4s ship alongside the engine's library.
      const all = [];
      if (Array.isArray(m.files)) all.push(...m.files);
      if (Array.isArray(m.loopFiles)) all.push(...m.loopFiles);
      LIB_FILES = all;
    } catch (e) { LIB_FILES = []; }
    return LIB_FILES;
  }

  const dirs = [
    { src: 'versions', dst: 'versions' },
    { src: 'data', dst: 'data' },
    // The layer scheduler worker is fetched from /versions/<file>
    // (not /<file>) because the engine's worker init resolves the URL
    // relative to the engine page's directory. Ship a copy in both
    // places so the engines can find it.
    { src: 'layer-scheduler.worker.js', dst: 'versions/layer-scheduler.worker.js' },
    { src: 'icons', dst: 'icons' },
    { src: 'portfolio', dst: 'portfolio' },
    { src: 'keyart', dst: 'keyart' },
    { src: 'presets', dst: 'presets' },
    { src: 'press', dst: 'press' },
    { src: 'legal', dst: 'legal' },
    // marketplace/curated/ ships the starter .swr-set files. The
    // marketplace.html page fetches them by relative path, so they must
    // be at marketplace/curated/<file>.swr-set.json in dist.
    { src: 'marketplace', dst: 'marketplace' },
    // marketing/personas/demos/<id>.json — per-persona engine config the
    // persona-runtime.client.js fetches at /personas/:id. See persona-demo.html
    // for the schema; cluster/mode + preset/primitive/color/reactor.
    { src: 'marketing', dst: 'marketing' },
    // audios/ ships per-engine demo MP3s (one ~250KB file per engine,
    // ~4 MB total). Each engine auto-loads ../audios/<engine>.mp3 as the
    // default audio source so the reactivity has something to drive.
    { src: 'audios', dst: 'audios' },
    // M1: ship the auth pages and api/ tree.
    { src: 'auth', dst: 'auth' },
    { src: 'api', dst: 'api' },
    { src: 'lib', dst: 'lib' },
    // AUDIOS_REDEPLOY_TRIGGER: force a re-deploy to bust Vercel's build
    // cache that was shipping the old vite.config.js without this entry.
    // The extra .gitkeep file ensures the audios/ directory is copied.
    { src: 'audios/.gitkeep', dst: 'audios/.gitkeep' },
    { src: 'tools', dst: 'tools' },
    // Engine pages reference /client/visualizer-controller.js (and possibly
    // other shared client scripts added later). Ship the whole directory.
    { src: 'client', dst: 'client' },
    // Vendored browser-side libraries (no CDN at runtime)
    { src: 'client/vendor', dst: 'client/vendor' },
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
    // The curated library/ copy is done in closeBundle (after Vite's
    // copyPublicDir has run) so the public/library/ mirror doesn't
    // overwrite it.
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
      // Strip the heavy public/* dirs that Vite's copyPublicDir re-ships
      // (copyPublicDir flattens: public/library/ → outDir/library/, so the
      // path to remove is outDir/library, not outDir/public/library). The
      // closeBundle re-copy of the curated library/ happens immediately
      // after, so the curated set is authoritative.
      for (const heavy of ['library', 'style-graphics', 'style-videos',
                           'style-videos-watermarked', 'style-videos-original']) {
        const p = resolve(outDir, heavy);
        if (existsSync(p)) {
          rmSync(p, { recursive: true, force: true });
          process.stdout.write('[copy-static] removed heavy dir ' + heavy + ' from outDir\n');
        }
      }
      // Re-copy the curated library/ (manifest-listed files only) since
      // copyPublicDir's stale public/library/ overwrote our earlier copy.
      const libRoot = resolve('library');
      if (existsSync(libRoot)) {
        const libDst = resolve(outDir, 'library');
        mkdirSync(libDst, { recursive: true });
        const libFiles = getLibraryFiles();
        let copied = 0;
        for (const f of libFiles) {
          const sp = resolve(libRoot, f);
          const dp = resolve(libDst, f);
          if (!existsSync(sp)) continue;
          mkdirSync(dirname(dp), { recursive: true });
          copyFileSync(sp, dp);
          copied += 1;
        }
        const mp = resolve(libRoot, 'manifest.json');
        if (existsSync(mp)) copyFileSync(mp, resolve(libDst, 'manifest.json'));
        // Always copy library/audio/* — the SONGS list in engine.html
        // references these directly, and the curated manifest only lists
        // image/video assets, not audio. Without this, the Songs panel
        // shows every track as "404 — file missing" in production.
        const audioRoot = resolve(libRoot, 'audio');
        if (existsSync(audioRoot)) {
          const audioDst = resolve(libDst, 'audio');
          mkdirSync(audioDst, { recursive: true });
          let audioCopied = 0;
          for (const f of readdirSync(audioRoot)) {
            const sp = resolve(audioRoot, f);
            if (!statSync(sp).isFile()) continue;
            copyFileSync(sp, resolve(audioDst, f));
            audioCopied += 1;
          }
          if (audioCopied > 0) {
            process.stdout.write('[copy-static] copied library/audio/: ' + audioCopied + ' files\n');
          }
        }
        process.stdout.write('[copy-static] re-copied curated library/: ' + (copied + 1) + ' files\n');
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const outDir = mode === 'development' ? 'dist-dev' : 'dist';
  return {
    plugins: [
      copyStatic(),
      // M1: route /api/* through the same handlers that run on Vercel.
      // This is a Vite plugin (NOT a server.configureServer — that doesn't
      // exist in Vite 5; configureServer goes on plugins).
      {
        name: 'swrc-api-middleware',
        configureServer(server) {
          process.stderr.write('[dev-api] registering /api/* middleware\n');
          server.middlewares.use(async (req, res, next) => {
            const url = req.url || '';
            if (!url.startsWith('/api/')) return next();
            try {
              await handleApi(req, res, () => {});
            } catch (e) {
              process.stderr.write('[dev-api] middleware error: ' + (e.stack || e.message) + '\n');
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'dev_api_error', message: e.message }));
              }
            }
          });
        },
      },
      // engine.html references many scripts with absolute paths (e.g.
      // <script type="module" src="/pwa-bootstrap.js">). Vite's HTML
      // transformer tries to bundle those as Rollup modules, which
      // fails on Vercel (and locally) because the files live in the
      // project root, not in public/. Strip the `type="module"` from
      // absolute-path module scripts so the browser loads them as
      // plain scripts; their order is preserved by the existing
      // `defer`/manual ordering, and the modules are designed to run
      // as global scripts anyway (they attach handlers to window).
      {
        name: 'strip-absolute-module-scripts',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            return html.replace(
              /<script\s+type="module"\s+src="\/([^"]+)"\s*><\/script>/g,
              '<script src="/$1" defer></script>'
            );
          },
        },
      },
      // engine-layout-inject — for any HTML that already imports
      // engine-genops (every variant does), inject the shared layout
      // stylesheet + controller. Two modes: studio (default 3-column)
      // and wide (full-bleed). Keyboard toggle: L. URL param: ?layout=wide.
      {
        name: 'engine-layout-inject',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            if (!/engine-genops\.client\.js/.test(html)) return html;
            if (/engine-layout\.client\.js/.test(html)) return html; // idempotent
            return html.replace(
              /(<link rel="stylesheet" href="\.\.\/engine-genops\.css" \/>)/,
              '$1\n  <link rel="stylesheet" href="../engine-layout.css" />'
            ).replace(
              /(<script src="\.\.\/engine-genops\.client\.js"><\/script>)/,
              '$1\n<script src="../engine-layout.client.js"></script>'
            );
          },
        },
      },
      // audio-damp-inject — same pattern as engine-layout. Injects the
      // shared exponential-smoothing helper (lib/audio-damp.client.js)
      // into every variant. Each variant can then call SWR_AUDIO_DAMP.damp
      // on audio feature reads to kill the per-frame jitter.
      {
        name: 'audio-damp-inject',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            if (!/engine-genops\.client\.js/.test(html)) return html;
            if (/audio-damp\.client\.js/.test(html)) return html; // idempotent
            return html.replace(
              /(<script src="\.\.\/engine-genops\.client\.js"><\/script>)/,
              '$1\n<script src="../lib/audio-damp.client.js"></script>'
            );
          },
        },
      },
    ],
    server: {
      port: 5174,
      host: '0.0.0.0',
      strictPort: false,
    },
    // api/ files are serverless handlers — they're copied to dist by the
    // copyStatic plugin and executed by Vercel at runtime. We don't want
    // Vite/Rollup to scan them, transform them, or pull them into the
    // engine bundle. Treat them as opaque:
    optimizeDeps: {
      exclude: ['api/**', 'api/_lib/**'],
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
        // The engine's index.html should never pull api/ code in. Treat
        // everything under api/ as external so Rollup leaves it alone.
        external: [/^api\//],
      },
    },
  };
});
