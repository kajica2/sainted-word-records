---
name: omb-wiki
description: "Read project knowledge and route writing through the official OpenWiki host lifecycle."
---

# OMB Wiki

Each project's `openwiki/` is its active knowledge store. Official OpenWiki owns
Claims, indexes, provenance, persisted runs/jobs and finalization. OMB provides
routing and read-only checks; it does not implement a second publisher.

## Modes and authority

`read` retrieves cited knowledge; `lint [--plan PATH|--changed-files FILES]` runs
read-only structural and semantic checks. `init`, `add`, and `update` route to the
official installed host skill (`add` is an update plan containing a new page).
Changed files and requested targets are planning inputs, not invented MCP fields.
`feedback` follows `Skill("omb-feedback")`'s protected approval boundary.

Resolve the absolute Git repository toplevel before writes. Read the installed
OpenWiki skill for the active supported host and follow its current instructions:
Claude `.agents/skills/openwiki/SKILL.md`, Codex `.agents/skills/openwiki/SKILL.md`.
If absent, report `bash .Codex/bin/omb-cli.sh openwiki-install --root ABS_ROOT`, or `npm install -g openwiki@latest`
followed by `openwiki integrations install claude --project ABS_ROOT` or the `codex` equivalent.
Installer changes are separately tracked installation actions, not doc output.
Never vendor or regenerate this third-party skill as an OMB export.

Native writes require the official MCP connection on a supported Claude/Codex host.

## Official sequential lifecycle

The main host consumes the official page loop sequentially. No page writer,
planning, or reviewer subagents run inside that loop. Never delegate a page to
`@wiki-writer`; it remains a read-only compatibility handoff.

1. Read project sources and `openwiki/INSTRUCTIONS.md` if present. Use
   `openwiki_begin` with absolute `root`, `mode` (`init` or `update`), and the
   configured documentation language. For explicit authoring (`add`, requested
   prose corrections/reorganization, or evidence repair), pass `force: true`
   with update so unchanged source does not suppress the requested page plan.
   Routine source-refresh updates may use the default non-forced check.
   Preserve the returned `runId`; resume a
   persisted run rather than deleting its state.
   If begin returns `status: noop` with no runId, do not call submit-plan or
   finish or invent a run. Verify existing latest metadata
   `openwiki/.last-update.json` has status complete and
   read-only evidence checks pass, then report a verified no-op. A failed evidence check
   requires a forced official update and source re-research, never a successful no-op.
   Before first init, account for upstream-managed root instruction blocks and
   workflow creation. Preserve existing workflow content. Recurring automation
   requires explicit project authorization; use an authorized manual/opt-in
   workflow when supplied.
2. Submit the official plan through `openwiki_submit_plan` with `runId` and
   `pages` (`path`, `title`, `purpose`, optional `seedPaths`, `relatedPages`,
   `instructions`). Initial plans include `/openwiki/quickstart.md`.
3. Call `openwiki_next_page`. Inspect existing Claim IDs with
   `openwiki_inspect_page_claims` before revising them. Read the cited source spans
   and write only the assigned page. Virtual `/openwiki/...` paths are repository
   relative after removing the leading slash; never write filesystem `/openwiki`.
   Reject traversal and symlink escapes.
4. Call `openwiki_submit_page` with `runId`, `jobId`, and sparse Claim decisions:
   `claims` containing statements and evidence resources, `confirmedClaimIds`, or
   `retractedClaimIds`. The tool has no page-body field: write the page first.
   Omitted issue-free Claims remain retained; stale Claims require decisions.
   Evidence such as `repo://src/example.py#L10-L18` must resolve and support the
   statement. If lines moved, replace/retract the Claim with the correct locator;
   do not simply confirm an obsolete span.
5. Repeat next/inspect/write/submit in this host until the queue completes, then
   call `openwiki_finish`. Never manually edit `.claims`, index, provenance,
   `.run.json`, `.page-manifest.json`, `.last-update.json`, or managed instruction
   blocks. Upstream owns these outputs.
6. Accept publication only when `finish.status == "complete"`,
   `finish.sourceChanged != true`, AND `openwiki/.last-update.json` has
   `status == "complete"`. A complete response with source drift is not success.
   For drift, begin(update), re-research, replan and finish at most two times.
   Continued drift returns non-success with run identity and resume action; never
   patch metadata to manufacture completion. Resume interruptions via begin/next
   without duplicate publication.

## Read and lint

Use the shared read engine per `.agents/skills/omb-context/references/workflow-handoff.md`:

```text
.Codex/bin/omb-cli.sh context search QUERY --root ABS_ROOT --source wiki
```

Preserve freshness, evidence IDs, exclusions, and source states. For legacy
frontmatter/summary diagnostics and lint, use `.Codex/bin/omb-cli.sh openwiki-read`:

```text
openwiki-read search QUERY --root ABS_ROOT
openwiki-read frontmatter openwiki/PAGE.md --root ABS_ROOT
openwiki-read summary openwiki/PAGE.md --root ABS_ROOT
openwiki-read lint --root ABS_ROOT
```

Index discovery determines relevant pages; do not require legacy category folders,
schemas or headings. Exclude frozen migration archives from active search/context.
`@wiki-reader` performs progressive retrieval. `@wiki-linter` checks native
structure and actual evidence locators; `@wiki-reviewer` independently checks
factual support after finalization or against a plan. Neither writes metadata.

## Legacy recovery

New legacy mutation commands are disabled. Do not start candidate publication.
Existing nonterminal `.omb/wiki-staging/` operations require explicit legacy
inspection/recovery/abort before migration. Preserve unresolved `docs/wiki/log/`
DRIFT-PENDING entries; new audit events belong under `.omb/logs/audit/`.
Never archive/delete unresolved audit or operation evidence. Recovery does not
authorize new legacy publication.

## Publication receipt

Apply `.agents/skills/omb-context/references/knowledge-disposition.md` after the official lifecycle. A read bundle cannot satisfy the writer receipt.

## Output

Use the complete envelope in `.Codex/rules/common/output-contract.md`, reporting
mode, run identity, finish result, finalized status, changed files and checks.
`DONE` requires a cited read, completed checks without P0/P1, or stable completion
above. `RETRY` requires a bounded recoverable failure with an exact resume action;
unsupported host, exhausted recovery or missing authority is `BLOCKED`. Scaffold
files, schema validation and subprocess exit codes alone do not prove completion.
