---
paths:
  - "docs/**/*.md"
  - "openwiki/**/*.md"
  - "**/CLAUDE.md"
  - "README.md"
  - ".claude/rules/**/*.md"
---

# SoT Authoring

Rules for any durable canonical document: a Source-of-Truth (SoT) statement must survive a
fresh clone, carry its own technical explanation, and stay current through hard delete rather
than accumulated deprecation banners.

## SOT-1 — Durable evidence only

Cite only artifacts that survive a fresh clone: committed `file:line-range` / `file::symbol`,
committed test names, merged commit SHAs, issue/PR URLs, ADR paths. Forbidden as evidence: any
path under `.omb/` (`plans/`, `todo/`, `interviews/`, `context/`, `logs/`, `compat/`,
`spike-transcripts/`), `worktrees/`, branch names, and session/transcript IDs. Applies to body
prose **and** `sources:` frontmatter.

**Discriminator:** a bare directory named as a workflow concept is not a citation; a concrete
filename is. `.omb/plans/` describing what `omb uninstall` preserves is legitimate; a specific
`.omb/plans/2026-04-30-example-plan.md` cited as substantiating evidence is a banned citation.
Likewise `/omb:run .omb/plans/2026-04-12-user-auth.md` in a command example is not evidence.
Test: *would a reader open this path to verify the claim?*

## SOT-1a — Never substitute derived provenance for primary evidence

When primary evidence is irrecoverable, the commit that merely added the document recording it
is **not** a valid replacement — that is circular. The correct repair is to restate the observed
facts inline as dated first-party assertions with an explicit note that the primary artifact was
not retained, or to re-derive the fact from committed code. Never fabricate a citation, and never
delete a substantiated finding merely because its pointer died.

## SOT-2 — The document carries the mechanism

A SoT statement must be verifiable without opening any other tracker. State the enforcing code
and its behavior, why an alternative fails, and the observable consequence. A pointer to where
work is tracked never substitutes for the technical explanation.

**Incorrect** — defers to a plan file's change unit:

> `[HARD]` This validator will reject aspirational claims. See
> `.omb/plans/2026-08-09-example-cutover-replan.md` for the mechanism.

**Correct** — names the validator, its closed field set, and why a rename cannot work:

> `[HARD]` `@wiki-reviewer` rejects a `[HARD]`/MUST claim naming no enforcement mechanism
> (`.claude/agents/omb/wiki-reviewer.md` REJECT conditions). A rename of the claim alone does not
> satisfy this, because the reviewer checks for a named mechanism class (hook, validator, test,
> CI gate, or review-time gate), not for surface wording.

## SOT-3 — Hard delete on change

When a fact changes, delete the stale text in the same commit. Git history is the archive.
Forbidden by default: `DEPRECATED`/`STALE` banners, strikethrough, "previously..." narration,
retained superseded sections.

**Exemptions (closed, normative):** soft deprecation is required for exactly these three
document classes, and only these:

> Soft deprecation is required for exactly these three document classes: ADRs (immutable
> decision records, superseded via `status: superseded` + `superseded-by:` / `supersedes:`);
> externally-consumed versioned API contracts under `docs/api/**` (internal-only API docs are
> not exempt); and CHANGELOG/release notes (append-only by nature).

**ADR immutability scope:** immutability governs the **decision content** — Context, Decision,
Consequences. Evidence pointers (`sources:`, reference lists, `→ source:` markers) are
**metadata**, not decision content, and MUST be corrected in place when they rot. Correcting a
dead pointer does not alter the decision and does not require supersession.

**File-move stub carve-out:** a file-move stub is permitted, at most 10 lines, with no rule
content, deleted within one release — matching the shape enforced for
`.claude/rules/workflow/10-coding-principles.md` by
`tests/harness/test_rules_contract.py::test_stub_files_contain_no_rule_content`.

**Frozen migration evidence exception:** only
`docs/migrations/openwiki-2026-09-20/legacy-wiki/**` is retained byte-identically
as non-authoritative historical evidence. The adjacent `manifest.json` records
source commit, SHA-256, destinations and dispositions. Never edit archive bodies,
use them as current policy, or include them in active search/context. This narrow
exception does not permit other stale documentation or unresolved audit logs.
Current facts must be rewritten from live sources in `openwiki/`.

## SOT-4 — Normative statements assert current enforced behavior

A `[HARD]`, MUST, or contract statement describes what is enforced **now**, and names its
enforcing mechanism. Valid mechanism classes are: a hook handler, a validator, a test, a CI gate,
or a named review-time gate (a specific agent's REJECT condition). Naming a review-time gate is
legitimate and is the mechanism class this rule itself relies on. A target state is never written
as a normative rule; a known gap goes in a clearly non-normative, dated section tracked by a
durable identifier (issue/PR/ADR) — never a plan-file path.

## See Also

- `.claude/rules/common/INDEX.md` — `paths:`-scoped common file registry.
- `.claude/agents/omb/wiki-reviewer.md` — the review-time gate SOT-4 names as a valid mechanism.
- `.claude/skills/omb-doc/rules/foundation-update-protocol.md` and
  `.claude/skills/omb-doc/rules/lifecycle-deprecation.md` — `omb-doc` procedure for SOT-3.
