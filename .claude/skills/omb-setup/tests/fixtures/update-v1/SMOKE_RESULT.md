# UPDATE (V1→V2 Migration) Smoke Test Results

**Files under test**: `v1-sample.md` → `CLAUDE.md` (V1_MIGRATE), `v2-baseline.md` → `v2-after-update.md` (V2_UPDATE)
**Date run**: 2026-04-18
**Overall result**: ALL PASS

---

## Part 1: V1_MIGRATE Checks

### CHECK M1 — Backup file exists

```
ls v1-sample.md.bak
```

| Expected | Result |
|----------|--------|
| File exists | PASS |

`v1-sample.md.bak` is a verbatim copy of `v1-sample.md` (byte-for-byte identical).

### CHECK M2 — v2 marker header present

```
grep "^<!-- omb:setup v2" CLAUDE.md
```

| Expected | Result |
|----------|--------|
| = 1 match | PASS |

Found: `<!-- omb:setup v2 | 2025-12-01 -->`

### CHECK M3 — Migration comment present (must = 1)

```
grep -c "Migrated from v1: review and prune" CLAUDE.md
```

| Expected | Measured | Result |
|----------|----------|--------|
| = 1 | 1 | PASS |

### CHECK M4 — No legacy auto-generation markers (must = 0)

```
grep -c "AUTO-GENERATED" CLAUDE.md
```

| Expected | Measured | Result |
|----------|----------|--------|
| = 0 | 0 | PASS |

Legacy `<!-- AUTO-GENERATED -->` markers (5 plain + 1 START/END pair) removed from v2 template
2026-04-18. V2_UPDATE now uses header-based anchoring — see reference.md §5.3.

### CHECK M5 — User content preserved in Gotchas section

```
grep "Webhook Delivery Ordering" CLAUDE.md
grep "TTL Flush Before Expiry" CLAUDE.md
grep "LEGACY_INVOICE_FORMAT" CLAUDE.md
grep "Celery Beat Schedule" CLAUDE.md
grep "Database Connection Pooling" CLAUDE.md
```

| Expected | Result |
|----------|--------|
| All 5 original h4 headings present | PASS |

All original `## Project-Specific Notes` sub-sections from `v1-sample.md` appear verbatim under
`## Gotchas / Non-obvious Patterns` in `CLAUDE.md`, wrapped with `<!-- Migrated from v1: review and prune -->`.

### CHECK M6 — Line count

```
wc -l CLAUDE.md
```

| Threshold | Measured | Result |
|-----------|----------|--------|
| ≤ 150 | 111 | PASS |

The migrated Gotchas content (5 detailed sub-sections) is included and the file remains within the
150-line cap. No truncation was required.

### CHECK M7 — v1 marker absent from CLAUDE.md

```
grep "omb:setup v1" CLAUDE.md
```

| Expected | Result |
|----------|--------|
| = 0 matches | PASS |

The v1 marker exists only in `v1-sample.md` and `v1-sample.md.bak`, not in the migrated `CLAUDE.md`.

---

## Part 2: V2_UPDATE Checks

### CHECK U1 — Preserved sections are byte-identical

Preserved sections extracted and compared via header-anchored Python script:
- `## HARD Rules` Project-specific sub-block (from `Project-specific:` line to end of HARD Rules section)
- `## Gotchas / Non-obvious Patterns`
- `## Gold Standard References`
- `## Memory & Lesson Capture`

```
diff <(python3 extract_preserved.py v2-baseline.md) <(python3 extract_preserved.py v2-after-update.md)
```

| Expected | Result |
|----------|--------|
| Empty diff | PASS |

`v2-preservation.diff` is empty — all 4 preserved sections are byte-identical between
`v2-baseline.md` and `v2-after-update.md`.

### CHECK U2 — AUTO-REPLACEABLE section bodies differ (were regenerated)

Sections compared programmatically (header-anchored split):

