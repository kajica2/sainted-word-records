# Comprehension Anatomy

Worked steps for rule 11(c) (comprehension skeleton) of
`.claude/rules/common/explanation-style.md`. Read this file when writing an explanatory answer
for a reader who did not write the code — rule 11(a) has already fixed that audience, and this
file elaborates the four-step skeleton that answer follows by default.

## Four-Step Skeleton

### `## Background`

**Purpose:** Ground the reader in why this mechanism exists at all, before naming any code.

**Required content:** The problem or need the mechanism was built to satisfy, stated as a
scenario a non-author reader recognizes. If the mechanism replaced an older approach, say what
changed and why — but only the part that was verified (rule 7); do not invent history to fill
the step.

**Omit when there is no content:** if the mechanism has no meaningful history — it is the first
and only way this problem has ever been solved in this codebase — state that in one line instead
of stretching prose to fill the heading (same rule as `explanation-anatomy.md:30-31`).

### `## Intuition`

**Purpose:** Give the reader a mental model of the mechanism's shape before the real control
flow, so the mechanism section reads as confirmation rather than first exposure.

**Required content:** A one- or two-sentence analogy or simplified description of what the
mechanism does, plus the toy example or diagram required by rule 11(d) — see Toy-Example
Guidance below. The toy example belongs here, ahead of the real code path.

**Omit when there is no content:** if the mechanism is already as simple as any analogy could
make it (a single well-named function with no branching), state that plainly instead of manufacturing
an analogy that adds no clarity.

### `## Mechanism`

**Purpose:** Describe the actual, verified control/data flow — this is where the mechanism section
of `explanation-anatomy.md`'s explanatory skeleton (`:41-51`) would normally sit, now following the
Intuition step instead of leading.

**Required content:** The real control/data flow, in execution order, cited per rule 8
(`file:line-range` or `file::symbol`, excerpt only when it substantiates the point). Boundaries and
exceptions — what the mechanism does NOT do, edge cases, error paths, configuration flags that
change behavior — belong here rather than in a separate step; a mechanism description that omits
its own exceptions is incomplete, not concise.

**Omit when there is no content:** never omit this step for an explanatory answer — it is the
substantive core the other three steps exist to support.

### `## Decision and what follows`

**Purpose:** Close the loop for the reader who now understands the mechanism: what changes, what
they need to decide, or what happens next.

**Required content:** For a decision request, the three-part set from rule 9 (options, recommendation,
impact). For a pure "how does this work" question with no pending decision, state what follows from
understanding the mechanism — the next place the reader would look, or what changes if they touch it.

**Omit when there is no content:** if the answer is purely informational and nothing follows from it
(no decision, no next step), state that in one line rather than inventing a decision to fill the
heading.

## Functional-Language Conversion Table

Rule 11(a) requires leading with what the system does for a user, not with an identifier. The table
below converts identifier-centric openers (forbidden) into scenario-centric openers (required),
including the three carve-outs rule 11(a) names where naming the identifier first is correct.

| Identifier-centric opener (forbidden) | Scenario-centric opener (required) |
|---|---|
| `retry_with_backoff() retries failed calls.` | `When a call to the payment provider fails, the system waits and tries again instead of giving up immediately.` |
| `The SubagentBashGateHandler blocks certain Bash calls.` | `When a read-only reviewer sub-agent tries to run a shell command with variable expansion, the harness refuses it before it can hang silently.` |
| `WorktreeDB.update() writes worktree state.` | `Every time a plan or a run finishes a step, the worktree's status on disk gets updated so a new session can pick up where it left off.` |
| `_derived_skeleton_count() counts skeletons.` | `The docs stay honest about how many response skeletons exist because the count is computed from the rule file, not typed by hand.` |
| Request names the identifier: "what does `retry_with_backoff` do?" | Name it first, per rule 11(a): `retry_with_backoff() retries a failed external call with exponential backoff before giving up.` Then explain what it does for the caller. |
| Request names the file: "what's in `subagent_bash_gate.py`?" | Name it first, per rule 11(a): `subagent_bash_gate.py holds the PreToolUse hook that denies unsafe Bash calls from read-only reviewer sub-agents.` Then explain the mechanism. |
| No accurate name other than the identifier exists: an internal helper with no product-facing name | Name it first, per rule 11(a): `_strip_exempt_constructs() has no name outside the code itself — it removes fenced code blocks, quote lines, and table-cell backtick spans from a string before checking the rest for non-ASCII text.` |

A named identifier stays available as the subject for follow-up turns on the same mechanism
(rule 11(a)) — once introduced, later turns may refer to it directly.

## Toy-Example Guidance

Rule 11(d) requires a toy example or a diagram before the real control flow. Use one set of fake,
minimal data that reproduces the mechanism's shape, and place it in the `## Intuition` step, ahead of
the `## Mechanism` step's real code path. The toy example exists to let the reader confirm they
understand the shape before reading the real, more complex path — it is not a second, redundant
explanation.

**Diagrams are inline SVG only.** ASCII art is banned, and Mermaid fences are banned — neither
renders in the self-contained HTML the `--page` mode produces. An inline `<svg>` block embedded
directly in the HTML output is the only supported diagram form for `--page` mode; terminal-mode
responses use prose or a toy example instead of a diagram.

## `ko` Rendering Table

Rule 11(c) fixes the four skeleton headings in English inside the rule file and this worked-steps
file — instructional and normative text stays English (`.claude/rules/common/language-settings.md`).
When `OMB_DOCUMENTATION_LANGUAGE=ko`, the user-visible section titles in the actual response use the
Korean renderings below instead of the English heading strings. These are quoted example renderings
(`.claude/rules/common/language-settings.md`), not instructional prose:

| Step order | Rendering |
|---|---|
| 1st | `Background → 배경` |
| 2nd | `Intuition → 감 잡기` |
| 3rd | `Mechanism → 동작` |
| 4th | `Decision and what follows → 결정과 그 다음` |
