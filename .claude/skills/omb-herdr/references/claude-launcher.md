# Claude launcher: TeamClaude first

This shared launch adapter applies to manager start, task, review, verify, goal and
ultra-review whenever `agent_kind=claude`. Keep that kind throughout; TeamClaude is
a wrapper around Claude Code, not a new Herdr agent kind. Keep the new tab's root
Pane, ownership checks, initial turn deadline and submit-once protocol.

## Capability and provenance

Use the installed `teamclaude --help`, `teamclaude version`, `claude --help`, and
`claude --version` as capability evidence. The checked wrapper is
[`@karpeleslab/teamclaude`](https://github.com/KarpelesLab/teamclaude), version 1.1.21;
do not confuse it with unrelated projects of the same name. Require forwarding of
`--dangerously-skip-permissions` to native Claude. Do not call `teamclaude env`, read
accounts/credentials, change proxy services/configuration, install a wrapper, or
modify shell aliases/PATH to make this work. Record unavailable commands explicitly.

Herdr's [agent automation](https://herdr.dev/docs/agent-automation/) documents that
`agent start --kind` selects the canonical executable and manually launched agents
are detected automatically. Its [CLI reference](https://herdr.dev/docs/cli-reference/)
documents `pane run` and `agent rename`. Recheck installed subcommand help before use.
Do not invent `--kind teamclaude`, `--executable`, or `--command` for agent start.

## Launch once, recognize, then submit

1. In the new tab's root Pane, confirm the original shell is ready in the recorded
   cwd, with no foreground agent. Record the TeamClaude attempt before launch. If
   the wrapper is conclusively unavailable at preflight, record that unavailable
   attempt and use the guarded fallback below; do not type an unavailable command.
2. Otherwise submit this fixed command to that Pane, with the returned Pane ID as a
   separately validated argument:

   ```text
   herdr pane run <pane-id> 'teamclaude run --dangerously-skip-permissions'
   ```

   `pane run` submits the shell command and Enter. Keep the command one safely quoted
   literal argument; never interpolate a task, account, path or report into it. Omit
   `-p`: this is an interactive launch, and the actual task is submitted once through
   `agent prompt` only after readiness. Do not use `--auto-fallback` or an `|| claude`
   shell chain; the host must observe and record any fallback decision.
3. Within the original bounded launch/turn deadline, poll `herdr agent get <pane-id>`
   and `herdr pane read <pane-id> --source visible`. Confirm detected `kind=claude`,
   ready state, same Pane/server/tab/cwd and available native session identity. A shell
   prompt, zero launcher status, elapsed time, or pane-run acknowledgement alone is
   not agent readiness. If the wrapper definitely exited, evaluate the guarded fallback
   below before proceeding. Otherwise missing detection/readiness at the deadline or
   an observed blocked/unknown occupant is BLOCKED; never launch over that occupant.
4. Check that the recorded name is still unused, then run
   `herdr agent rename <pane-id> <agent-name>`. Re-read agent identity to confirm the
   binding. Only then continue the shared `agent prompt` and collection procedure.
   Do not include the review task in the launch command or submit before recognition.

## Guarded native fallback

One native-Claude attempt in the SAME Pane is permitted only if the wrapper was
conclusively unavailable, or definitely exited before ANY task submission. In both
cases first prove the original shell is foreground in the expected cwd and no wrapper
or child agent remains. Use live Pane/agent and process evidence; visible shell-like
text alone is insufficient. If ownership or process exit cannot be established, BLOCK.

```text
herdr agent start <agent-name> --kind claude --pane <pane-id> --timeout 30000 -- --dangerously-skip-permissions
```

Bound its timeout by the remaining original deadline (at most 30000 ms here). The
installed `agent start` requires timeout greater than 3000 ms: if no valid timeout
fits the remaining budget, BLOCK instead of launching or resetting the deadline. Fallback
never resets the budget. Validate the returned agent identity/readiness before the
first task submission. Native failure BLOCKS; do not retry or create another Pane.

Timeout, stalled/blocked/unknown state, authentication or managed-policy refusal, an
unsupported native permission option, and uncertain delivery never authorize fallback.
After any task submission (including submission_uncertain), never fallback/relaunch.
Reconcile the existing request instead. Launch failure keeps the tab under
delegation §6 retention rules.

Persist `launcher_attempts` with launcher (`teamclaude|claude`), version, actual argv,
timestamps, observed outcome, readiness/exit evidence and fallback reason, separate
from `agent_kind=claude` and native session identity. Record only non-secret provenance;
never record account identities, tokens or credential environment values. Both launch
paths retain full native permissions and the request's mutation_policy.
