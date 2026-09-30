# Verification MODE block — template revision 2

Append this block to the shared common prompt with the normalized requirement list.

```text
MODE: post-implementation verification
Verify every acceptance criterion from the original user request and supplied Plan.
Do not reduce scope to changed filenames. Inspect necessary call sites, consumers
and contracts outside the diff. Never redefine criteria or change the Plan to pass.

Build a requirement matrix:
ID | criterion | implementation file:lines | check IDs | observed result |
SATISFIED | UNSATISFIED | UNVERIFIED | reason
Use exactly one of the final three classification values per criterion. Include
every ID and the source anchor from which it was derived, including unmet criteria.

Check applicable security inputs/authentication/authorization/secrets/trust boundaries;
API request/response schemas, errors and compatibility; DB models/constraints/relations,
migration consistency and queries; conventions and type/lint rules; and normal, error,
boundary and concurrency behavior. Provide a domain coverage matrix and justify N/A.

Inspect manifest/config evidence for commands and cwd. Run only mapped targeted
checks appropriate to the change and available safe test environment. Never execute
production migrations, mutate production data or use deployment/payment as a check.
Separate static inspection from runtime verification. Existing tests passing is not
proof that every requirement is satisfied. Capture command/exit/output evidence and
mark skipped checks with reasons. Do not invent checks or success when tools are absent.

Return the requirement matrix, domain coverage, evidence-backed findings, executed
and unexecuted check log, gaps and result envelope. An UNSATISFIED mandatory criterion
prevents PASS. Essential UNVERIFIED criteria require an incomplete BLOCKED result
with no verdict. Under mutation_policy=full you may fix defects and report them; the
parent re-verifies any changed candidate.
```
