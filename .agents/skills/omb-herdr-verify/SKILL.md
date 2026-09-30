---
name: omb-herdr-verify
description: "Delegate post-implementation requirements verification to Codex or Claude Code in one new Herdr tab, with security/API/DB/behavior evidence; the verifier may fix defects under mutation_policy=full."
user-invocable: true
argument-hint: "[--codex|--claude] [--base <local-ref>] [--no-push] [plan-path | requirements]"
allowed-tools: Bash, Read, Write, Grep, Glob, AskUserQuestion
effort: high
---

# Herdr requirements verification

Only the main session may delegate. Parse selectors before requirement text: default
Codex; `--codex|--claude` are mutually exclusive even on the same host. No cross-kind
fallback or skip. The shared Claude launcher requires TeamClaude first and permits
its bounded native-Claude fallback. Parse `--bypass`, `--no-prompt`, `--yes` as prompt suppression; missing essential
input then returns BLOCKED. Parse optional `--base <local-ref>`, `--no-push`, and
explicit Plan or requirements. `--no-push` forces push_policy=none under
mutation_policy=full (see `.agents/skills/omb-herdr/references/delegation.md` for the
shared policy default table). Content after `--` is plain text. Reject malformed/unknown
options before tab creation. Resolve a Plan from unambiguous conversation context only;
never pick the newest file. An OMB TODO is not required.

Read `.agents/skills/omb-herdr/references/delegation.md`,
`.agents/skills/omb-herdr/references/prompt-contract.md`, and
`.agents/skills/omb-herdr/references/result-contract.md` in full. Resolve these paths
on the current host before following the resource instructions. Read
[verify prompt](references/verify-prompt.md) and bind its mode block into the shared
template. Load `.Codex/rules/workflow/11-subagent-watchdog.md` for bound settings and
`.Codex/rules/common/output-contract.md` for the parent envelope.

Normalize every user requirement/Plan acceptance criterion to an ID with testable
acceptance conditions. If neither requirements nor a Plan supplies them, clarify
before dispatch, or BLOCK under prompt suppression. Preserve conflicting criteria as
an input blocker rather than silently redefining acceptance.

Follow the shared lifecycle using one NEW tab and full native permissions;
mutation_policy=full, push_policy defaults to current_branch and is forced to none by
`--no-push`. No recursive delegation. Check all applicable domains in the
selected CLI session. Existing goal Verify still runs before this independent
stage. The parent re-verifies any changed candidate.

Return the complete requirement matrix, checks, findings, exclusions and gaps. Use
`PASS|FAIL` only when sufficient evidence permits judgment; essential unverified
criteria BLOCK. Render the original verdict in the report body; parent envelopes
omit verdict and follow the shared `<omb>DONE|RETRY|BLOCKED</omb>` mapping.
A verifier that fixed the candidate it is verifying is self-certifying: a PASS with
non-empty changed_files or commits maps per
`.agents/skills/omb-herdr/references/result-contract.md` `self_fixed_pending_reverify`
to `<omb>RETRY</omb>` with a concern until a fresh Herdr verify reporting empty
changed_files (or the ordinary omb-verify) confirms post_candidate_identity.
