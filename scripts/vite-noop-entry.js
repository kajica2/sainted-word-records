// scripts/vite-noop-entry.js — a deliberately empty Rollup entry.
//
// Vite requires at least one rollupOptions.input. The repo used to point it
// at engine.html, but copy-static ships dist/engine.html as a plain file
// copy, so Vite's output for it was overwritten anyway and the extracted
// dist/assets/engine-*.js + engine-*.css were referenced by nothing —
// 138 KB of dead weight in every build.
//
// This file satisfies Rollup so the build has an input; the
// `drop-noop-entry` plugin in vite.config.js removes the chunk it emits.
// Do not put anything in here.
export default {};
