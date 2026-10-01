# v1-rubric Archive

## Version Tag

`v1-rubric pre-57-item-extension baseline`

## Date

2026-04-20

## Contents

This directory is a verbatim snapshot of the `omb-prompt-evaluation` rubric files taken
before the 57-item extension (T10 and later tasks in the prompt-guide-4-7-optimization plan).

| File | Source |
|------|--------|
| `REFERENCE.md` | `.claude/skills/omb-prompt-evaluation/SKILL.md` |
| `calibration-anchors.md` | `.claude/skills/omb-prompt-evaluation/rules/calibration-anchors.md` |
| `eval-clarity.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-clarity.md` |
| `eval-claude-code.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-claude-code.md` |
| `eval-context-eng.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-context-eng.md` |
| `eval-context.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-context.md` |
| `eval-examples.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-examples.md` |
| `eval-output.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-output.md` |
| `eval-reasoning.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-reasoning.md` |
| `eval-role.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-role.md` |
| `eval-safety.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-safety.md` |
| `eval-structure.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-structure.md` |
| `eval-tool.md` | `.claude/skills/omb-prompt-evaluation/rules/eval-tool.md` |

The archived skill body is named `REFERENCE.md` so skill discovery does not
activate the historical rubric. Its contents remain unchanged.

## Restore Procedure

### Git-level revert

If the feature branch has not yet been merged:

```bash
# Revert a specific file to this archived version
git show HEAD~N:.claude/skills/omb-prompt-evaluation/SKILL.md > .claude/skills/omb-prompt-evaluation/SKILL.md
# Replace HEAD~N with the commit hash captured before T10 began (see git log)
```

If the branch has already been merged, revert the commits that introduced the rubric extension:

```bash
git revert <commit-hash-range>
```

### File-level copy-back

Copy all archived files back to their canonical locations:

```bash
ARCHIVE=".claude/skills/omb-prompt-evaluation/archive/v1-rubric"
RULES=".claude/skills/omb-prompt-evaluation/rules"

cp "${ARCHIVE}/REFERENCE.md" ".claude/skills/omb-prompt-evaluation/SKILL.md"
cp "${ARCHIVE}/calibration-anchors.md" "${RULES}/calibration-anchors.md"
cp "${ARCHIVE}/eval-clarity.md"       "${RULES}/eval-clarity.md"
cp "${ARCHIVE}/eval-claude-code.md"   "${RULES}/eval-claude-code.md"
cp "${ARCHIVE}/eval-context-eng.md"   "${RULES}/eval-context-eng.md"
cp "${ARCHIVE}/eval-context.md"       "${RULES}/eval-context.md"
cp "${ARCHIVE}/eval-examples.md"      "${RULES}/eval-examples.md"
cp "${ARCHIVE}/eval-output.md"        "${RULES}/eval-output.md"
cp "${ARCHIVE}/eval-reasoning.md"     "${RULES}/eval-reasoning.md"
cp "${ARCHIVE}/eval-role.md"          "${RULES}/eval-role.md"
cp "${ARCHIVE}/eval-safety.md"        "${RULES}/eval-safety.md"
cp "${ARCHIVE}/eval-structure.md"     "${RULES}/eval-structure.md"
cp "${ARCHIVE}/eval-tool.md"          "${RULES}/eval-tool.md"
```

## When to Restore

Restore this baseline if any of the following conditions occur:

1. **V4 calibration breach** — 2 or more calibration anchors fail to reproduce expected scores
   after 2 full calibration iterations with the extended rubric.
2. **V5b unexpected BLOCKING** — the `omb-prompt-review` skill enters `BLOCKED` state
   unexpectedly on prompts that previously completed without blockers.
3. **V6 fixture matrix instability** — the fixture matrix (T14-T15) is unstable after 2
   iteration attempts (scores vary >5 points across identical runs).
4. **Post-merge real-prompt drift** — production prompt scores drift more than 10% from
   pre-extension baseline after merge to main.

In all cases: restore files, re-run calibration, document the failure, and open a new plan
task to investigate the root cause before re-attempting the extension.

## Retention

Keep this archive for **2 releases** from the release that ships the 57-item extension.
After 2 releases without a regression, this directory may be deleted.
