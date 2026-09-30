---
paths:
  - ".omb/plans/*fix*.md"
  - ".claude/skills/omb-fix/**"
  - ".claude/agents/omb/fix-writer.md"
---

# Fix Plan Section Structure

This is the single source of truth for the 8-section fix plan layout consumed by `omb:fix` Step 3.5 grep gates.

Any edit to section markers or the 7-column table header must be mirrored in:

- `.claude/agents/omb/fix-writer.md`
- `.claude/skills/omb-fix/SKILL.md` Step 3.5 grep checks
- this rule file

The plan MUST follow the standard 8-section structure adapted for bug fixes.

## Section 1: Bug Report and Acceptance Criteria

- 1.1 Bug Summary: one sentence.
- 1.2 Expected vs Actual Behavior.
- 1.3 Scope and Constraints: in-scope fix and out-of-scope items.
- 1.4 Acceptance Criteria must include code-fix criteria, systemic reinforcement criteria, and regression criteria.

## Section 2: Investigation Findings

Use four subsections:

- 2.1 Reproduction Strategy.
- 2.2 Pre-investigation Findings: Source | Finding | File/Location | Confidence.
- 2.3 Failure Path and Root-Cause Hypotheses: Rank | Hypothesis | Confidence | Confirming Evidence | Rejecting Evidence.
- 2.4 Impact Scope and Minimal Patch Boundary: what must change and what must not change.

## Section 3: TODO Checklist

Heading MUST start with `## 3.`.

Each item MUST match this shape so `omb:run` can parse it:

```markdown
- [ ] #1 [CP] {description} -> @{agent} | Skill("{skill}")
- [ ] #2 {description} -> @{agent} | Skill("{skill}")
```

Rules:

- `[CP]` flags critical-path tasks; omit it for non-critical tasks.
- Both `->` and the Unicode arrow variant are accepted.
- `@{agent}` is required.
- `Skill("...")` is optional but recommended.
- Include separate checklist items for code fix, rules fix, wiki update, harness fix, regression test, and doc update when those apply.

## Section 4: Implementation Plan Details

Heading MUST start with `## 4.`.

Each phase MUST include the canonical 7-column task table:

```markdown
### Phase 1: {phase title}

Goal: {phase goal}

| # | Task | Agent | Skill | MCP Tool | Dependencies | Deliverable |
|---|------|-------|-------|----------|--------------|-------------|
| 1 | {task} | @{agent} | Skill("{skill}") | {MCP tool or -} | - | {file/artifact} |

Implementation notes:
- {implementation notes}
```

Rules:

- The `#` column values MUST cross-reference Section 3 task numbers.
- Use `-` when a column has no value.

## Domain Mapping

- Code fix: `@{domain}-implement` via `Skill("omb-orch-{domain}")`.
- Rules prose: `@doc-writer`.
- Rules frontmatter, schema, or hook behavior: `@harness-implement` via `Skill("omb-orch-harness")`.
- Wiki: `Skill("omb-wiki")` through the main-host official lifecycle.
- Harness: `@harness-implement` via `Skill("omb-orch-harness")`.
- Docs: `@doc-writer`.

## Section 5: Architecture Diagram

Optional. Include when three or more components interact.

## Section 6: TDD Verification Plan

- Reproduction test proving the bug exists before the fix.
- Fix test proving the bug is resolved.
- Regression tests proving existing functionality is unchanged.
- Reinforcement tests for lint rules, hooks, or documentation gates when those are part of the fix.

## Section 7: Documentation Update Plan

Split into:

- 7.1 `docs/`
- 7.2 `openwiki/`
- 7.3 `.claude/rules/`
- 7.4 `.claude/` harness artifacts

## Section 8: Risks, Assumptions, and Rollback

- Risk table: Risk | Probability | Impact | Mitigation.
- Unverified assumptions.
- Rollback strategy if the fix causes a regression.
