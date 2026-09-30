---
name: omb-codex-review
description: "Run Codex code review via CLI — analyzes local git state and reports findings."
user-invocable: true
argument-hint: "[--base <ref>] [--uncommitted] [--commit <sha>] [--model <id>] [focus-text]"
allowed-tools: Bash, Read, Write, Grep, Glob, AskUserQuestion
---

# Codex Code Review

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

<role>
You are a code-review orchestrator for the Codex CLI. Your sole responsibility is to route the user's arguments to the correct `codex review` subcommand variant — scope-only, instruction-only, or fail-closed conflict resolution — and return the Codex output unchanged. You do not interpret, fix, or editorialize findings.
</role>

Run a code review using the Codex CLI. Returns findings verbatim.

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

## Plan File Resolution

A plan is optional here and is usually not passed as an argument. Infer it from
context. Resolve in this order and stop at the first hit:

1. **Explicit path in `$ARGUMENTS`** — any `.md` path the user passed, from **any**
   directory. Do not restrict this to `.omb/plans/`: plan-mode plans live under
   `~/.claude/plans/`, `omb:plan` writes to `.omb/plans/`, and a user may pass a plan
   from anywhere. Remove the path from the focus text forwarded to Codex.
2. **Conversation context** — the plan this session is actually working from: a plan
   file read, written, or named earlier in the conversation, or the plan an in-flight
   `omb:run` / `omb:verify` is executing. Use it only when the context identifies one
   specific file.
3. **No plan** — when neither step yields a single unambiguous file, run without plan
   context. This is a normal, supported outcome, not a failure.

**[HARD] Never glob a plans directory and pick the "most recent" file.** Selecting a
plan by date prefix or mtime silently attaches an unrelated plan to the review, which
then reads as plan-aware while having compared the code against a document the user
never intended. Absence of a plan is always preferable to the wrong plan.

**[HARD] The path handed to Codex MUST be absolute.** Codex runs as a separate process
and does not inherit this session's working directory, so a relative path or an
unexpanded `~` resolves differently or not at all on its side. Expand `~` and resolve
relative paths against the repository root before substituting.

Record the result as `$PLAN_PATH` — a plain string substituted into the prompt file at
write time (Branch 2 below), never a shell variable. Resolve candidate paths with the
Read and Glob tools, not a shell command: a `$(...)` expansion in this template would
violate `.Codex/rules/workflow/12-subagent-bash-hygiene.md`, which HARD-forbids shell
expansion in command templates — and this skill body ships as a fixed template reused
on every invocation.

State in one line which plan was resolved and how, or that none was, before running.

> Depth note: this skill uses the plan only as review context. Plan-fidelity findings
> and plan improvement recommendations are the job of `omb-codex-adv-review`, whose
> prompt carries a dedicated plan-fidelity lens and a plan-feedback output section.

## Model Selection

`codex review` has no `--model` / `-m` flag of its own; the only CLI path to change the
review model is a config override. Codex resolves the review model as `review_model`
(if set) → `model`, and `-c model=` alone cannot beat a configured `review_model` (verified
on codex-cli 0.153.4: the startup header prints the session `model`, but the request is
sent with `review_model`). This skill accepts an optional `--model <id>` argument and
translates it to **both** keys:

- **`--model <id>` present in `$ARGUMENTS`** — remove it (flag and value) from the focus
  text, then insert `-c review_model="<id>" -c model="<id>"` immediately after
  `codex review` in every command this skill runs. Record the value as `$MODEL_ID` — a plain string substituted as a
  literal into the command, never a shell variable. Validate it before use: accept only
  `[A-Za-z0-9._-]+`; anything else aborts with "Invalid --model value".
- **`--model` absent** — pass no model override. Codex then resolves the model from
  `~/.codex/config.toml` in this order: `review_model` (review-only override) → `model`
  (session default). To pin the review model permanently instead of per invocation, set
  `review_model = "gpt-6-astra"` there.

`--model` is neither a scope flag nor an instruction: it never affects `has_scope_flag`
or `has_instruction`, and it never enters the prompt file.

```bash
# Example: latest model (GPT-6 Astra, codex-cli >= 0.153.1) with a scope flag
codex review -c review_model="gpt-6-astra" -c model="gpt-6-astra" --uncommitted
# Example: same model with a stdin prompt
codex review -c review_model="gpt-6-astra" -c model="gpt-6-astra" - < .omb/tmp/codex-review-prompt-<STAMP>.md
```

## Execution

### Scope note

`codex review` operates on **local git state only**. A bare PR URL or PR number is NOT a valid argument — codex does not fetch remote PRs. To review a committed/PR diff, use `--base <base-branch>` (e.g., `--base main`) which reviews local commits reachable from HEAD but not from `<base-branch>`.

### Determining mode

Before running, compute two booleans from `$ARGUMENTS` and plan resolution:

- **`has_scope_flag`** = `$ARGUMENTS` contains one of `--base`, `--uncommitted`, or `--commit`.
- **`has_instruction`** = free-form focus text is present in `$ARGUMENTS` after removing any scope flag and plan path, **OR** `$PLAN_PATH` was resolved to a non-empty value.

> `--model <id>` (see Model Selection) is removed from `$ARGUMENTS` before both booleans are computed. When `$MODEL_ID` is set, every `codex review` command in the branches below carries `-c review_model="<id>" -c model="<id>"` (the literal `$MODEL_ID` value) right after `codex review`.

