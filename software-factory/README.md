# SWR Software Factory — multi-provider

The factory floor for Sainted Word Records: a router that decides **which agent and
which model** does a piece of work, a bridge that calls the model, and a GitHub Action
that runs it on issues, pull requests and a nightly schedule.

Four API providers and two local agent CLIs are wired in. Every task carries a
**primary model and a fallback chain** — the bridge walks the chain until one provider
answers, and a provider you have not given a key for is *skipped*, not an error. One
key gives you a working factory; four keys give you a resilient one.

---

## 1. The providers

| Provider | Speaks | Base URL | Key |
|---|---|---|---|
| **MiniMax** | Anthropic Messages | `https://api.minimax.io/anthropic` | `MINIMAX_API_KEY` |
| **OpenCode Zen** | three of them, per model | `https://opencode.ai/zen/v1` | `OPENCODE_API_KEY` |
| **xAI (Grok)** | OpenAI Responses | `https://api.x.ai/v1` | `XAI_API_KEY` |
| **Antigravity** | Gemini Interactions | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| **Antigravity CLI** | stdout (`agy -p`) | local | — |
| **OpenCode CLI** | stdout (`opencode run`) | local | — |

**OpenCode Zen is a gateway, not a model.** Its catalog sits on three different
endpoints depending on the family, which is why the router stores the format per
model rather than per provider:

| Family | Endpoint | Adapter |
|---|---|---|
| Claude, Qwen | `/messages` | Anthropic |
| GPT, Muse | `/responses` | OpenAI Responses |
| DeepSeek, MiniMax, Grok Build, GLM, Kimi | `/chat/completions` | OpenAI-compatible |
| Gemini | `/models/gemini-*` | Google (not wired — see limits) |

So `opencode/minimax-m3` and `minimax/MiniMax-M3` are the same model billed two ways —
one direct, one through the gateway. The router treats them as different entries
because they have different capabilities: through Zen it lands on `/chat/completions`,
which has no thinking controls.

---

## 2. The model map

| Job | Primary | Fallbacks | Price in / out (per M tokens) |
|---|---|---|---|
| Planning, nightly audit | `minimax/MiniMax-M3` | `xai/grok-4.7` → `opencode/claude-sonnet-5` | $0.30 / $1.20 |
| Coding, creative | `minimax/MiniMax-M2.7` | `opencode/qwen3.7-plus` → `xai/grok-4.6` | $0.30 / $1.20 |
| Triage | `minimax/MiniMax-M3.1-Flash` | `opencode/deepseek-v4.1-flash` → `xai/grok-4.7` | $0.15 / $0.60 |
| PR verification | `minimax/MiniMax-M3.1-Flash` | `opencode/deepseek-v4.1-flash` → `xai/grok-4.7` | $0.15 / $0.60 |

The fallback order is not alphabetical and not "best first" — it is
**cheapest-capable first**. Grok 4.7 is a $2/$6 model, so it sits behind a $0.30/$1.20
one even though it is the more capable of the two.

### The price table

| Model | Context | In | Out | Cache read |
|---|---|---|---|---|
| `minimax/MiniMax-M3.1-Flash` | 1M | $0.15 | $0.60 | $0.015 |
| `minimax/MiniMax-M3` | 1M | $0.30 | $1.20 | $0.06 |
| `minimax/MiniMax-M2.7` | 200K | $0.30 | $1.20 | $0.06 |
| `minimax/MiniMax-M2.7-highspeed` | 200K | $0.60 | $2.40 | $0.06 |
| `opencode/qwen3.8-flash` | 1M | $0.15 | $0.47 | $0.016 |
| `opencode/deepseek-v4.1-flash` | 1M | $0.30 | $1.20 | $0.06 |
| `opencode/qwen3.7-plus` | 262K | $0.40 | $1.60 | $0.04 |
| `opencode/claude-sonnet-5` | 1M | $2.00 | $10.00 | $0.20 |
| `opencode/claude-opus-5-5` | 1M | $4.00 | $20.00 | $0.50 |
| `xai/grok-4.7` | 500K | $2.00 | $6.00 | $0.50 |
| `xai/grok-4.20-multi-agent-0309` | 1M | $1.25 | $2.50 | $0.20 |
| `antigravity/gemini-3.8-flash` | 1M | $1.50 | $7.50 | $0.15 |

