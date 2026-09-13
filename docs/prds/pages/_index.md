# Platform Pages — Implementation Specs

These 10 platform pages are the detailed implementation specs for
the post-login surfaces. They expand on PRDs 012-021 in the parent
PRD suite (../PRD-012..021.md) with HTML/CSS mockups, data models,
and acceptance criteria.

**Architectural note**: Most of these pages require multi-user state
(multi-user auth, project storage, billing, analytics). The repo's
core principle is "zero backend" (PRD-001 §1.3). Implementing these
pages as-is requires deciding between (a) building a backend, (b)
reducing scope to single-user IndexedDB-only versions, or (c) skipping.

See [../PRD-002-AUDIT.md](../PRD-002-AUDIT.md) for the pattern: PRDs
written without codebase context often need re-spec before implementation.

## Pages

- **PAGE-001** — DASHBOARD.md — see [./PAGE-001-DASHBOARD.md](./PAGE-001-DASHBOARD.md)
- **PAGE-002** — ASSET-MANAGER.md — see [./PAGE-002-ASSET-MANAGER.md](./PAGE-002-ASSET-MANAGER.md)
- **PAGE-003** — CLIENT-WORKSPACE.md — see [./PAGE-003-CLIENT-WORKSPACE.md](./PAGE-003-CLIENT-WORKSPACE.md)
- **PAGE-004** — CAMPAIGN-PLANNER.md — see [./PAGE-004-CAMPAIGN-PLANNER.md](./PAGE-004-CAMPAIGN-PLANNER.md)
- **PAGE-005** — LIVE-CONTROL-ROOM.md — see [./PAGE-005-LIVE-CONTROL-ROOM.md](./PAGE-005-LIVE-CONTROL-ROOM.md)
- **PAGE-006** — MARKETPLACE.md — see [./PAGE-006-MARKETPLACE.md](./PAGE-006-MARKETPLACE.md)
- **PAGE-007** — ANALYTICS.md — see [./PAGE-007-ANALYTICS.md](./PAGE-007-ANALYTICS.md)
- **PAGE-008** — BILLING.md — see [./PAGE-008-BILLING.md](./PAGE-008-BILLING.md)
- **PAGE-009** — SETTINGS.md — see [./PAGE-009-SETTINGS.md](./PAGE-009-SETTINGS.md)
- **PAGE-010** — HELP-LEARN.md — see [./PAGE-010-HELP-LEARN.md](./PAGE-010-HELP-LEARN.md)

## Hermes prompt template

The closing of swr-pages-md.md includes a Hermes prompt template
that references these pages. It assumes:
- A /shared/styles/tokens.css file (doesn't exist)
- A /shared/styles/components.css file (doesn't exist)
- A /app route with stylesheet issues (doesn't exist — see PRD-002 audit)

Before pasting this template to a coding agent, update those
references to match the actual codebase (swr-app.html, engine.html,
versions/*.html are the existing surfaces).
