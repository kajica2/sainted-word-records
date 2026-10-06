# Korean-first evidence authoring

Generated titles, descriptions, headings, prose, tables, `message_ko`, and user
decision notices are written in professional Korean.

## Identifier preservation

Preserve every verified technical identifier byte-for-byte, including API paths,
HTTP methods and statuses, JSON/schema keys, symbols, table/column names, env
vars, Redis identifiers, metrics, commands, paths, protocols, enum literals,
ports, product names, migration IDs, and incident IDs. Never translate,
normalize, title-case, pluralize, or repair an identifier.

## Evidence boundary

Never guess. Prefer evidence in this order: executable code, schemas/migrations,
tests, then prose. Every material claim cites a source path and precise location.
If evidence is absent, inconclusive, or conflicting, stop publication with
`USER_DECISION_REQUIRED` and ask a Korean question that presents the competing
claims and their evidence.

Feature activation is explicit. Prose keywords never activate a feature. The
dispatcher adds a value to `document_features` only after showing the cited code
fact and recording user confirmation.

## Review style

- State purpose, scope, actors, invariants, failure behavior, and evidence directly.
- Distinguish verified facts from items requiring confirmation.
- Use Korean sentences around protected identifiers without altering them.
- Do not add filler, speculative examples, or unsupported guidance.
- Required headings come only from the selected schema; no cross-schema heading is implicit.
