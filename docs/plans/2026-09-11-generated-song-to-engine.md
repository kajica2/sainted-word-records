# Generated Song → Engine Audio Source — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **For the user:** This is a *design doc + implementation plan* in one, per the
> user's standing "be very careful, plan first" rule. It is small enough (one
> feature, one chokepoint) that splitting into two docs would be ceremony.

**Goal:** Take a song generated anywhere (Suno via CDP, HeartMuLa locally, manual
upload, future API) and pipe its rendered MP3 straight into the engine as an
audio source — no manual download/re-upload/click-through.

**Architecture:** Add a single global function
`window.SWR_GENERATED_AUDIO.importMp3(blob, opts)` that converts a rendered MP3
`Blob` into a `File` and hands it to the existing `window.SWR.Audio.load()` bus.
Two thin consumers — a Suno post-render hook and a drag/drop fallback — both
go through the same import function. Nothing else changes.

**Tech Stack:** Vanilla JS, ESM (no TypeScript per AGENTS.md). Uses the existing
`lib/mvm-audio-bus.client.js` chokepoint and the existing
`lib/recorder.client.js` MP3-output path. No new deps, no new infra, no
distributor integration (explicitly out of scope — see "Out of scope" below).

**Scope discipline:** This plan is the *minimum that ships product value*. We
deliberately do NOT build:
- Voice capture / STT (separate plan if you want it)
- Spotify distribution (no public API exists — needs a paid distributor)
- HeartMuLa integration (Linux+CUDA only; out of scope on this Mac)
- New UI surface beyond a single "Import MP3" button + drag/drop zone

---

## Why this is small

The codebase already has both halves of the pipeline:

- **Render → MP3:** `lib/recorder.client.js` → `SWR_RECORDER.stop()` returns
  `{ blob, ... }` where `blob` is an MP4/M4A AAC-encoded blob (mime
  `audio/mp4` or `video/mp4`). It is *already* a playable file the engine
  can ingest via `SWR.Audio.load(new File([blob], 'song.mp4'))`. We don't
  need to invent rendering.

- **Engine → audio source:** `lib/mvm-audio-bus.client.js` exposes
  `window.SWR.Audio.load(file)` which sets `el.src = URL.createObjectURL(file)`
  and wires up the Web Audio analyser/captureStream pipeline. That is the
  only entry point we need.

What's missing is the **seam between them**: a stable, named function that
takes a `Blob`, returns a `File`, and is callable from anywhere — including
from outside the engine page (e.g. a future Suno harvest script that posts
back to a parent window).

---

## Decision matrix (alternatives considered)

| Option | Why rejected |
|---|---|
| Auto-load on `MediaRecorder.dataavailable` in engine | Couples generation to running engine; doesn't help offline generation |
| Build new audio bus from scratch | `SWR.Audio` already exists and is the documented chokepoint; AGENTS.md says match existing patterns |
| Use `<input type="file">` only | Already exists; we add drag/drop + programmatic import alongside, not instead |
| Convert MP4→MP3 with ffmpeg.wasm | The engine handles AAC/mp4 natively via the browser; conversion is unnecessary weight |
| Add a "Spotify upload" stage | No public API; needs a distributor account; explicit out-of-scope |
| Build voice/STT pipeline | Different feature; out of scope here |
| Wire directly to Suno.com via CDP from this page | CDP requires a *separate* Chrome instance; engine page can't drive it. The realistic Suno→engine path is: Suno renders → file lands on disk → `SWR_GENERATED_AUDIO.importMp3()` consumes it. |

---

## File map (exact)

### Create

- `lib/generated-audio.client.js` — the new module. Public: `SWR_GENERATED_AUDIO.importMp3(blob, opts)`, `SWR_GENERATED_AUDIO.fromUrl(url, opts)`, `SWR_GENERATED_AUDIO.fromFile(file)`. ~80 LOC.
- `tests/generated-audio.test.mjs` — node test (no browser needed; pure blob→file logic). ~60 LOC.

### Modify

