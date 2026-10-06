# UPDATE (V1→V2 Migration + V2 Preservation) Smoke Fixture

## Purpose

This fixture directory contains inputs and expected outputs for two smoke tests of the
`omb-setup` v2 CLAUDE.md generator:

1. **V1_MIGRATE** — migration from v1-style CLAUDE.md to the v2 schema (Section 5.2 of reference.md)
2. **V2_UPDATE** — v2-to-v2 regeneration preserving all user-editable sections (Section 5.3 of reference.md, header-anchored)

The migrations were simulated manually following the pseudocode in `reference.md` Sections 5.2 and 5.3.

---

## Files

| File | Description |
|------|-------------|
| `v1-sample.md` | Input: v1-style CLAUDE.md (151 lines) with v1 marker and real user content |
| `v1-sample.md.bak` | Step 1 output: verbatim copy of `v1-sample.md` (V1_MIGRATE backup step) |
| `CLAUDE.md` | Step 3–4 output: freshly written v2 CLAUDE.md with migrated Gotchas (111 lines) |
| `v2-baseline.md` | Input: clean v2 CLAUDE.md with non-trivial content in all 4 preserved sections |
| `v2-after-update.md` | V2_UPDATE output: regenerated auto-replaceable sections, preserved sections untouched |
| `v2-preservation.diff` | Empty diff confirming preserved sections are byte-identical across the V2_UPDATE |
| `SMOKE_RESULT.md` | Pass/fail log with all check results and evidence |
| `README.md` | This file |

---

## V1_MIGRATE Invocation Flow

Follows `reference.md` Section 5.2 (5-step pseudocode):

```
Step 1: cp v1-sample.md v1-sample.md.bak
         (verbatim backup before any mutation)

Step 2: Collect user content from v1 sections:
         - Full body of "## Project-Specific Notes" section
         - (Other removed sections had no user-added paragraphs)
         → migration_scratch = verbatim text of all 5 sub-sections

Step 3: Write fresh v2 template (CLAUDE.md) from scratch via CREATE-mode generator:
         - v2 marker header: <!-- omb:setup v2 | 2025-12-01 -->
         - AGENTS.md bridge block at top
         - All 8 standard v2 sections (WHY / WHAT / HOW / HARD Rules /
           Gotchas / Gold Standard References / Reference Index / Memory & Lesson Capture)

Step 4: Append migration_scratch into "## Gotchas / Non-obvious Patterns"
         under the line: <!-- Migrated from v1: review and prune -->

Step 5: Leave Project-specific sub-block in HARD Rules empty
         (user populates in next setup phase or manually)
```

### What was in `## Project-Specific Notes` (v1 user content migrated)

Five sub-sections covering:
- **Webhook Delivery Ordering** — Redis distributed lock requirement (incident-42)
- **TTL Flush Before Expiry** — 60-second preemptive token refresh rule
- **Feature Flag: LEGACY_INVOICE_FORMAT** — deprecated flag, do not remove until PAYM-881
- **Celery Beat Schedule** — task registration in `src/worker/schedules.py`
- **Database Connection Pooling** — separate `DATABASE_WORKER_URL` for Celery workers

These appear verbatim under `### Project-Specific Notes (migrated)` in `CLAUDE.md`.

---

## V2_UPDATE Invocation Flow

Follows `reference.md` Section 5.3 header-anchored pseudocode:

```
Input: v2-baseline.md (v2 marker, 4 preserved sections with real content)

Step 1: Split input file by lines starting with "## " (section headers)

Step 2: For each AUTO-REPLACEABLE header
        (## WHY / ## WHAT / ## HOW / ## Reference Index (progressive disclosure)):
         Replace body from the header line to the line before the next "## " header
         with freshly generated content from the CREATE-mode template
         → WHY: updated to include subscription lifecycle management (v2 feature)
         → WHAT: updated to add subscriptions module bullet
         → HOW: updated to add Celery worker row, tighten Lint command
         → Reference Index: updated to add docs/wiki/index.md row

Step 3: For ## HARD Rules:
         Replace ONLY the block under "Universal (positive form):" sub-header.
         Stop at the line prefix-matching "Project-specific:" — preserve from there onward verbatim.
         (Universal rules are constant; SAME content is expected and correct.)

Step 4: Skip during replacement (preserved sections, never touched):
         → ## Gotchas / Non-obvious Patterns (preserved verbatim)
         → ## Gold Standard References (preserved verbatim)
         → ## Memory & Lesson Capture (preserved verbatim)

Step 5: Update v2 marker date to 2026-01-15

Output: v2-after-update.md
```

