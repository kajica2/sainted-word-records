---
description: "Output Contract"
paths: ["**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", ".omb/**", ".claude/**"]
---

# Output Contract

Every sub-agent MUST end its response with a `<omb>` status tag followed by a result envelope.

## Canonical Status Set (HARD)

There are exactly **3** canonical `<omb>` values:

```
<omb>DONE</omb>   <omb>RETRY</omb>   <omb>BLOCKED</omb>
```

Any other value blocks execution (exit 2). This is enforced by `src/hook/lifecycle/status_router.py`.

- **[HARD] Only `DONE | RETRY | BLOCKED` are valid `<omb>` values.** Derivatives (`DONE-WITH-CONCERNS`, `PARTIAL`, `SUCCESS`, `FAILED`, `COMPLETE`, `APPROVED`, `REJECTED`, etc.) are forbidden and will be blocked by the hook.
- **[HARD] Comparison is case-sensitive.** Lowercase or mixed-case variants (`done`, `Done`, `Blocked`) also block.

## Status Tags

| Status | Meaning | Hook action |
|--------|---------|-------------|
| `<omb>DONE</omb>` | Task completed, proceed | exit 0 |
| `<omb>RETRY</omb>` | Task failed, retry possible | exit 0 + stderr warning |
| `<omb>BLOCKED</omb>` | Cannot proceed, needs human | exit 2 (block) |
| Any other value | — | **exit 2 (block) + stderr** |

## Envelope Format

```
<omb>DONE</omb>

```result
verdict: <closed-set value per agent type — see Verdict Field>
summary: <1-3 sentence summary of what was done>
artifacts:
  - <key output paths or identifiers>
changed_files:
  - <files modified, empty list for read-only agents>
concerns:
  - <concerns if any, empty list if none>
blockers:
  - <blocking issues, empty list if none>
retryable: true | false
next_step_hint: <suggested next action>
```

## Verdict Field

The `verdict:` field is a **closed set per agent type**. It is advisory only — the `<omb>` tag carries the orchestration signal.

| Agent Type | Allowed `verdict:` values |
|------------|---------------------------|
| critique, review | `APPROVE` \| `REJECT` |
| verify, audit | `PASS` \| `FAIL` |
| All others (explore, design, implement, orchestrator, utility) | **field MUST be omitted** |

Forbidden: `CONDITIONAL_PASS`, past-tense forms (`APPROVED`, `REJECTED`), free-form labels, and `BLOCKED` as a verdict (the omb-tag already carries the block signal).

## Plan-Review Vocabulary (report-local)

The plan-review vocabulary in `.claude/rules/workflow/02-review-plan.md` (`PASS | CONDITIONAL PASS | FAIL | PLATEAU`, `APPROVED | BLOCKED | NEEDS-REVISION`, `BLOCKING | WARNING | NOTE`) is **report-local** and MUST NOT appear inside `<omb>` tags or `verdict:` envelope fields.

## Rules

- The `<omb>` tag + envelope MUST be the final block in your response.
- Use ONLY the 3 allowed status values: `DONE`, `RETRY`, `BLOCKED`.
- `concerns:` non-empty = completed with caveats (orchestrator proceeds but logs them).
- `retryable: true` means the orchestrator may re-run this agent with adjustments.
- `next_step_hint` helps the orchestrator decide what to spawn next.
- `changed_files` MUST be empty for read-only agents (design, critique, verify, explore).
- `artifacts` should list concrete outputs: file paths, endpoint names, schema names.