- `engine.html` — add `<script defer src="/lib/generated-audio.client.js"></script>` after the audio-bus script. ~1 LOC.
- `engine-settings.client.js` — extend the existing audio file-input handler so drag/drop onto the engine canvas also routes through `SWR_GENERATED_AUDIO.fromFile()`. ~10 LOC. (No drive-by refactor; only the existing drop zone is touched.)
- `package.json` — add `test:generated-audio` npm script that runs the new node test. ~1 LOC.
- `HOWTO-30s-VIDEO.md` — append a 10-line section "Importing a generated song". Doc-only, non-blocking.

### Out of scope (do NOT touch)

- `lib/mvm-audio-bus.client.js` — already does the right thing.
- `lib/recorder.client.js` — already produces the right blob.
- `make-video.html`, `persona-*.js` — no behavior change needed; they already use the audio bus.
- Any Spotify/distributor code — explicitly deferred.
- Any voice/STT code — explicitly deferred.

---

## Public API contract

```js
// window.SWR_GENERATED_AUDIO
{
  // Take a rendered Blob (e.g. MediaRecorder output, Suno download, fetch()).
  // Returns a Promise that resolves to the loaded File, or rejects with
  // { unsupported: true } if the audio bus is unavailable.
  importMp3(blob, opts?) → Promise<File>

  // Same, but fetches the URL first. Useful for Suno "download" buttons and
  // any <a href> link to a CDN-hosted MP3/M4A. CORS must allow it; otherwise
  // the returned promise rejects with { cors: true }.
  fromUrl(url, opts?) → Promise<File>

  // Pass-through for an existing File from an <input type="file">.
  fromFile(file) → Promise<File>

  // Feature flag — returns false if SWR.Audio.load() isn't on window.
  isAvailable() → boolean
}
```

`opts` (all optional):
- `filename`: override the filename passed to `new File([...], name)`. Default: derive from blob.type + timestamp.
- `autoplay`: bool, default `true` — calls `SWR.Audio.play()` after load.
- `onProgress`: `(phase: 'fetching'|'decoding'|'ready', pct: number) => void` — for UI progress bars.

---

## Tasks (bite-sized, TDD, sequential)

### Task 1: Write failing test for `importMp3` happy path

**Files:**
- Create: `tests/generated-audio.test.mjs`
- Test: `tests/generated-audio.test.mjs`

**Step 1:** Write a node test that stubs `window` + `URL` + `SWR.Audio`,
loads `lib/generated-audio.client.js` via `vm.runInNewContext`, then calls
`SWR_GENERATED_AUDIO.importMp3(new Blob(['x'], { type: 'audio/mpeg' }))`
and asserts:
  1. Returns a `Promise<File>`
  2. `SWR.Audio.load` was called with that File
  3. `SWR.Audio.play` was called
  4. The File has the right `type` and a sensible `name`

**Step 2:** Run it. Expected: FAIL — `SWR_GENERATED_AUDIO is not defined`.

**Step 3:** No implementation yet.

**Step 4:** Confirm failure mode matches expected.

**Step 5:** Commit the test alone:
```bash
git add tests/generated-audio.test.mjs
git commit -m "test(generated-audio): scaffold importMp3 happy-path test"
```

---

### Task 2: Implement minimal `importMp3`

**Files:**
- Create: `lib/generated-audio.client.js`

**Step 1:** Implement:

