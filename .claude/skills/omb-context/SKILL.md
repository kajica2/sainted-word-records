---
name: omb-context
description: "Shared knowledge manager: search verified wiki and operational memory, build bounded workflow bundles, and validate reuse."
user-invocable: true
argument-hint: "[search QUERY | build QUERY --workflow interview|plan|run|verify|pr|review | status --bundle PATH] [--root ABS_ROOT]"
metadata:
  token_estimate: "ceil(character_count / 4)"
  output_dir: ".omb/context"
  allowlist:
    workflows: [interview, plan, run, verify, pr, review]
  defaults:
    journal_entries: 0
    include_generated_at: true
    compatibility_wiki_context_path: ".omb/.wiki_context.md"
  workflow_token_caps:
    interview:
      max_tokens: 1600
      sections:
        facts: 700
        decisions: 400
        memory: 300
        unknowns: 200
    plan:
      max_tokens: 2000
      sections:
        rules: 500
        wiki_constraints: 900
        recent_plans: 400
        journal: 200
    run:
      max_tokens: 3000
      sections:
        wiki_constraints: 1500
        gotcha_lessons: 900
        lesson_notes: 600
    verify:
      max_tokens: 2500
      sections:
        acceptance_criteria: 600
        changed_files: 400
        wiki_constraints: 700
        relevant_lessons: 500
        verification_rules: 300
    pr:
      max_tokens: 1800
      sections:
        diff_summary: 500
        verification_evidence: 500
        pr_rules: 400
        release_notes: 400
    review:
      max_tokens: 2500
      sections:
        changed_files: 500
        risk_rules: 600
        wiki_constraints: 600
        relevant_lessons: 500
        prior_feedback: 300
---

# Shared Knowledge Context

## Execution Contract

This skill is the common read manager. It calls the deterministic `context` CLI;
it does not reproduce ranking, source validation, or publication in prompts.
The runtime adapters validate OpenWiki Claims and operational memory directly.
No adapter calls this skill, omb-wiki, or omb-memory back.

1. Resolve the selected checkout's absolute root after the caller's worktree gate.
2. Read [retrieval-contract.md](references/retrieval-contract.md) for input/output
   semantics and [authority-boundaries.md](references/authority-boundaries.md).
3. Invoke the checkout wrapper with quoted user arguments:

   ```text
   .claude/bin/omb-cli.sh context search QUERY --root ABS_ROOT --workflow plan
   .claude/bin/omb-cli.sh context build QUERY --root ABS_ROOT --workflow interview
   .claude/bin/omb-cli.sh context status --root ABS_ROOT --bundle BUNDLE_JSON
   ```

4. For `search`, optionally repeat `--source wiki` / `--source memory`; default is
   both. `--include-history` preserves historical labels. `--limit` bounds results.
   For `build`, use a frontmatter workflow, optional `--max-tokens N`,
   `--changed-files path,...`, and `--journal N`. The old `--workflow ...` skill
   syntax maps to `build` using the current task as QUERY.
5. Interpret returned source states separately from retrieval state. Empty or
   unavailable optional knowledge prompts narrow source exploration, not invented
   facts or a workflow-wide failure. Invalid roots/profiles/arguments must be fixed.
6. Pass the returned bundle identity and paths according to
   [workflow-handoff.md](references/workflow-handoff.md). Use `status` before reuse
   after checkout, scope, source, profile, or revision changes and after compaction.

## Budget and artifacts

The YAML frontmatter is the single source of truth for workflow and section caps.
`ceil(character_count / 4)` estimates the entire rendered Markdown, including
headings, metadata, and provenance; it is not an actual tokenizer guarantee.
Overrides must be positive and may only lower the cap. Section caps scale down
proportionally with floor rounding. Evidence and memory conditions/exceptions are
atomic: omit an item that cannot fit, recording why; never broaden it by truncation.

Build writes `.omb/context/{workflow}/{bundle_id}.json` and the matching `.md`.
Use returned task-specific paths for delegation. `--compatibility` additionally
writes `.omb/context/{workflow}.md` and, for run, `.omb/.wiki_context.md`; these are
compatibility snapshots, not authoritative identities. Search/status do not write.
Journal filenames/titles and plan/rule pointers are workflow inputs, not durable facts.

OpenWiki discovery begins at `openwiki/index.md`; the engine excludes frozen
migration archive evidence from current facts, unfinished runs, stale Claims, and
unsupported prose. Source code and tests remain authoritative. Operational memory
is scoped practice with validated checkout/layer/revision identity, not wiki facts.

## Publication handoff

Reading never publishes. After verified implementation, callers use
[knowledge-disposition.md](references/knowledge-disposition.md) to prepare scoped
updates for existing owners; a ready bundle is not a publication receipt.
