# Knowledge disposition and publication receipt

After each verified implementation task, prepare one bounded batch for the existing
writer owners. Keep related tasks together when they affect the same verified
source snapshot; do not publish the same snapshot repeatedly at every workflow.

```json
{
  "target": "wiki|docs|memory",
  "action": "update|no-op|deferred|failed",
  "source_fingerprint": "verified source/diff snapshot identity",
  "tests": [],
  "affected_pages": [],
  "affected_claims": [],
  "claim_actions": {"retain": [], "revise": [], "retract": []},
  "representative_queries": [],
  "reason": "evidence and applicability"
}
```

Capture an atomic falsifiable fact, its applicability, exceptions, source symbols
and bounded locators. Include searchable title/description/tags/identifiers and
representative Korean/English questions. An unverified plan is never a current fact;
proposal text belongs in a labeled design artifact until implementation is verified.
An unchanged artifact supports no-op only with actual source checks. Required
updates may be deferred during execution, but remain unresolved for DOC/PR gates.

```json
{
  "owner": "official-openwiki|omb-doc|omb-memory",
  "source_fingerprint": "same verified source snapshot",
  "status": "complete|no-op|deferred|failed",
  "run_id_or_revision": "actual owner identity or null",
  "evidence": [],
  "retrieval_check": {"queries": [], "evidence_ids": [], "result": "verified|failed|pending"}
}
```

Reuse a receipt only for the same verified source snapshot. A changed fingerprint
requires a fresh disposition and owner validation. The existing PR gate also binds
its final documentation record to lint_base_commit/lint_merge_base/lint_head_tree;
this receipt supplements that gate and does not replace its clean snapshot checks.

For wiki complete, require `finish.status == "complete"`,
`finish.sourceChanged != true`, and `openwiki/.last-update.json` status complete.
For wiki no-op, require an official noop response plus current source evidence and
complete latest metadata; never invent a run or call finish without a run ID.
Retain interrupted run identity and resume action. A retrieval_status of ready
does not prove publication. After publication, run representative `context search`
queries and verify intended evidence is returned; report failed retrieval separately
from publication status, and repair or explain it before closing the knowledge task.

Memory success requires validated revision and read-back; docs success requires
actual document validation. Never hand-edit generated Claims, indexes, run metadata,
or upstream-managed instruction blocks. Missing official publisher capability is
BLOCKED for required publication, never fabricated N/A. Required pending, deferred,
or failed updates block DOC completion and PR handoff; source implementation may
continue while those exact blockers remain visible.
