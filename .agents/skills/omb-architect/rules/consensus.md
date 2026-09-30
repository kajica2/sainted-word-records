# Consensus Synthesis

Cited by `.claude/skills/omb-architect/SKILL.md` Step 4. This step runs in the main
session — never a sub-agent. Ticket ID format, priority definitions, and the consensus
finding table shape are defined in `.claude/rules/workflow/09-ticket-schema.md`; this
file only adds the refactoring-specific prefix and veto rules layered on top of that
schema.

## Step 4a: Collect and Deduplicate

1. Gather all findings from every resolved team member (per the watchdog protocol),
   grouped by topic (1-9, see `rules/analysis-topics.md`).
2. For each topic, deduplicate findings that reference the same `file:line` or the same
   underlying concern.
3. For each unique finding, count how many team members flagged it.

## Step 4b: Classify by Consensus Level

The denominator N is the total number of resolved team members from Step 3 (dropped
best-effort agents reduce N; a dropped `@core-critique` is a `<omb>BLOCKED</omb>` event
and never reaches this step).

| Consensus Level | Criterion | Priority |
|----------------|-----------|----------|
| Unanimous | All N agree | P0 |
| Supermajority | >=75% of N agree | P0 |
| Majority | >50% of N agree | P0 |
| Strong minority | 33-50% of N agree | P1 |
| Minority | <33% of N agree | P2 |
| Single voice | Exactly 1 agent flags | P3 |

## Step 4c: Apply Veto Power

Escalate these findings regardless of vote count:

| Agent | Condition | Minimum Priority |
|-------|-----------|-------------------|
| `@core-critique` | BLOCKING finding | P1 |
| `@security-audit` | BLOCKING finding | P1 |
| `@wiki-reviewer` | BLOCKING finding | WP-P1 (WP prefix preserved) |

## Step 4d: Ticket Prefixes

| Prefix | Source |
|--------|--------|
| `RF-P{N}-{NNN}` | Evaluation-derived — from the main session's own `omb-evaluation-refactoring` rubric self-check |
| `CR-P{N}-{NNN}` | Consensus-derived — from this synthesis step |
| `WP-P{N}-{NNN}` | Wiki-consistency — from `@wiki-reviewer` |

Do not use `CP-` or `EP-` prefixes here — those belong to `omb-plan`/`omb-plan-review`.
`RF-`/`CR-` are the canonical refactoring prefixes per
`.claude/rules/workflow/09-ticket-schema.md`.

## Step 4e: Conflict Resolution and the 50/50 Rule

- **Majority position** becomes the recommendation.
- **Minority position** is recorded as a dissenting view with rationale.
- **50/50 split:**
  - In **standalone mode** (`bypass_mode=false`), escalate to the user via
    `AskUserQuestion` — do not auto-resolve.
  - In **pipeline mode** (`bypass_mode=true`), never call `AskUserQuestion`. Pick the
    behavior-safer option (the choice with the smaller behavior-change surface, or, when
    that is ambiguous, the choice that preserves the current architecture over a
    rewrite) and record it as a `concerns:` entry in the output envelope, labelled
    `(b)` — see `.claude/skills/omb-goal/rules/pipeline-contract.md` for the
    disagreement-consensus classification vocabulary this mirrors.

## Step 4f: Synthesis Output

For each of the 9 topics, produce:

```
### Topic {N}: {TOPIC NAME}

**Consensus findings ({count} items):**

| # | Finding | Flagged By | Consensus | Priority | file:line | Goal Impact |
|---|---------|-----------|-----------|----------|-----------|-------------|
| 1 | {finding} | @core-critique, @code-debug | Majority (5/9) | P0 | app/foo.py:88 | {sentence} |
| 2 | {finding} | @code-review | Single voice | P3 | app/bar.py:12 | {sentence} |

**Dissenting views (if any):**
- @{agent} disagrees because: {rationale}
```

This table feeds the `Consensus Findings` section of
`.claude/skills/omb-architect/rules/design-document.md`.
