---
description: "Hook Conventions"
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**", ".claude/hooks/**", "src/hook/**", ".claude/settings.json", "scripts/omb-setup-settings.sh"]
---

# Hook Conventions

## Naming Convention

All hook dispatching uses a single unified script in `.claude/hooks/omb/`:

```
omb-hook.sh <EventType>
```

Where `<EventType>` maps to a Claude Code lifecycle event in PascalCase:

| Command | Lifecycle Event | Matcher |
|---------|----------------|---------|
| `omb-hook.sh SessionStart` | SessionStart | — |
| `omb-hook.sh PreToolUse` | PreToolUse | Bash, Write\|Edit |
| `omb-hook.sh PreToolUse` | PreToolUse | Skill (acts only when `OMB_HERDR_DELEGATE=1`, blocking a delegated Herdr agent's own `omb-herdr*` Skill call per `.claude/skills/omb-herdr/references/delegation.md` §1) |
| `omb-hook.sh PostToolUse` | PostToolUse | Write\|Edit |
| `omb-hook.sh Stop` | Stop | Agent |
| `omb-hook.sh SubagentStart` | SubagentStart | `*` (all) |
| `omb-hook.sh SubagentStop` | SubagentStop | `*` (all) |
| `omb-hook.sh WorktreeSetup` | WorktreeSetup | manual invocation |
| `omb-hook.sh WorktreeTeardown` | WorktreeTeardown | manual invocation |

> For the harness-owned vs user namespace contract, see `docs/oh-my-braincrew/cli.md`.

## Architecture

```
Claude Code lifecycle event
  ↓
settings.json hook entry (type: command)
  ↓
.claude/hooks/omb/omb-hook.sh (unified dispatcher)
  ↓
uv run oh-my-braincrew <EventType> [args...]
  ↓
src/hook/cli.py → Registry → Handler(s)
```

### Shell Wrapper

The single `omb-hook.sh` file is a **thin dispatcher only** — all logic lives in `src/hook/`. The shell wrapper MUST be a single `exec` call with no conditional branches, variable assignments, or utility commands (`jq`, `grep`, etc.).

#### Development template (run from source via uv)

```bash
#!/usr/bin/env bash
# omb-hook.sh — Thin wrapper for oh-my-braincrew Python CLI
# Usage: omb-hook.sh <EventType> [args...]
set -euo pipefail

# Resolve project root via 4-tier fallback (env > git > script-relative > pwd).
# See .claude/rules/languages/shell.md "Project root resolution".
resolve_project_dir() {
  local root
  if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}" ]]; then
    printf '%s\n' "${CLAUDE_PROJECT_DIR}"; return 0
  fi
  if root=$(git rev-parse --show-toplevel 2>/dev/null) && [[ -n "$root" && -d "$root/.claude" ]]; then
    printf '%s\n' "$root"; return 0
  fi
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)
  if [[ -n "$root" && -d "$root/.claude" ]]; then
    printf '%s\n' "$root"; return 0
  fi
  pwd
}
PROJECT_DIR=$(resolve_project_dir)
exec uv run --project "${PROJECT_DIR}" oh-my-braincrew "$1" "${@:2}"
```

#### Release template (installed binary on PATH)

```bash
#!/usr/bin/env bash
# omb-hook.sh — Thin wrapper for oh-my-braincrew CLI
# Usage: omb-hook.sh <EventType> [args...]
set -euo pipefail
exec omb "$1" "${@:2}"
```

Rules:
- No `jq`, `grep`, or other logic in the shell wrapper
- No conditional branches (`if`, `[`, `||`, `&&` with side effects) **except inside `resolve_project_dir()`** — the project-root fallback chain is the **single allowed exception** to the no-logic rule
- The exception is **strictly** scoped to the `${CLAUDE_PROJECT_DIR:-}` / `git rev-parse` / `BASH_SOURCE` chain that resolves the project root. Tool-input parsing, conditional dispatch, `jq`/`grep`/`sed`, decision logic, and retry/backoff are all forbidden.
- No variable assignments beyond `set -euo pipefail` and `PROJECT_DIR=$(resolve_project_dir)`
- `exec` replaces the shell process to preserve stdin piping and exit codes
- `$1` is the EventType, `${@:2}` passes through remaining CLI args

### Python Package

Source: `src/hook/`

| Sub-package / Module | Purpose |
|---------------------|---------|
| `cli.py` | Entry point: parse event type, read stdin, dispatch, exit |
| `protocol.py` | JSON stdin/stdout I/O |
| `registry.py` | Handler registration and sequential dispatch with timeout |
| `types.py` | EventType enum, ExitCode enum, HookInput/HookOutput |
| `contract.py` | Environment validation |
| `core/` | Core handlers (session start, stop) |
| `lifecycle/` | Lifecycle handlers (pre-tool-use, post-tool-use) |
| `quality/` | Quality gate handlers (lint checks, PR gates) |
| `security/` | Security handlers (secret scanning, scope guards) |
| `worktree/` | Worktree handlers (setup, teardown) |

## Protocol

- **stdin**: JSON payload from Claude Code (event-specific fields)
- **stdout**: Text injected into Claude's context (SessionStart, UserPromptSubmit)
- **stderr**: Diagnostic messages shown in user terminal (verbose mode)
- **Exit codes**: `0` = allow, `2` = block, other = non-blocking error (fail-open)

## Adding a New Handler

No new shell scripts are needed. To add a new handler:

1. Create a handler `.py` file in the appropriate sub-package under `src/hook/` (e.g., `src/hook/quality/<name>.py`) implementing the `Handler` ABC
2. Register in `src/hook/cli.py:build_registry()`
3. Create `tests/hooks/test_<name>.py`
4. If a new lifecycle event: add a new entry in `settings.json` pointing to `omb-hook.sh` with the new EventType

### Declaring a lifecycle event WITHOUT a new handler (observability-only)

Some events need only to *fire* so the always-on `event_mirror` records a wall-clock
anchor — no decision logic is required. `cli.py:main()` calls `mirror_before_dispatch` /
`mirror_after_dispatch` for **every** valid `EventType` regardless of which handlers
match, and `Registry.dispatch()` returns a benign `ALLOW` (exit 0) when no handler is
registered for the event. So declaring the event in `settings.json` is sufficient — do
NOT add a handler `.py` or a `cli.py` mapping unless decision logic is actually needed.

`SubagentStart` and `SubagentStop` are wired this way:

- `SubagentStart` (matcher `*`, non-blocking) gives the sub-agent duration observability
  (`event_mirror` / `hook_stats`) a live start anchor.
- `SubagentStop` (matcher `*`, non-blocking) is the stop anchor that lets `event_mirror`
  pair each `SubagentStart` with its `SubagentStop` so `hook_stats` can report wall-clock
  duration. **The matcher MUST be `*`, not `Agent`:** per the Matcher Syntax table,
  `SubagentStart`/`SubagentStop` match the **sub-agent type**, not the `Agent` tool name
  (unlike `Stop`, which matches the tool name). A `matcher: "Agent"` here would only fire
  for a sub-agent literally typed `Agent` and would never run for normal domain agents,
  leaving every duration unpaired. The `EventType` enum already defines both events, so no
  new handler is needed.
- The `<omb>` contract enforced by `StatusRouterHandler` on `Stop`/`matcher=Agent` does
  NOT fire for `run_in_background` sub-agents; primary enforcement stays orchestrator-side
  per `workflow/11-subagent-watchdog.md`.

**[HARD] Two-source agreement for every hooks entry.** Every `settings.json` `hooks`
entry MUST be mirrored verbatim (same event / matcher / `timeout`) into the
`scripts/omb-setup-settings.sh` heredoc PATCH block. `tests/hooks/test_settings_hook_timeouts.py`
parses both sources and asserts they agree per `(event, matcher)` pair, and that each
`timeout` is strictly above the imported `EVENT_DEADLINE` (events absent from the table
use `DEFAULT_EVENT_DEADLINE`). `SubagentStart`/`SubagentStop` use `timeout: 10` (> the
fallback deadline of 8) in both sources.

## HARD Rules

1. **[HARD] All hook dispatching MUST use the single `omb-hook.sh` dispatcher** — no other shell scripts for hooks.
2. **[HARD] Shell wrapper contains NO logic** — only the `exec uv run` template.
3. **[HARD] Python handles all JSON** — no `jq` in shell scripts.
4. **[HARD] Every handler has tests** — `tests/hooks/test_<name>.py` required.
5. **[HARD] Zero runtime dependencies** — `src/hook/` uses stdlib only.
6. **[HARD] `omb init` and `omb update` MUST seed every required `.claude/bin/` wrapper from packaged resources** — `.claude/bin/omb-cli.sh` and `.claude/bin/codex-preflight.sh` are invoked directly by `omb-codex-*` skill preflights, so a missing wrapper surfaces as `exit=not-installed` and breaks every Codex integration immediately after install. Trusting the release tarball alone is forbidden because tarball regressions (or older installer binaries) silently drop the directory and `_copy_harness_dirs` skips missing source dirs without error. The seed source MUST live inside the `hook` Python package (e.g. `src/hook/resources/bin/`) so the invariant holds regardless of tarball state, and `verify_installation` MUST list both wrappers in `REQUIRED_FILES` so the gap is caught at integrity time. Every new required wrapper added to `.claude/bin/` MUST be added to BOTH the seed function (`hook.commands.seed_bin.REQUIRED_BIN_WRAPPERS`) AND `integrity.REQUIRED_FILES` in the same change — otherwise this regression class returns. Applies only to `init` and `update`; other commands MAY assume the wrappers already exist. **When the seed source is a package resource (e.g. `hook/resources/bin/`), the release build pipeline MUST also include `--collect-data <package>` in every PyInstaller invocation, with a regression test that parses the workflow YAML** — `--collect-submodules` only collects Python modules, not data files, so without `--collect-data` the bundled binary's `_MEI...` extraction directory will lack the wrapper sources and `seed_bin_wrappers` will raise `FileNotFoundError` at runtime.

7. **[HARD] Setup/install scripts MUST preserve user-added hook matchers and permission entries** — Scripts that mutate `.claude/settings.json` (e.g., `scripts/omb-setup-settings.sh`) MUST upsert hooks arrays by `matcher` key (replace same-matcher entries, preserve all others) and union `permissions.allow` (deduplicated). Replacing entire arrays right-wins is forbidden because it silently drops user/plugin-added matchers (e.g., `WikiRouteGuardHandler`'s `Agent` matcher) and converts hooks into dead code. Every such script MUST ship with regression tests under `tests/scripts/` exercising the upsert/union semantics with at least one user-added matcher and one user-added permission entry pre-populated.

## Wrapper-Absent Handling

Skills that shell-inject `.claude/bin/` wrappers MUST handle the wrapper-absent case (`not-installed`) distinctly from wrapper-internal errors. Use the shared preflight pattern in `.claude/bin/codex-preflight.sh` as reference.

## Non-Hook Executable Wrappers

`.claude/bin/` holds CLI helper scripts invoked from SKILL.md shell-injection blocks — **not hooks**. Scripts in `.claude/bin/` MUST NOT be registered in `settings.json` as hook handlers and MUST NOT read Claude Code's hook stdin JSON. `omb-cli.sh` is the canonical example: it routes `omb env` subcommands from skill preflights via `uv run --project "${CLAUDE_PROJECT_DIR}" oh-my-braincrew`.

HARD rule #1 ("All hook dispatching MUST use the single `omb-hook.sh` dispatcher — no other shell scripts for hooks") applies ONLY to `.claude/hooks/omb/`. Scripts under `.claude/bin/` are out of its scope.