Long-context rates (above a 200K prompt): Grok 4.7 goes to $4.00/$12.00, MiniMax M3
to $0.60/$2.40.

---

## 3. The depth knobs, and they are not interchangeable

This is the part that bites when you port a config between providers. **Each family
has a different way to say "think harder", and sending the wrong one is a 400.**

| Style | Wire | What it does | Where |
|---|---|---|---|
| `anthropic-adaptive` | `thinking: {type:"adaptive"}` | the model picks its own depth | MiniMax M3, Claude via Zen |
| `anthropic-budget` | `thinking: {type:"enabled", budget_tokens:N}` | a hard token budget | MiniMax M2.x, Qwen via Zen |
| `anthropic-effort` | `output_config: {effort}` | `low`·`medium`·`high`·`xhigh`·`max` | **MiniMax-M3.1-Flash only** |
| `openai-effort` | `reasoning: {effort}` | `low`·`medium`·`high`·`xhigh` | Grok 4.7 / 4.6 |
| `none` | — | the model does not expose one | DeepSeek, MiniMax via Zen |
| `gemini-agent` | `agent_config.model` | the agent picks its own harness | Antigravity |

The router expresses the intent per task, and the bridge adapts it to whichever
model ends up answering:

```json
"triage": {
  "primary": "minimax/MiniMax-M3.1-Flash",
  "fallbacks": ["opencode/deepseek-v4.1-flash", "xai/grok-4.7"],
  "effort": "low"
}
```

On the primary that becomes `output_config.effort: "low"`. On the DeepSeek fallback
the effort is **dropped** — that model has no such knob, and a fallback that cannot
honour the effort is still a working fallback. On the Grok fallback it becomes
`reasoning: {effort: "low"}`. `npm run check:factory-routing` warns when a fallback
cannot take the effort, and fails when the *primary* cannot.

Two more traps, both now handled in the bridge:

- **`MiniMax-M3.1-Flash` always thinks.** `{"type":"disabled"}` is a 400. `none` is
  not a valid effort value on any MiniMax model.
- **xAI's Chat Completions API is deprecated.** The Responses API is the supported
  surface, and it is the only one that carries the model's encrypted reasoning
  across a tool loop — which is what keeps the model on its plan after a tool call.
  The bridge sends `include: ["reasoning.encrypted_content"]` and passes the
  reasoning items back unchanged.

---

## 4. The pieces

```
software-factory/
  routing.config.json   the router: providers, model catalog, agents, triggers
  providers.mjs         the five wire formats
  swr-agent.mjs         the bridge: routing, tools, guards, failover
  budget-ledger.mjs     the money: a durable per-UTC-day ledger
  worker-lease.mjs      the brakes: a global pool of two active agents
  swarm-guard.mjs       the two composed: price a turn, claim a slot
  README.md             this file
.github/workflows/
  factory.yml           the factory floor: triage, PR verdict, nightly drift
scripts/
  check-factory-routing.mjs   the router gate (no API key needed)
  check-fx-doc-drift.mjs      the doc-vs-code drift gate
agents/
  team.config.json       the same model pins, for the local team
  start-team.sh          launches the three agents
```

### The router — `routing.config.json`

A provider registry (base URL, auth, endpoint paths, per-format headers), a model
catalog with context windows, prices and reasoning styles, the three agents with
per-task primary + fallback chains, and the five triggers.

### The bridge — `swr-agent.mjs`

```bash
node software-factory/swr-agent.mjs run --agent SWR-Ops --task triage --context "…"
node software-factory/swr-agent.mjs run --agent SWR-Check --task verification --diff-file pr.diff
node software-factory/swr-agent.mjs run --agent SWR-Ops --task planning --model xai/grok-4.7
node software-factory/swr-agent.mjs chat --agent SWR-Twin --task creative    # interactive
node software-factory/swr-agent.mjs show --agent SWR-Ops                     # the chain
node software-factory/swr-agent.mjs models --live                            # catalog + live check
node software-factory/swr-agent.mjs formats                                 # the wire formats
node software-factory/swr-agent.mjs self-test                               # guard rails
```

