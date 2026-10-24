# SWR Software Factory — on MiniMax

The factory floor for Sainted Word Records: a router that decides **which agent and
which model** does a piece of work, a bridge that calls MiniMax, and a GitHub Action
that runs it on issues, pull requests and a nightly schedule.

This is the port of the original Claude-based design. The shape is unchanged —
routing config, workflow, bridge — but every model id, every thinking control and
every price comes from MiniMax now.

---

## 1. The model map

The original design routed three Claude tiers. MiniMax has its own tiers, and they
line up better than you would expect:

| Role | Claude (before) | MiniMax (now) | Context | Price in / out (per M tokens) |
|---|---|---|---|---|
| Planning, nightly audit | `claude-3-opus-20240229` | **`MiniMax-M3`** | 1M | $0.30 / $1.20 |
| Coding, creative | `claude-3-5-sonnet-20240620` | **`MiniMax-M2.7`** | 200K | $0.30 / $1.20 |
| Triage, PR verification | `claude-3-haiku-20240307` | **`MiniMax-M3.1-Flash`** | 1M | $0.15 / $0.60 |
| Latency tier (optional) | — | `MiniMax-M2.7-highspeed` | 200K | $0.60 / $2.40 |
| Fallback | — | `MiniMax-M2.5` | 200K | $0.30 / $1.20 |

The whole factory costs **less than one Opus call per hour of CI**, and the nightly
audit — the job that actually reads the repo — now runs on a 1M-context model
instead of a 200K one.

**`MiniMax-M2.7-highspeed` is a latency tier, not a cost tier.** It is exactly 2× the
price of `MiniMax-M2.7` and buys nothing but faster first-token. The routing config
does not use it for anything.

### The two depth knobs, and they are not interchangeable

This is the one thing that bites when you port a Claude config to MiniMax:

- **`output_config.effort`** — `low` · `medium` · `high` · `xhigh` · `max`.
  **`MiniMax-M3.1-Flash` only.** Send it to `MiniMax-M3` or `MiniMax-M2.7` and you
  get a 400. `none` is not a valid value; `{"type":"disabled"}` on Flash is a 400 too,
  because Flash always thinks.
- **`thinking`** — three shapes, one per model family:
  | Model | Payload | Depth control |
  |---|---|---|
  | `MiniMax-M3` | `{"type":"adaptive"}` | the model decides |
  | `MiniMax-M3.1-Flash` | `{"type":"adaptive"}` | `output_config.effort` |
  | `MiniMax-M2.7` | `{"type":"enabled","budget_tokens":8192}` | the budget |

The routing config expresses this in one `reasoning` block per task, and
`scripts/check-factory-routing.mjs` fails the build if you ask a model for a knob it
does not have:

```json
"reasoning": {
  "triage":      { "effort": "low" },
  "coding":      { "thinking": "budget", "thinking_budget_tokens": 8192 },
  "planning":    { "thinking": "adaptive" }
}
```

---

## 2. The pieces

```
software-factory/
  routing.config.json   the router: provider, model catalog, agents, triggers
  swr-agent.mjs         the bridge: MiniMax <-> the factory (zero dependencies)
  README.md             this file
.github/workflows/
  factory.yml           the factory floor: triage, PR verdict, nightly drift
scripts/
  check-factory-routing.mjs   the router gate (no API key needed)
  check-fx-doc-drift.mjs      the doc-vs-code drift gate
agents/
  team.config.json       the same model pins, for the local team
  start-team.sh          launches the three agents on MiniMax
```

### The router — `routing.config.json`

One file holds the provider block, a model catalog with context windows and prices,
the three agents (role file, default model, per-task model, depth control) and the
five triggers. `swr-agent.mjs` is the only thing that reads it, and
`npm run check:factory-routing` is the only thing that validates it.

### The bridge — `swr-agent.mjs`

```bash
node software-factory/swr-agent.mjs run --agent SWR-Ops --task triage --context "…"
node software-factory/swr-agent.mjs run --agent SWR-Check --task verification --diff "$(git diff origin/main)"
node software-factory/swr-agent.mjs chat --agent SWR-Twin --task creative    # interactive
node software-factory/swr-agent.mjs show --agent SWR-Ops                     # resolved route
node software-factory/swr-agent.mjs models                                  # live catalog
node software-factory/swr-agent.mjs self-test                               # guard rails
```

It speaks the Anthropic Messages API because MiniMax exposes
`https://api.minimax.io/anthropic/v1/messages`. The wire format stayed; the
provider block changed. No SDK, no dependency — the repo's CI does a bare
`npm ci` and has no LLM client in its tree.

**Tools.** Two, and they are deliberately asymmetric:

