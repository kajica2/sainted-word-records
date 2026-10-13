// lib/app-version.js — single source of truth for the app version.
//
// This file is a placeholder. The Vite plugin `inline-app-version` reads
// package.json#version on every build and writes the real values to
// dist/lib/app-version.js. The placeholder below is what runs in `npm run
// dev` (Vite's middleware serves the source file directly, no plugin
// rewrite) and what the bust script falls back to if the build artifact
// is ever missing.
//
// On cache-bust: window.SWR_APP_VERSION is read by lib/app-version-bust.js
// at the top of every page (synchronous, in <head>, before any other script).
// When the version changes, the bust script clears stale local state and
// forces a hard reload so the user always sees the latest build.
//
// Order in <head>:
//   <script src="/lib/app-version.js"></script>       <!-- 1. sets window.SWR_APP_VERSION -->
//   <script src="/lib/app-version-bust.js"></script>  <!-- 2. checks + reloads if stale -->
window.SWR_APP_VERSION = 'dev';
window.SWR_APP_VERSION_BUILD = 'dev';