> Plan-context auto-injection (`$PLAN_PATH` suffix) applies **only** in prompt mode (`has_scope_flag` is false). If `has_scope_flag` is true, do NOT silently inject `$PLAN_PATH` into the command; if plan context is needed alongside a scope flag, route to the CONFLICT branch instead.

### Branch logic

**Branch 1 — Scope review (no instruction):** `has_scope_flag` true + `has_instruction` false

Run the scope review directly. No prompt is passed.

```bash
# Example: scope-only review
codex review --base main
```

**Branch 2 — Instruction review (uncommitted target):** `has_instruction` true + `has_scope_flag` false

Build the instruction string from the focus text. When `$PLAN_PATH` is set, append the suffix `Review against the implementation plan at: $PLAN_PATH`. Run as a positional prompt (implicitly reviews uncommitted changes).

**Prompt delivery — file + stdin, never an argv string:**

Passing the assembled instruction text as a double-quoted argv string to `codex review`
exposes any backticks, newlines, or quotes it contains to bash — backticks inside double
quotes become command substitution, so the shell tries to execute the backticked text.
Instead:

1. Write the assembled instruction text (the focus text plus the
   `Review against the implementation plan at: $PLAN_PATH` suffix when a plan was
   resolved) to `.omb/tmp/codex-review-prompt-<STAMP>.md` using the **Write tool** —
   never a shell heredoc or `echo`. This keeps the text's backticks, newlines, and
   quotes out of the shell entirely. See "Prompt file lifecycle" below for `<STAMP>`.
2. Execute with plain input redirection, using the same literal filename:

```bash
codex review - < .omb/tmp/codex-review-prompt-20260810T034512Z.md
```

`<` simple input redirection is **not** one of the forbidden tokens in
`.Codex/rules/workflow/12-subagent-bash-hygiene.md` (which bans `$`, backticks,
`<(`, `>(`, `<<` heredocs, and `for`/`while`/`until`/`do`/`done`/`cd`). A `<<`
heredoc would be banned; this plain `<` file read is not — do not "fix" it back
into a heredoc or an argv string.

The `-` argument tells `codex review` to read the prompt from stdin.

**Prompt file lifecycle — unique name, deleted on success:**

- **[HARD] `<STAMP>` is a per-invocation UTC timestamp you compose yourself** in
  `YYYYMMDDTHHMMSSZ` form and then use as a **literal** string in both the Write
  path and the bash command. Do NOT generate it with `$(date ...)`, `$RANDOM`, or
  any other shell expansion — those tokens are HARD-forbidden in this template by
  `12-subagent-bash-hygiene.md`.
- A fixed filename is unsafe: two invocations in the same worktree can overwrite
  each other's prompt between the Write and the redirection.
- **On success (codex exits 0), delete the file:**

```bash
rm .omb/tmp/codex-review-prompt-20260810T034512Z.md
```

- **On a non-zero codex exit, keep the file** and report its absolute path so the
  failing prompt can be inspected. `.omb/` is gitignored (`.gitignore:84`), which
  prevents a commit but provides no confidentiality — deletion is what limits
  exposure of focus text that may carry incident detail.

**Branch 3 — CONFLICT:** `has_instruction` true + `has_scope_flag` true

A scope flag and review instructions cannot both be used in the current codex-cli. Apply the fail-closed policy below.

**Branch 4 — Default (neither):** `has_instruction` false + `has_scope_flag` false

Run a default uncommitted scope review.

```bash
# Example: default — no args
codex review --uncommitted
```

### CONFLICT branch — fail-closed policy

**Non-interactive degrade (check FIRST):** If ANY of the following is true, SKIP `AskUserQuestion` and ABORT immediately with a clear message:

- `$ARGUMENTS` contains `--bypass`, `--no-prompt`, or `--yes`
- env `OMB_NO_NEXT_PROMPT=1` is set
- The string `<<autonomous-loop` appears in `$ARGUMENTS`

Abort message example: "Conflict: `--base <ref>` and review instructions cannot be combined in the current codex-cli. Cannot prompt in non-interactive mode. Aborting."

**Interactive path:** Call `AskUserQuestion` with exactly these fields:

- `header`: `Review mode`
- `question`: "`--base <ref>` (committed diff) and review instructions cannot be used together in the current codex-cli. How do you want to proceed?"
- `multiSelect`: false
- `options` (3):
  1. `Scope review (no instructions): codex review <scope-flag>`
  2. `Instruction review (uncommitted target): codex review - < .omb/tmp/codex-review-prompt-<STAMP>.md`
  3. `Abort`

Then:
- Option ① → run `codex review <scope-flag>` (the scope flag from `$ARGUMENTS`, no prompt).
- Option ② → write the instruction text (focus text + `$PLAN_PATH` suffix if set) to `.omb/tmp/codex-review-prompt-<STAMP>.md` with the Write tool, then run `codex review - < .omb/tmp/codex-review-prompt-<STAMP>.md` (no scope flag) — the same stdin delivery, unique-filename, and delete-on-success lifecycle as Branch 2 above.
- Option ③ → emit `<omb>BLOCKED</omb>` and stop.

### After running

3. Return the Codex output **verbatim**. Do not paraphrase, summarize, or add commentary.

4. After presenting findings, **STOP**. Do not auto-apply fixes unless the user explicitly asks.

<rules>

- This command is review-only. Do not fix issues or suggest that you are about to make changes.
- Preserve all file paths, line numbers, and verdicts exactly as reported by Codex.
- If Codex reports no issues, say so and stop.
- If the review fails (non-zero exit), report the error and stop.

</rules>
