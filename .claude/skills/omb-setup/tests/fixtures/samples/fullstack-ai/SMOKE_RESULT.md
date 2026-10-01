# fullstack-ai Sample Smoke Test Results

**File under test**: `expected-CLAUDE.md`
**Date run**: 2026-04-18
**Template**: fullstack-ai (LangGraph AI)
**Overall result**: ALL PASS

## Static Checks

### CHECK 1 — Line count

```
wc -l expected-CLAUDE.md
```

| Threshold | Measured | Result |
|-----------|----------|--------|
| ≤ 120 preferred | 68 | PASS (preferred) |
| ≤ 150 required | 68 | PASS |

### CHECK 2 — No legacy auto-generation markers (must = 0)

```
grep -c "AUTO-GENERATED" expected-CLAUDE.md
```

**Result**: 0 — PASS

Legacy `<!-- AUTO-GENERATED -->` markers removed 2026-04-18 — see reference.md §5.4.

### CHECK 3 — Unresolved placeholders (must return 0 matches)

```
grep "{{" expected-CLAUDE.md
```

**Result**: 0 matches — PASS

### CHECK 4 — Forbidden section names (must = 0)

```
grep -cE "omb Commands|Worktree Management|\.omb/ Directory|Testing Strategy|Commit Conventions|Error Handling|Quality Gates" expected-CLAUDE.md
```

**Result**: 0 — PASS

### CHECK 5 — HARD rule lines (must be ≥ 5)

```
grep -c "^- \[HARD\]" expected-CLAUDE.md
```

**Result**: 8 — PASS

Breakdown: 6 Universal + 2 Project-specific

### CHECK 6 — OMB_DOCUMENTATION_LANGUAGE (must = 1)

```
grep "OMB_DOCUMENTATION_LANGUAGE" expected-CLAUDE.md
```

**Result**: 1 — PASS

### CHECK 7 — Reference Index git rules row (must be ≥ 1)

```
grep -c "\.claude/rules/git/" expected-CLAUDE.md
```

**Result**: 1 — PASS

### CHECK 8 — Coding Principles block (must be ≥ 1 heading + all 4 mantras)

```
grep -c "Coding Principles" expected-CLAUDE.md
grep -c "Think Before Coding\|Simplicity First\|Surgical Changes\|Goal-Driven Execution" expected-CLAUDE.md
```

**Result**: 1 heading match, 4 mantra matches — PASS

## Summary

| # | Check | Command | Expected | Actual | Status |
|---|-------|---------|----------|--------|--------|
| 1 | Line count | `wc -l` | ≤ 150 | 68 | PASS |
| 2 | No legacy markers | `grep -c "AUTO-GENERATED"` | = 0 | 0 | PASS |
| 3 | No `{{` placeholders | `grep "{{"` | 0 matches | 0 | PASS |
| 4 | No forbidden sections | `grep -cE "..."` | = 0 | 0 | PASS |
| 5 | `- [HARD]` lines | `grep -c "^- \[HARD\]"` | ≥ 5 | 8 | PASS |
| 6 | OMB_DOCUMENTATION_LANGUAGE | `grep "OMB_DOCUMENTATION_LANGUAGE"` | = 1 | 1 | PASS |
| 7 | git rules row | `grep "\.claude/rules/git/"` | ≥ 1 | 1 | PASS |
| 8 | Coding Principles block | `grep -c "Coding Principles"` + 4 mantras | ≥ 1, = 4 | 1, 4 | PASS |

## Notes

- Template: `fullstack-ai` (LangGraph AI stack family)
- HOW commands sourced from root `package.json` Turbo scripts
- Extra slot row: `LangGraph dev` / `cd apps/ai && langgraph dev` from `answers.json`
- 2 project-specific HARD rules + 6 Universal (incl. diff-targeted testing) bring total to 8 (≥ 5 threshold met with margin)
- WHAT bullets reflect 3-app monorepo structure: `apps/api/src/`, `apps/ai/src/`, `apps/web/src/`
- Reference Index: 5 rows (Language / Workflow / Git / Tools / Coding Principles) — Wiki/Architecture/Local override rows omitted
  because `docs/wiki/index.md`, `docs/architecture/`, and `CLAUDE.local.md` do not
  exist in this fixture directory
- Legacy AUTO-GENERATED markers removed 2026-04-18; UPDATE mode uses header-based anchoring
- Coding Principles block added 2026-04-20 — 10 lines (+9 block, +1 ref row); line count 71 → 81
- Diff-targeted testing HARD rule added 2026-08-31 to the Universal list; line count 67 → 68,
  HARD rule count 7 → 8