### Regenerated vs Preserved Sections

| Section | V2_UPDATE Action | Rationale |
|---------|-----------------|-----------|
| `## WHY` | REGENERATED | New feature (subscriptions) changed project description |
| `## WHAT` | REGENERATED | New module listed in directory map |
| `## HOW` | REGENERATED | New command row added (Celery worker) |
| `## HARD Rules` Universal block | REGENERATED (same content) | Universal rules are constant — applying the template produces identical text |
| `## Reference Index` | REGENERATED | docs/wiki/index.md now exists → conditional row added |
| `## HARD Rules` Project-specific | PRESERVED | User-managed sub-block |
| `## Gotchas / Non-obvious Patterns` | PRESERVED | User-editable section |
| `## Gold Standard References` | PRESERVED | User-editable section |
| `## Memory & Lesson Capture` | PRESERVED | User-editable section |

### Preservation Verification

`v2-preservation.diff` is produced by extracting the 4 preserved sections from both
`v2-baseline.md` and `v2-after-update.md` (using header-anchored extraction) and running `diff`.
An empty file confirms byte-identical preservation.

To reproduce:

```bash
python3 - <<'PYEOF'
import re, sys

def extract_preserved(path):
    with open(path) as f:
        content = f.read()
    # HARD Rules Project-specific: from "Project-specific:" to the next "## " header
    proj = re.search(r'(Project-specific:.*?)(?=\n## )', content, re.DOTALL)
    # Each preserved section: from its "## " header to the next "## " header (or EOF)
    gotchas = re.search(r'(## Gotchas.*?)(?=\n## )', content, re.DOTALL)
    gold = re.search(r'(## Gold Standard.*?)(?=\n## )', content, re.DOTALL)
    memory = re.search(r'(## Memory & Lesson Capture\n.*?)$', content, re.DOTALL)
    return "\n\n".join([
        proj.group(1) if proj else "",
        gotchas.group(1) if gotchas else "",
        gold.group(1) if gold else "",
        memory.group(1) if memory else "",
    ])

base = extract_preserved("v2-baseline.md")
updated = extract_preserved("v2-after-update.md")
if base == updated:
    print("PASS: preserved sections are byte-identical")
else:
    print("FAIL: preserved sections differ")
    sys.exit(1)
PYEOF
```

---

## Invariants Verified (see SMOKE_RESULT.md for details)

### V1_MIGRATE
- `v1-sample.md.bak` exists and is a verbatim copy of `v1-sample.md`
- `CLAUDE.md` contains `<!-- omb:setup v2 | ... -->` (v2 marker)
- `grep -c "Migrated from v1: review and prune" CLAUDE.md` = 1
- `grep -c "AUTO-GENERATED" CLAUDE.md` = 0 (legacy markers removed 2026-04-18)
- All original Project-Specific Notes sub-sections present in Gotchas
- `wc -l CLAUDE.md` = 111 (≤ 150)

### V2_UPDATE
- `diff` of preserved sections = empty (`v2-preservation.diff` is an empty file)
- At least 1 auto-replaceable section body differs between baseline and after-update
- `grep -c "AUTO-GENERATED" v2-after-update.md` = 0 (legacy markers removed 2026-04-18)

---

## Change History

- **2026-04-18**: Legacy `<!-- AUTO-GENERATED -->` markers (5 plain + 1 START/END pair) removed from
  the v2 template (reference.md §2). V2_UPDATE now anchors on section headers (`## ` lines) instead
  of HTML comment markers. The extraction script was rewritten to use header-based anchoring.
