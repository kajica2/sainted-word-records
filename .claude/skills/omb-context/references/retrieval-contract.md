# Shared retrieval contract

The runtime `hook.knowledge` engine owns normalization, candidate validation,
ranking, deduplication, provenance, and fingerprinting. Skills supply intent and
judge applicability; they must not implement a competing search algorithm.

`context search QUERY --root ABS_ROOT --workflow PROFILE` returns schema_version,
engine_version, query, expanded_terms, retrieval_status, source_status, selected,
excluded, and fingerprint. Evidence retains id, source_kind, root, layer, path,
heading, locator, claim_id, revision, content, evidence_resources, freshness,
applicability, selection_reason, and score. Ranking score is not verification.

Current wiki facts require actual Claim statements with validated cited spans.
Body snippets without proven Claim mapping are unverified navigation. Historical
material remains historical even with `--include-history`. Hash validity proves
snapshot identity, not semantic entailment; verify relevant source behavior.
Operational memory keeps complete applicability and exceptions and distinct layer
identities. Missing or invalid memory never permits raw-file bypass.

A result can be ready, empty, partial, or unavailable. Inspect per-source states and
excluded reasons. A failed optional source does not erase valid results from another
source. Empty/unavailable results require bounded source exploration and recorded
unknowns. Invalid root/profile/arguments are input failures, not empty success.

`context build` selects whole evidence units within frontmatter budgets and returns
bundle identity and artifact paths. `context status --root ABS_ROOT --bundle PATH`
checks identity and current source membership/revisions without writing. Rebuild
when stale; do not reuse a bundle from a different checkout. Keep read validation
separate from the publication evidence in knowledge-disposition.md.