```js
// lib/generated-audio.client.js — single seam between rendered MP3/M4A blobs
// and the SWR engine audio bus. No new dependencies.
//
//   SWR_GENERATED_AUDIO.importMp3(blob, { filename?, autoplay?, onProgress? })
//   SWR_GENERATED_AUDIO.fromUrl(url, opts?)
//   SWR_GENERATED_AUDIO.fromFile(file)
//   SWR_GENERATED_AUDIO.isAvailable()
//
// Idempotent: re-evaluation returns the cached singleton.

(function () {
  'use strict';
  if (window.SWR_GENERATED_AUDIO) return;

  function ext(blob) {
    const t = (blob && blob.type) || '';
    if (t.includes('mp4') || t.includes('m4a')) return 'm4a';
    if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
    if (t.includes('wav')) return 'wav';
    if (t.includes('ogg')) return 'ogg';
    return 'bin';
  }

  function safeFilename(blob, override) {
    if (override) return override;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `generated-${ts}.${ext(blob)}`;
  }

  function isAvailable() {
    return !!(window.SWR && window.SWR.Audio && typeof window.SWR.Audio.load === 'function');
  }

  function fromFile(file) {
    if (!isAvailable()) return Promise.reject({ unsupported: true });
    if (!(file instanceof Blob)) return Promise.reject({ invalid: 'not-a-blob' });
    window.SWR.Audio.load(file);
    return Promise.resolve(file);
  }

  function fromBlob(blob, opts = {}) {
    const filename = safeFilename(blob, opts.filename);
    const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
    return fromFile(file).then((f) => {
      if (opts.autoplay !== false && window.SWR.Audio.play) {
        try { window.SWR.Audio.play(); } catch (_) {}
      }
      return f;
    });
  }

  async function fromUrl(url, opts = {}) {
    if (opts.onProgress) opts.onProgress('fetching', 0);
    const res = await fetch(url);
    if (!res.ok) return Promise.reject({ http: res.status });
    const blob = await res.blob();
    if (opts.onProgress) opts.onProgress('decoding', 0.5);
    const f = await fromBlob(blob, opts);
    if (opts.onProgress) opts.onProgress('ready', 1);
    return f;
  }

  window.SWR_GENERATED_AUDIO = {
    isAvailable,
    fromFile,
    importMp3: fromBlob,   // historical name — accepts any blob, not just mp3
    fromUrl,
  };
})();
```

**Step 2:** Run the test from Task 1. Expected: PASS.

**Step 3:** Commit:
```bash
git add lib/generated-audio.client.js
git commit -m "feat(generated-audio): importMp3/fromUrl/fromFile seam to audio bus"
```

---

### Task 3: Add `fromUrl` CORS-failure test + handling

**Files:**
- Modify: `tests/generated-audio.test.mjs`

**Step 1:** Add a test that stubs `fetch` to return `{ ok: true, blob: () => Promise.reject(new TypeError('CORS')) }`, calls `fromUrl('https://x/y.mp3')`, and asserts the rejection reason includes `cors: true`.

**Step 2:** Run it. Expected: FAIL.

**Step 3:** Patch `fromUrl` to catch fetch errors and reject with `{ cors: true }`:

```js
async function fromUrl(url, opts = {}) {
  if (opts.onProgress) opts.onProgress('fetching', 0);
  let res;
  try { res = await fetch(url); }
  catch (_) { return Promise.reject({ cors: true }); }
  if (!res.ok) return Promise.reject({ http: res.status });
  const blob = await res.blob();
  if (opts.onProgress) opts.onProgress('decoding', 0.5);
  const f = await fromBlob(blob, opts);
  if (opts.onProgress) opts.onProgress('ready', 1);
  return f;
}
```

**Step 4:** Run test. Expected: PASS.

**Step 5:** Commit:
```bash
git add tests/generated-audio.test.mjs lib/generated-audio.client.js
git commit -m "feat(generated-audio): classify fetch errors as CORS"
```

---

### Task 4: Wire `<script>` tag into `engine.html`

**Files:**
- Modify: `engine.html` (find the line where `/lib/mvm-audio-bus.client.js` is loaded, add the new script immediately after it on the next defer line)

**Step 1:** Search `engine.html` for `mvm-audio-bus.client.js` to find the exact insertion point. The Vite `strip-absolute-module-scripts` plugin requires the script tag to use an absolute path and NO `type="module"` (per AGENTS.md "do not re-add type=module to absolute-path scripts").

**Step 2:** Insert immediately after:
```html
<script defer src="/lib/generated-audio.client.js"></script>
```

**Step 3:** Run `npm run check` to confirm syntax + bundle gates still pass.

**Step 4:** Commit:
```bash
git add engine.html
git commit -m "feat(engine): load generated-audio seam after audio bus"
```

---

### Task 5: Route existing drag/drop zone through `fromFile`

**Files:**
- Modify: `engine-settings.client.js` (only the existing drop handler; do not refactor surrounding code)

