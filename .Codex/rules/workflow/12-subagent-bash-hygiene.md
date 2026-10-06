# Sub-Agent Bash Command Hygiene

**SSOT for sub-agent Bash command hygiene.** This file loads globally at session start (no
`paths:` frontmatter): it governs how sub-agents *shape* Bash commands, a concern that is not
tied to which files are edited. Other files (agent/skill definitions that declare `Bash`) **cite**
this file and MUST NOT restate its allow-grammar or agent-class table — same discipline as
`testing/test-execution.md` and `workflow/11-subagent-watchdog.md`.

## Why

Claude Code's permission engine never auto-approves a Bash command that contains shell
expansion or control flow, regardless of any `settings.json` allowlist entry. The analyzer
denies with reasons such as "Contains simple_expansion" (`$VAR`, `$(...)`, `<(...)`) or
"Compound command contains cd with output redirection" (`cd X && cmd > file`), and prompts the
user for approval instead. On a `run_in_background` sub-agent that prompt has nowhere to
render — it is invisible, so the sub-agent appears to hang. The sub-agent watchdog
(`workflow/11-subagent-watchdog.md`) then treats the silence as a real hang, kills the child
with `TaskStop`, and retries it — burning a retry slot on a command that was never going to
execute in that form. This was documented as a wiki lesson on 2026-07-18 (project blueprint,
harness gotchas) after repeated false-hang retries traced back to `$(...)`/`for`-loop
commands issued by read-only reviewer sub-agents. No allowlist widening fixes this: the
analyzer's expansion/control-flow check runs before allowlist matching, so an allow entry for
`git log*` still blocks `git log $(cat rev.txt)`.

## Allow-grammar (SSOT definition)

A sub-agent Bash command is **plain** if and only if it contains **none** of the following:

