---
title: Update Protocol
impact: CRITICAL
tags: foundation, updates, lifecycle
---

## Update Protocol

Documents are living artifacts — updated in place, never replaced. Every update follows a strict protocol to prevent data loss, stale cross-references, and invisible regressions. Overwriting a document without reading it first is the most common cause of documentation drift.

### Protocol Steps (in order)

1. **Read the existing document first** — never write without reading the current state
2. **Update `updated:` in frontmatter** — set it to today's date; leave `created:` unchanged
3. **Preserve existing structure** — do not reorganize sections unless the template itself changed
4. **Replace, do not accumulate** — delete superseded text in the same commit; git history is the
   archive (`.claude/rules/common/sot-authoring.md` SOT-3):
   ```markdown
   JWT validation is the primary auth mechanism since v2.
   ```
5. **Add a changelog entry** — required for `api` and `database` category documents:
   ```markdown
   | 2026-04-10 | Added rate-limit headers to response schema | No |
   ```
6. **Check cross-references** — if this document is listed in another document's `depends-on`, review the dependent document for accuracy

### When Each Step Applies

| Step | api | database | backend | frontend | other |
|------|-----|----------|---------|----------|-------|
| Read first | always | always | always | always | always |
| Update `updated:` | always | always | always | always | always |
| Preserve structure | always | always | always | always | always |
| Deprecate, don't delete | exempt classes only\* | exempt classes only\* | exempt classes only\* | exempt classes only\* | exempt classes only\* |
| Changelog entry | required | required | optional | optional | no |
| Check cross-references | always | always | always | always | always |

\* Soft deprecation is required for exactly these three document classes: ADRs (immutable
decision records, superseded via `status: superseded` + `superseded-by:` / `supersedes:`);
externally-consumed versioned API contracts under `docs/api/**` (internal-only API docs are
not exempt); and CHANGELOG/release notes (append-only by nature). Every other document
follows step 4: replace, do not accumulate.

---

**Incorrect (overwriting without reading, leaving `updated:` stale, no changelog trail):**

```markdown
---
title: Auth Middleware
category: backend
status: active
created: 2026-01-15
updated: 2026-01-15    # Wrong: not updated to today's date
---

# Auth Middleware

JWT validation added.
```

Why this fails:
- `updated:` still shows the original creation date — no signal that this document changed
- The session-cookie content is gone with no changelog row recording when or why — a reader
  who depended on it has no way to trace what replaced it
- The agent did not read the existing document before writing

**Correct (read first, updated frontmatter, superseded text removed, changelog carries the history):**

```markdown
---
title: Auth Middleware
category: backend
status: active
created: 2026-01-15
updated: 2026-04-10    # Correct: reflects today's update
---

# Auth Middleware

JWT validation is the primary auth mechanism since v2.

## Changelog

| Date | Change | Breaking |
|------|--------|----------|
| 2026-04-10 | Replaced session-cookie auth with JWT; removed session-cookie documentation | Yes |
| 2026-01-15 | Initial documentation | No |
```

---

**Incorrect (cross-reference check skipped after a schema change):**

A developer updates `docs/database/schema-user.md` to add a new `role` column but does not check `docs/api/user-profile.md`, which lists the response fields. The API doc now omits `role`, silently contradicting the schema.

**Correct (cross-reference check performed):**

After updating `docs/database/schema-user.md`, read its `depends-on` field. Any document listed there must be reviewed and updated if the schema change affects its content.
