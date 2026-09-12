# Dev server quirks

Date: 2026-09-12

Notes for anyone running `npm run dev` locally on `engine.html` (or any
other page with large inline `<script>` blocks). The Vite dev server is
usually invisible, but it has two failure modes that look like "your
edit didn't land" but are actually server-side cache poisoning.

#### Symptom 1: "No matching HTML proxy module found"

```
[vite] Internal server error: No matching HTML proxy module found from
/Users/.../engine.html?html-proxy&index=0.js
   at LoadPluginContext.load (.../vite/dist/node/chunks/dep-BK3b2jBa.js:35045:17)
```

**What it means:** Vite splits the inline `<script>` blocks out of
`engine.html` into a small number of `?html-proxy&index=N.js` chunks
(one chunk per `<script>` block). When you edit `engine.html` and add
a new inline `<script>` block, or reorder them, or remove one, the
`index` numbers change. The browser has a cached reference to
`?html-proxy&index=0.js` that's now pointing at a chunk that no longer
corresponds to that index. Vite tries to serve it and can't.

**How it surfaces in the browser:** `engine.html` loads, the page
mostly works, but some inline script isn't running — usually the one
that was previously at the index the browser cached. The Puppeteer
verifier may show "transition X didn't fire" even though the source is
correct, or `addFiles()` returns undefined and items don't grow.

**Fix:**

```bash
pkill -9 -f vite
pkill -9 -f esbuild
rm -rf node_modules/.vite .vite
npm run dev
```

Then **hard reload** the browser tab (Cmd+Shift+R) so it doesn't use
the cached chunk URL.

#### Symptom 2: "No matching HTML proxy module found" — happens on restart

Same error, but it happens *immediately* on `npm run dev` start, not
after an edit. Cause: the previous dev server got killed mid-write
(`pkill -9`) and left a half-written chunk file in `node_modules/.vite`.

**Fix:** same as above — wipe `node_modules/.vite`, restart.

#### Symptom 3: my code shipped to disk, but the page runs old code

You patched `engine.html`, restarted vite, hard-reloaded the browser,
and... the new code isn't there. `grep <your marker> engine.html`
finds it on disk. `curl http://localhost:5174/engine.html` doesn't.

**Cause:** the chunk URL the browser cached maps to a chunk file that
exists on disk but whose *contents* weren't refreshed because vite's
file-watcher missed the edit event. This usually means: the file was
written while vite was mid-restart, OR the file's mtime didn't change
(rare on macOS).

**Fix:** same — `rm -rf node_modules/.vite`, restart vite, hard reload.

#### Why this happens

Vite's HTML-proxy chunking is supposed to be transparent. It mostly is
— but it caches by index, and the index is positional in the HTML
file. As soon as you add, remove, or reorder an inline `<script>` block
in `engine.html`, the indices shift and the old chunk URLs become
meaningless. The dev server picks this up on file-watch events most of
the time, but if the watch is delayed (large file, slow disk, or
mid-restart edit), you'll see this error.

`engine.html` is ~7,000 lines and has ~30 inline `<script>` blocks.
That's a lot of chunks for vite to track. Every inline-script edit has
non-trivial odds of triggering one of these symptoms.

#### Prevention

- **Avoid editing `engine.html` while vite is mid-restart.** Wait for
  the `[vite] ready in NNN ms` line before saving.
- **Prefer extracting to external scripts.** Every new `<script>` block
  in `engine.html` is one more chunk to keep in sync. If you find
  yourself adding a non-trivial inline script, put it in
  `lib/<name>.client.js` and `<script src="/lib/<name>.client.js">`
  instead.
- **The cache-bust recipe is always the same:** `pkill -9 vite &&
  rm -rf node_modules/.vite && npm run dev` + browser hard reload.
  Add it to your muscle memory.

#### What is NOT this bug

If your page works locally but the production build is broken, that's
`npm run build` — vite's build pipeline is separate from the dev
server and doesn't use the HTML-proxy trick.

If your CI verifier fails (`.github/workflows/ci.yml`) but `node
verify-*.mjs` passes locally, that's the test environment, not the
chunk issue — usually a missing env var or a path mismatch between
your local checkout and the runner's checkout.

If `npm run check:syntax` fails on a file you didn't edit, that's
either the file has a CRLF/LF mismatch or the syntax checker is
strict about something. Run `node --check <file>` to see the exact
parse error.

#### Related

- `docs/CI-VERIFY-STRATEGY.md` — why CI runs the 5 it does
- `vite.config.js` — the `copy-static` + `swrc-api-middleware` plugins
  (production bundling; does NOT use HTML-proxy)