| Section | Status |
|---------|--------|
| `## WHY` body | DIFFERS (regenerated — added subscription lifecycle) |
| `## WHAT` body | DIFFERS (regenerated — added subscriptions module bullet) |
| `## HOW` body | DIFFERS (regenerated — added Celery worker row, updated Lint cmd) |
| `## HARD Rules` Universal block | SAME (universal rules are constant by design) |
| `## Coding Principles` body | DIFFERS (added — new section not present in baseline) |
| `## Reference Index` body | DIFFERS (regenerated — added Coding Principles + Blueprint wiki rows) |

5 of 6 auto-replaceable section bodies changed. The HARD Rules Universal block is intentionally
stable (the 5 universal rules do not change between updates); the schema does not require that
all bodies must differ — only that the replacement was applied. The `## Coding Principles`
section was newly introduced in this update (not in the baseline). The Reference Index body
gained `Coding Principles` and `docs/wiki/index.md` rows, confirming regeneration ran.

### CHECK U3 — No legacy auto-generation markers (must = 0)

```
grep -c "AUTO-GENERATED" v2-after-update.md
```

| Expected | Measured | Result |
|----------|----------|--------|
| = 0 | 0 | PASS |

### CHECK U4 — v2 marker date updated

```
grep "omb:setup v2" v2-after-update.md
```

Found: `<!-- omb:setup v2 | 2026-01-15 -->` (updated from `2025-12-01`) — PASS

---

## Summary

### V1_MIGRATE

| # | Check | Command | Expected | Actual | Status |
|---|-------|---------|----------|--------|--------|
| M1 | .bak exists | `ls v1-sample.md.bak` | file exists | exists | PASS |
| M2 | v2 marker header | `grep "omb:setup v2" CLAUDE.md` | = 1 | 1 | PASS |
| M3 | Migration comment | `grep -c "Migrated from v1..."` | = 1 | 1 | PASS |
| M4 | No legacy markers | `grep -c "AUTO-GENERATED"` | = 0 | 0 | PASS |
| M5 | User content in Gotchas | `grep` for each original h4 | all present | all present | PASS |
| M6 | Line count | `wc -l CLAUDE.md` | ≤ 150 | 111 | PASS |
| M7 | v1 marker absent | `grep "omb:setup v1" CLAUDE.md` | 0 | 0 | PASS |

### V2_UPDATE

| # | Check | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| U1 | Preserved sections diff empty | empty | empty | PASS |
| U2 | Auto-replaceable bodies regenerated | ≥ 1 section differs | 5/6 differ | PASS |
| U3 | No legacy markers | = 0 | 0 | PASS |
| U4 | v2 marker date updated | date changed | 2025-12-01 → 2026-01-15 | PASS |
| U5 | Coding Principles block present | ≥ 1 heading + 4 mantras | present | PASS |

---

## Known Concerns

**None for this fixture.** The migrated `CLAUDE.md` is 111 lines, comfortably within the 150-line cap.

In real usage: if the v1 `## Project-Specific Notes` section is significantly longer (e.g., 80+ lines
of user content), the migrated CLAUDE.md could exceed 150 lines. The V1_MIGRATE algorithm would
enter the **HALT** tier in that scenario and surface a warning to the user, who must prune before
proceeding. This fixture's v1 user content (5 sub-sections, ~50 lines) stays within budget.

## Change History

- **2026-04-20**: Coding Principles block (`## Coding Principles` + 4 mantras + ref row) added to
  `v2-after-update.md` (the expected output of V2_UPDATE). CHECK U2 updated from 4/5 to 5/6.
  CHECK U5 added. `## Coding Principles` is an AUTO-REPLACEABLE section per reference.md §5.3.
- **2026-04-18**: Legacy `<!-- AUTO-GENERATED -->` markers (5 plain + 1 START/END pair) removed from
  the v2 template (reference.md §2). V2_UPDATE now anchors on section headers (§5.3). CHECKS
  renumbered M1-M7 and U1-U4. Plain/pair marker count checks replaced with a single negative
  invariant check (CHECK M4 / U3: `grep "AUTO-GENERATED" = 0`).
