---
title: Durable Evidence Only
impact: HIGH
tags: quality, evidence, sot
---

## Durable Evidence Only

Every citation in `docs/` must survive a fresh clone. This restates SOT-1 and SOT-1a from
`.claude/rules/common/sot-authoring.md` (the cross-skill SSOT) in `omb-doc`'s worked-example
style — do not fork the contract itself, only its illustration.

### What Counts as Durable

Cite only artifacts that survive a fresh clone: committed `file:line-range` / `file::symbol`,
committed test names, merged commit SHAs, issue/PR URLs, ADR paths. Forbidden as evidence: any
path under `.omb/` (`plans/`, `todo/`, `interviews/`, `context/`, `logs/`, `compat/`,
`spike-transcripts/`), `worktrees/`, branch names, and session/transcript IDs. This applies to
body prose and `sources:`/`relates-to` frontmatter alike.

### The Bare-Directory-vs-Filename Discriminator

A bare directory named as a workflow concept is not a citation; a concrete filename cited as
substantiating evidence is. Ask: *would a reader open this path to verify the claim?* A bare
directory reference describes what a mechanism does with a class of files — nothing to open, no
claim to verify. A specific filename asserts "this exact file proves the point" — a reader can
open it and check.

**Permitted (bare directory, workflow concept, nothing to verify):**

```markdown
`omb uninstall` preserves `.omb/plans/` so prior planning artifacts remain on disk after the
harness is removed.
```

**Banned (specific plan file cited as substantiating evidence):**

```markdown
The retry-cap decision was made in `.omb/plans/2026-04-30-example-plan.md`, which explains
why `RETRY_MAX` defaults to 1.
```

The first sentence never asks the reader to open anything — `.omb/plans/` is describing
`omb uninstall`'s behavior toward a category of files. The second sentence asks the reader to
open `.omb/plans/2026-04-30-example-plan.md` to verify a design decision — but that path is a
working directory (`.omb/`), not a committed artifact, so it will not exist after the plan is
cleaned up or in another contributor's clone. The fix is to cite the merged commit, PR, or ADR
that actually recorded the decision, or restate the decision inline as a dated first-party
assertion per SOT-1a below.

A command example naming a plan path in passing is not a citation either — `/omb:run
.omb/plans/2026-04-12-user-auth.md` illustrates command usage, it does not substantiate a claim.

### Never Substitute Derived Provenance for Primary Evidence

When primary evidence is irrecoverable, the commit that merely added the document recording it
is not a valid replacement — that is circular (SOT-1a). The correct repair is to restate the
observed facts inline as a dated first-party assertion, noting the primary artifact was not
retained, or to re-derive the fact from committed code.

**Incorrect (circular substitution):**

```markdown
The dual-pool design was chosen for the reasons described in commit a1b2c3d, which added
this document.
```

**Correct (dated first-party assertion, primary artifact not retained):**

```markdown
As of 2026-04-30, the dual-pool design was chosen because a single connection pool blocked
reads behind long-running `XREAD` calls (observation; the original spike transcript that
measured this was not retained).
```

### Rules

- Never cite `.omb/**`, `worktrees/**`, a branch name, or a session/transcript ID as evidence in
  `docs/**`, `CLAUDE.md`, `README.md`, or `.claude/rules/**` — apply the discriminator above
  before citing any path under `.omb/`.
- Never point a normative claim (`[HARD]`, MUST) at a plan file — see SOT-4 in
  `.claude/rules/common/sot-authoring.md` for the valid enforcing-mechanism classes.
- When durable evidence cannot be found, say so explicitly rather than inventing a citation or
  laundering it through the commit that merely recorded it.

See `.claude/rules/common/sot-authoring.md` for the full SOT-1/SOT-1a/SOT-4 contract this rule
restates; do not duplicate the contract text itself, only illustrate it here.
