---
description: Testing standards for Python and TypeScript projects
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**"]
---

# Testing Standards

## TDD Cycle (mandatory for new code)

For new features and bug fixes, follow the RED-GREEN-IMPROVE cycle:
1. **RED**: Write a failing test that describes the expected behavior
2. **GREEN**: Write the minimal implementation to make the test pass
3. **IMPROVE**: Refactor while keeping tests green — clean up duplication, improve naming, simplify logic

Skip TDD only for: trivial changes, pure config, or documentation-only updates.

SSOT: `.claude/rules/testing/test-execution.md` — defines the diff-targeted test-selection HARD rule; do not restate it as authoritative here.

## Frameworks
- **Python**: pytest (with pytest-asyncio for async code)
- **TypeScript**: vitest (with @testing-library/react for components)

## Execution Timeouts

SSOT: `.claude/rules/testing/test-execution.md` — defines all numeric defaults; do not restate them as authoritative.

Test selection is diff-targeted per `testing/test-execution.md` — do not restate its mapping here.

- pytest runs MUST carry a per-test runner timeout (`--timeout=10` or a `PYTEST_TIMEOUT=10` prefix); the `pytest_timeout_guard` PreToolUse hook blocks Bash calls that omit it.
- vitest always runs as `vitest run` — bare `vitest` (watch mode) never terminates and is forbidden.
- Set the Bash tool `timeout` explicitly: 60s for a single test file, 120s for a full suite.
- Background test runs (`run_in_background` / `&`) MUST include a runner-level timeout and have their output checked immediately on completion — the Bash tool `timeout` is not proven to kill background jobs.
- On a test-run timeout, follow the Timeout Triage Protocol: suspect test-code defects first (lint/compile the test, run one test with `-x`, inspect fixtures) before re-running or raising any limit.

## Coverage Targets
- New code: minimum 85% line coverage, 80% branch coverage
- Critical paths (auth, payments, data mutations): 95%+ line, 90%+ branch
- Utilities and helpers: 90%+
- Coverage is enforced by verify agents via omb-tdd skill — implement agents MUST run coverage commands before reporting DONE

## Test Naming
- Python: `test_<function>_<scenario>_<expected>` e.g. `test_login_invalid_password_returns_401`
- TypeScript: `describe("<Component>")` + `it("should <behavior>")` e.g. `it("should show error on invalid input")`

## Test Structure (AAA Pattern)
1. **Arrange**: set up test data and dependencies
2. **Act**: execute the code under test
3. **Assert**: verify the result

## Mock Strategy
- Mock at boundaries only (external APIs, databases, file system)
- Never mock the unit under test
- Prefer dependency injection over monkeypatching
- Use factories for test data — no hardcoded magic values
- Reset mocks between tests to prevent cross-contamination
- Mock returns MUST be typed and match actual API/DB response shapes — empty `{}` or untyped `MagicMock()` are banned
- Every mock MUST have at least one call argument assertion — see omb-tdd `rules/mock-discipline.md` for full rules

## What to Test
- Happy path for every public function
- Edge cases: empty input, null, boundary values
- Error paths: expected exceptions, validation failures
- Integration points: API contracts, database queries

## What NOT to Test
- Private/internal implementation details
- Third-party library internals
- Trivial getters/setters with no logic
