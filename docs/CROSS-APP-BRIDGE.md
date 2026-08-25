# Cross-App Bridge Survey (Freq Lab ↔ SWR Visualizer)

## What we want

`freq-lab.vercel.app` (https://freq-lab.vercel.app/) is a local-only
binaural/Rife/isochronic frequency generator. Sainted Word Records
(https://github.com/kajica2/sainted-word-records) is an audio-reactive
visualizer system with 13 engine-driven visualizers. The user
wants the two to coordinate via the visualizer-control transport
shipped in commits 5d647d5…1240d0a (ws://<host>:8787 + JSON events).

## Why "use shared libraries" is the right framing

Both already live in this user's domain. Reuse between them should
not duplicate:

- Freq Lab's feature-module pattern (`window.FreqLabFeatures[<name>]`,
  setup() with `{audio, state, document, window}`).
- SWR Visualizer's similar global registry (`window.SWR.*`).
- The visualizer-control transport (`window.VC`, ws bridge).

Shared libraries let either side register the same module without
forking.

## What's already done (commit 1240d0a)

`sainted-word-records/tools/freq-bridge.js` is a freq-lab
feature-module that:

- registers as `window.FreqLabFeatures['swr-vc-bridge']`.
- reads freq-lab's DOM (sliders, mode select, play button) — **NOT**
  freq-lab's module-private `state` const.
- forwards DOM changes to the WS bridge as `{type:"set",param,value}`
  every 250ms; only when state actually changed.
- accepts inbound `{type:"set",param,value}` and writes the slider
  + dispatches `input` + `change` so freq-lab's own handler runs.
- accepts inbound `{type:"action", name}` and clicks the
  corresponding `#playBtn` / `#resetBtn` / `#recBtn` / `#exportBtn`.
- exposes `FreqLabFeatures['swr-vc-bridge'].disconnect()` for clean
  teardown.

Verified by `verify-freq-bridge.mjs` against the live freq-lab page
with the bridge running locally on port 8787. The check passes for
the DOM and outbound path; **in-page fetches to /healthz are blocked
by Chrome's Private Network Access**, which surfaces a real
deployment problem the user must solve.

## The deployment problem (and three solutions)

`https://freq-lab.vercel.app/` is a public HTTPS origin. Chrome's
Private Network Access (PSA) blocks HTTPS pages from initiating
loops to private address space — `127.0.0.1`, `10.x`, `192.168.x`.
This means a freq-lab page opened over HTTPS literally cannot
`new WebSocket('ws://127.0.0.1:8787')` without a Same-Origin or
locally-served workaround.

Three options, in increasing invasiveness:

### Option A — Ship freq-bridge.js inside freq-lab (1 PR)

Add `<script src="swr-vc-bridge.js"></script>` to freq-lab's
`<script>` block (the one in `index.html` that loads
`hrtf-spatial.js`, `lfo-drift.js`, etc.). **Also** add
`'swr-vc-bridge'` to freq-lab's `init()` feature loop:

```js
const order = ['hrtf-spatial', 'spatial-3d', 'lfo-drift',
               'visual-entrainment', 'hyper-journey',
               'provenance-badges', 'bls-mode', 'chord-mode',
               'swr-vc-bridge'];  // <- add this
```

Reversible by removing both lines. Effort: 5 minutes (one PR).

### Option B — Serve freq-lab locally (no freq-lab change)

```bash
git clone <freq-lab-repo>
cd <freq-lab-repo>
python3 -m http.server 8000
# open http://127.0.0.1:8000/ — same-origin (loopback) — PSA exempt.
```

Reversible by killing the server. Effort: 30 seconds.

### Option C — Reverse-proxy bridge (production-grade)

Deploy the WS bridge at `wss://something.vercel.app/ws` (or whatever
matches freq-lab's Vercel project). freq-bridge.js reads its URL
from a known env-style hook (a `data-vc-ws-url` attribute or a
`?ws=...` query param) instead of `ws://<host>:8787`.

Reversible by tearing down the proxy. Effort: 30 min.

## My recommendation

**A, then C.** A is one PR and unblocks the immediate "make the visualizer
driven by freq-lab's controls" goal. C is the right answer once
you actually want this in daily use beyond a single dev box.

B works for testing only.

## Files & commits

| commit | file | status |
|---|---|---|
| `5d647d5` | client/visualizer-controller.js + scripts/dev-control-ws.mjs | shipping |
| `8cc6d59` | one-line `<script>` tag in 12 versions/*.html | shipping |
| `28e82ef` | tools/mobile/index.html + tools/agentic-set.mjs | shipping |
| `d6e5f03` | tools/osc-bridge.py | shipping |
| `1240d0a` | tools/freq-bridge.js + verify-freq-bridge.mjs | shipping (this PR) |

## What's parked

- Bluetooth driver — still macOS-only, still needs a named device.
- LAN bootstrap URL helper — the mobile page could include a
  /q?to=ws://HOST:PORT flow so the phone can land on the right
  endpoint without typing it.

Both reversible when folded in.
