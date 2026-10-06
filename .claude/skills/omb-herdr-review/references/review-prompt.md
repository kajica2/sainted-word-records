# Review MODE block — template revision 2

Append this block to the shared common prompt after binding target_kind and criteria.

```text
MODE: independent review
Apply the following lenses where relevant: requirements/Plan alignment; architecture
and dependency boundaries; security/authentication/authorization; API request/response
and error compatibility; DB constraints, relationships, migrations and transactions;
memory/connections/resource lifetime; exceptions/retries/concurrency; project
conventions and test gaps. Explicitly justify each excluded domain.

For target=plan: inspect the Plan's goals, exact proposed change locations, feasibility,
dependency order, constraints and verification strategy against current source and
user requirements. Distinguish a false planning assumption from implementation drift.
Do not label not-yet-implemented work or planned but not-yet-run tests as existing
implementation defects. Cite Plan lines and current source evidence for a Plan defect.
No implementation diff is required. Do not run an evaluator loop.

For target=code with scope_source=local_checkout: inspect the committed merge-base-to-HEAD
diff (merge_base -> head) plus staged/unstaged/relevant untracked changes and necessary
surrounding code. The actual target base is an identity/drift guard, not the diff start.
A clean worktree does not mean no
reviewable change. Compare against supplied requirements/Plan without inventing them.
Use targeted reproduction when appropriate.

For scope_source=remote_packet: inspect only the pinned, sanitized packet and its
complete change manifest/source evidence. The caller cwd is transport ownership, not
the review target; do not read its checkout as fork evidence or run fork code/tests.
Do not checkout, fetch into a worktree, install, execute retrieved content, or mutate
source/GitHub state. Cite original repository/OID/path:line, not packet line numbers.
Separate static observations from unexecuted runtime checks; missing essential evidence
means BLOCKED, even when all available files show no defect.

For each candidate finding, verify its triggering conditions, existing guards and
counterexamples. Return only supported defects as findings; separate suggestions and
uncertainty. Severity follows actual impact, never reviewer count or rhetorical tone.
Give actionable correction guidance with exact existing file/line evidence. Report
APPROVE or REJECT only under the supplied result contract; missing essential evidence
is BLOCKED. Include coverage, exclusions, check log and remaining uncertainty even
when there are no findings. Never promise correctness beyond inspected evidence.
```
