# Owned session management

Run the environment and identity preflight in [delegation](delegation.md) for every
control action. Limit records to the current resolved repository/worktree. Session
IDs refer to OMB ledger entries, not raw pane IDs. Reject path traversal, symlinks
outside the record root, forged/ambiguous identities and unknown options.

## start

`start [--codex|--claude]` uses the shared new-tab start procedure and fixed native
permission flags, opening one new tab kept until an explicit `close`. Return `session_id`,
kind, tab/Pane and record path. No arbitrary work is submitted. Independent task/review/verify
invocations each create their own new tab and never reuse it. No `run` action exists.

## status

`status` (also no action) reconciles local managed records with live Herdr state:
inspect `herdr pane get <pane-id>` and `herdr agent get <agent-name>` after checking
the server/session identity. Preserve original IDs, observed `native_session_id`
when available, and `last_observed_at`. Compare cwd, tab/workspace, kind and occupant.
If the session moved or was replaced, do not infer a new control target from position.

Report separate columns: session_id, kind, Pane, observed lifecycle, request completion,
validated verdict, last observation. `done` is not a verdict. Distinguish a live agent,
an exited agent with its shell Pane still present, a manually closed Pane, unknown
detection, and server unreachable. Server failure never proves the Pane is closed.
If no live lookup is possible, label cached observations unverified with their timestamp.
Ownership uncertainty blocks later mutation; read-only status can report the uncertainty.

If the identified request has `wait_mode=async`, `poller_owner` equals this session's own
`printenv CLAUDE_SESSION_ID` and is not `unknown`, no live poller in this session, and
`now < async_deadline_at`, `status` is the async re-arm owner per [delegation](delegation.md)
§4: re-arm the poller once with the same `async_deadline_at` and record `poll_rearm_count`,
then collect and validate under delegation §5 and close under §6 exactly as the original
poller would. When `poller_owner` is a different session, including `unknown` (which never
matches any session, not even another `unknown`), do not re-arm from here: report the request
and its `poller_owner` and instruct the user to resume from that session, via explicit `read`,
or close the request.
An interrupted sync wait (never reached `wait_mode=async`) is resumed the same way `read`
does below, gated on `sync_owner` instead of `poller_owner`.

List every record whose isolation.cleanup is retained with its worktree_path, baseline_oid,
isolated_head, unapplied commit OIDs, conflicting paths and cherry_pick state. Recovery from
cherry_pick=blocked is manual: the caller resolves or discards the retained commits, then
runs explicit close; there is no automatic retry.

## read

`read <session-id>` validates the current identity, then uses screen-first collection
and fallback rules in the shared procedure. Select active_request_id if in-flight,
otherwise latest_request_id. Display that request's
identity and report. Do not reinterpret an old request report as a new completion.
If only the original shell remains, preserve passive Pane output where attributable;
never send agent input to it. No request means screen observation only, not a verdict.

When the selected request's latest turn is still `prepared` after a
`codex_startup_dialog:*` BLOCK, reconcile identity and read the visible screen. A dialog
still shown repeats the same BLOCK without sending keys. Otherwise, with the agent ready,
always rebuild the prompt (not only on a push_policy change, unlike the [delegation](delegation.md)
§1 resume rule) with a fresh §2 snapshot, `turn_id` and `turn_started_at` (the undelivered
turn never ran), then submit it once through §4.

`read` is the other async re-arm owner per [delegation](delegation.md) §4, under the same
`poller_owner`-gated conditions and outcome as `status` above: `wait_mode=async`,
`poller_owner` equals this session and is not `unknown`, no live poller in this session,
`now < async_deadline_at` re-arms the poller once with the unchanged deadline and records
`poll_rearm_count`; a different `poller_owner`, including `unknown` (never a match, even
against another `unknown`), reports the request and its owner instead of re-arming — `read`
is exactly the explicit call that takes ownership of such a request. An interrupted sync
wait (the request was still in its foreground sync phase, never reached `wait_mode=async`)
is resumed only when the request's `sync_owner` equals this session's own
`printenv CLAUDE_SESSION_ID` and is not `unknown`: `read` sets `wait_mode=async` under the
request's original `turn_started_at`-derived deadlines (never resetting them) and re-arms
the poller. A different `sync_owner`, including `unknown`, is reported, not converted.

