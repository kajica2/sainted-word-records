import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

// Vite plugin: copy ./library/*, ./versions/*, and the GitHub project files
// to the configured outDir so the pre-seeded asset library, the 5 visual
// versions, and the project landing page ship with the build.
function copyStatic(options = {}) {
  return {
    name: 'copy-static',
    closeBundle() {
      // Respect the build's actual outDir
      const outDir = options.outDir || 'dist';
      const dirs = [
        { src: resolve('library'), dst: resolve(outDir, 'library') },
        { src: resolve('versions'), dst: resolve(outDir, 'versions') },
      ];
      for (const { src, dst } of dirs) {
        if (!existsSync(src)) continue;
        mkdirSync(dst, { recursive: true });
        for (const f of readdirSync(src)) {
          // Skip dev-only inject scripts and editor backups
          if (f.startsWith('_') || f.endsWith('.bak')) continue;
          const sp = join(src, f);
          const dp = join(dst, f);
          if (statSync(sp).isFile()) copyFileSync(sp, dp);
        }
      }
      // Copy root-level project files
      const rootFiles = ['landing.html', 'interactive-howto.html', 'market-study.html', 'profit-plan.html', 'campaign.html', 'README.md', 'LICENSE', 'HOWTO-30s-VIDEO.md', 'og.png'];
      for (const f of rootFiles) {
        const sp = resolve(f);
        if (!existsSync(sp)) continue;
        copyFileSync(sp, resolve(outDir, f));
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const outDir = mode === 'development' ? 'dist-dev' : 'dist';
  return {
    plugins: [copyStatic({ outDir })],
    server: {
      port: 5174,
      host: '0.0.0.0',
      strictPort: false,
    },
    build: {
      target: 'es2022',
      outDir,
      assetsInlineLimit: 0,
    },
  };
});
