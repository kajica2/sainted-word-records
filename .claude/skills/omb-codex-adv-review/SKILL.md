---
name: omb-codex-adv-review
description: "Adversarial Codex review — challenges assumptions, finds failure modes, pressure-tests implementation choices."
user-invocable: true
argument-hint: "[--base <ref>] [--model <id>] [focus-text]"
allowed-tools: Bash, Read, Write, Grep, Glob, AskUserQuestion
---

# Codex Adversarial Review

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
You are an adversarial review orchestrator for the Codex CLI. Your responsibility is to assemble the structured multi-lens adversarial prompt, route it to `codex review`, and return findings verbatim. If `--base` is present, you apply the fail-closed conflict policy — never silently drop the adversarial framing or run a mislabeled review. You do not interpret, fix, or soften findings.
</role>

Run an adversarial code review using the Codex CLI. Unlike standard review, this mode actively challenges the implementation — finding failure modes, security risks, race conditions, and design weaknesses.

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

Adversarial review is most often run against a plan — verifying the implementation
against it, and returning improvement feedback, is the primary value of this skill.
But a plan is never required, and the user usually does NOT pass its path as an
argument. Infer it from context instead.

Resolve in this order and stop at the first hit:

1. **Explicit path in `$ARGUMENTS`** — any `.md` path the user passed, from **any**
   directory. Do not restrict this to `.omb/plans/`: plan-mode plans live under
   `~/.claude/plans/`, `omb:plan` writes to `.omb/plans/`, and a user may pass a plan
   from anywhere. Remove the path from the focus text forwarded to Codex.
2. **Conversation context** — the plan this session is actually working from: a plan
   file read, written, or named earlier in the conversation, or the plan an in-flight
   `omb:run` / `omb:verify` is executing. Use it only when the context identifies one
   specific file.
3. **No plan** — when neither step yields a single unambiguous file, run the review
   **without** plan context. This is a normal, supported outcome, not a failure.

**[HARD] Never glob a plans directory and pick the "most recent" file.** Selecting a
plan by date prefix or mtime silently attaches an unrelated plan to the review: the
report then reads as plan-faithful while having verified the implementation against a
document the user never intended. Absence of a plan is always preferable to the wrong
plan. If context suggests a plan but cannot narrow it to one file, treat that as
step 3 and say so.

**[HARD] The path handed to Codex MUST be absolute.** Codex runs as a separate process
and does not inherit this session's notion of the working directory, so a relative
path or an unexpanded `~` resolves differently or not at all on its side. Expand `~`
to the user's home directory and resolve any relative path against the repository
root before substituting it.

Record the result as `$PLAN_PATH` — a plain string substituted into the prompt file at
write time (step 1 of Execution below), never a shell variable. Resolve and inspect
candidate paths with the Read and Glob tools, not a shell command: a `$(...)`
expansion in this template would violate
`.claude/rules/workflow/12-subagent-bash-hygiene.md`, which HARD-forbids shell
expansion in command templates — and this skill body ships as a fixed template reused
on every invocation.

Before running, state in one line which plan was resolved and how (explicit argument
or context inference), or that the review is running without plan context. A wrong
inference must be visible to the user in the transcript, not buried in the prompt file.

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
codex review -c review_model="gpt-6-astra" -c model="gpt-6-astra" - < .omb/tmp/codex-adv-prompt-<STAMP>.md
```

## Execution

### Scope note

`codex review` operates on **local git state only**. A bare PR URL or PR number is NOT a valid argument — codex does not fetch remote PRs. To review a committed/PR diff, use `--base <base-branch>` (e.g., `--base main`) which reviews local commits reachable from HEAD but not from `<base-branch>`. Note: because adv-review ALWAYS carries an adversarial prompt as an instruction, passing `--base` creates a CONFLICT (see below).

### Determining mode

Adv-review **always** carries an instruction (the adversarial prompt block). Therefore `has_instruction` is always true. The only choice is whether `$ARGUMENTS` contains a scope flag:

- **`has_scope_flag`** = `$ARGUMENTS` contains `--base`.

> `--model <id>` (see Model Selection) is removed from `$ARGUMENTS` before `has_scope_flag` is computed and before focus text is extracted. When `$MODEL_ID` is set, every `codex review` command below carries `-c review_model="<id>" -c model="<id>"` (the literal `$MODEL_ID` value) right after `codex review`.

### Branch logic

**Normal path — no scope flag:** `has_scope_flag` false

Build the adversarial review command. The `codex review` CLI does not have a `--adversarial` flag. Instead, pass adversarial review instructions as the prompt argument. Extract any remaining focus text from `$ARGUMENTS` after removing the plan path.

**Important:** Do NOT add `--uncommitted` — the prompt implicitly reviews uncommitted changes.

The adversarial prompt to pass to Codex is the following structured multi-lens review instruction. Compose it as a single string (strip the XML tags before passing to the CLI):

```
<role>You are a principal-level adversarial reviewer with deep expertise in distributed systems, security, and database integrity. Your job is to find what will break in production, not to validate that the code looks reasonable.</role>

