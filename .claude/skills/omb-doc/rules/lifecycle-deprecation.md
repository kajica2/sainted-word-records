---
title: Deprecation Protocol
impact: HIGH
tags: lifecycle, deprecation, versioning
---

## Deprecation Protocol

Default: hard delete. When content is replaced, outdated, or removed, delete the stale text in
the same commit — git history is the archive (`.claude/rules/common/sot-authoring.md` SOT-3).
Soft deprecation (a `DEPRECATED` banner, `status: deprecated`, or a retained superseded section)
is reserved for exactly three document classes, defined below. Everything else follows the
Update Protocol's "replace, do not accumulate" step
(`.claude/skills/omb-doc/rules/foundation-update-protocol.md`).

### Exempt Document Classes

Soft deprecation is required for exactly these three document classes: ADRs (immutable
decision records, superseded via `status: superseded` + `superseded-by:` / `supersedes:`);
externally-consumed versioned API contracts under `docs/api/**` (internal-only API docs are
not exempt); and CHANGELOG/release notes (append-only by nature).

For every document outside these three classes, delete the stale content in place; do not add
a banner or retain a superseded section.

### Frozen migration evidence

The sole additional preservation exception is the byte-identical, non-authoritative
`docs/migrations/openwiki-2026-09-20/legacy-wiki/**` corpus defined in SOT-3.
Its adjacent manifest accounts for original hashes and native destinations.
Do not modify originals or include them in active search/context. This is not a
general soft-deprecation exception and does not cover unresolved audit logs.

### Document-Level Deprecation (exempt classes only)

For an externally-consumed versioned API contract under `docs/api/**`, set `status: deprecated`
in frontmatter and add a banner:

```yaml
---
title: Users API (v1)
status: deprecated
---
> **DEPRECATED:** This API version is deprecated as of 2026-04-01. See [Users API v2](../api/users-v2.md) for the current version.
```

### Section-Level Deprecation (exempt classes only)

For a deprecated section within an active exempt-class document, use a blockquote:

```markdown
> **DEPRECATED (2026-04-01):** This authentication method is no longer supported. Use OAuth2 instead. See [Auth Design](../security/auth-design.md).
```

### ADR Deprecation

ADRs are immutable once accepted — the decision content (Context, Decision, Consequences)
never changes in place. To supersede a decision:
1. Create a new ADR referencing the old one
2. Update the old ADR frontmatter: `status: superseded`, `superseded-by: docs/architecture/adr/NNN-new.md`
3. Update the new ADR frontmatter: `supersedes: docs/architecture/adr/NNN-old.md`

**ADR immutability scope:** immutability governs the decision content only. Evidence pointers
(`sources:`, reference lists, `→ source:` markers) are metadata, not decision content, and MUST
be corrected in place when they rot — a dead `sources:` entry does not require creating a new
ADR or triggering supersession; `@doc-writer` fixes it directly in the existing ADR.

### Rules

- Outside the three exempt classes: never leave a `DEPRECATED` banner, `status: deprecated`,
  or a retained superseded section — delete the stale text in the same commit.
- Within the three exempt classes: never delete without the structured supersession/deprecation
  mechanism above — link to the replacement in the deprecation banner or `superseded-by:` field.

**Incorrect (banner added for a non-exempt document):**

```markdown
# docs/backend/auth-middleware.md is not an ADR, an externally-consumed
# versioned API doc, or a CHANGELOG — it gets a DEPRECATED banner anyway
# and the superseded session-cookie section is left in place
```

**Correct (non-exempt document — hard delete, changelog carries the history):**

```markdown
# docs/backend/auth-middleware.md: session-cookie section removed in the
# same commit that added JWT validation; the changelog row records the change
```

**Incorrect (ADR decision content edited in place instead of superseded):**

```markdown
# docs/architecture/adr/012-use-redis-pubsub.md: Decision section rewritten
# to describe Redis Streams instead — no new ADR, no status: superseded
```

**Correct (ADR superseded per the mechanism above):**

```markdown
# docs/architecture/adr/012-use-redis-pubsub.md: status: superseded,
# superseded-by: docs/architecture/adr/031-use-redis-streams.md
# docs/architecture/adr/031-use-redis-streams.md: supersedes: adr/012
```
