# SUMMARY — Final Report Shape and Posting Target

Cited from `SKILL.md` "## SUMMARY".

## Content (`OMB_DOCUMENTATION_LANGUAGE`)

- Requirement reconciliation table (from `rules/review-team.md`'s `unmapped_requests`).
- Per-ticket disposition table. Each comment row carries the `trusted` boolean `snapshot` already
  emits (`src/hook/commands/pr_watch_fetch.py:170`) as a `trusted` column — reporting only, never
  a gate.
- Evidence and finding records from `review-evidence.md`: source roles and identities,
  mismatches/revalidation, impact, confidence, corroborating reviewers, counterevidence,
  `verification_gap`, and disposition linked through evidence IDs. State required gaps and
  their resume conditions separately from optional context limitations.
- Risk coverage for every axis: `triggered` / `not-triggered`, rationale, owner, and evidence
  IDs; retain unresolved coverage gaps rather than implying they passed.
- Iteration count.
- Every file this run changed (HARD rule 13) — the only human-visible record of an unsupervised
  run.
- Unverified items (for example a CVE that could not be confirmed against tool output).
- Three disclosure lines: the secret-file guard's `*.pem`/`*.key` gap (HARD rule 12), the
  marker-stripping-is-exhaustive-but-secret-masking-is-best-effort split (HARD rule 8 /
  `rules/review-team.md` Ingestion Policy), and the fact that PR mode loaded the PR head
  branch's own `.claude/` harness (`rules/target-resolution.md`).
- Remaining unresolved P0-P2 tickets, when any are left at the iteration cap.

`SKILL.md` HARD rules already state the normative sentences this report cites — do not restate
them here.

## Posting Target

PR mode: post inside the SWEEP bracket's final `pr-watch comment` call, and also write the same
content to `.omb/reviews/{date}-{slug}.md`. Local mode and fork review-only mode: write only to
the `.omb/reviews/` report and render it in the terminal — no GitHub posting.

## Termination

Writable/local mode: no unresolved P0-P2 ticket remains, every P3 has a recorded disposition,
verification succeeded, and required replies/resolutions are confirmed → `<omb>DONE</omb>`.
Required evidence judgments must also be complete under `review-evidence.md`'s Validity and
Gaps gate; optional wiki limitations and valid P3 deferrals do not by themselves block DONE.
A successful review-only report may contain unresolved findings and still return DONE, with
its no-write limitation explicit. Retrieval failure is not a successful read-only review.

Iteration/fix-budget exhaustion with unresolved P0-P2 tickets, failed required checks,
incomplete dispositions, head drift, or operational failures → `<omb>BLOCKED</omb>`.
Pending checks → `<omb>RETRY</omb>` with their names and tested/pushed head OID. Take the final
snapshot before composing the summary, then confirm publication with another snapshot; if new
arrivals or failures change the result, report the changed status locally and correct any stale
summary while the bracket is open. Call `pr-watch end` before returning; failure to release an
open bracket prevents DONE. Report checks actually run and gaps without inventing success.
