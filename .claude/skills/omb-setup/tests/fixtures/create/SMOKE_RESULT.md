# CREATE Smoke Test Results

**File under test**: `expected-CLAUDE.md`
**Date run**: 2026-04-18
**Overall result**: ALL PASS

## Static Checks

### CHECK 1 — Line count

```
wc -l expected-CLAUDE.md
```

| Threshold | Measured | Result |
|-----------|----------|--------|
| ≤ 120 preferred | 80 | PASS (preferred) |
| ≤ 150 required | 80 | PASS |

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

**Result**: 6 — PASS

Breakdown: 5 Universal + 1 Project-specific

### CHECK 6 — OMB_DOCUMENTATION_LANGUAGE (must = 1)

```
grep "OMB_DOCUMENTATION_LANGUAGE" expected-CLAUDE.md
```

**Result**: 1 — PASS

Found in the 5th Universal HARD rule:
`Write user-facing documents ... in the language set by \`OMB_DOCUMENTATION_LANGUAGE\` (default \`en\`)`

### CHECK 7 — Reference Index git rules row (must be ≥ 1)

```
grep -c "\.claude/rules/git/" expected-CLAUDE.md
```

**Result**: 1 — PASS

Row present: `| Git & commit/branch rules | \`.claude/rules/git/\` |`

### CHECK 8 — Coding Principles block (must be ≥ 1 heading + all 4 mantras)

```
grep -c "Coding Principles" expected-CLAUDE.md
grep -c "Think Before Coding\|Simplicity First\|Surgical Changes\|Goal-Driven Execution" expected-CLAUDE.md
```

**Result**: 1 heading match, 4 mantra matches — PASS

## Summary

| # | Check | Command | Expected | Actual | Status |
|---|-------|---------|----------|--------|--------|
| 1 | Line count | `wc -l` | ≤ 150 | 80 | PASS |
| 2 | No legacy markers | `grep -c "AUTO-GENERATED"` | = 0 | 0 | PASS |
| 3 | No `{{` placeholders | `grep "{{"` | 0 matches | 0 | PASS |
| 4 | No forbidden sections | `grep -cE "..."` | = 0 | 0 | PASS |
| 5 | `- [HARD]` lines | `grep -c "^- \[HARD\]"` | ≥ 5 | 6 | PASS |
| 6 | OMB_DOCUMENTATION_LANGUAGE | `grep "OMB_DOCUMENTATION_LANGUAGE"` | = 1 | 1 | PASS |
| 7 | git rules row | `grep "\.claude/rules/git/"` | ≥ 1 | 1 | PASS |
| 8 | Coding Principles block | `grep -c "Coding Principles"` + 4 mantras | ≥ 1, = 4 | 1, 4 | PASS |

## Notes

- Reference Index contains 5 rows (Language / Workflow / Git / Tools / Coding Principles).
  Wiki, Architecture, and Local override rows are intentionally absent because
  `docs/wiki/index.md`, `docs/architecture/`, and `CLAUDE.local.md` do not exist in this fixture directory.
  This matches the schema policy: conditional rows emitted only when paths exist at generation time.
- Legacy `<!-- AUTO-GENERATED -->` markers (5 plain + 1 START/END pair) were removed 2026-04-18.
  The new UPDATE mode anchors on header lines (see reference.md §5.3) instead of HTML comment markers.
- Coding Principles block added 2026-04-20 — 10 lines (+9 block, +1 ref row); line count 70 → 80.