No SDK, no dependency — the repo's CI does a bare `npm ci` and has no LLM client in
its tree. `--dry-run` prints the exact request each model in the chain would receive,
with the API key redacted, without calling anything.

**Tools.** Two, deliberately asymmetric:

| Tool | Who gets it | Rules |
|---|---|---|
| `read_file` | every agent that speaks a tool-capable format | repo root and the `../digital_twin` twin root only; a `../` escape is refused |
| `write_file` | every agent that is not read-only | only `agents/TASKS.md`, `README.md`, `CHANGELOG.md`; only with `--allow-writes` |

`SWR-Check` is read-only by construction: the bridge does not declare `write_file`
for it, so a verdict can never edit the tree it is judging.
`node software-factory/swr-agent.mjs self-test` proves all of this without an API key.

### The guard — `budget-ledger.mjs`, `worker-lease.mjs`, `swarm-guard.mjs`

The bridge will not spend money it has not reserved, and it will not start a third
agent while two are already running. Three modules, zero dependencies:

| Module | What it owns |
|---|---|
| `budget-ledger.mjs` | a durable per-UTC-day ledger: reserve before a call, settle after it, release when nothing was billed |
| `worker-lease.mjs` | the global worker pool: at most `maxConcurrentAgents` live leases, idempotent re-claims, TTL recovery of a crashed agent |
| `swarm-guard.mjs` | the two composed: worst-case chain pricing, fail-closed on unknown pricing, settle-the-difference |

**How a turn is priced.** The reservation is sized by the **most expensive model in
the failover chain**, because a failover can land on it. If ANY member of the chain
is a paid model whose price is unknown, the whole chain is refused **before the
request is built** — an unpriceable call is not a free call. A local CLI provider
runs a binary on this machine, so it is free by construction and never blocks a run.
A missing rate is a **null** cost, never a zero: `estimateUsd()` refuses to price
what it cannot price.

**What the money does.** `reserve` → the request goes out → `settle` with the
answering model's own rates and the provider's reported usage. The difference
between the reservation and the real cost goes back to the day. A chain that failed
outright releases its reservation: no completion, no bill.

**What the cap does and does not bound.** The cap is enforced on the *reservation*,
so a turn that bills more than it reserved can push the day's total past the cap —
the money is already spent. What the guard guarantees is that **nothing else is
spent after that**: the remaining budget goes negative and every later reservation
is refused until the next UTC day.

**Where the state lives.** `data/swr-budget/` and `data/swr-leases/` — both
gitignored (`/data/swr-*`). One file per UTC day, append-only, one JSON line per
event; a half-written line closes the day until `reconcile` repairs it. The repair
writes a temp file and renames it, so a crash during the repair leaves the day
exactly as it was — the spent money is never erased by the thing meant to save it.
A **corrupt lease file** (a crash between the exclusive create and the write) is
pruned rather than thrown on: it says nothing about who holds a slot, and one
truncated file must not brick the pool until an operator deletes it by hand.

```bash
node software-factory/budget-ledger.mjs status
node software-factory/worker-lease.mjs status
node software-factory/budget-ledger.mjs reconcile --day 2026-11-04
```

`SWR_BUDGET_DIR` and `SWR_LEASE_DIR` relocate *where* the state is. They cannot
raise the cap or the worker count: those come from `qa/swarm.config.json` when it
exists and from the committed defaults (`$2` a day, `2` agents) when it does not.

**The slot outlives the turn.** A turn can take ninety minutes (three attempts ×
ten-minute timeout × three chain models) against a fifteen-minute lease. The
bridge therefore renews the lease **while the request is in flight**, and it
*checks* the renewal: a lease that was lost stops the run rather than letting it
continue outside the pool. `agents/start-team.sh` reads the same cap and starts at
most that many agents — and says which one it did not start.

Four test suites gate this, all inside the `check` group so `check:full` runs them:

