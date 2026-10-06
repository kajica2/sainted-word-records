# Sub-Agent Hang Detection & Watchdog

**SSOT for sub-agent spawn bounding.** This file loads globally at session start (no
`paths:` frontmatter): it governs how the main session *spawns and bounds* sub-agents, a
concern that is not tied to which files are edited. Other files (the spawn-bearing skills)
**cite** this file and MUST NOT restate its numeric defaults — same discipline as
`testing/test-execution.md`.

An unbounded synchronous sub-agent spawn ("spawn all in one message, wait for all") can stall
the whole workflow forever when one child runs a hanging script. The watchdog hard-bounds every
spawn, terminates a hung child, retries it once under a corruption-safe guarantee, then
degrades-and-continues (BLOCK only when a *critical* sub-agent is lost).

## Herdr transport exception

For `omb-herdr*` delegation, use `.claude/skills/omb-herdr/references/delegation.md`.
TaskStop does not control Herdr panes or tabs. A turn waits foreground in slices of
min(60, OMB_HERDR_POLL_S, remaining sync budget) seconds until OMB_HERDR_SYNC_WAIT_S,
then via one background poller until OMB_HERDR_ASYNC_CEILING_S — both count from turn
start, never reset. OMB_SUBAGENT_POLL_SLICE_S does not apply to Herdr, and
HARD_CEILING_S does not bound Herdr turns.

## Mechanism (verified in this harness)

This harness has **no synchronous `Agent({timeout})` call argument** — the `Agent` tool exposes
no `timeout` parameter, so a foreground spawn cannot be bounded by the caller. The real,
verified bound is the **background-spawn + bounded-poll + force-terminate** triad:

| Step | Call | Confirmed behavior |
|------|------|--------------------|
| Spawn | `Agent(..., run_in_background: true)` | returns an `agentId` immediately |
| Poll | `TaskOutput(agentId, block: true, timeout: POLL_SLICE_S*1000)` | `status: completed` + full output (incl. `<omb>`), or `status: running` after the slice |
| Terminate | `TaskStop(agentId)` | kills the running sub-agent cleanly (`status: killed`) |

These tools are callable by the **main session only** (sub-agents never spawn agents), even
though `settings.json permissions.allow` does not list them.

## `<omb>` enforcement is orchestrator-side under the watchdog

`StatusRouterHandler` enforces the `<omb>` contract on `Stop` + `matcher=Agent`, which fires
for **foreground** agents only — a backgrounded sub-agent's completion is **not** mirrored as
a `Stop`/`SubagentStop` event. Therefore the watchdog **MUST enforce the `<omb>` contract
orchestrator-side**: parse the tag from the text `TaskOutput` returns, and treat a missing tag
or `<omb>BLOCKED</omb>` exactly as the hook would (BLOCKED → stop/escalate).

## Detection model — activity/silence-aware, not flat wall-clock

A flat elapsed bound kills *legitimately long* work. The signal is **silence**: a child
still emitting output is alive; one silent past the inactivity window is hung.

- **Progress = a change in the `TaskOutput` output between polls** (new text/length delta, or
  `status` transition). Progress **resets the inactivity/startup clocks** — never the ceiling.
- Thresholds are **type-aware**: `STARTUP_GRACE_S` (no output yet — warm-up), `INACTIVITY_S`
  (silent *after* progress — the hang signal), `SOFT_INACTIVITY_S` (observability-only "quiet"
  note), `HARD_CEILING_S` (absolute).
- **`HARD_CEILING_S` is absolute, NEVER reset by progress.** It fires regardless of how much
  output the child emits, so steady noise forever still gets terminated.

## Escalation ladder (defined once here; embedded in skills)

```
spawn each sub-agent:
  agentId = Agent({ ..., run_in_background: true })   # record agentId + spawn_wall_clock + last_progress_at
loop per live sub-agent:
  out = TaskOutput(agentId, block: true, timeout: POLL_SLICE_S * 1000)
  if out.status == completed:
      parse <omb> from out.output  →  enforce contract orchestrator-side; mark resolved
  elif progress since last poll (output delta or status change):
      last_progress_at = now                          # alive — resets inactivity/startup, NOT hard ceiling
  elif no output yet and elapsed < STARTUP_GRACE_S:
      keep waiting                                    # warm-up tolerated
  elif silent ≥ SOFT_INACTIVITY_S (and < INACTIVITY_S):
      log "slow/quiet sub-agent" note                 # observability only — no kill
  # HARD breach (either condition):
  if silent ≥ INACTIVITY_S  OR  elapsed_since_spawn ≥ HARD_CEILING_S:
      TaskStop(agentId)                               # HARD_CEILING_S is absolute — never reset by progress
      if retry_count[agent] < RETRY_MAX
         AND aggregate_retries_this_step < RETRY_MAX  # aggregate cap dominates (checked FIRST)
         AND corruption-safe (see guarantee):
            retry once with fresh context (re-spawn)
      else:
            drop with a FINAL note ("not retrying again; raise OMB_SUBAGENT_* to extend"):
              best-effort agent → proceed with partial results, log dropped
              critical agent    → emit <omb>BLOCKED</omb>
```

