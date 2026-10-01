# Operation and deployment boundaries

## Configuration

Copy [deep-agent-builder.example.json](deep-agent-builder.example.json) to a private operator-owned configuration and replace every `REPLACE_WITH_...` value. The example is structurally valid, not a deployed environment. Never commit a real host, personal path, credential, or continuation. No environment migration, production issue writes, or cron registration is implied by installing the skill.

Required deployment inputs are an allowlisted repository, actual coordinator hostname, private absolute local state directory, and authenticated GitHub writer login. `language` is `ko`; `version` is 1. The first target is `braincrew-lab/deep-agent-builder`. The repository's current default branch must be discovered; the config does not assert one.

One coordinator host owns one local SQLite journal and flock domain. All participating workers use this coordinator. State must be on a private local filesystem, never NFS or a copied multi-host journal. State directories are mode 0700, files mode 0600; symlink, owner, mode, host, and schema checks fail closed. Do not delete lock files or reuse a different state directory to bypass an active claim. There is no public daemon or automatic failover.

For local execution, the configured hostname must match the actual coordinator host. GitHub authentication belongs to the coordinator and its `/user` login must equal `writer_login`; missing priority labels or permissions defer rather than create labels. Retain all nonpriority labels, including residual GUCCI labels.

For remote execution, set client `transport="ssh"` and a trusted `ssh_host`; requests are forwarded with fixed argv `ssh -- HOST omb issue-maintainer gateway` and structured JSON stdin. Configure the server's `OMB_ISSUE_MAINTAINER_CONFIG` (or an administrator-owned forced gateway command with `--config`) to point to its private **local-transport** config. Client JSON cannot choose server config, executable, credentials, or endpoints. Failed SSH never falls back to a local writer.

## Commands

| Command | Effect |
|---------|--------|
| `omb issue-maintainer inspect --repo OWNER/REPO --config PATH [--target N ...]` | Complete bounded reads; no claim, comment, DB, or lock creation. |
| `omb issue-maintainer prepare --repo OWNER/REPO --config PATH` | Resume pending operation first, otherwise reserve one seed and return private analysis continuation. |
| `omb issue-maintainer apply --operation-id ID --decision-file PATH --config PATH` | Authenticate the one-shot continuation, validate/freeze the Decision, and execute through readback gates. |
| `omb issue-maintainer resume --operation-id ID --config PATH` | Recover that operation only when process and outcome conditions permit. |
| `omb issue-maintainer gateway [--config PATH]` | Trusted server JSON boundary; no arbitrary mutation passthrough. |
| `omb issue-maintainer normalize-cron-prompt --prompt-file PATH` | Pure prompt transformation; no config, GitHub, state, or scheduler access. |

`--target` accepts unique positive issue numbers within the configured related limit. Do not assume repeated targets authorize another issue group. These are CLI commands; the skill invocation itself accepts `--repo` and `--config` and follows the full workflow.

Default upper bounds: read timeout 30s, write timeout 60s, read retries 3, run timeout 1800s, heartbeat 60s, liveness 300s, open issues 1000, open PRs 1000, related candidates 50, consolidated sources 20, and comments 1000. Smaller configured bounds are permitted with `heartbeat < liveness <= run_timeout <= 1800`. Reaching an incomplete inventory or an evidence limit must not be reported as complete. Mutations are never blindly retried.

## Private continuation and Decision

Use a mode-0700 scratch directory outside the checkout and exclusive mode-0600 files. Establish restrictive permissions before redirecting prepare/resume stdout; never emit or read the raw continuation into a tool transcript. A local JSON transformation produces an analysis view with `data.continuation_capability` removed. The final Decision is assembled by a local JSON transformation that reads the private original and copies its token without printing it. Keep all issue-controlled strings in JSON or files, not shell fragments. Keep the private file path on argv and the token only inside its JSON. Do not pipe raw preparation errors or file contents into shared diagnostic logs.

`prepare` ends its process with a durable `awaiting_decision` reservation. Its `completed` command status is not overall completion. The fixed analysis deadline remains in force after that process exits; another cron cannot steal it merely because its PID died. The capability is consumed when apply starts and is bound to authenticated OS/SSH identity, operation, generation, and repository. Repeated apply is not a retry mechanism: inspect/resume the operation instead.

Use [decision-schema.json](decision-schema.json). It describes JSON shape, not the entire authorization contract. Runtime checks additionally enforce exact target digests, title/priority/category agreement, limits, seed membership, same repository, open state, linked PR protection, native relationships, exact code quotes, branch reachability, per-issue branch mappings, and complete source coverage bindings. The schema deliberately permits redacted stored Decisions without a capability; a new apply requires the private issued value.

When source snapshot branch metadata is empty, never substitute the repository default branch. Establish branch facts from actual source issue/PR/code evidence, then provide a complete `issue_branch_scopes` map. Every declared effective merge branch needs verified Evidence. Different scope sets require explicit unified backport intent and a completion condition naming every branch. If that intent or evidence is absent, keep links and normalize only the selected standalone issue when safe.

