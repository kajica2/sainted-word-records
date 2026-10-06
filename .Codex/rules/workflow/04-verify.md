---
description: Verification rules for validating implementation correctness
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**"]
---

# Verification Rules

## Verification Order
1. **Automated checks FIRST** — type checker, linter, tests, build
2. **Manual inspection SECOND** — code review, architecture alignment

Never skip automated checks. If they fail, fix before proceeding.

## Automated Checks (must all pass)
- Type check: `mypy` (Python), `tsc --noEmit` (TypeScript)
- Lint: `ruff` (Python), `eslint` (TypeScript)
- Tests: targeted tests for changed behavior; follow `testing/test-execution.md` and do not add a broad development suite
- Build: project must compile/build without errors

## Evidence-Based Reporting
Every finding MUST include:
- **File path and line number**: `src/api/routes.py:42`
- **What was found**: concrete description
- **Severity**: PASS, FAIL, or WARNING
- **How to reproduce**: command or steps

## PASS/FAIL Criteria

### PASS requires ALL of:
- All automated checks pass
- Deliverable matches plan specification
- No unhandled error paths
- Boundary validation present

### FAIL if ANY of:
- Type checker or linter errors
- Test failures
- Missing deliverable
- Security vulnerability detected
- Unvalidated boundary input

## Verification Report Format
```
RESULT: PASS | FAIL
Automated: [pass/fail counts]
Findings:
  - [severity] file:line — description
```

## Next Step

After verification passes, run `omb:doc` when documentation or wiki updates may be required. The release flow is `04-verify -> 05-doc -> 06-create-pr`.