## follow-up

`follow-up <session-id> <text>` continues the latest task, review or verify request whose
latest accepted turn is complete or blocked_by_child, selected by latest_request_id after
reconciling any active_request_id. For blocked_by_child the text answers the child's question
within the same request scope and mutation_policy.
A session whose tab was closed cannot receive follow-up; start a new delegation.
Bind its request_id, candidate and Plan digest in the prompt. Generate a fresh turn_id
and the next turn_sequence, require both in
report markers/fields, and record them before sending. Set active_request_id and mark the
new turn incomplete, preserving prior accepted reports. This explicitly authorized new turn
gets a new deadline independent of the retained session's age; uncertain submission/recovery
keeps that same deadline. A manager-only session with no request needs an explicit
review/verify invocation, which creates a new tab. Never send while working or
identity is changed/unknown. For multiple historical requests require an unambiguous
latest request; do not guess. Use the same bounded submission/collection rules and
do not treat follow-up delivery as completion.

## close

`close <session-id>` is explicit authorization to end that owned session, including an
active request. Apply the same pre-close identity re-read and ownership checks as
[delegation](delegation.md) §6 step 2 (re-read live tab/Pane identity, `pane_count == 1`,
tab label equals `agent_name`, `tab_id` differs from the caller's own tab) before closing.
If the original agent exited, closing its remaining shell additionally requires positive
evidence of that same owned shell and no replacement/foreground process. Otherwise BLOCK
on uncertainty. Do not close a Pane or tab whose occupant has been replaced, another
user's Pane or tab, any tab that is not tab_owned, or any workspace/server. Automatic
close after validated collection is defined in delegation §6; there is no blanket
stop/reset.

Best-effort read/save visible output first; do not wait indefinitely for a full report
when the user explicitly closes a running request. Record it as cancelled/incomplete,
never completed or passed. On confirmed closure clear active_request_id, retaining
latest_request_id and cancelled turn evidence. Persist the closure intent, then apply
[delegation](delegation.md) §6 step 2's three-branch rule verbatim (clean close when all
checks pass; owned-Pane-only close on `pane_count > 1` or a legacy session; close nothing
on a label mismatch or caller-tab match) to select `herdr tab close <tab_id>` or
`herdr pane close <recorded-pane-id>`.

Verify response and subsequent lookup in the SAME server/session: explicit absence
confirms closed_at (`tab_not_found` for a tab close, Pane absence for a Pane close).
An unreachable server/timeout leaves close_outcome uncertain; do
not repeat blindly. Already-absent IDs are idempotent record reconciliation, not an
error requiring recreation. Preserve reports/records after closure. Do not claim that
closing a Pane or tab terminated detached background processes outside it.

For a request with `isolation`, explicit close never cherry-picks or removes the isolated worktree:
record cleanup=retained and report worktree_path, baseline_oid, isolated_head and unapplied
commit OIDs; the same-cwd scan ignores an explicitly closed session.

`close --completed` first freezes the candidate session-ID list for this project:
each must have a valid result — completion=complete and no active request for
latest_request_id already collected (active_request_id is null after accepted
completion). Completed
FAIL/REJECT reports qualify; blocked_by_child, timeout, unknown, cancelled, missing and
incomplete results do not. Revalidate each live identity and absence of new work immediately
before its close. Skip/report any session that is working, changed or uncertain.
Never broaden this request to all panes merely because the eligible list is empty.
The explicit action authorizes these eligible closes without another confirmation.