- `$` (any use — variable expansion, `$(...)`, arithmetic `$((...))`)
- backtick (`` ` ``)
- `<(` or `>(` (process substitution)
- `<<` (heredoc)
- a word-boundary occurrence of `for`, `while`, `until`, `do`, `done`, or `cd`

Pipelines (`|`) and `&&`/`;` chains **of plain, allowlisted commands** are fine — only the
tokens above trip the gate. `git log --oneline | head -20` is plain; `for f in *.py; do rg
TODO "$f"; done` is not (fails on `for`/`do`/`done`, and `$f`).

## Agent class table

| Class | Agents | Enforcement |
|-------|--------|-------------|
| A — full deny | 13 enumerated reviewers: `plan-evaluator`, `core-critique`, `api-design`, `db-design`, `ui-design`, `ai-design`, `electron-design`, `infra-design`, `infra-critique`, `security-audit`, `code-review`, `harness-design`, `wiki-reviewer` | Bash denied outright by hook, regardless of command content — these agents have no legitimate shell need. A reviewer with a self-declared scoped `Bash(...)` grant in its own frontmatter is exempt. |
| B — hygiene-gated read-only | `*-verify` (`ai-verify`, `api-verify`, `db-verify`, `ui-verify`, `electron-verify`, `infra-verify`, `harness-verify`), `*-explorer` (`ai-explorer`, `api-explorer`, `db-explorer`, `ui-explorer`, `electron-explorer`, `infra-explorer`, `harness-explorer`, `doc-explorer`, `general-explorer`, `core-explore`), `code-debug`, `fix-history`, `fix-triage`, `fix-architect`, `feedback-analyzer`, `ops-leak-audit`, `infra-cloud`, `infra-k8s`, `ai-architect`, `plan-writer`, `plan-improver`, `fix-writer` | Allow-grammar enforced by hook deny: plain commands pass through to normal permission evaluation; non-plain commands are denied with rewrite guidance. |
| C — write agents | `*-implement`, `git-commit`, `code-test`, `doc-writer`, `wiki-writer`, and other file-editing agents | Guidance only — the hook does not intervene. Heredoc-based commit message patterns (`git commit -m "$(cat <<'EOF' ... EOF)"`, per `git/commit-template.md`) remain legal for these agents. |

**Degradation boundary (HARD):** the PreToolUse payload's `agent_type` field is a free-form
teammate label chosen by the spawning skill (e.g. `rev-critique`, `plan-writer-1`), not
necessarily a registered agent name — see "Layer 2 — hook" below for the exact resolution
order. A label that fails to resolve to any Class A/B/C name degrades from Class-A full-deny to
the Class-B hygiene allow-grammar default; it is never treated as a no-op.

## HARD Rules

- **[HARD] Spawn-bearing skills pin `name:` on every `Agent({ subagent_type: ... })` block** so
  the identity resolver in `SubagentBashGateHandler` can exact-match the label to a registered
  agent name and restore Class-A full-deny precision. Coverage is partial: this applies only to
  the eight skills using the `Agent({ subagent_type: ... })` invocation form (`omb-plan`,
  `omb-plan-review`, `omb-verify`, `omb-refactoring`, `omb-fix`, `omb-run`, `omb-architect`,
  `omb-ultra-review`) — the
  `Agent(@agent-name):` form used by `omb-orch-*` and the unnamed spawns in `omb-explore` /
  `omb-issue` are not covered and remain on the hygiene fail-closed default.
- **[HARD] Class-B agents write single plain commands only.** Use absolute paths instead of
  `cd`; use the Read, Grep, and Glob tools instead of `sed`/`awk`/`for`-loops over files; use
  `printenv VAR` instead of `echo ${VAR:-default}`. Never retry a denied command in the same
  form — rewrite it per the cookbook below.
- **[HARD] Agent/skill `.md` files MUST NOT embed command templates containing `${`, `$(`, or
  backticks for Class-A or Class-B agents.** A shell-injection template baked into a prompt
  guarantees the same command shape on every invocation, reproducing the hang deterministically.
- **[HARD] Every Bash-declaring agent `.md` cites this file** (`workflow/12-subagent-bash-hygiene.md`)
  by path in its rules/constraints section — do not restate the allow-grammar or class table inline.

## Rewrite cookbook

| Forbidden form | Plain replacement |
|-----------------|--------------------|
| `for f in *.py; do rg TODO "$f"; done` | One `rg TODO` call across the glob, or issue one Grep tool call per file instead of a shell loop. |
| `diff <(cmd1) <(cmd2)` | Write each command's output to a real temp file (via Read/Write or two separate Bash calls), then `diff file1 file2`. |
| `cd apps/api && pytest tests/` | `pytest apps/api/tests/` — pass the absolute/relative path as an argument, no `cd`. |
| `echo ${OMB_LANGUAGE:-en}` | `printenv OMB_LANGUAGE` (or accept its absence and use the Read tool to inspect config directly). |
| `cat "$(git rev-parse --show-toplevel)/CLAUDE.md"` | Use the Read tool directly on the resolved path, or run `git rev-parse --show-toplevel` alone, read its output, then issue a second plain `Read`/`cat` call with the literal path. |

## Enforcement layers

1. **Layer 1 — seed allowlist**: the main-session convenience `Bash(...)` entries seeded via
   `OMB_PERMISSIONS_SEED` (see `harness/claude-code-harness.md` §7), kept in 3-source lockstep
   per `workflow/08-hook-conventions.md` HARD rule #7. Trusted main session only.
2. **Layer 2 — hook**: `SubagentBashGateHandler` (`src/hook/security/subagent_bash_gate.py`)
   resolves the sub-agent identity from `agent_type` before applying either deny mode. Resolution
   is exact-match-or-suffix-strip only (never substring/fuzzy — that would let, e.g., a
   `review-code` label cross-resolve to `code-review`):
   1. Exact-match the label against the union of Class A, B, and C names.
   2. On no match, strip one trailing `-<digits>` pin suffix (e.g. `core-critique-2` ->
      `core-critique`) and re-match.
   3. Still no match -> unresolved.

   A label that resolves to Class A gets the full deny; one that resolves to Class C passes
   through untouched; one that resolves to Class B, or fails to resolve at all, falls back to
   the Class-B allow-grammar deny as a fail-closed default. A reviewer with a self-declared
   scoped `Bash(...)` grant in its own frontmatter is exempt from both the Class-A deny and the
   hygiene deny. `permissionDecision: deny` always wins over any Layer-1 allow entry (precedence:
   deny > defer > ask > allow). Kill switch: `OMB_BASH_GATE_ENABLED=false` disables the entire
   handler (all classes) for the session.
3. **Layer 3 — this rule + agent constraints**: the HARD rules above, cited by every
   Bash-declaring agent, prevent the hygiene violation from being written into a prompt in the
   first place — the hook is the backstop, not the primary control.

This rule interacts with `workflow/11-subagent-watchdog.md`: a hygiene-denied command returns
a synchronous deny to the sub-agent (visible in its own transcript, not a silent hang), so it
does NOT trigger the watchdog's inactivity/hard-ceiling kill path — the sub-agent sees the
deny reason and can rewrite the command within the same turn.

## See Also

- `testing/test-execution.md` — global-load precedent for a numeric-default SSOT file.
- `workflow/11-subagent-watchdog.md` — the hang-detection/kill/retry ladder this rule prevents
  from firing on hygiene-deniable commands.
- `common/output-contract.md` — the `<omb>` contract sub-agents still owe regardless of Bash
  denial.
- Wiki lesson (2026-07-18, project blueprint harness gotchas) — origin of this rule.
