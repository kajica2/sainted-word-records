# Visualizer Control — Quick Reference

This repo ships a **single transport** through which any tool can drive
any audio-reactive visualizer:

```
                                         ┌─────────────────────────────┐
                                         │     scripts/dev-control-ws   │
                                         │  ws://127.0.0.1:8787  (msgs)  │
                                         │  http://127.0.0.1:8799/healthz│
                                         └─────────┬─────────────────────┘
                                                   │ fanout
                  ┌────────────────────────────────┼────────────────────────────────┐
                  │                  │             │             │                  │
            ┌─────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
            │ Visualizer: │  │ Visualizer:│  │ Visualizer:│  │ Visualizer:│  │ Visualizer:│
            │ aurora.html │  │ chrome.     │  │ eclipse.    │  │ smoke.      │  │ void.       │
            │ (and 13 more)│  │             │  │             │  │             │  │             │
            └─────────────┘  └────────────┘  └────────────┘  └────────────┘  └────────────┘

                  ▲                                                       ▲
                  │ loads                                                │ loads
                  │ client/visualizer-controller.js                       │ tools/freq-bridge.js
                  │                                                       │ (when shipped on a same-origin
                  │                                                       │  freq-lab instance — see
                  │                                                       │  docs/CROSS-APP-BRIDGE.md)
```

The protocol is a small JSON envelope:

| Outbound (visualizer → bridge)         | Inbound (driver → visualizer)         |
|---------------------------------------|---------------------------------------|
| `{type:"hello", version, params, …}`  | `{type:"set", param, value}`           |
| `{type:"param", param, value, source}` | `{type:"action", name: "play"\|...}`   |
| `{type:"peer:hello", peer}`            | `{type:"load", version}`              |
| `{type:"peer:bye", role}`              | `{type:"raw", data}`                  |

## Drivers

| Driver | How | File |
|---|---|---|
| **Agentic CLI** | `node tools/agentic-set.mjs param sens 1.7` | `tools/agentic-set.mjs` |
| **Mobile browser** | Open `tools/mobile/index.html` on a phone on the same LAN | `tools/mobile/index.html` |
| **OSC** | `python3 tools/osc-bridge.py` listens on UDP `:9000`; address `/VC/param <name> <value>` etc. | `tools/osc-bridge.py` |
| **Bluetooth** *(parked — see below)* | macOS IOBluetooth + paired peripheral | — |
| **Freq Lab cross-app** | `tools/freq-bridge.js` registered inside a freq-lab page | `tools/freq-bridge.js` |

`tools/agentic-set.mjs` also exposes `snapshot` and `--peer-count` for
arbitrary scripting:

```bash
node tools/agentic-set.mjs snapshot
node tools/agentic-set.mjs --peer-count
node tools/agentic-set.mjs load eclipse
node tools/agentic-set.mjs action play
```

## One-command dev shell

```bash
bash tools/dev-up.sh    # start Vite + WS bridge + healthz, print URLs
bash tools/dev-down.sh  # stop them
```

`dev-up.sh` is idempotent: if Vite is already on :5174 or the bridge
on :8787, it reuses them. Logs land in `tools/.dev-logs/{ws-bridge,vite}.log`.

## Manual dev (advanced)

```bash
npm run dev                                     # Vite on :5174
node scripts/dev-control-ws.mjs                 # WS bridge on :8787 + healthz on :8799
```

In two terminals. The visualizer pages also work if you point them
at any LAN IP that the dev box binds to.

## Verifying the transport

Each verify script reproduces one round-trip from a real headless
browser and the real WS bridge:

```bash
node verify-visualizer-controller.mjs   # 6/6 ALL GREEN
node verify-freq-bridge.mjs            # 5/5 ALL GREEN (after freq-lab ships)
```

`verify-*:visualizer` scripts run `npm run check:verify`, which
executes all `verify-*.mjs` smoke tests.

## Visualizer pages

The thirteen engine-driven visualizers in `versions/*.html` each
auto-connect to the WS bridge on load. To drive them programmatically
(e.g. write a one-liner that nudges the engine every frame), talk
to `ws://127.0.0.1:8787` with `{type:"set",param:"sens",value:1.7}`.

The eight non-engine variants in `versions/` (`baroque`, `collage`,
`kraft`, `mosaic`, `phosphor`, `spectrum`, `tape`, `typography`) are
audio-reactive style canvas pages without the `A.params` namespace —
they're unaffected by `set` messages and re-render on every frame
based on whichever audio source the page has loaded.

## Adding a new driver

1. Open a WebSocket to `ws://<host>:8787`.
2. Send `{type:"hello", role:"<your-role>"}` first.
3. Send `{type:"set"|"action"|"load", …}` messages; they fan out to
   every visualizer peer on the bridge.
4. Optional: subscribe to inbound `param` messages to mirror the
   visualizer's state on your side.

The transport is intentionally tiny so a new driver is usually
20-50 lines.

## Cross-app: linking Freq Lab → SWR

`tools/freq-bridge.js` is a freq-lab feature-module that watches
freq-lab's DOM controls and forwards them over the same WS bridge.
Adding it to a freq-lab deployment is a one-line `<script>` inclusion;
see `docs/CROSS-APP-BRIDGE.md` for the three deployment shapes.

## What isn't here yet

| Driver / Issue | Status | Notes |
|---|---|---|
| **Bluetooth (4th driver)** | parked | macOS-only `IOBluetooth` shim; needs a named paired peripheral. |
| **TLS / auth on the WS bridge** | parked | The bridge binds 127.0.0.1 free-text; production needs a signed token. |
| **LAN-bootstrap URL helper** | parked | The mobile page could include a `/q?to=ws://host:port` flow so a phone could land on the right endpoint without typing it. |

Each of these is its own loop under the project's small/reversible
iteration discipline. Each deletes with one file removed.
