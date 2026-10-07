# Shared Herdr delegation procedure

This is an execution contract for the host model, not an executable helper. Entry
skills supply the resolved watchdog bounds and result/prompt contract resources.
Use the installed CLI as syntax authority; the examples were checked against Herdr
0.9.1. Read the current official [agent automation](https://herdr.dev/docs/agent-automation/),
[CLI reference](https://herdr.dev/docs/cli-reference/), and
[agent skill](https://herdr.dev/docs/agent-skill/) when capabilities differ.
Do not install, update, restart, or alter Herdr integrations automatically.

## 1. Validate before creating anything

- Run `printenv OMB_HERDR_DELEGATE`; when it prints `1`, this process is a delegated
  agent: return BLOCKED before any mutation and never create a tab, Pane or agent.
- The default is Codex. `--codex` and `--claude` are mutually exclusive; repeating
  one selector normalizes to one value. Reject conflicts before mutation. Selecting
  the same host still requires a fresh independent CLI. No automatic fallback to
  another agent kind, native sub-agent, or direct `codex exec` is allowed. Claude uses
  the bounded TeamClaude-first, native-Claude fallback in [Claude launcher](claude-launcher.md);
  this is a same-kind launch adapter, never a fallback from Herdr.
- Run `printenv HERDR_ENV`; require `HERDR_ENV=1` before any control command. Read
  `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, and `HERDR_PANE_ID` with `printenv`. Never infer
  caller identity from the currently focused UI or inspect another session outside Herdr.
- Run `herdr --version`, `herdr --skill`, `herdr agent --help`, `herdr pane --help`,
  and relevant subcommand `--help`. Never run bare `herdr` for discovery. Verify the
  selected CLI with its `--version` and `--help` before starting it; require the native
  permission option. For Claude also inspect `teamclaude version` and `teamclaude --help`
  under the launcher contract; a definitively unavailable wrapper permits native Claude.
  Status/read/close validate recorded live identity without requiring
  a fresh CLI launch or an installed executable that an already-running process no longer needs.
- After the environment check, run `herdr status`, `herdr pane current --current`,
  `herdr agent list`, and caller pane layout. Resolve session/server context and caller
  IDs from current responses. Check server capability, selected kind, cwd and access.
  Missing identity/capability is BLOCKED, not permission to guess or reconnect elsewhere.
- Claude uses `--dangerously-skip-permissions`; Codex uses
  `--dangerously-bypass-approvals-and-sandbox -c check_for_update_on_startup=false`
  (the config override suppresses the interactive startup update prompt, which
  otherwise blocks the pane before the prompt is sent). These are fixed
  native launch arguments, not prompt text: after Herdr's `--` for agent start,
  or after `teamclaude run` for the wrapper launch. No repeated opt-in, restricted
  substitute, or `--allow-dangerously-skip-permissions` alone. Record actual argv and
  versions; an unsupported flag or managed-policy refusal BLOCKS. This does not grant
  OS administrator rights or change global settings.

**Mutation and push policy (SSOT — entries cite this, do not restate).**
`mutation_policy` defaults to `full`; entries pass `inspect_only` for `--inspect-only`
or remote_packet and `plan_only` only when a caller requests it. `push_policy` defaults
to `current_branch` under `mutation_policy=full`, and is forced to `none` under
`plan_only` and `inspect_only` regardless of caller request. Under `full`, an explicit
`--no-push` also forces `push_policy=none`. `omb-herdr-review` selects `plan_only`
(`push_policy=none` implied) via `--plan-only` (valid only with `--target plan`) and
forces `push_policy=none` under `full` via `--no-push`; `omb-herdr-verify` forces
`push_policy=none` under `full` via `--no-push`.
A dirty-checkout isolated run (§2) forces push_policy=none regardless of caller request.

`push_policy` is additionally forced to `none`, regardless of caller request, when any
of the following holds at request-freeze time (§2):
- `pre_request_dirty`, or any staged or untracked non-ignored path, is non-empty — edits
  and commits by the delegate remain permitted; only the push is downgraded, and this
  downgrade is recorded as a concern (reconciled against the delegate's actual commits in
  [result contract](result-contract.md) step 3).
- `HEAD` is detached, the current branch is the repository default branch (resolve
  `refs/remotes/origin/HEAD`, fall back to `main`, then `master`), or the current branch
  matches the protected set `main`, `master`, `develop`, `release/*`, `hotfix/*`.
- The main session started this delegation on its own judgment rather than an explicit
  `/omb:herdr*` invocation by the user, unless the user's own request explicitly asks
  for a push. Explicit user invocation keeps the defaults above.
- The pre-submission remote snapshot below fails, or the repository has no configured
  remote.

**Single evaluation point.** `push_policy` is evaluated at exactly one instant: the §2
pre-submission snapshot — the same snapshot that records `pre_request_head`,
`pre_request_dirty` and `pre_request_remote_refs` — taken immediately before building the
prompt. Do not re-evaluate it after the prompt is built for that same submission. Rebuild
is resume-only: on resuming a session whose prompt was built but never submitted (e.g.
after an interrupted turn), re-run the §2 snapshot; if the freshly evaluated `push_policy`
differs from the one embedded in that stored, unsent prompt, discard the stored prompt and
rebuild it with the fresh policy and a fresh `turn_id` before submitting. Never submit a
prompt whose embedded `push_policy` no longer matches its own submission-time evaluation.

## 2. Freeze scope and persist identity

Resolve cwd, repository/worktree and Plan paths as absolute paths. An explicit Plan
wins; otherwise only a uniquely identified contextual Plan may be used. Never use
a newest-file glob. `target_kind=plan` requires an explicit Plan and its cited sources;
it does not require an implementation diff. Verification requires requirements/Plan,
not an OMB TODO. On ambiguity clarify only outside bypass; otherwise BLOCK.

The default `scope_source=local_checkout` uses the local scope rules below. Review-only
`--evidence-packet` instead follows [fork evidence](fork-evidence.md); never require the
caller checkout HEAD to match that remote target or union its dirty files into the review.

For local code scope, resolve the requested base to a local commit and its merge-base with
HEAD. If omitted, establish the repository's default branch from Git/config evidence;
do not assume main/master or silently use HEAD. Include committed merge-base-to-HEAD
changes (merge_base -> head), staged,
unstaged and relevant untracked regular files. Record excluded secret/binary/generated
files and reasons. Do not ingest credentials into the packet.

Keep the actual resolved target base distinct from merge_base: base is the target identity
and drift guard; merge_base defines the committed diff. Target-only commits are not PR changes.
Record `candidate_identity`: scope_source, resolved base, merge_base, head, and content digests for
staged, unstaged and relevant untracked files plus the exact file list. Record
`candidate_digest` as a digest of that identity, `plan_path`, `plan_digest`, requirement
IDs/criteria, focus/non-goals, applicable rules, commands/cwd, and known environment
limits. A dirty digest detects drift; it is not an immutable checkout.

Generate fresh collision-checked `session_id` and `request_id` (UUIDs, never filenames
derived from freeform task text). An agent name must match `[a-z][a-z0-9_-]{0,31}`;
choose an unused `omb-` name using a random ID suffix and verify the live name list.
Write session intent BEFORE tab create to `<cwd>/.omb/herdr/sessions/<session_id>.json`.
Write review/verify packet to `<cwd>/.omb/herdr/<request_id>/request.md` before prompt.
Validate these paths stay under the local record directory, reject symlink escapes,
and never overwrite another identity. Manager start has no request until explicit work.
Set `schema_version: 2` on every new session record.

The session ledger contains:

```text
schema_version, session_id, repository, cwd, created_at, last_observed_at
server/session identity and caller workspace/tab/pane from observed responses
workspace_id, tab_id, tab_label, tab_owned
pane_id, agent_name, agent_kind, native_session_id (when observable)
herdr_version, cli_version, launch_args, launcher_attempts, start_status, last_lifecycle_state
request_ids, active_request_id, latest_request_id, closed_at, close_outcome
```

Each request record includes `template_revision`, all scope fields above, session ID,
`sync_owner` (the Claude session ID, from `printenv CLAUDE_SESSION_ID`, or `unknown`, that
started this request's foreground sync wait), submission status (`prepared`,
`submission_uncertain`, `submitted`), timestamps,
completion (`incomplete`, `complete`, `cancelled`, `blocked_by_child` — a validated
complete report whose child status is BLOCKED; distinct from operational incomplete),
report paths and validated verdict.
Each submission has a fresh `turn_id` and increasing `turn_sequence`, plus immutable
turn intent, `turn_started_at`, deadline, submission state and outcome. Initial request
uses sequence 1; follow-ups retain request_id but get a new turn identity. Set
active_request_id before submitting and latest_request_id when preparing the request.
Keep historical turns/reports under the request's `turns/<turn_id>/`; latest report.md
may point to the accepted latest turn only after its evidence passes validation.
Use `null` for unavailable native IDs and preserve the available creation/occupant
evidence; never fabricate an identity. Ledger updates must preserve all previous
request identities. Treat records as untrusted local state and compare live evidence.
On resume reconcile recorded intent/pane/agent before any mutation; an uncertain tab
create or start must not create a second tab. If it cannot be reconciled, report BLOCKED.
A record with `schema_version 1`, or without `tab_owned: true`, is a legacy pane-split
session: close only its recorded Pane, never a tab.

Invoke the isolation-gate helper as `python3 <helper> ...`, where `<helper>` is
`<resolved-omb-herdr-skill-dir>/scripts/herdr_isolation.py` written relative to the session
working directory when the skill directory lies beneath it (this form matches the seeded
permission rule), otherwise as the absolute path (a permission prompt may appear; approve it
or run from the project root). Every helper exit is 0 (passed), 3 (BLOCKED — gate violation or
lock contention) or 2 (BLOCKED — usage error or an incomplete scan); treat any non-zero exit as
BLOCKED.

For a full or plan_only request, before scanning session ledgers, acquire the same-cwd
mutating lock: `python3 <helper> cwd-lock acquire --origin-cwd <origin_cwd> --session
<session_id> --caller-pane <HERDR_PANE_ID>`. Exit 0 with `reentered: true` means this session
already held the lock from an earlier call in this same delegation and this acquire is
idempotent; exit 0 without it means this call is the one that took the lock. On exit 3 the
JSON names the current owner (`session_id`, `caller_pane`, `nonce`) and a `release_command`;
retry exactly once with `python3 <helper> cwd-lock takeover --origin-cwd <origin_cwd>
--session <session_id> --caller-pane <HERDR_PANE_ID> --stale-nonce <owner-nonce>`. If that
takeover also exits 3, return BLOCKED with the owner's `session_id` and `caller_pane`, plus the
operator command from the JSON — `python3 <helper> cwd-lock release --force --owner-nonce <n>
--origin-cwd <origin_cwd>` — for the user to run themselves, and only after confirming the
owner session has actually ended. `--force` release is authorized by possession of that
command's `owner-nonce` alone, and the nonce is deliberately visible in every `status` read
and conflict payload — secrecy of the nonce is never the control. This prose rule is the
control: the model never runs the `--force` release on its own judgment. The paired
`permissions.ask` entry for that exact
command is a best-effort nudge only — it is bound to the literal command prefix (a different
absolute path or argument order will not match it), it can be skipped depending on the active
permission mode (e.g. bypass), and the lock itself is a cooperative file that any process can
remove. inspect_only requests never call cwd-lock. Every BLOCKED return between a successful
acquire and tab creation releases the lock with `python3 <helper> cwd-lock release
--origin-cwd <origin_cwd> --session <session_id>` — except when that acquire itself reported
`reentered: true`, in which case the lock belongs to an earlier call in this same session and
stays held for that call to release.

Before tab creation for a full or plan_only request, scan session ledgers for the same cwd.
The blocking condition is a session whose cwd == this cwd or whose isolation.origin_cwd == this
cwd. If any such session has an active_request_id, or a retained tab whose latest request is
blocked_by_child, with mutation_policy full or plan_only, or isolation.cherry_pick in
{pending, blocked}, return BLOCKED with that session_id; a session that went through an explicit
close is excluded. While such a request is active (sync or async), the main
session edits no files in that cwd and starts no other mutating delegate there;
inspect_only requests are unaffected.
For an isolated request "edits no files in that cwd"
applies to the isolation worktree — the origin checkout may keep being edited, though an overlap
with the delegate's commit path ends the integration precheck in BLOCKED. For an isolated
request the session cwd (and the `herdr tab create --cwd` value) is the isolated path, while
isolation.origin_cwd is the directory this scan, the record paths and integration use.
Immediately before submission record pre_request_head (HEAD OID), pre_request_dirty
(path -> content digest for staged, unstaged and untracked files), and
pre_request_remote_refs in the request record: run `git remote` to list every configured
remote, then run `git ls-remote --heads --tags <remote>` for each with a
per-remote bound and no interactive credential prompt, e.g.
`GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes' perl -e 'alarm 20; exec
@ARGV' -- git ls-remote --heads --tags <remote>` (the Bash tool's own `timeout` parameter
is the outer bound; the `alarm 20` is the inner, per-remote bound so one hung remote
cannot consume the whole outer budget alone), recording the full result as a `remote ->
{ref -> OID}` map. A failed `git remote`/`git ls-remote` call on any configured remote, a
per-remote timeout, or the repository having no configured remote, forces
push_policy=none and records a concern "remote unverified"; it never blocks the request.
A post-collection timeout under the same bound counts as a snapshot failure under
[result contract](result-contract.md) step 3 rule (b), with the same
declared-pushes/push_policy=current_branch BLOCK-vs-concern split.
When pre_request_dirty or any pre-staged path is non-empty, or the push-policy downgrade
conditions in §1 apply, force push_policy=none and record a concern; this does not block
edits or commits. For task mode pre_request_head/pre_request_dirty is the
candidate_identity.

### Dirty-checkout isolation

```text
TRIGGER  mutation_policy=full AND
         `git -C <origin_cwd> status --porcelain=v1 -z --untracked-files=all` is non-empty.
         plan_only requests run in place and are never isolated (they cannot commit or push).
         Clean checkout, inspect_only and remote_packet: skip this subsection.
1  origin_top = rev-parse --show-toplevel; origin_branch = symbolic-ref --short HEAD
   (detached HEAD -> BLOCKED); origin_head = rev-parse HEAD; primary_root = parent of
   realpath(`git -C <origin_cwd> rev-parse --git-common-dir`), never CLAUDE_PROJECT_DIR.
   A non-empty origin index (`git -C <origin_cwd> diff --cached --quiet` fails) is recorded as a
   concern now: integration requires an empty index and will BLOCK otherwise.
2  origin_dirty = path -> {kind, mode, digest} from that -z status (isolation-time set, kept in the
   record), computed with `python3 <helper> dirty-map --repo <origin_cwd> --out <request_dir>/origin-dirty.json`
   (its JSON `entries` map is origin_dirty). A rename is a delete of the old path plus an add of
   the new one. Classify with lstat: regular files are copied; a symlink is recreated only when its
   stored target is relative and resolves inside origin_top; submodule entries, absolute-target
   symlinks (they would point back into the caller's checkout), outside symlinks and other types
   are excluded. Always exclude `.env*`, `*.pem`, `*.key` (workflow/13-pr-watch.md HARD rule 3)
   plus the §2 secret/binary/generated judgments. Excluded paths stay in origin_dirty and are
   listed as isolation gaps.
3  iso_path = <primary_root>/worktrees/.herdr-isolate/<first 8 hex of request_id>. Run these five
   checks, in order, before any baseline copy, Plan mapping, tab creation or launch:
3a Ancestor-symlink gate: `python3 <helper> ancestors --root <primary_root> --path <iso_path>`.
   Any non-zero exit -> BLOCKED, reporting the JSON's symlink/non-directory path list; nothing is
   created yet.
3b Require `git -C <primary_root> check-ignore -q worktrees/.herdr-isolate/probe` to succeed and
   iso_path to be absent; otherwise BLOCKED before anything is created.
3c Run `git -C <origin_top> worktree add --detach <iso_path> <origin_head>`. This worktree carries
   no branch and is never registered with the omb-worktree scripts or DB. A failed `worktree add`
   is BLOCKED; nothing was created by this procedure, so there is nothing to clean.
3d Post-check: `python3 <helper> verify-worktree --repo <origin_top> --path <iso_path>` (confirms
   the worktree's realpath matches iso_path and a `detached` porcelain entry exists for it). Any
   non-zero exit removes the worktree with the same rule as the Tracked-symlink gate below, then
   BLOCKED.
3e Tracked-symlink gate: run `python3 <helper> tracked-symlinks --worktree <iso_path>`, which lists
   every index entry with `git -C <iso> ls-files --stage -z`; for each mode 120000 entry it reads the
   link target from the worktree with `readlink`, never dereferencing the link (reading its raw target
   text is not the same as following it to a destination file). It applies both a lexical rule and a
   physical walk: any relative target that escapes <iso> once normalized lexically against the link's
   own directory inside <iso> (e.g. `../../../../repo/file`) is an escape, and the physical walk
   additionally follows chained links component by component, expanding each link's own target into
   the pending path stack — a missing path component with any `..` still left in that pending stack is
   also an escape, and a chain of more than 40 hops is BLOCKED as a loop. On a checkout with
   `core.symlinks=false` (tracked "symlinks" stored as plain text rather than real filesystem links),
   `readlink` fails and the scan cannot complete, which is treated the same as any other incomplete
   scan. Any absolute target, any escaping relative target by either rule, or a scan that cannot
   complete, -> BLOCKED — exit 3 lists the affected paths, exit 2 means the scan could not complete;
   never rewrite these links (an escaping committed link would lead a delegate back into live caller
   files).
   On that BLOCKED path only (no delegate exists yet), remove the just-created worktree with
   `git -C <origin_top> worktree remove --force <iso_path>` after confirming it is a `detached`
   entry at iso_path in `worktree list --porcelain`; if that fails, retain it and report its path.
4  Baseline: copy each non-excluded origin_dirty path (bytes and mode) into <iso> or
   `git -C <iso> rm -q --` a deleted path; `git -C <iso> add --` those paths;
   `git -C <iso> commit --no-verify -m "chore(herdr): isolation baseline <request_id>"`;
   baseline_oid = HEAD and baseline_committed=true. When nothing was copied (every dirty path
   excluded) make no commit: baseline_oid = origin_head and baseline_committed=false. A baseline
   commit is local-only: never pushed or cherry-picked. Fidelity: every copied digest in <iso> equals origin_dirty;
   mismatch -> remove the worktree and BLOCK.
5  Plan mapping (read-only): when plan_path is inside origin_top and absent in <iso> (ignored or
   excluded), copy its bytes there uncommitted and pass that copy as the prompt's plan_path (same
   plan_digest). A delegate edit to the mapped copy is reported as a gap and never written back.
6  iso_cwd = <iso>/<relpath(origin_cwd, origin_top)>; session record cwd = iso_cwd. Records and
   request files stay under <origin_cwd>/.omb/herdr/. Recompute candidate_identity in <iso>
   (head = baseline_oid, no dirty files); keep origin's as isolation.origin_candidate_digest.
7  The following pre_request snapshot is taken in <iso>: pre_request_head = baseline_oid.
   The prompt's isolated field is true (false for every non-isolated request).
Never run git stash anywhere in this procedure (the stash stack is shared across worktrees and sessions).
```

When the request was isolated per the trigger above, the request record also includes
`isolation: {origin_cwd, origin_top, origin_branch, origin_head, origin_dirty, origin_candidate_digest,
worktree_path, baseline_oid, baseline_committed, isolated_head, plan_map, applied_commits,
integrated_candidate_identity, cherry_pick: pending|applied|blocked, cleanup: pending|removed|retained}`.
A record without these fields reads as non-isolated. `schema_version` stays 2 since these fields are
additive only.

## 3. Create one new tab and start once

Resolve the caller workspace ID from observed identity (`HERDR_WORKSPACE_ID` or
`herdr status`). Keep the caller's own tab/focus untouched and execute once with
safely quoted literal cwd:

```text
herdr tab create --workspace <caller-workspace-id> --cwd <absolute-cwd> --label <agent-name> --env OMB_HERDR_DELEGATE=1 --no-focus
```

Read `.result.tab.tab_id` and `.result.root_pane.pane_id`; immediately record returned
tab/pane/workspace IDs and set `tab_owned: true`. Never derive IDs from examples or
pane order. The root Pane is the agent Pane; confirm it is an available shell.

For a full or plan_only request, immediately bind the acquired cwd-lock to this tab:
`python3 <helper> cwd-lock bind --origin-cwd <origin_cwd> --session <session_id> --tab
<tab_id>`. Exit 0 records `tab_id` on the held lock so a later takeover can check whether
this tab is still alive; exit 3 (owner session mismatch) is unexpected after a successful
acquire in this same session and is reported as a concern without retrying — release the
lock per the rule above and return BLOCKED.

Independent task/review/verify invocations each create exactly one NEW tab; do not
reuse a manager-started tab, another user's tab, clear a user's session, create a
workspace, or create any worktree other than the §2 isolation worktree. On tab-creation
uncertainty inspect `herdr tab list` for the
recorded label before proceeding, never repeat blindly.

For Codex use the unused recorded name and returned ID:

```text
herdr agent start <agent-name> --kind codex --pane <pane-id> --timeout 30000 -- --dangerously-bypass-approvals-and-sandbox -c check_for_update_on_startup=false
```

For Claude follow [Claude launcher](claude-launcher.md): attempt TeamClaude first in
this same Pane, then native Claude only when the documented fallback conditions hold.
Never invent `--kind teamclaude` or a custom executable override for `agent start`.
Successful start or verified manual-launch detection identifies a ready agent;
record `.result.agent` and observed native identity. For startup `agent_not_ready`,
timeout or failure, inspect get/visible read, retain the tab and report the cause.
Do not relaunch or send prompts to an unready/unknown occupant.

Codex `agent start` can report `idle` while a startup dialog owns the screen, and
prompt keystrokes would then answer that dialog (Enter accepts its default, such as
"Update now"). Before the first prompt, read the visible screen. If it shows a folder
trust question ("Trust this folder"), "Hooks need review", or an update offer, send no
keys: BLOCK with `codex_startup_dialog:<folder_trust|hook_trust|update>`, keep the turn
`prepared` (never submitted), and retain the tab, lock and any isolation worktree. Tell
the user to answer the dialog in that tab, then run `read <session-id>` to deliver the
prompt, or `close` the session. An answer given inside a linked worktree is stored for
the repository root, so it also covers later isolation worktrees of that checkout.
Never trust hooks or folders on the user's behalf.

## 4. Submit once and bound observation

Build the English prompt using [prompt contract](prompt-contract.md), the entry's
mode resource, and [result contract](result-contract.md). Store the exact prompt in
request.md. Deliver prompt as ONE safely quoted argument; do not interpolate arbitrary
Plan/log text into shell double quotes or use `$(cat ...)`. Use a structured subprocess
argument array or correct shell quoting. No persistent runtime helper is necessary.

Read `OMB_HERDR_SYNC_WAIT_S`, `OMB_HERDR_POLL_S` and `OMB_HERDR_ASYNC_CEILING_S` with
`printenv`; validate each as a positive integer, clamp `OMB_HERDR_POLL_S` to 5-60, and
when `OMB_HERDR_SYNC_WAIT_S` exceeds `OMB_HERDR_ASYNC_CEILING_S` fall back to the
documented defaults and record a concern instead of guessing. `turn_started_at` is the
authorized turn's start (epoch seconds, one bare `date +%s` call); the initial request's
turn starts before agent launch (manager-only start has its own bounded launch
operation), a later explicit idle follow-up starts a new bounded turn, and
`OMB_HERDR_SYNC_WAIT_S`/`OMB_HERDR_ASYNC_CEILING_S` are both counted from that instant,
not from session age — never reset on progress, timeout, resume or repeated polling.

Immediately before submitting, compare live agent/pane/server identity and readiness
against the ledger. Mark `submission_uncertain` before the call; update it only from
observed evidence. Send `herdr agent prompt <agent-name> <prompt> --wait --timeout <ms>`.
Use `min(60, OMB_HERDR_POLL_S, remaining sync budget seconds) * 1000` for the timeout.
For subsequent observation use `herdr agent wait <agent-name> --timeout <ms>` with the
same slice formula. No wait call exceeds 60 seconds. Recovery keeps the pending turn's deadline;
a resumed sync phase re-slices only the remaining `OMB_HERDR_SYNC_WAIT_S` budget, never a fresh one.

`idle`/`done` are collection signals, not proof of request completion. Waits track
lifecycle, not request turns. Never send a new prompt while an existing turn works.
For `blocked`, `agent_not_ready`, `unknown`, disconnect or exit, inspect `agent get`
and visible read. Do not answer login, model-selection or approval dialogs beyond
the task's authorization; return the actionable blocker without changing launch mode.

`timeout` and `agent_prompt_stalled` do not prove non-delivery. Never blindly resubmit
the prompt, restart the agent or create a second tab. Inspect request markers and
live state first.

If the sync phase exhausts `OMB_HERDR_SYNC_WAIT_S` while the agent is still working,
switch to the background poller instead of continuing to occupy the caller's turn.
Record `wait_mode=async` and `async_deadline_at = turn_started_at +
OMB_HERDR_ASYNC_CEILING_S` (epoch seconds) in the request record, then run exactly
once with `run_in_background: true`:

```text
bash <resolved-omb-herdr-skill-dir>/scripts/herdr-async-wait.sh <agent-name> <OMB_HERDR_POLL_S> <async-deadline-epoch>
```

Record the returned background task ID as `poll_task_id` and the launching session as
`poller_owner` (`printenv CLAUDE_SESSION_ID`, or `unknown` if unset). Report the session,
request and tab IDs plus the deadline to the user, then end the turn without an `<omb>` tag —
this loop runs in the main session, which owes no per-response status tag (same
reasoning as `workflow/13-pr-watch.md` HARD rule 1). One poller runs per request; never
launch a second one while `poll_task_id` is still live.

When the poller's background completion re-invokes the main session, branch on its
`HERDR_ASYNC_STATUS`: `SETTLED` moves to collection under §5 and closure under §6;
`CEILING`, `LOST` or `INVALID` records the turn incomplete, retains the tab, and returns
BLOCKED with the exact session/request/tab/pane IDs for later read. A session restart
resumes the poller automatically only when the restarted session's own
`printenv CLAUDE_SESSION_ID` is unchanged (matches the recorded `poller_owner`) — the same
session process picking back up its own live poll under the unchanged `async_deadline_at`.
Otherwise `status` reports the request as orphaned (`poller_owner`, `async_deadline_at`, and
the last known session/request/tab/pane IDs) and takes no action on its own; an explicit
user `read <session-id>` call is what takes ownership — it records the reading session as
the new `poller_owner` and re-arms the poller once, under the same unchanged
`async_deadline_at`, never a fresh one.

`poller_owner` and `sync_owner` are recorded as `unknown` when `CLAUDE_SESSION_ID` was unset
at the time they were captured. `unknown` marks "no session identity was available"; it is
never treated as a wildcard and never matches any session for ownership-gating purposes,
including a second `printenv CLAUDE_SESSION_ID` that itself resolves to `unknown`. A request
whose recorded owner is `unknown` is therefore never auto-resumed by a restart: it is
resumed only through the user's explicit `read` (which records the current session as the
new owner) or ended via `close`.

`status` and `read` (management.md) are the explicit re-arm owner, gated by `poller_owner`
(recorded above): when `wait_mode=async`, `poller_owner` equals this session's own
`printenv CLAUDE_SESSION_ID` and is not `unknown`, no live `poll_task_id` in this session, and
`now < async_deadline_at`, they re-arm the poller once with the same deadline and record
`poll_rearm_count`; their yield message includes the manual resume command (`/omb:herdr
read <session-id>`, per the `omb-herdr` SKILL.md argument-hint). Keep it simple when
`poller_owner` is a different session, including `unknown`: never re-arm from here — report
the request (session/request/tab IDs, `poller_owner`) and instruct the user to resume from
that owning session, via explicit `read`, or close the request instead. After
`async_deadline_at`, the retained agent is unmonitored and may still act, so the user should
read and close it.
An interrupted sync wait (the phase that ran before `wait_mode=async` was ever set) leaves
the request active with its original `turn_started_at`-derived deadlines unchanged; `read`
converts it to `wait_mode=async` and re-arms the poller only when the request's
`sync_owner` equals this session's own `printenv CLAUDE_SESSION_ID` and is not `unknown` —
otherwise report the request and its `sync_owner` without converting it. Never treat the
interruption as completion.

## 5. Collect, validate, and preserve

Use `herdr agent read <agent-name> --source recent-unwrapped --lines 120`; this returns
plain text, not JSON. If necessary increase the row count while idle. For a working,
blocked or unknown agent use `--source visible`; history reads can return agent_not_idle.
Save retrieved raw output locally as response.md without losing full failing check logs.

Request file output only after an incomplete screen read and a larger idle history
read still fail. Ask the SAME idle agent to reproduce the completed report as Markdown
in a specified safe temporary directory, keeping request_id/candidate identity and
performing no new review. Give this collection-only submission its own turn_id and
turn_sequence; require those markers in the returned wrapper and retain the original
report's assessment turn identity as `report_origin_turn_id`. A collection-only turn
has a bounded collection deadline, never extends an unresolved assessment or reruns it.
Read the returned regular file only after checking its path
and symlinks. The initial prompt must not request file output. Record this recovery as
a follow-up, not a new independent review or silent acceptance of a partial report.

Validate request markers, fields, evidence and result with [result contract](result-contract.md).
Recompute scoped candidate and Plan digests after collection. For a remote packet,
recompute its content identities and revalidate pinned target metadata as the fork contract
requires; the caller checkout is not the candidate. Under inspect_only, source drift
invalidates affected conclusions until checked. Under full or plan_only, compare the
recomputed identity with the pre-request snapshot and the declared
post_candidate_identity/post_plan_digest, then reconcile delegate mutations under
the result contract step 3. Concurrent user edits must not be attributed without evidence.
Do not reset, stash, checkout, delete or repair changed source here. Preserve the actual
changes and explain them. This applies to the origin checkout; an isolated request continues
with the integration step below.

Write report.md with validated findings and the original verdict, or an explicit
incomplete reason; preserve previous versions in the corresponding turn directory.
On validated latest-turn completion, clear active_request_id and preserve latest_request_id
for later reading/follow-up. This applies to both `complete` and `blocked_by_child`
completions. A new follow-up makes that request incomplete/in-flight again
without erasing its prior accepted turn. Timeout/uncertain delivery keeps active_request_id
until reconciliation proves completion or explicit close records cancellation. Never clear
an in-flight pointer merely from idle/done without the matching turn report.
Record session/request completion separately from process state.
Return report/session paths; these are local run artifacts, not durable source truth.

For a non-isolated full or plan_only request, once this validated completion clears
active_request_id with completion `complete` (not `blocked_by_child`), release the same-cwd
lock: `python3 <helper> cwd-lock release --origin-cwd <origin_cwd> --session <session_id>`. A
`blocked_by_child` completion also clears active_request_id but keeps the lock held (the
same-cwd scan blocks on its retained tab) until a follow-up completes or `close`. An isolated request's
lock instead releases below, once `cherry_pick=applied`. inspect_only never acquired the
lock, so there is nothing to release here.

### Isolated integration

```text
Runs only after step-3 reconciliation accepted the report (no BLOCKED).
1  isolated_head = `git -C <iso> rev-parse HEAD`. Leftovers: `git -C <iso> status --porcelain=v1 -z
   --untracked-files=all` ignoring the mapped Plan copy; a path declared in changed_files but
   uncommitted -> cherry_pick=blocked, BLOCKED (work not delivered). Every other uncommitted
   leftover is listed in the report as not delivered before any removal; none is silently dropped.
2  History checks in <iso>: `merge-base --is-ancestor <baseline_oid> <isolated_head>` succeeds;
   `rev-list --merges <baseline_oid>..<isolated_head>` is empty. Publication check, only when
   baseline_committed=true (otherwise baseline_oid is origin_head, which may legitimately be on
   the remote): `branch -r --contains <baseline_oid>`, `tag --contains <baseline_oid>` and
   `for-each-ref --points-at <isolated_head> refs/remotes` are all empty. Any failure -> BLOCKED.
3  picked = `rev-list --reverse <baseline_oid>..<isolated_head>`; P = union of
   `diff-tree --no-commit-id --name-only --no-renames -r <oid>` over picked. Pre-checks in origin:
   current branch == origin_branch; `git -C <origin_cwd> diff --cached --quiet` succeeds (else
   BLOCKED telling the caller to commit or unstage; never unstage automatically). Record
   pre_pick_head = `git -C <origin_top> rev-parse HEAD` and pre_pick_dirty = the complete origin
   dirty map, computed with `python3 <helper> dirty-map --repo <origin_top> --out
   <request_dir>/pre-pick-dirty.json` using the step-2 classification and digest rules (excluded
   entries included). Then require P ∩ isolation-time
   origin_dirty = ∅; P ∩ current origin dirty paths = ∅; no p in P exists in the origin working
   tree untracked or ignored (`git -C <origin_top> ls-files --error-unmatch -- <p>` fails while
   the file exists). Any failure -> cherry_pick=blocked, BLOCKED. An overlap BLOCKED tells the
   caller that a delegate edit to a path dirty at isolation can never be integrated: commit
   those paths first so the delegate runs in place.
4  picked empty -> skip. Else `git -C <origin_top> cherry-pick <baseline_oid>..<isolated_head>`
   (no -x: isolated OIDs are not kept). On a stop: a conflicted path that was dirty at isolation
   time -> `git cherry-pick --abort` immediately. Otherwise resolve only paths clean at isolation
   time and clean now, keeping both sides' intent, run their mapped tests, then
   `git cherry-pick --continue`; if that is not possible, `git cherry-pick --abort`. After any
   abort re-hash origin dirty paths, report any digest change, set cherry_pick=blocked and
   BLOCK listing picked OIDs and conflicted paths. Never discard, stash or overwrite origin dirty work.
5  Record applied_commits (isolated OID -> new OID) and integrated_candidate_identity
   {origin_branch, HEAD after picks, origin dirty digests}; cherry_pick=applied, then release
   the same-cwd lock: `python3 <helper> cwd-lock release --origin-cwd <origin_cwd> --session
   <session_id>`. A review/verify
   verdict transfers to integrated_candidate_identity only when all of these hold: pre_pick_head
   equals isolation.origin_head; pre_pick_dirty equals isolation.origin_dirty exactly (same paths,
   kinds, modes and digests, excluded entries included), checked with `python3 <helper>
   compare-dirty --expected <origin-dirty.json> --actual <pre-pick-dirty.json>` where only exit 0
   counts as equal; `rev-list <pre_pick_head>..HEAD` after the picks
   is exactly the applied_commits new OIDs; the dirty map at identity capture still equals
   pre_pick_dirty; and the verdict does not depend on an excluded path. Any drift, an unavailable
   comparison, or a conflict resolution that changed assessed content records the verdict as
   stale/unverified for the origin candidate (it never blocks an otherwise valid integration):
   never report APPROVE/PASS on bytes the delegate did not see. This gate never replaces the
   result-contract `self_fixed_pending_reverify` re-check. Pushing origin_branch stays the caller's
   decision.
On any BLOCKED here: retain the isolation worktree and tab (cleanup=retained) and report
session_id, request_id, tab_id, pane_id, worktree_path, baseline_oid, isolated_head, picked OIDs and paths.
```

Then close the tab under §6.

## 6. Close the owned tab after collection

Close only when report.md and response.md are saved under .omb/herdr/<request_id>/, the
request is recorded complete with child status DONE or RETRY (any verdict), changed-file
reconciliation (result contract step 3) did not block, and, for an isolated request,
isolation.cherry_pick=applied. The agent is
idle or done. A validated child BLOCKED report is recorded completion=blocked_by_child and keeps the
tab so follow-up can answer its question; §6 runs again after that follow-up turn completes.

1. `herdr tab get <tab_id>`: same workspace_id; `herdr pane get <pane_id>`: same tab_id,
   agent name, kind and native_session_id as the ledger.
2. Immediately before `herdr tab close <tab_id>`, re-read `herdr tab get <tab_id>` and
   check, in order: `pane_count == 1`, the tab label equals `agent_name`, and `tab_id`
   differs from the caller's own tab (`printenv HERDR_TAB_ID`). Persist close intent, then
   branch on which check failed, one cause per branch:
   - All three pass, and `tab_owned` is true: `herdr tab close <tab_id>`, then
     `herdr tab get <tab_id>` must fail with `tab_not_found` -> `closed_at`,
     `close_outcome=tab_closed`.
   - `pane_count > 1` (a user added panes) or a legacy session without `tab_owned`: close
     only the owned Pane -> `herdr pane close <pane-id>` -> `close_outcome=pane_closed_tab_retained`.
   - The tab label does not equal `agent_name`, or `tab_id` equals the caller's own tab:
     close nothing -> `close_outcome=uncertain` as a concern, with the tab retained and its
     IDs reported.

When this close confirms closure of a request whose active_request_id was still set at the
start of this step (an explicit close of an active request, per management.md's `close`, which
this rule's three branches serve verbatim), and close_outcome is `tab_closed` or
`pane_closed_tab_retained`, also release the same-cwd lock: `python3 <helper> cwd-lock
release --origin-cwd <origin_cwd> --session <session_id>`. A `close_outcome=uncertain` leaves
the closure itself unconfirmed, so the lock stays held.

For an isolated request, only after `close_outcome=tab_closed` is confirmed, run the following
in order: (1) when `baseline_committed=true`, re-run the §5 isolated-integration publication
check; (2) verify the ledger's `worktree_path` — the expected path is not the ledger value but
is recomputed from `request_id` as `<primary_root>/worktrees/.herdr-isolate/<first 8 hex of
request_id>`; the realpath of `worktree_path` must equal that expected path and must appear as
a `detached` entry in `git -C <origin_top> worktree list --porcelain`; (3) run
`git -C <origin_top> worktree remove --force <worktree_path>`. Success sets `cleanup=removed`;
a failure at any step sets `cleanup=retained` and returns BLOCKED. A `pane_closed_tab_retained`
or `uncertain` close_outcome removes nothing and reports `cleanup=retained`.

3. Unreachable server or timeout -> `close_outcome=uncertain` as a concern with the tab
   retained and its IDs reported; parent status is otherwise unchanged from the collection
   result. Do not repeat blindly.

Retain the tab and return BLOCKED with session_id, request_id, tab_id and pane_id when
the agent is working/blocked/unknown, the async ceiling expired, submission is
uncertain, the report is incomplete, or ownership/attribution is uncertain.