**Circuit breaker — per-agent AND aggregate (aggregate dominates).** `OMB_SUBAGENT_RETRY_MAX`
caps per-agent retries AND **total** retries across one fan-out step. The aggregate cap is
checked first: once reached, no further retries fire even under an individual agent's own cap
— the guard against an N-parallel-hung re-spawn storm (5 hung reviewers ⇒ at most `RETRY_MAX`
total, not 5).

## Corruption-safety guarantee (HARD)

A `TaskStop`-killed sub-agent that edits files (`*-implement`, any write agent) may leave a
half-written tree; retrying on it is unsafe. A write/implement agent retries **only** under
git worktree isolation (`workflow/07-worktree-protocol.md`) **or** an explicit clean/rollback
step first. Read-only agents (reviewers, evaluators, verifiers, explorers, designers) leave no
tree mutation and are exempt — classify every file-editing agent "retry-requires-clean-boundary".

## Critical vs best-effort classification

- **Critical** (loss ⇒ `<omb>BLOCKED</omb>`): `@plan-evaluator`; the single domain
  `*-implement`/`*-verify` agent in an orchestration sequence.
- **Best-effort** (loss ⇒ degrade & continue): any one of N parallel domain reviewers/verifiers.
- **Default when unclassified: best-effort.**

## Environment variables (SSOT — cite, do not restate elsewhere)

Defaults are anchored to `oh-my-openagent`'s validated values, scaled up for LLM cadence.
All 10 are seeded via the **`setdefault` (seed-if-missing)** path
(`scripts/omb-subagent-defaults.json`), never the overwrite heredoc `env` block, so
`omb update` cannot clobber a user-tuned value.

| Var | Default | Meaning |
|-----|---------|---------|
| `OMB_SUBAGENT_WATCHDOG` | `true` | Master on/off. `false` → unbounded synchronous spawn (the original hang — do NOT set globally). |
| `OMB_SUBAGENT_POLL_SLICE_S` | `30` | `TaskOutput` blocking slice per poll. |
| `OMB_SUBAGENT_STARTUP_GRACE_S` | `120` | Tolerated silence before first output (warm-up). |
| `OMB_SUBAGENT_SOFT_INACTIVITY_S` | `120` | Silence after progress → log a "slow/quiet" note (observability). |
| `OMB_SUBAGENT_INACTIVITY_S` | `300` | Silence after progress → hung → `TaskStop`. Resets on any progress. |
| `OMB_SUBAGENT_HARD_CEILING_S` | `900` | Absolute terminal bound → `TaskStop`. **Never reset by progress.** |
| `OMB_SUBAGENT_RETRY_MAX` | `1` | Per-agent retry cap AND aggregate retries-per-step cap (aggregate dominates). |
| `OMB_HERDR_SYNC_WAIT_S` | `900` | Foreground wait budget from turn start; exceeded → async. |
| `OMB_HERDR_POLL_S` | `60` | Sync slice ceiling and poller `agent wait` slice/min interval (5-60). |
| `OMB_HERDR_ASYNC_CEILING_S` | `7200` | Absolute bound from turn start. Never reset. |

Thresholds are tunable per-invocation with a stated reason (mirrors `test-execution.md`'s
"explicit stated reason" carve-out). LLM-heavy sub-agents may legitimately approach
`HARD_CEILING_S`.

## Copy-paste Watchdog Protocol block (embed in spawn-bearing skills)

> When `OMB_SUBAGENT_WATCHDOG=false`, skip the watchdog and spawn synchronously (reverts to
> prior behavior — reversible without a code edit). Otherwise:
>
> 1. Spawn every sub-agent in the fan-out with `Agent({ ..., run_in_background: true })`;
>    record each `agentId`, its `spawn_wall_clock`, and `last_progress_at`.
> 2. Poll each live agent with `TaskOutput(agentId, block: true, timeout: POLL_SLICE_S*1000)`.
>    On `completed`, parse the `<omb>` tag from the returned text and enforce the contract
>    orchestrator-side. On progress (output delta), reset its inactivity clock.
> 3. On HARD breach (`silent ≥ INACTIVITY_S` OR `elapsed ≥ HARD_CEILING_S`), `TaskStop(agentId)`,
>    then retry-once (per-agent AND aggregate `RETRY_MAX`, aggregate dominates; write/implement
>    agents only under a clean boundary) → else drop: best-effort degrade & continue, critical
>    emit `<omb>BLOCKED</omb>`.
> 4. Cite this rule (`workflow/11-subagent-watchdog.md`) as SSOT for thresholds; do NOT restate
>    the numeric defaults.

## See Also

- `testing/test-execution.md` — global-load precedent + "explicit stated reason" carve-out.
- `workflow/07-worktree-protocol.md` — the clean-boundary the corruption-safety guarantee needs.
- `common/output-contract.md` — the `<omb>` contract the watchdog enforces orchestrator-side.
- `workflow/08-hook-conventions.md` — sub-agent duration observability (event_mirror).