## Human protection

Explicit unresolved human decisions and active work require protection. Exact source quotes are evidence; assignment and residual labels alone are insufficient. Normal maintenance Decisions require `human_conflicts=[]`.

For an exact human **comment** on the reserved seed, submit a structurally valid standalone Decision with `canonical_issue=seed`, `sources=[]`, `merge_kind="none"`, `requirement_coverage=[]`, and a `human_conflicts` entry containing the seed number, actual `comment_id`, verbatim `quoted_text`, and concrete `reason`. Preserve the current intent in all other fields; these fields are validated but not published. The engine freshly validates the snapshot and quote, rejects the configured writer as the comment author, verifies any supplied Evidence, and records a local protected fingerprint with zero GitHub writes. It returns `deferred`, `data.phase="protected"`, and releases this operation's reservation. Subsequent invocations skip this unchanged seed until its semantic input changes. Finish this invocation; do not select another seed.

This is a narrow evidence binding, not automated proof of every author's intent. Do not classify a bot's text as a human decision merely because its login differs from the writer. Body/title-only conflict with `comment_id=null`, a conflict on another issue, or unverified authorship has no durable protection disposition: report deferred and retain the evidence for review. Do not fabricate a comment ID or author to force a skip. Do not use the protected path to disguise a merge or close sources.

## Recovery and result handling

| CLI status | Exit | Skill action |
|------------|------|--------------|
| `completed` | 0 | Inspect phase: analysis continuation proceeds; verified terminal completion ends. |
| `no_change` | 0 | End with no further issue selected. |
| `busy` | 2 | Another valid owner/analysis window remains; defer to a later invocation. |
| `deferred` | 2 | Report the precise unresolved condition without a write retry. |
| `failed` or invalid input | 1 | Report missing configuration/authority or validation failure; do not mutate around it. |

The next invocation automatically attempts pending-operation recovery through `resume`. Expiry is only one condition: prior writer and recorded child process groups must be proved terminated or fenced, and uncertain remote outcomes must be reconciled before a legal generation transition. Boot ID, PID start time, and process-group evidence prevent assuming that a reused PID is the same process. Unknown child identity, registration gaps, unreachable hosts, or ambiguous outcomes remain deferred.

Frozen request identity excludes generation; a new generation never turns an old uncertain request into a new POST/PATCH. Verified steps are skipped, remaining steps retain their order and original payload/timestamp. A missing postimage after timeout is not proof that a request failed. Lost comment responses require one exact trusted-author/body/request-marker match; zero or multiple matches do not authorize reposting. Missing or externally edited journal-bound comments also defer.

Partial consolidation keeps durable state and reservations. Do not reopen verified closed sources, roll back canonical text, clear uncertain requests, or delete the journal. Correct the external uncertainty through an operator-reviewed recovery process; this CLI does not provide a force-takeover command. To stop deployment, disable its scheduled caller and stop the writer while retaining state for reconciliation; do not revert GitHub blindly.

Completed baselines use actual semantic input, relevant candidates, and current cited branch blobs. Only verified own-comment bodies are normalized through journal IDs, authors, exact bodies, and targets; comment ID and author presence remain in the digest to detect deletion. Snapshot state reasons are retained too. Repository HEAD or `updatedAt` alone does not trigger rework; new human input, relevant candidates, or changed cited code can. GitHub PATCH has no compare-and-swap: fresh reads and full postimage verification cannot atomically exclude a nonparticipating human's GET/PATCH race. Do not claim exactly-once remote execution or a universal human lock.

Definitive rejection is distinct from uncertain application. Read-only preflight failures and completed HTTP 400/401/403/404/405/410/422 rejections are journaled as `rejected`. After correcting the cause, a newer generation recovered after proven writer/child termination may attempt the same frozen request once, preserving the payload hash and rejection history and repeating all fresh group checks. The same generation cannot retry it. Verified requests are not resent; timeouts, incomplete responses, 408/409/429 and server errors remain subject to uncertain-result reconciliation. Diagnostics distinguish `rejected_remote_write` from `uncertain_remote_write`.

An empty original issue body can remain empty when no addition is needed; title validation remains required. Comments with an explicit deleted/null author retain their ID and body with author `[unknown]`. This reserved value cannot be a configured writer or establish human-decision protection; malformed non-null author data still defers.

## Scheduling boundary

A future operator may schedule `/omb-issue-maintainer --repo OWNER/REPO --config PRIVATE_CONFIG_PATH` once deployment inputs are ready. This skill does not create that schedule. Use the same coordinator for all workers; scheduling multiple disconnected coordinators defeats the ownership contract.

The cron helper recognizes only an exact leading unquoted `omb-issue` or `/omb-issue` scanner invocation. It leaves `omb-issue-maintainer`, quoted/fenced examples, prose, and ambiguous input unchanged. Existing scanner `--issue` prompts retain their existing bypass. No maintainer `--bypass` option is needed or supported.