| Tool | Who gets it | Rules |
|---|---|---|
| `read_file` | every agent | repo root and the `../digital_twin` twin root only; a `../` escape is refused |
| `write_file` | every agent that is not read-only | only `agents/TASKS.md`, `README.md`, `CHANGELOG.md`; only with `--allow-writes` |

`SWR-Check` is read-only by construction: the bridge does not declare `write_file`
for it, so a verdict can never edit the tree it is judging. `swr-agent.mjs self-test`
proves all of this without an API key.

---

## 3. Setup

**In GitHub** — add one secret and (optionally) one variable:

```
Settings → Secrets and variables → Actions
  Secret:   MINIMAX_API_KEY   = sk-…
  Variable: MINIMAX_BASE_URL  = https://api.minimax.io/anthropic   (optional)
```

`MINIMAX_BASE_URL` is only needed for the China region endpoint
(`https://api.minimaxi.com/anthropic`). The global endpoint is the default.

**Locally:**

```bash
export MINIMAX_API_KEY=sk-…
npm run check:factory          # the router gate + the drift gate
node software-factory/swr-agent.mjs self-test
./agents/start-team.sh          # three MiniMax agents
```

---

## 4. What the Action does

| Job | Trigger | Agent · model | What it does |
|---|---|---|---|
| `factory-selftest` | schedule, manual | — | validates the router, runs the bridge self-test, resolves every route. No API key, no cost. |
| `triage-issue` | issue opened | SWR-Ops · M3.1-Flash | labels `untriaged`, triages, comments on the issue, opens a PR with the `agents/TASKS.md` update |
| `verify-pr` | PR opened / updated | SWR-Check · M3.1-Flash | reviews the diff against the merge base, comments PASS/FAIL, fails the job on FAIL |
| `nightly-drift-check` | 02:17 UTC, manual | SWR-Ops · M3 | runs the archive scan and the FX drift gate, analyses the result, opens a PR with the fix |

**The brake is not in this file.** `ci.yml` already runs `npm run check:full` on
every PR, and that chain takes ~20 minutes. Re-running it here would double the gate
for the same signal, so `factory.yml` does the part CI cannot: an LLM review with a
verdict. The two jobs are complementary, not redundant.

**Bots do not push to main.** The triage and drift jobs open a PR. `main` on this
repo moves several commits an hour; a bot that pushes to it at 02:17 is a bot that
loses a race.

---

## 5. Drift, actually checked

The original nightly job used `grep -c 'class=' engine.html` as a proxy for the FX
count. That counts markup classes — it returned 347 against a claimed 14, and it was
never a proxy for anything.

`scripts/check-fx-doc-drift.mjs` does the real thing: it parses the README's
"**14 WebGL FX**" claim, parses the uniform state block in `fx-postprocess.js`, and
compares them.

- a named effect the code does not have → **FAIL** (a false claim)
- an effect the code has that the README does not mention → **warning** (an
  incomplete claim, worth a line, not worth a red build)
- the "14-FX pipeline" count in the file tree has to agree with the feature list

Today it passes, with one warning: the code drives `tone`, `sharp` and `cinematic`
that the README does not mention.

The README's "20 stackable CSS filters" claim is **not** checked — there is no
canonical list of CSS filters in the tree to compare against, so a check there could
only ever guess. It stays unchecked on purpose.

---

## 6. The cost picture

Per 1M tokens, standard tier, as published by MiniMax:

| Model | Input | Output | Cache read |
|---|---|---|---|
| `MiniMax-M3.1-Flash` | $0.15 | $0.60 | $0.015 |
| `MiniMax-M3` (≤512k in) | $0.30 | $1.20 | $0.06 |
| `MiniMax-M3` (>512k in) | $0.60 | $2.40 | $0.12 |
| `MiniMax-M2.7` | $0.30 | $1.20 | $0.06 |

A single nightly audit on `MiniMax-M3` with a 200K-token repo context and a 4K-token
answer is roughly **$0.07**. A PR review on `MiniMax-M3.1-Flash` is under a cent.
The whole factory is cheaper than the API bill for reading the diffs once by hand.

Prompt caching is automatic on MiniMax for prefixes over 512 tokens, so the role
prompt and the repo context are cached across runs — which is why the system prompt
is sent unchanged on every call.

---

## 7. Known limits

- **No image or video input on the M2.x family.** `MiniMax-M2.7` is text and tool
  calls only. If a job needs to look at a screenshot, it has to go to
  `MiniMax-M3` or `MiniMax-M3.1-Flash` (both 1M context, both native multimodal).
- **`MiniMax-M2.7` has 200K context**, not 1M. A job that reads the whole repo needs
  `MiniMax-M3`.
- **The write allowlist is three files.** Widening it is a deliberate act, not a
  convenience — it is the only thing between a model and the tree.
- **The verdict is a model opinion.** It is a brake, not a proof. The test gate is
  `ci.yml`.
