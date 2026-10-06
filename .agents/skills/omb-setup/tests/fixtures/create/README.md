# CREATE smoke fixture

## Purpose

This fixture directory contains the inputs and expected output for a smoke test of the
`omb-setup` v2 CLAUDE.md generator in CREATE mode.

## Files

| File | Description |
|------|-------------|
| `package.json` | Minimal Node.js/fullstack root with `dev`, `test`, `lint`, `typecheck`, `build` scripts |
| `pyproject.toml` | Minimal Python backend with `[tool.ruff]` and `[tool.pyright]` configuration |
| `answers.json` | Pre-filled non-interactive answers for the `fullstack` template |
| `expected-CLAUDE.md` | Manually-constructed expected output per v2 schema (Section 2 of reference.md) |
| `SMOKE_RESULT.md` | Static verification results recorded by the implementation agent |

## Usage

```
# CREATE smoke fixture
# Usage (future, when binary exists):
#   cat answers.json | omb-setup --non-interactive --cwd=<tmp-dir>
# Manual verification here: expected-CLAUDE.md is hand-constructed per v2 schema.
```

## How expected-CLAUDE.md was built

1. Template `fullstack` selected from `answers.json`
2. HOW table commands sourced from `package.json` scripts:
   - Dev: `turbo dev` (scripts.dev)
   - Test: `turbo test` (scripts.test)
   - Lint: `turbo lint` (scripts.lint)
   - Typecheck: `turbo typecheck` (scripts.typecheck)
   - Build: `turbo build` (scripts.build)
3. Project slot row: `DB migrate` / `alembic upgrade head` from `answers.json`
4. Project purpose from `answers.json` (`project_purpose`)
5. Project-specific HARD rule from `answers.json` (`project_hard_rules[0]`)
6. 5 Universal HARD rules verbatim from plan §2.3 schema
7. AGENTS.md bridge comment block at file top
8. Reference Index: 4 required rows only — Wiki/Architecture/Local override rows omitted
   because `docs/wiki/index.md`, `docs/architecture/`, and `CLAUDE.local.md` do not
   exist in this fixture directory