<review_lenses>
1. Architecture — Are responsibilities cleanly separated, or do layers bleed into each other? Does any abstraction leak implementation details or create tight coupling that blocks future changes?
2. Memory leaks — Are there unreleased object references, accumulating caches with no eviction, circular references, or unbounded state growth across requests?
3. Connection/resource leaks — Are DB connections, HTTP clients, file handles, and sockets always returned to their pool or closed? Is every context manager and `finally` block actually exhaustive?
4. DB schema integrity — Can every migration be rolled back without data loss? Are constraints, indexes, and FK relationships correct? Could a schema-model mismatch silently corrupt data?
5. SOT compliance — Does the implementation contradict or silently diverge from decisions recorded in `openwiki/` or `docs/`? Are arbitrary design choices made outside the approved SOT docs?
6. Security risks — Is every external input validated and sanitized? Are there authn/authz bypass vectors, secret exposure paths, injection points, or violated trust boundaries?
7. Side-effects & omissions — Are there non-idempotent operations that could cause double-writes or phantom state on retry? Are all exception paths handled, concurrency edge cases considered, and observability hooks in place? What material risk did I miss?[PLAN_FIDELITY]
</review_lenses>

Report only material findings. For each finding include: the lens label, file:line evidence, and a concrete one-sentence failure scenario.

<output_format>
Per-lens findings table with columns: Lens | file:line | Failure Scenario | Severity (BLOCKING / NON-BLOCKING).
</output_format>[PLAN_FEEDBACK_FORMAT]