```bash
npm run test:budget-ledger        # the ledger: cap, idempotency, torn writes, concurrency
npm run test:worker-lease         # the pool: two workers, re-claims, TTL recovery, corrupt files
npm run test:swarm-guard          # the guard: chain pricing, settle-the-difference, refusals
npm run test:swarm-guard-wiring   # the bridge: the real CLI against a local fake provider
```

The wiring test drives the real CLI as a child process against a **local fake
provider** (`tests/helpers/fake-provider.mjs`, its own process). The fake reads the
ledger **at request time**, so "the reservation comes first" is an observation and
not a claim — and a refused turn is proved by the fake receiving **zero** requests.

---

## 5. Setup

**In GitHub** — one secret per provider. All of them are optional; the router skips
the ones you leave out.

```
Settings → Secrets and variables → Actions
  Secrets:  MINIMAX_API_KEY, OPENCODE_API_KEY, XAI_API_KEY, GEMINI_API_KEY
  Variables: MINIMAX_BASE_URL  (default https://api.minimax.io/anthropic)
             OPENCODE_BASE_URL (default https://opencode.ai/zen/v1)
             XAI_BASE_URL      (default https://api.x.ai/v1)
```

**Locally:**

```bash
export MINIMAX_API_KEY=...
npm run check:factory          # the router gate + the drift gate
node software-factory/swr-agent.mjs self-test
node software-factory/swr-agent.mjs models --live   # which providers are actually reachable
./agents/start-team.sh          # three agents
```

---

## 6. What the Action does

| Job | Trigger | Agent · chain | What it does |
|---|---|---|---|
| `factory-selftest` | every trigger | — | validates the router, runs the bridge self-test, resolves every route. No API key, no cost. |
| `triage-issue` | issue opened | SWR-Ops · Flash → DeepSeek → Grok | labels `untriaged`, triages, comments on the issue, opens a PR with the `agents/TASKS.md` update |
| `verify-pr` | PR opened / updated | SWR-Check · Flash → DeepSeek → Grok | reviews the diff against the merge base, comments PASS/FAIL, fails the job on FAIL |
| `nightly-drift-check` | 02:17 UTC, manual | SWR-Ops · M3 → Grok → Claude | runs the archive scan and the FX drift gate, analyses the result, opens a PR with the fix |

**The brake is not in this file.** `ci.yml` already runs `npm run check:full` on
every PR, and that chain takes ~20 minutes. Re-running it here would double the gate
for the same signal, so `factory.yml` does the part CI cannot: an LLM review with a
verdict.

**Bots do not push to main.** The triage and drift jobs open a PR. `main` on this
repo moves several commits an hour; a bot that pushes to it at 02:17 is a bot that
loses a race.

---

## 7. Drift, actually checked

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

## 8. Known limits

- **Antigravity cannot touch this repo.** It is a managed agent running in a
  Google-hosted sandbox, not a chat model. The bridge gives it no tools, so the only
  thing it can do is work with what is inlined in the prompt. It is routed as a
  fallback for creative and research work, not for anything that reads the tree.
- **The local CLIs are outside the allowlist.** `agy -p` and `opencode run` bring
  their own tools and their own permissions — they run as the local user against the
  working tree. The bridge's `write_file` rules do not apply to them. Treat them as
  "a person is driving", not as "the factory is driving".
- **The Gemini models on OpenCode Zen are not wired.** They sit on Google's own
  `/models/gemini-*` endpoint, which is a sixth wire format. Until that lands, a
  Gemini model id in the catalog would fail the router gate rather than fail at
  02:17.
- **xAI's regional endpoint costs 10% more** (`us.api.x.ai/v1`).
- **Grok Code Fast 1 is retired**; its successor is `grok-build-0.1`, and xAI has
  not published a context window for it — do not route a long-context job there
  without measuring it first.
- **The verdict is a model opinion.** It is a brake, not a proof. The test gate is
  `ci.yml`.
- **The ledger is a local brake, not a vault.** It protects against a runaway run on
  this machine; it cannot stop a determined operator from deleting the state
  directory or pointing `SWR_BUDGET_DIR` somewhere fresh. The cap and the worker
  count are policy, not secrets, and they live in `qa/swarm.config.json` when it
  exists and in the committed defaults when it does not.
