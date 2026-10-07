---
name: omb-herdr-review
description: "Delegate evidence-backed Plan or code review to Codex or Claude Code in one new Herdr tab; the reviewer may fix findings, commit and push, and returns actionable findings."
user-invocable: true
argument-hint: "[--codex|--claude] [--target plan|code] [--base <local-ref> | --evidence-packet <path>] [--inspect-only] [--plan-only] [--no-push] [plan-path] [focus]"
allowed-tools: Bash, Read, Write, Grep, Glob, AskUserQuestion
effort: high
---

# Herdr independent review

Only the main session may delegate. Parse selectors before scope text: default Codex;
`--codex|--claude` are mutually exclusive, including when the selected CLI is the
current host. No same-host skip or cross-kind fallback is allowed. The shared Claude
launcher requires TeamClaude first and permits its bounded native-Claude fallback.
Parse `--bypass`, `--no-prompt`,
`--yes` as suppression of questions/next-step prompts; unresolved input then BLOCKS.
Parse `--target plan|code` (default code), `--base <local-ref>`, optional Plan and
focus. Content after `--` is plain task text. Reject malformed/unknown options before
tab creation. Plan target requires an explicit Plan path; code target permits no Plan.
Parse internal `--evidence-packet <absolute-path>` only with `--target code`, mutually
exclusive with `--base` and a local Plan argument. It selects remote-packet inspection
for a fork review; requirements and any Plan excerpts must be pinned packet evidence.
Parse internal `--plan-only` only with `--target plan`; mutually exclusive with
`--inspect-only` and `--no-push`. Parse `--no-push` with either target under
mutation_policy=full; mutually exclusive with `--inspect-only` and `--plan-only`.
Reject an invalid combination before tab creation.
Read `.claude/skills/omb-herdr/references/fork-evidence.md` for validation in that mode;
normal Plan/code reviews retain their local-checkout scope.

Read `.claude/skills/omb-herdr/references/delegation.md`,
`.claude/skills/omb-herdr/references/prompt-contract.md`, and
`.claude/skills/omb-herdr/references/result-contract.md` in full. Resolve these paths
on the current host before following the resource instructions. Read
[review prompt](references/review-prompt.md) and bind its mode block into the shared
template. Load `.claude/rules/workflow/11-subagent-watchdog.md` for bound settings and
`.claude/rules/common/output-contract.md` for the parent envelope.

Follow the shared sequence: preflight, freeze scope, persist request, create one NEW
tab, start selected CLI with full native permissions, submit once, bounded
wait, screen-first collection, validate request/candidate/evidence, close the tab after
validated collection.
Both Plan and code reviews are independent sessions; do not reuse an idle manager tab.

Review all applicable domains in that one session; under mutation_policy=full the
reviewer may fix findings and report them. `--inspect-only` sets
mutation_policy=inspect_only; `--evidence-packet` always does. `--plan-only` sets
mutation_policy=plan_only, push_policy=none; `--no-push` keeps mutation_policy=full but
forces push_policy=none. See `.claude/skills/omb-herdr/references/delegation.md` for the
shared policy default table. In goal, the caller
applies remaining Plan findings without a new Evaluation; this reviewer does not start
a re-evaluation loop. Findings identify actual files and line
numbers or mark a proposed new file and cite the existing requirement/contract.

Render the validated child review verdict `APPROVE|REJECT` in the report body and
use the shared result mapping for `<omb>DONE|RETRY|BLOCKED</omb>`. Parent orchestrator
envelopes omit verdict. Do not claim success from an idle/done state or missing report.
Under mutation_policy=full, a reviewer that fixed the candidate it is reviewing is
self-certifying: an APPROVE with non-empty changed_files or commits maps per
`.claude/skills/omb-herdr/references/result-contract.md` `self_fixed_pending_reverify` to
`<omb>RETRY</omb>` with a concern until an independent re-check confirms the candidate:
for `--target code`, a fresh Herdr review under `--inspect-only`, or the ordinary
omb-ultra-review / code-review path; for `--target plan` without `--plan-only`, a fresh
Herdr Plan review under `--plan-only` reporting empty changed_files, or the ordinary
omb-plan-review. This does not apply under `--plan-only` itself: a Plan edit there is the
intended amendment output, reconciled by the caller's apply-findings-only handoff, not by
this self-certification check.