<self_critique>
Before finalizing, run a self-critique pass: verify each finding is reproducible from actual observed code behavior — not a hypothetical pattern. Drop any finding you cannot tie to a concrete file:line and failure scenario.
</self_critique>
```

### Plan-conditional prompt sections

Two placeholders in the template above are filled only when a plan resolved. Both are
driven by the same condition, so they are always both present or both absent.

**When `$PLAN_PATH` is set**, replace `[PLAN_FIDELITY]` with a newline followed by this
eighth lens (substituting the absolute path):

```
8. Plan fidelity — Read the plan at $PLAN_PATH. Does the implementation do what the plan specifies, and only that? Report three things separately: (a) requirements the plan states that the implementation does not satisfy, (b) behavior the implementation adds that the plan does not authorize, and (c) places where the plan itself was wrong, underspecified, or made an assumption the code now disproves. For (c), judge the plan, not the code — a faithful implementation of a flawed plan is still a finding.
```

**When `$PLAN_PATH` is set**, also replace `[PLAN_FEEDBACK_FORMAT]` with a newline
followed by:

```
<plan_feedback>
After the findings table, add a section titled "Plan improvement recommendations". This section is about how to improve the plan and the approach — it is not a second copy of the defect list. Each recommendation states the concrete change to make and why the current plan text leads somewhere worse. Order by impact. Include recommendations that are not defects: a missing verification step, an ordering that creates avoidable rework, a decision the plan left implicit that will be re-litigated during implementation. If the plan is sound, say so in one line rather than inventing recommendations.
</plan_feedback>
```

**When `$PLAN_PATH` is not set**, delete both placeholders entirely, leaving seven
lenses and the findings table alone. Do not substitute a weaker plan-fidelity lens
that reviews against an unnamed or guessed plan.

When `$ARGUMENTS` has focus text, prepend `Focus on: {focus_text}.` after the `<role>` block.

**Prompt delivery — file + stdin, never an argv string:**

The assembled prompt body contains backticks (from the review-lens text) and
newlines. Passing it as a double-quoted argv string to `codex review` lets bash
interpret those backticks as command substitution — this is the bug this change
fixes. Instead:

1. Write the fully assembled prompt (with `[PLAN_FIDELITY]` and
   `[PLAN_FEEDBACK_FORMAT]` already substituted or removed per the rules above, and
   any focus sentence already prepended) to
   `.omb/tmp/codex-adv-prompt-<STAMP>.md` using the **Write tool** — never a shell
   heredoc or `echo`. This is what keeps the prompt's backticks, newlines, and
   quotes out of the shell entirely. See "Prompt file lifecycle" below for
   `<STAMP>`.
2. Execute with plain input redirection, using the same literal filename:

```bash
codex review - < .omb/tmp/codex-adv-prompt-20260810T034512Z.md
```

`<` simple input redirection is **not** one of the forbidden tokens in
`.claude/rules/workflow/12-subagent-bash-hygiene.md` (which bans `$`, backticks,
`<(`, `>(`, `<<` heredocs, and `for`/`while`/`until`/`do`/`done`/`cd`). A `<<`
heredoc would be banned; this plain `<` file read is not — do not "fix" it back
into a heredoc or an argv string.

The `-` argument tells `codex review` to read the prompt from stdin.

**Prompt file lifecycle — unique name, deleted on success:**

- **[HARD] `<STAMP>` is a per-invocation UTC timestamp you compose yourself** in
  `YYYYMMDDTHHMMSSZ` form (the example above shows the shape) and then use as a
  **literal** string in both the Write path and the bash command. Do NOT generate
  it with `$(date ...)`, `$RANDOM`, or any other shell expansion — those tokens are
  HARD-forbidden in this template by `12-subagent-bash-hygiene.md`, and a
  permission prompt on a backgrounded invocation is invisible.
- A fixed filename is unsafe: two invocations in the same worktree can overwrite
  each other's prompt between the Write and the redirection, so one Codex process
  executes the other's instructions.
- **On success (codex exits 0), delete the file:**

```bash
rm .omb/tmp/codex-adv-prompt-20260810T034512Z.md
```

- **On a non-zero codex exit, keep the file** and report its absolute path, so the
  exact prompt that failed can be inspected. Deleting only on success preserves the
  reproduction value that motivated retaining it, without leaving prompt text on
  disk indefinitely.
- The prompt can carry whatever the user put in their focus text, including
  incident detail. `.omb/` is gitignored (`.gitignore:84`), which prevents a commit
  but provides no confidentiality — deletion is what limits exposure.

**CONFLICT path — scope flag present:** `has_scope_flag` true

A `--base` flag and adversarial instructions cannot both be passed in the current
codex-cli. Apply the fail-closed policy below.

### CONFLICT branch — fail-closed policy

**Non-interactive degrade (check FIRST):** If ANY of the following is true, SKIP `AskUserQuestion` and ABORT immediately with a clear message. Do NOT silently fall back to a plain scope-only review — that would run a mislabeled adversarial review.

- `$ARGUMENTS` contains `--bypass`, `--no-prompt`, or `--yes`
- env `OMB_NO_NEXT_PROMPT=1` is set
- The string `<<autonomous-loop` appears in `$ARGUMENTS`

Abort message example: "Conflict: `--base <ref>` and adversarial instructions cannot be combined in the current codex-cli. Cannot prompt in non-interactive mode. Aborting."

**Interactive path:** Call `AskUserQuestion` with exactly these fields:

- `header`: `Review mode`
- `question`: "`--base <ref>` (committed diff) and adversarial instructions cannot be used together in the current codex-cli. How do you want to proceed?"
- `multiSelect`: false
- `options` (3):
  1. `Scope review — plain diff review WITHOUT adversarial framing: codex review <scope-flag>`
  2. `Adversarial review (uncommitted target, recommended): codex review - < .omb/tmp/codex-adv-prompt-<STAMP>.md`
  3. `Abort`

Then:
- Option ① → run `codex review <scope-flag>` (the scope flag from `$ARGUMENTS`, no adversarial prompt). Note: this is a plain diff review — adversarial framing is lost.
- Option ② → write the full assembled adversarial prompt (+ `$PLAN_PATH` suffix if set) to `.omb/tmp/codex-adv-prompt-<STAMP>.md` with the Write tool, then run `codex review - < .omb/tmp/codex-adv-prompt-<STAMP>.md` (no scope flag, uncommitted target) — the same stdin delivery, unique-filename, and delete-on-success lifecycle as the normal path above.
- Option ③ → emit `<omb>BLOCKED</omb>` and stop.

### After running

3. Return the Codex output **verbatim**. Do not paraphrase, summarize, or add commentary.

4. After presenting findings, **STOP**. Do not auto-apply fixes unless the user explicitly asks.

## Focus Text Examples

- `adversarial-review challenge the caching design` — pressure-test caching choices
- `adversarial-review check for race conditions in auth flow` — find concurrency issues
- `adversarial-review` — general adversarial review of all changes

## Attack Surface

Codex adversarial review focuses on:
- Auth/permissions bypass
- Data loss scenarios
- Race conditions and concurrency bugs
- Rollback safety
- Observability gaps
- Error handling completeness

## Step 4: Suggest Next Pipeline Step (AskUserQuestion)

After the adversarial review report is delivered, propose the next pipeline step explicitly.

**Skip this step when ANY of the following holds:**

1. The skill is ending with `<omb>BLOCKED</omb>` — user intervention is required.
2. A non-interactive flag is present (same conditions as the CONFLICT branch non-interactive check: `--bypass`, `--no-prompt`, `--yes`, `OMB_NO_NEXT_PROMPT=1`, or `<<autonomous-loop`).
3. The user already issued the next-step command in the same turn.

Otherwise call `AskUserQuestion` exactly ONCE:

- `header`: `Next step` (≤12 chars)
- `question`: one sentence including the finding count, e.g. `Codex adv-review complete ({N} findings). What's next?`
- `multiSelect`: false
- `options` (4):
  1. `Run plan now (omb run --worktree) (Recommended)` — invoke `Skill("omb-run", args: "--worktree {plan-path}")`
  2. `Rewrite plan (omb plan)` — invoke `Skill("omb-plan", args: "<rewrite hint>")`
  3. `Run plan-review` — invoke `Skill("omb-plan-review", args: "{plan-path}")`
  4. `Stop`

The `next_step_hint:` envelope field MUST still be populated regardless of whether `AskUserQuestion` was shown — downstream CLI and hook code reads it.

<rules>

- This command is review-only. Do not fix issues.
- Preserve all file paths, line numbers, and confidence scores exactly as reported.
- If Codex reports no material findings, say so and stop.
- If the review fails (non-zero exit), report the error and stop.

</rules>
