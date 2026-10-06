# Operation record

The coordinator/writer renders this format; the skill never posts it directly. Human-readable text is Korean. The metadata is exactly one JSON line between the marker lines. Replace placeholders only through the validated writer. `input_digest` is 64 lowercase hexadecimal characters without a `sha256:` prefix.

```text
{Korean explanation of the verified phase and canonical/source relationship}

<!-- omb-issue-maintainer:v1
{"operation_id":"OPERATION_ID","run_id":"RUN_ID","repository":"OWNER/REPO","canonical_issue":123,"source_issues":[124],"phase":"applying","writer_login":"WRITER_LOGIN","generation":1,"updated_at":"2026-09-27T00:00:00Z","expires_at":"2026-09-27T00:30:00Z","input_digest":"DIGEST_64_HEX","request_id":"REQUEST_ID"}
-->
```

Required keys are all shown above except `request_id`, which the parser permits optionally and mutation intents include. Unknown fields are rejected. Valid phases are `reserved`, `awaiting_decision`, `applying`, `recovering`, `completed`, `no_change`, `busy`, `deferred`, `failed`, and `uncertain`; supported parser phases do not imply that every phase is published.

The canonical record is created after canonical edits are verified with phase `applying`, then updated to `completed` after all source steps are verified. A source receives its consolidation notice before closure. There is one managed comment per operation per affected issue; local heartbeats do not generate repeated GitHub comments.

Only the local verified journal's comment ID, target binding, actual trusted author, strict marker, and exact prior body authorize editing an existing record. A copied marker alone is not a claim or ownership proof. Missing/deleted/ambiguous prior comments defer instead of authorizing a replacement POST.

Stable request identities omit generation. Recovery reuses frozen payloads, timestamps, and verified comment bindings in intent order. Never place continuation capabilities, credentials, private paths, or raw configuration in this record. TTL expiration is a recovery signal, never permission to steal the reservation.
