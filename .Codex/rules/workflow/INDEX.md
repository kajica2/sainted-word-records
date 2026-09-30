# Workflow Rules

## Files

- `00-research.md` — Research & Reuse (Step 0): GitHub search, library docs, package registries before writing net-new code
- `01-plan.md` — Plan Writing Rules: adaptive code-location-first structure, change-unit evidence, execution handoff, delegation, and density gates
- `01-plan-fix.md` — Plan Fix Rules: targeted fixes for P0/P1 tickets from plan evaluation
- `02-review-plan.md` — Plan Review: automated rubric evaluation + manual pre-mortem, verdict thresholds
- `03-implement.md` — Implementation Rules: scope guard, TDD cycle, boundary validation, self-check checklist
- `04-verify.md` — Verification Rules: automated checks first, evidence-based reporting, PASS/FAIL criteria
- `05-doc.md` — Documentation Workflow: when to run omb:doc, scope, omb:wiki relationship, handoff to omb:pr
- `05-test.md` — Testing Standards: TDD cycle, frameworks, coverage targets, mock strategy, AAA pattern
- `06-create-pr.md` — PR Creation Rules: branch naming, conventional commits, required PR sections, language support
- `07-worktree-protocol.md` — Worktree Protocol (DB-Based): state machine, HARD rules, skill integration, CLI commands, DB schema
- `07-worktree-scripts.md` — Deterministic Scripts: `worktree-setup.sh` / `worktree-teardown.sh` / `branch-teardown.sh` RESULT-block contracts, calling-skill responsibilities, real-registration verification, DB invariants
- `08-hook-conventions.md` — Hook Conventions: naming, architecture, shell wrapper template, HARD rules
- `09-ticket-schema.md` — Ticket Schema: P0-P3 format, prefix table, consensus finding table, score sheet, grade thresholds
- `10-coding-principles.md` — Stub redirect → moved to `common/coding-principles.md`
- `11-subagent-watchdog.md` — Sub-Agent Hang Detection & Watchdog (SSOT, globally loaded): background-spawn + bounded-poll + force-terminate triad, activity/silence-aware thresholds, escalation ladder, per-agent + aggregate retry cap, corruption-safety guarantee, `OMB_SUBAGENT_*` env defaults
- `12-subagent-bash-hygiene.md` — Sub-Agent Bash Command Hygiene (SSOT, globally loaded): allow-grammar definition (no `$`/backtick/`<(`/`>(`/`<<`/`for`/`while`/`until`/`do`/`done`/`cd`), Class A/B/C agent enforcement table, HARD rules, rewrite cookbook, 3-layer enforcement (seed allowlist, `SubagentBashGateHandler` hook, agent constraints)
- `13-pr-watch.md` — Post-PR Watch (SSOT, globally loaded): nine `OMB_PR_WATCH_*` env defaults, session-tail termination contract, trust boundary, mutation containment, termination contract — each HARD rule names its enforcing mechanism

## Triggers

Inject these rules when working on: workflow steps, planning, implementation, verification,
PR creation, documentation, testing, hook configuration, worktree management,
sub-agent spawn bounding, watchdog, hang detection, `run_in_background` agent spawn,
`TaskOutput`/`TaskStop` polling, `OMB_SUBAGENT_*`, fan-out retry/escalation,
subagent bash hygiene, permission prompt, simple_expansion, allow-grammar,
pr-watch, `OMB_PR_WATCH_*`, `ScheduleWakeup`, PR watch, CI follow-through, review-thread sweep.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest — coding-principles lives here)
- `../harness/INDEX.md` (harness configuration used by workflow hooks)
- `../git/` (branch naming and commit conventions for omb:pr)
- `.claude/skills/omb-goal/rules/pipeline-contract.md` (omb-goal autonomous pipeline contract: phase order, `--bypass` semantics, retry cap, consensus classification, decision log)
- `.claude/skills/omb-refactoring/rules/refactoring-pipeline-contract.md` (omb-refactoring delta contract over omb-goal: ARCHITECT insertion, `refactor/` branch type, `--research` routing, architect artifact handoff, VERIFY refactoring rubric gate)
