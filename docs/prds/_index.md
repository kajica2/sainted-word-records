# Sainted Word Records — Hermes PRDs
## Product Requirements Document Suite
### For: AI-assisted implementation (Hermes/Codex/Cursor)
### Version: 1.0 · September 2026
### Author: Creative Technology Director
### Repository: https://github.com/kajica2/sainted-word-records

---


## PRDs in this directory

- **PRD-001** — see [PRD-001.md](./PRD-001.md)
- **PRD-002** — see [PRD-002.md](./PRD-002.md)
- **PRD-003** — see [PRD-003.md](./PRD-003.md)
- **PRD-004** — see [PRD-004.md](./PRD-004.md)
- **PRD-005** — see [PRD-005.md](./PRD-005.md)
- **PRD-006** — see [PRD-006.md](./PRD-006.md)
- **PRD-007** — see [PRD-007.md](./PRD-007.md)
- **PRD-008** — see [PRD-008.md](./PRD-008.md)
- **PRD-009** — see [PRD-009.md](./PRD-009.md)
- **PRD-010** — see [PRD-010.md](./PRD-010.md)
- **PRD-011** — see [PRD-011.md](./PRD-011.md)
- **PRD-012** — see [PRD-012.md](./PRD-012.md)
- **PRD-013** — see [PRD-013.md](./PRD-013.md)
- **PRD-014** — see [PRD-014.md](./PRD-014.md)
- **PRD-015** — see [PRD-015.md](./PRD-015.md)
- **PRD-016** — see [PRD-016.md](./PRD-016.md)
- **PRD-017** — see [PRD-017.md](./PRD-017.md)
- **PRD-018** — see [PRD-018.md](./PRD-018.md)
- **PRD-019** — see [PRD-019.md](./PRD-019.md)
- **PRD-020** — see [PRD-020.md](./PRD-020.md)
- **PRD-021** — see [PRD-021.md](./PRD-021.md)

Each PRD is self-contained and may be implemented independently. The numbering reflects rough priority order (engine features in PRDs 002-011, platform UI in PRDs 012-021).

## Audits

PRDs are written without codebase context. Before implementing, check whether the PRD's premise matches reality:

- **[PRD-002-AUDIT.md](./PRD-002-AUDIT.md)** — PRD-002 ("fix the stylesheet") is based on a wrong assumption. The actual stylesheets load fine; the proposed `setCanvasFormat` would conflict with `SWR_RENDER.fit()`; the proposed dark theme variables duplicate what's already in `swr-app.html`. **No work needed.**
- **[PRD-AUDIT.md](./PRD-AUDIT.md)** — comprehensive audit of all 21 PRDs in tabular form. Per-PRD verdict (Done / Re-spec / Skip / Conflict) with status notes and effort estimates. Suggested execution order: 003 → 010 → 005 → 009 → 006 → 011 → 008 (the re-spec queue).

More audits pending as PRDs are reviewed.
