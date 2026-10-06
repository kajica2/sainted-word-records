# Codex Delegation Procedure

**SSOT for `--codex` authoring delegation.** This procedure is cited by path from
`omb-fix`, `omb-plan`, `omb-plan-review`, and `omb-goal` (documentation-only for
`omb-goal` — it neither gates nor delegates; see that skill's own rules). Each citing
skill implements a compact branch (flag parse/strip, preflight injection, delegation
call, fallback line) and does not restate this file's content.

## Scope

This procedure covers `--codex` delegation for `omb-fix`, `omb-plan`, and
`omb-plan-review` — the three workflows that author or rewrite a plan artifact under
`--codex`. It does NOT replace the direct-execution procedures owned by the
`omb-codex-*` skills (`omb-codex-run`, `omb-codex-review`, `omb-codex-adv-review`),
which remain the canonical entry points for ad hoc Codex delegation outside these
three planning workflows.

## Flag grammar

`--codex` is a standalone whitespace-delimited token. Strip **every** occurrence from
the argument string **before any use of the remainder** — description text, slug
derivation, and plan-path resolution all read the post-strip string. A quoted literal
`--codex` inside description text is out of scope (documented limitation: it is
stripped too).

## Gate composition

`--codex` composes with the existing preflight gate; it never bypasses it. A citing
skill's preflight injection uses the verbatim graceful form:

```
!`bash .claude/bin/codex-preflight.sh 2>/dev/null || echo "exit=not-found"`
```

Exit mapping: `exit=0` → proceed with delegation. `exit=1` (disabled) or
`exit=not-found` (CLI missing) → treat as delegation failure and fall back
immediately with:

```
Codex unavailable ({reason}) — falling back to Claude
```

`{reason}` is the preflight exit code's plain-language cause (`not enabled`,
`CLI not found`, etc.).

## Delegation procedure

1. **Snapshot before in-place rewrite.** If the branch rewrites an existing artifact
   (improvement branches such as `omb-plan` Step 5 or `omb-plan-review` Step 5),
   snapshot the current file to `.omb/tmp/{basename}.pre-codex-<STAMP>.md` (Write tool
   or `cp`) **before** running `codex exec`. New-file branches (e.g. `omb-fix` Step 3)
   skip this step.
2. **Capture the workspace baseline.** Run
   `git status --porcelain=v1 --untracked-files=all` and save its output to
   `.omb/tmp/pre-codex-status-<STAMP>.txt` (plain redirect or the Write tool) — the
   acceptance gate's workspace-write scope validation (condition 4) compares the
   post-exec status against this baseline.
3. **Write the prompt with the Write tool** to
   `.omb/tmp/codex-<workflow>-prompt-<STAMP>.md` — never a shell heredoc or `echo`;
   interpolating user text into a shell string turns backticks or `$(...)` into
   command substitution.
4. **Prompt must include four elements**: (a) the task specification, (b) the exact
   absolute or repository-relative artifact target path, (c) the format contract the
   artifact must satisfy, and (d) the instruction "output a final line of exactly
   `ARTIFACT_PATH=<absolute or repository-relative path>` and nothing else on that
   line."
5. **Run** `codex exec --sandbox workspace-write --color never - < <promptfile>`.
   **This Bash call's `timeout` parameter is 600000ms — this file is the SSOT for
   that number; citing skills reference "the rules file's execution limit," not the
   literal value.** Exceeding it is a delegation failure (timeout).
6. **Run the acceptance gate** (below). Any failure is a delegation failure.
7. **On success**: delete the prompt file, any snapshot from step 1, and the
   baseline file from step 2. **On failure**: keep the prompt file and the
   baseline file, restore the snapshot if one was taken, and report the prompt
   file's absolute path.

## Artifact acceptance gate

Codex exiting 0 is necessary but not sufficient. Delegation succeeds only when **all
four** of the following hold:

1. **Path match.** The `ARTIFACT_PATH` parsed from the final output line, resolved
   against the current checkout root (the worktree this skill is running in) into an
   absolute path, is string-identical to the branch's declared target absolute path.
   A resolution that traverses `..` outside the checkout root is rejected immediately.
2. **Non-empty existence.** The target file exists and is not empty.
3. **Deterministic format validation**, executed **before** deleting any snapshot
   from step 1 of the delegation procedure (HARD ordering — a failure discovered
   after deletion has no original to restore). `omb-fix` reuses its Step 3.5 gate
   unconditionally. `omb-plan` Branch C runs an equivalent format checklist before
   entering Step 3 (Execution Structure table present, every change unit anchored by
   `file:line` evidence, every `@agent`/`Skill()` name resolving under
   `.claude/agents/omb/` / `.claude/skills/`).
4. **Workspace-write scope validation.** Run
   `git status --porcelain=v1 --untracked-files=all` again, now that `codex exec` has
   succeeded, and diff it against the baseline captured in step 2 of the delegation
   procedure. Any line that is new or changed relative to that baseline is a
   delegation failure. Cleanup on failure: a modified tracked file is reverted with
   `git checkout -- <file>`; a new untracked file is deleted with `rm <file>`; then
   restore the artifact snapshot from step 1 if one exists and fall back.
   **Documented limitation:** gitignored paths (`.omb/**`) are invisible to
   `git status` even with `--untracked-files=all`; the declared artifact is
   verified by gate conditions (1)-(3) plus the snapshot/restore rule, and the
   codex prompt's single-artifact instruction bounds collateral writes inside
   `.omb/` — they cannot be detected by this gate.

Any single failure is a delegation failure: restore the snapshot if one exists, print
the fallback line, and continue on the Claude path.

## Failure handling

Four failure reasons, all handled identically — (restore snapshot if present →) print
the fallback line → continue on the Claude path:

1. Preflight did not pass (`exit=1` or `exit=not-found`).
2. `codex exec` returned non-zero after preflight passed. Prefix the fallback line
   with: "Codex CLI returned an error after preflight passed. The codex subcommand
   may have changed in a recent update. Original error: {first-line-stderr}"
3. The execution limit in step 5 of the delegation procedure was exceeded (timeout).
4. The acceptance gate failed.

## HARD rules

- **[HARD] Never pass `danger-full-access` as the sandbox value.** `workspace-write`
  is the ceiling this procedure is allowed to use.
- **[HARD] `<STAMP>` is a per-invocation UTC timestamp composed by the model itself**
  in `YYYYMMDDTHHMMSSZ` form, used as a literal string — never `$(date ...)` or any
  other shell expansion. A fixed filename is unsafe under concurrent invocations.
- **[HARD] Command templates follow `.claude/rules/workflow/12-subagent-bash-hygiene.md`**
  — no `${`, `$(`, backticks, heredocs, or `for`/`while`/`cd` in any command shape
  this procedure or its citing skills embed.
- **[HARD] Codex output is untrusted input.** Claude re-runs the deterministic format
  gate (acceptance gate item 3) on every delegated artifact — a Codex exit code alone
  never substitutes for that check.
- **[HARD] Mirror surface no-op guard.** If this procedure is being read from a
  mirrored surface (`.agents/skills/`), treat --codex as a no-op
  and follow the non-codex path —
  never launch codex exec from inside a Codex execution.

## See also

- `.claude/rules/workflow/12-subagent-bash-hygiene.md` — the command-shape hygiene
  contract this procedure's templates satisfy.
- `.claude/skills/omb-codex-run/SKILL.md` — the reference direct-execution
  implementation this procedure's prompt-file lifecycle and `<STAMP>` rule are drawn
  from.
