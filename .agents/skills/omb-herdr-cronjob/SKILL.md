---
name: omb-herdr-cronjob
description: "Schedule detached Codex or Claude CLI runs through Herdr Cron, with owned panes, durable logs, failure pausing, and explicit resume."
user-invocable: true
argument-hint: "setup | add | update | list | status | pause | resume | run | cancel | remove | history | logs | logs-purge"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion
---

# Scheduled CLI execution

Use the installed OMB CLI's `herdr-cronjob` command. It owns native scheduling,
state transitions, CLI subprocesses, pane cleanup and logs. Do not implement a
second scheduler in the conversation, use OS crontab, or substitute an app reminder.
An attached Herdr client is unnecessary. This is separate from interactive
`omb-herdr`: scheduled runs use print mode and close their owned panes.

## Resolve the request

For registration, bind the user's exact task, existing absolute execution cwd,
schedule, logical job ID and CLI choice. Ask only for genuinely missing task or
schedule information. Use Codex by default; `--codex` and `--claude` are mutually
exclusive. Resolve omitted timezone to the host's IANA timezone through the
runtime and show the stored timezone with the schedule preview.

Write the prompt verbatim into a private file and pass its absolute path using
`--prompt-file`. Prompt text is data: never interpolate it into a native shell
command or a Herdr pane command. Registration snapshots the file; later edits
to that file do not update the job. Use `update` for intentional changes.

Use the active checkout's installed wrapper, with an absolute path when cwd can
change: `bash /absolute/checkout/.Codex/bin/omb-cli.sh herdr-cronjob ...`.
Pass each path and schedule as one properly quoted shell argument. Prepend
`bash /absolute/checkout/.Codex/bin/omb-cli.sh` to each example below.

```text
herdr-cronjob setup
herdr-cronjob add --id nightly --cwd /absolute/project --schedule "0 9 * * *" --timezone Asia/Seoul --prompt-file /absolute/private/request.txt --codex
herdr-cronjob add --id review --cwd /absolute/project --schedule "@every 1h" --prompt-file /absolute/private/review.txt --claude --timeout 45m
herdr-cronjob update nightly --schedule "0 10 * * *"
herdr-cronjob list --json
herdr-cronjob status nightly --json
herdr-cronjob pause nightly
herdr-cronjob resume nightly
herdr-cronjob run nightly
herdr-cronjob cancel nightly
herdr-cronjob remove nightly
herdr-cronjob history nightly --json
herdr-cronjob logs nightly
herdr-cronjob logs-purge nightly --run RUN_ID --yes
```

`setup` checks or installs missing official Herdr tools and verifies the native
user service. Reuse compatible tools and a healthy shared service. CLI login is
separate; never replace credentials or report authentication from a binary's
presence alone. Surface unsupported platforms, versions, service roots and
capabilities before activation. Do not run internal `_execute` or `_worker`
commands manually to bypass registration and ownership checks.

## Execution policy

- Codex executes with full permissions in noninteractive mode. `--claude` tries
  `teamclaude run` first, then native Claude only after a failure proven to occur
  **before work starts**. Missing TeamClaude is a safe fallback condition. A
  generic nonzero exit, timeout, unknown start or model error is not. Never
  resubmit a task merely because the previous result is delayed.
- Runtime is unlimited by default. Only an explicit positive `--timeout` adds
  a deadline. Silence or a question-shaped output is not proof of input waiting;
  only a confirmed machine event can identify a blocked run. Report unsupported
  observation honestly, without adding an idle timeout.
- A second occurrence of the same job is skipped while its owned execution or
  cleanup is unresolved. Different jobs may run concurrently, including jobs in
  the same cwd; explain possible file collisions when registering such jobs.
  There is no missed-run catchup or automatic task retry. Interval schedules
  follow the native daemon's start/restart basis; use cron for wall-clock timing.
- After five consecutive failed runs the job pauses. Success resets the count;
  cancelled and skipped runs do not increment or reset it. `resume` starts a new
  native generation, resets the count and keeps prior history. It is not a replay
  of missed occurrences.
- `pause` stops future occurrences while the current run continues. `cancel`
  stops the current owned run while preserving its schedule. `run` requires an
  active job. Busy updates are rejected. `remove` disables future occurrences,
  waits for owned execution cleanup, and then
  deletes the job's owned private prompt snapshot; history and logs remain.
- Terminal runs close their owned panes. If log storage fails, preserve available
  output, report partial/unavailable logs and still close the pane. Never turn a
  successful CLI exit into a failed task solely because logs could not be saved.
  Unknown process or pane ownership prevents destructive cleanup and new overlap.
  Every descendant that inherits the per-run environment marker
  belongs to the run, even after `setsid`; when the run ends (or recovery
  finds the controller dead) such descendants are killed only after their
  kernel identity is re-verified.
  There is no exemption: daemons a scheduled run starts (tmux or screen
  servers, `gpg-agent`, `ssh-agent`, `watchman`) are terminated when the run
  ends; start a daemon you need to keep outside the job. Not detected:
  descendants that replace or overwrite their environment (`env -i`, Codex
  `shell_environment_policy`, setproctitle-style rewrites). A descendant whose
  environment cannot be read (on Linux a non-dumpable process, or an unreadable
  process reparented to init) keeps ownership retained until it exits.

## Inspect results and retain history

Use `status`, `history` and `logs` for the logical job; show native generation/run
IDs, actual launcher, outcome, failure count, cleanup and log status separately.
CLI exit zero establishes process success, not semantic fulfillment of the task.
Native cancellation acknowledgement alone does not establish child termination.
Report retained ownership, incomplete cleanup or missing logs instead of success.

History is retained without an automatic quota. Only explicit `logs-purge --yes`
removes selected completed-run logs; never purge active execution evidence or
unowned paths. `list` is project-scoped; `list --all` includes only OMB-owned jobs.

Do not inspect, back up, migrate, disable or remove existing operating crontab or
Hermes schedules as part of this skill. Retired OMB skills are not aliases for
this runtime. Manage only jobs created through `herdr-cronjob`.

## Result

Return the observed action, job ID, effective cwd/CLI/schedule/timezone, state and
relevant log/run references. A successful registration requires verified active
native configuration; a preparing/paused/unknown transition is not active success.
End with `<omb>DONE</omb>`, `<omb>RETRY</omb>` or `<omb>BLOCKED</omb>` and the
standard result envelope including artifacts, concerns and the next action.
