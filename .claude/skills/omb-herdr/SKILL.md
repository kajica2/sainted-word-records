---
name: omb-herdr
description: "Delegate a request to Codex or Claude in a new Herdr tab that closes after result collection, or manage OMB-owned Herdr sessions (start, status, read, follow-up, close)."
user-invocable: true
argument-hint: "[--codex|--claude] [--no-push] [task] <request> | start [--codex|--claude] | status | read <session-id> | follow-up <session-id> <text> | close <session-id> | close --completed"
allowed-tools: Bash, Read, Write, Grep, Glob
effort: high
---

# Herdr task delegation and session management

Operate only from a Herdr-managed caller (`HERDR_ENV=1`). This is a prompt-driven
skill, not a Python CLI command. Only the main session may launch a delegated agent;
children never redelegate. `omb-herdr-run` is not provided.

Read [delegation](references/delegation.md) for preflight and the shared new-tab
start procedure. For `task`, also read [prompt contract](references/prompt-contract.md),
[task prompt](references/task-prompt.md) and [result contract](references/result-contract.md).
For a management action, read [management](references/management.md).
Load `.claude/rules/workflow/11-subagent-watchdog.md` to bind `OMB_HERDR_SYNC_WAIT_S`,
`OMB_HERDR_POLL_S` and `OMB_HERDR_ASYNC_CEILING_S`; load
`.claude/rules/common/output-contract.md` for the envelope.
Supply these resolved values to the procedure; do not copy their defaults here.

Actions: task, start, status, read, follow-up, close. The first non-option token selects
an action only when it is one of these words. Otherwise, when a selector or request text
is present, the invocation is task delegation; the remaining text, or all text after `--`,
is the verbatim request. A request that begins with an action word must be written as
`task <request>` or `-- <request>`. No action and no text means `status`.
`--codex|--claude` apply to task and start only; default Codex; both selectors are an error
before any mutation. `--no-push` applies to task only and forces push_policy=none under
mutation_policy=full. `start` never accepts request text.
The main session may start task, review or verify delegation on its own judgment without a
user command. When it does so on its own judgment rather than an explicit `/omb:herdr`
invocation, push_policy defaults to none unless the user's own request asks for a push;
an explicit user invocation keeps the existing push_policy defaults in
[delegation](references/delegation.md) §1. Sub-agents and delegated agents never invoke
these skills.
Parse `--bypass`, `--no-prompt`, or `--yes` as prompt suppression only. These flags never
broaden management scope. Other management actions resolve kind from the recorded session,
not a default. Reject unknown actions/options and ambiguous session IDs before controlling
a tab or pane.

`start` creates one new tab and a ready CLI without inventing work. Task, review and verify
calls each create their own new tab. Management start does not reserve a reusable reviewer.
`follow-up` only continues a recorded request. Full native permissions are fixed by the
shared start procedure; no repeated opt-in. Script paths resolve relative to
`<resolved-omb-herdr-skill-dir>`, the absolute directory containing the loaded `omb-herdr/SKILL.md`
(an exported copy resolves against its own SKILL.md).

Report session IDs, current observations, artifact paths and requested action outcome.
Delegation tabs close automatically after validated collection (delegation §6); manager-start
sessions stay open until explicit close. Explicit close preserves evidence and targets owned
identities only. Never equate an agent's `done` state with a successful review or
verification. The parent envelope's `changed_files` reports the validated delegate changes for
task/review/verify calls, and `[]` for management actions.

End with `<omb>DONE</omb>` on a completed task or management action, `<omb>RETRY</omb>` on an
evidenced incomplete task, or `<omb>BLOCKED</omb>` on unavailable environment, ambiguous
ownership, a child BLOCKED report, or operational failure. Use the common result envelope with
artifacts containing session records and collected reports, concerns for incomplete
observations, and actionable blockers. Management has no verdict; task also omits verdict. A
successful `status` may truthfully report running or unknown requests without completing
them by mere observation; when it owns the poller (per delegation §4's `poller_owner` gate)
it may re-arm and drive that request through collection, validation and close, which does
complete it.
