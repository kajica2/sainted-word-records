# SWR Todo Tracker

## In Progress

| Item | Priority | Status |
|------|----------|--------|

## Backlog

| Item | Priority | Notes |
|------|----------|-------|
| CU-1: Variant caching | P2 | IndexedDB cache for analysis |
| CU-2: Lazy-load variant drawFx | P2 | Reduce initial JS load |
| CU-3: Targeting v2 confidence scoring | P3 | Model upgrade |
| CU-4: Script loading optimization | P3 | 88 → ~45 JS files |
| Clean Engine (CSS transitions) | DONE | 2026-10-10 ec42c9d |

---

## Done

| Item | Date | Commit |
|------|------|--------|
| Early access modal extension | 2026-10-09 | 8caf977 |
| Beta Test Agreement | 2026-10-09 | 8caf977 |
| engine-basic-mode.client.js 404 fix | 2026-10-09 | — |
| versions.html APP_SURFACES fix | 2026-10-09 | — |
| start-team.sh launcher | 2026-10-09 | f6961d6 |
| U2: Remove dead engine-core.client.js | DONE | Already removed |
| U3: Remove duplicate transitions | DONE | Already fixed |
| U4: AGENTS.md fixes | DONE | Already correct |

---

## Quick Commands

```bash
# Start a task (creates worktree)
./tools/worktree.sh start <branch-name>

# Complete task
./tools/worktree.sh done

# List open tasks
grep -E "^\| " .omb/todo.md | grep -v "✓\|DONE\|—"
```
