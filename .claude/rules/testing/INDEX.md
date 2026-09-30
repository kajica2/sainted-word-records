# Testing Rules

## Files

- `pytest.md` — pytest structure, fixtures, async (pytest-asyncio), parametrization, coverage commands
- `vitest.md` — vitest component testing with @testing-library/react, `vitest run` (no watch mode)
- `integration.md` — integration test patterns, timeouts (60s per test, 10min total), real-dependency boundaries
- `test-execution.md` — **timeout-discipline SSOT**: per-test 10s / single file 60s / full suite 120s, background-run policy, vitest watch-mode ban, triage protocol, diff-targeted selection HARD rule. Loads globally (no `paths:` frontmatter) and is enforced by the `pytest_timeout_guard` PreToolUse hook. Other files cross-reference its numeric defaults, never restate them.

## Triggers

Inject these rules when working on: pytest, vitest, test execution, timeouts, `tests/**`,
`**/test_*.py`, `**/*.test.ts`, `--timeout`, `PYTEST_TIMEOUT`, pytest-timeout,
`vitest run`, watch mode, coverage runs, fixtures, monkeypatch, background test runs.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../workflow/05-test.md` (TDD cycle, coverage targets, mock strategy, AAA pattern)
