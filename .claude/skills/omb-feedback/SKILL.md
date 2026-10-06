---
name: omb-feedback
description: Diagnose workflow feedback and route approved reinforcement through reviewed proposal transactions.
argument-hint: "[git-sha] [free-text feedback]"
allowed-tools: "Agent, Skill, AskUserQuestion, Read, Grep, Glob, Bash(git log*), Bash(git show*), Bash(git diff*)"
---

# Human Feedback Channel

Diagnose which workflow step should have prevented the reported problem. Feedback
produces evidence and a proposal; it never directly changes a rule, prompt,
template, hook, or live wiki document.

## Input and analysis

Parse `$ARGUMENTS` as an optional commit SHA followed by feedback text. If a SHA
is present, reject a commit carrying `X-OMB-Feedback-Generated: true` to prevent
recursive reinforcement. Ask the user for the observed result, expected result,
and reproduction path when those facts are missing.

Invoke the read-only `feedback-analyzer` with the bounded evidence. Require:

- `missed_step`, `root_cause`, `subtype`, and `missed_step_key`;
- searched files and concrete evidence;
- exact proposed targets and edit shapes;
- one verification command per proposed target.

Do not treat analyzer output as permission to mutate a target.

## Reinforcement decision

Present the evidence and ask whether to:

1. propose a workflow rule, hook/verification gate, or agent-prompt change;
2. propose a cross-cutting governance lesson when no stronger process contract
   already covers the case;
3. reject or cancel.

Reject or cancel ends without a publishing operation or target mutation.

## Protected proposal and approval

Keep the proposal in the conversation or the existing workflow artifact; it is
not published project knowledge. Record each proposed target's exact
`target`, `baseline_sha256`, `edit_shape`, supporting `evidence`, and
`verification_command`. Never invoke the disabled legacy feedback transaction.
Present the bounded proposal for an explicit approve/reject/cancel decision;
reuse existing explicit authorization for that exact scope when supplied.

- Reject/cancel ends without a publishing operation or target mutation.
- Approval authorizes a fresh implementation, not direct application of the
  proposal. Recheck every target baseline; a conflict requires a new decision.
- `@harness-implement` owns approved rule, schema, template, prompt or hook
  changes in a separate reviewed `/omb-run --worktree` task.
- `@harness-verify` independently checks harness changes. Knowledge publication
  is a distinct `Skill("omb-wiki")` official update run by the main host.
- Preserve the priority workflow-rule > agent-prompt > knowledge lesson; propose
  a lesson only when a stronger process contract cannot enforce the invariant.
- Keep exact approved targets and evidence through the handoff. Do not expand
  scope or fabricate consent from analyzer output.
- Before publication, complete the independent harness review and verification
  commands and review source evidence supporting the knowledge plan. No page or
  reviewer subagent runs inside the official OpenWiki page loop.
- After stable official finish, independently review native factual support and
  stop PR handoff on failure. Repair through official update; never edit Claims.
  The two workflows do not share an atomic cross-tree publisher.

If review fails, preserve evidence and report non-success. Scope/baseline changes
require a fresh decision; repairs within the approved scope retain authorization.

## Output

End with the standard OMB envelope. Report proposal evidence, decision, exact
targets, baseline checks and verification commands. `changed_files` stays empty
until the separately approved implementation workflow completes. Publication
requires the stable finish condition in `omb-wiki`; a proposal is never policy.