**Step 1:** Find the existing drop handler in `engine-settings.client.js` (already identified — it sits next to the audio file-input).

**Step 2:** Replace the direct `SWR.Audio.load(file)` call with:
```js
if (window.SWR_GENERATED_AUDIO && window.SWR_GENERATED_AUDIO.fromFile) {
  window.SWR_GENERATED_AUDIO.fromFile(file);
} else {
  window.SWR.Audio.load(file);
}
```

The fallback to direct `SWR.Audio.load()` keeps behavior identical if the new script ever fails to load.

**Step 3:** Run `npm run check`. Smoke-test in dev (`npm run dev`), drop an MP3 on the engine, confirm it plays. Screenshot per the user's standing "screenshot after every change" rule.

**Step 4:** Commit:
```bash
git add engine-settings.client.js
git commit -m "feat(engine): route drop-zone audio through generated-audio seam"
```

---

### Task 6: Add npm script + verify gate

**Files:**
- Modify: `package.json`

**Step 1:** Add to `scripts`:
```json
"test:generated-audio": "node tests/generated-audio.test.mjs"
```

**Step 2:** Wire it into the existing `check` chain if appropriate (per AGENTS.md "Quick gate: npm run check → check:syntax + check:manifest + check:bundle + scripts/test-api.mjs"). Do NOT add to `check:full` without confirming with the user — `check:full` already runs the slow Puppeteer suite and the new test is unit-fast; it can be a separate `check:unit` later if desired.

**Step 3:** Run `npm run test:generated-audio`. Expected: PASS.

**Step 4:** Run `npm run check`. Expected: PASS.

**Step 5:** Commit:
```bash
git add package.json
git commit -m "chore: add test:generated-audio script"
```

---

### Task 7: Doc blurb in HOWTO

**Files:**
- Modify: `HOWTO-30s-VIDEO.md` (append, do not rewrite)

**Step 1:** Append:

```markdown

## Importing a generated song

If you've generated an MP3/M4A outside the engine (Suno, HeartMuLa, a
distributor download, or a fetch from a CDN), pipe it straight in:

```js
// From a Blob you already have (e.g. MediaRecorder output):
const file = await SWR_GENERATED_AUDIO.importMp3(blob);

// From a URL:
await SWR_GENERATED_AUDIO.fromUrl('https://cdn.example.com/song.mp3');

// From a <input type="file"> change event:
await SWR_GENERATED_AUDIO.fromFile(input.files[0]);
```

All three call `SWR.Audio.load()` internally, so the engine's analyser
and BPM detection work on the imported track the same as on a
manually-dropped file.
```

**Step 2:** Commit:
```bash
git add HOWTO-30s-VIDEO.md
git commit -m "docs: import-generated-song snippet in HOWTO"
```

---

## Verification (end-to-end, before claiming done)

After all 7 tasks land:

1. `npm run test:generated-audio` → PASS
2. `npm run check` → PASS
3. `npm run dev` → open `/engine/` → drop an MP3 onto the canvas → confirm it plays and BPM detects
4. In devtools console: `SWR_GENERATED_AUDIO.importMp3(await fetch('/audios/demo.mp3').then(r=>r.blob()))` → confirm it loads + plays
5. CORS smoke: `SWR_GENERATED_AUDIO.fromUrl('https://example.com/no-cors.mp3')` → confirm rejection `{cors: true}`, not a thrown TypeError
6. (Optional) Run `npm run verify:autoplay` to confirm no regression on the existing audio-input E2E path

---

## What this plan does NOT include

Listed explicitly so the user can request them as follow-up plans:

- Voice capture (`MediaRecorder` + STT) → input
- Lyrics-to-song generation → input (HeartMuLa on Linux box, Suno via CDP from this Mac, or external API)
- Spotify distribution (requires paid distributor account; no public API)
- HeartMuLa local setup on this Mac (would need Linux VM or remote GPU box)
- New engine UI for "Import MP3" — drag/drop is enough for now
- A "voice → song → engine" end-to-end demo (would combine this plan + voice/STT plan)