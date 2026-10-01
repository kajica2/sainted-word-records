# Required additional Herdr review

When selected, use this final independent review inside TICKET-LOOP, after its ordinary
review/fix obligations reach a reviewable candidate and before SWEEP. @core-critique and
the domain team still run. Suppress only the legacy Codex second opinion.

No cross-kind fallback, same host no-op, or clean-tree skip: committed-only PR changes
remain review targets. The shared Claude launcher tries TeamClaude first and permits
only its bounded native-Claude fallback. The selected kind and a new Herdr tab remain
mandatory in every mode. Choose exactly one scope path before binding the request.

## Writable PR and local checkout

Bind the validated cwd, mode, PR identity (when applicable), actual target base,
merge-base, head and staged/unstaged/untracked digests as candidate_identity. Supply
reconciled requirements and this identity to the bound HERDR_REVIEW_SKILL with
`--bypass --{agent_kind} --target code --base {validated_local_base_commit} --inspect-only`.
For a writable PR, resolve its actual target branch base to that local commit; never substitute
the repository default branch for a non-default PR target. For local mode, use the
already validated default-branch base from TARGET. Confirm the review checkout HEAD
matches the validated PR/local head and that the delegated packet's resolved base,
merge-base, head and dirty digests match candidate_identity before accepting its report.
A missing local base or mismatched head blocks this local-checkout path rather than
silently changing the range. Review committed changes from merge_base to head; the
actual target base remains the identity/drift guard. Pass a known Plan
explicitly when one is part of the requirement source; do not invent one for code review.

## Fork PR: remote evidence only

For a fork, skip the local-base and checkout-HEAD prerequisites above. Keep the caller
cwd solely for Pane/record ownership; never treat its source, dirty files or tests as
the fork candidate. Using TARGET's immutable remote repositories/base/head, prepare
the packet required by HERDR_FORK_CONTRACT. Resolve merge_base through pinned remote
comparison evidence and include the complete file manifest and sanitized diff/source
with content digests and original file:line mappings. Do not checkout or execute fork
code, create a worktree, or perform source/GitHub mutation. Missing essential evidence
or incomplete manifest is BLOCKED before dispatch.

Call the bound HERDR_REVIEW_SKILL with
`--bypass --{agent_kind} --target code --evidence-packet {absolute_packet_path} --inspect-only`.
Do not pass `--base` or a local Plan; include pinned intent/Plan excerpts in the packet.
Freeze candidate_identity as scope_source=remote_packet plus repository/PR/base/head/
merge_base, packet digest and file manifest; do not union local dirty state. Before
acceptance rehash packet content and re-read remote target metadata for drift under
HERDR_FORK_CONTRACT. A local HEAD mismatch is irrelevant; a remote identity/content
mismatch BLOCKS. Essential unexecuted runtime checks remain BLOCKED, never a static pass.

## Collection and disposition

Persist kind, request_id, tab/Pane/session, request/report paths, candidate_identity,
outcome and consumed iteration/fix budget in the existing decision-log handoff before
advancing. A delegated turn that switches to async wait persists poll_task_id and
deadlines in the same decision-log handoff and yields; the poller's completion resumes
this step without resubmitting.
On timeout recover the same recorded request through HERDR_MANAGEMENT_SKILL before
submitting again. Require matching completed evidence under HERDR_RESULT_CONTRACT;
missing capability, incomplete report or unrecoverable identity mismatch is BLOCKED.
No lease may be held during dispatch, waits, review or remediation. Pass `--inspect-only`:
ultra-review owns remediation, posting lease and fix budget.

Preserve raw findings and map them to existing UR/CV tickets with request provenance.
Apply the ordinary validity gate before fixing: unsupported claims require counter-evidence
and disposition; valid findings return to existing domain implementers. Re-run mapped
checks after fixes and obtain a fresh Herdr review for the changed candidate. Reuse a
completed report only when all candidate_identity, scope and requirements still match.
Charge this loop to the existing 5-iteration cap and OMB_PR_WATCH_MAX_FIXES budget; reserve
attempted batches as ticket-loop.md requires. Do not reset either counter or create a
second independent retry budget. Unresolved mandatory tickets at the limit are BLOCKED.

Mode restrictions remain binding: local mode never pushes or posts. A fork remains
review-only, with no source or GitHub mutation and no remediation loop. A complete fork
review returns parent DONE with concerns describing unresolved findings and the child
REJECT/RETRY; preserve the child verdict verbatim rather than converting it to approval.
Operational failure is BLOCKED in every mode. Summary includes selected kind, request,
Pane, reviewed candidate, outcome, ticket dispositions and unverified items. A writable
run cannot claim completion if the explicitly selected review did not complete.
