---
description: Documentation workflow rules after verification and before PR creation
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**"]
---

# Documentation Workflow Rules

`omb:doc` runs after implementation verification and before PR creation.

Canonical flow:

```text
03-implement -> 04-verify -> 05-doc -> 06-create-pr
```

Do not run `omb:pr` before required documentation and wiki updates are complete or explicitly marked not applicable.

## When To Run `omb:doc`

Run `omb:doc` after `04-verify` passes when any of these changed:

- Public API behavior, request/response schemas, error contracts, auth, or rate limits.
- Database schema, migrations, indexes, repository behavior, cache keys, or data lifecycle.
- Frontend routes, component APIs, user workflows, accessibility behavior, or design tokens.
- Infrastructure, deployment, configuration, environment variables, runbooks, or operational procedures.
- Security posture, permissions, threat model, secret handling, audit logging, or compliance controls.
- Any behavior users, operators, integrators, or future maintainers need to understand.

Skip `omb:doc` only when the change is purely internal and no existing documentation becomes stale. The skip decision must be recorded in the PR body.

## `omb:doc` Scope

`omb:doc` owns living service documentation under `docs/`.

Use it to:

- Create or update API, database, backend, frontend, feature, deployment, security, integration, common-rule, and ADR documents.
- Update `docs/README.md`, `docs/GLOSSARY.md`, category overviews, and cross-references when affected.
- Verify examples, commands, file paths, diagrams, and frontmatter are current.
- Preserve existing document structure and update changelog or `updated` metadata when required by `omb-doc` rules.

## `omb:wiki` Relationship

`omb:wiki` routes project knowledge under `openwiki/` through the official installed OpenWiki skill; upstream owns Claims, indexes and finalization. Record an explicit knowledge disposition for every documentation task.

`omb:wiki` may be executed in either of two valid ways:

1. Inside `omb:doc`, when the documentation update naturally includes wiki alignment.
2. As a separate workflow step, when wiki initialization, read, update, lint, or feedback needs its own focused pass.

Use `omb:wiki update` when implementation changes affect native pages and Claims supported by changed source files.
Use `omb:wiki add` for source-backed constraints, decisions, feature notes and documented system behavior. Use `omb:memory` for project working practices, operational lessons, correction history condensed into current guidance, and SoT authoring routes; do not duplicate them into Wiki pages automatically.
Use `omb:wiki lint` before PR when `openwiki/**` files changed or when the plan requires wiki validation.

A required update is complete only with stable official finish (`sourceChanged != true`) and complete latest metadata, or the official verified no-op branch defined in `omb-wiki`. An interrupted run or unfinished required update blocks PR handoff.

## Required Evidence

The documentation step must report:

- Documentation files created, updated, or intentionally left unchanged.
- Wiki action taken: inline update, separate `omb:wiki` step, or not applicable.
- Source files or plan items that drove each documentation update.
- Any stale documentation found and how it was resolved.
- Any docs or wiki blockers that should stop PR creation.

## Handoff To `omb:pr`

Before invoking `omb:pr`, confirm:

- `omb:doc` completed or was explicitly skipped with rationale.
- `omb:wiki` was run inline, run separately, or marked not applicable with rationale.
- Documentation-related tests, lint checks, vocabulary checks, or link checks passed when available.
- PR summary can accurately mention documentation and wiki impact.

If docs or wiki work is incomplete, return to `omb:doc` or `omb:wiki` before `omb:pr`.
