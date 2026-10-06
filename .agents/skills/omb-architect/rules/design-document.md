# Design Document Template

Cited by `.claude/skills/omb-architect/SKILL.md` Step 5. The design document is written
to `.omb/architect/{date}-{slug}.md`. Use exactly these headings, in this order; omit
`Prior Art` only when `research_mode=false`.

## Heading Set

```markdown
# Architecture Design: {slug}

## Scope Inventory

Summarize the inventory JSON: file count by language, function count, duplicate
clusters, naming violations, package smells. Link the inventory JSON and hotspots
Markdown paths.

## Hotspot Table

Reproduce or link the top hotspots from the inventory's `summary.hotspots` (line-count
descending, path ascending tie-break).

## Consensus Findings

Insert the Step 4f synthesis output verbatim, per
`.claude/skills/omb-architect/rules/consensus.md` — one subsection per analysis topic
that produced at least one finding.

## Measurable Refactoring Goal

State the goal as a single, falsifiable sentence with a concrete before/after metric
(e.g., a line count, a duplicate-cluster count, a coverage percentage) — never a vague
directional statement like "improve maintainability".

## Success Criterion

State the exact command or check that proves the goal was met, and the expected
before/after values for that check.

## Target Architecture

Describe the target module map and package layout. Include:
- Module/package boundaries after the change.
- Design-pattern rationale, citing `.claude/rules/common/design-patterns.md`.
- The utility-extraction list (Topic 8 findings this design acts on).
- The naming-change list (Topic 9 findings this design acts on).

## Migration Order

List the ordered sequence of change units a downstream `omb:plan` should follow,
respecting dependency order (foundational modules before their consumers).

## Behaviour-Preservation Risks

List the top risks that a downstream TDD behavior-preservation plan must cover,
referencing Topic 6 (BEHAVIOR-RISK) findings and any existing test-coverage gaps.

## Prior Art

Conditional section — include only when `research_mode=true`. List the research
results carried forward from Step 2 (at most 3), each with a one-line relevance note.

## Decision Notes

Record non-obvious decisions made during synthesis: 50/50 fallback choices taken in
pipeline mode, dropped best-effort agents, and any deviation from a majority
recommendation with its rationale. This section is the sole decision record this skill
produces — `omb-architect` does not write a separate `.omb/goal/{slug}-decisions.md`
decision log.
```

## Rules

- Every heading above is required verbatim except `Prior Art`, which is conditional.
- Do not add extra top-level headings; put agent-specific detail inside the matching
  section instead.
- Keep code/path/command references literal and copy-pasteable — no shell expansion.
