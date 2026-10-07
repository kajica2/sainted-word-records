---
name: omb-codex-run
description: "Delegate a coding task to Codex CLI — runs codex exec for investigation, bug fixes, or implementation."
user-invocable: true
argument-hint: "<task-description>"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Codex Task Execution

## Shared knowledge handoff

After the worktree/root gate and before repository-dependent decisions, follow
`.agents/skills/omb-context/references/workflow-handoff.md`. Reuse valid inherited `knowledge_context`,
or have the main host invoke `Skill("omb-context")` with `build <task> --workflow run`
and the selected absolute root. Read `.agents/skills/omb-context/SKILL.md` budgets;
use returned bundle paths, evidence IDs, adoption/rejection reasons and unknowns.
Pass the same original bundle to every direct/Codex/fallback/reviewer branch.
Independent reviewers never receive each other's findings. Retrieved past behavior
must not override an authorized new requirement; verify actual source evidence.

## Execution Contract

**Task type:** Perform the focused utility operation documented below without expanding its scope.

**Required input:** A concrete target, path, or command context. Validate user-controlled values before using them at CLI, file, network, or configuration boundaries.

**Do:**
- Inspect the current state first, use the narrowest applicable operation, and report exact commands or evidence used for validation.
- Preserve unrelated files and distinguish operation failure from unavailable tooling or environment.

**Don't:**
- Do not infer permission for destructive or external side effects.
- Do not report success from expected output alone; check the resulting state.

**Completion:** Produce the documented output with fresh verification evidence, or state the precise blocker and safe next step.

Delegate a coding task to the Codex CLI. Codex runs independently and returns the result.

## Preflight

!`bash .claude/bin/codex-preflight.sh 2>/dev/null || echo "exit=not-found"`

If `exit=not-found` → abort with:
> "Codex CLI not found on PATH. Install: `npm install -g @openai/codex`, then run `omb init` to enable Codex (or set `OMB_USE_CODEX=1` in `.claude/settings.local.json`)."

If `exit=1` → abort with:
> "Codex is not enabled. Run `omb init` to enable it, or set `OMB_USE_CODEX=1` in `.claude/settings.local.json`. (Note: `omb update` only refreshes an already-enabled Codex CLI.)"

If `exit=0` → proceed.

After preflight passes, if any Codex CLI call returns a non-zero exit, wrap the error with:
> "Codex CLI returned an error after preflight passed. The codex subcommand may have changed in a recent update. Original error: {first-line-stderr}"

## Arguments

$ARGUMENTS

## Execution

1. If no task description is provided, ask the user what they want Codex to do.

2. Write the following complete prompt envelope to
   `.omb/tmp/codex-run-prompt-<STAMP>.md` using the **Write tool** — never a shell
   heredoc or `echo`. Preserve the user's task description verbatim inside its own
   block; add the validated context as a separate block, not a rewrite of that task:

   ```text
   <user_task>
   {user's original task description, verbatim}
   </user_task>
   <knowledge_context>
   {bundle_path, bundle_id, query_signature, source_fingerprint, evidence_ids,
    adopted, rejected_with_reason, unresolved_questions from the validated handoff}
   </knowledge_context>
   Read the identified bundle before repository-dependent decisions. Preserve
   source root/layer/revision and full applicability. Cite adopted or rejected
   evidence IDs with reasons; treat unknowns as source checks, not invented facts.
   Retrieved prior behavior cannot override the user's requested change.
   ```

   `$ARGUMENTS` is arbitrary user text; interpolating it into a double-quoted shell
   string lets backticks or `$(...)` become command substitution. Writing the
   envelope with the Write tool keeps both user text and context outside the shell.
   See "Prompt file lifecycle" below for `<STAMP>`. If context is empty/unavailable,
   preserve its actual status and unknowns instead of omitting the handoff.

3. Immediately before running, print a one-line notice that Codex will run in workspace-write
   mode and can modify files in the working tree. This is a notice, not an approval request —
   do not add an `AskUserQuestion` gate for it.

4. Run the task with explicit flags and stdin redirection, using the same literal filename:
```bash
codex exec --sandbox workspace-write --color never - < .omb/tmp/codex-run-prompt-20260810T034512Z.md
```

   `<` simple input redirection is **not** one of the tokens banned by
   `.Codex/rules/workflow/12-subagent-bash-hygiene.md` (`$`, backticks, `<(`, `>(`, `<<`
   heredocs, and `for`/`while`/`until`/`do`/`done`/`cd`). A `<<` heredoc would be banned; this
   plain `<` file read is not — do not "fix" it back into a heredoc or an argv string.
   `--color never` keeps ANSI escape sequences out of the verbatim output this skill returns.
   The `-` argument tells `codex exec` to read the prompt from stdin.

5. Return the Codex output **verbatim**.

6. If Codex made file changes, summarize what was changed so the user can review.

7. **On success (codex exits 0), delete the prompt file:**
```bash
rm .omb/tmp/codex-run-prompt-20260810T034512Z.md
```
   On a non-zero exit, keep it and report its absolute path so the failing prompt can be
   inspected.

## Prompt file lifecycle

- **[HARD] `<STAMP>` is a per-invocation UTC timestamp you compose yourself** in
  `YYYYMMDDTHHMMSSZ` form (the examples above show the shape) and then use as a **literal**
  string in both the Write path and the bash commands. Do NOT generate it with `$(date ...)`,
  `$RANDOM`, or any other shell expansion — those tokens are HARD-forbidden in this template
  by `12-subagent-bash-hygiene.md`.
- A fixed filename is unsafe: two invocations in the same worktree can overwrite each other's
  prompt between the Write and the redirection, so one workspace-write Codex process executes
  the other invocation's task.
- Delete on success, keep on failure. `.omb/` is gitignored (`.gitignore:84`), which prevents a
  commit but provides no confidentiality — deletion is what limits exposure of task text that
  may carry incident detail.

## Options

- The task description should be a clear, specific prompt describing what Codex should do.
- Codex's own default sandbox is read-only. This skill deliberately overrides that default and
  runs with `--sandbox workspace-write` so a delegated task that needs to edit files does not
  silently fail.

## Examples

```
/omb codex run "investigate why the login API returns 500 on empty password"
/omb codex run "add input validation to the user registration endpoint"
/omb codex run "refactor the payment service to use async/await"
```

## Rules

- Preserve the user's task description exactly inside the user_task block.
- Do not modify or "improve" that text. Add only the validated knowledge_context
  envelope and evidence-use instruction specified in Execution step 2; stdin must
  contain both blocks, not only the user text.
- After Codex completes, present the result and let the user decide next steps.
- If Codex fails, report the error without attempting alternative solutions.
- [HARD] Never pass `danger-full-access` as the sandbox value for this skill's Codex
  invocation — `workspace-write` is the ceiling this skill is allowed to use.
