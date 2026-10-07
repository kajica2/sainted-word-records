---
paths: ["tests/**/*.py", "test_*.py", "*_test.py"]
---

# Pytest Conventions

## Structure
- Tests mirror source: `src/api/routes.py` → `tests/api/test_routes.py`
- Shared fixtures in `conftest.py` at each test directory level
- Name tests: `test_{what}_{condition}_{expected}` (e.g., `test_login_invalid_password_returns_401`)

## Fixtures
- Use `@pytest.fixture` for setup/teardown, not setUp/tearDown
- Scope fixtures appropriately: `function` (default), `module`, `session`
- Use `autouse=True` sparingly — only for truly universal setup
- Database fixtures: create and rollback per test (transaction isolation)

## Async Tests
- Use `pytest-asyncio` with `@pytest.mark.asyncio`
- Async fixtures: `@pytest_asyncio.fixture`
- Use `AsyncClient` (httpx) for FastAPI endpoint tests

## Patterns
- `parametrize` for testing multiple inputs: `@pytest.mark.parametrize("input,expected", [...])`
- `pytest.raises(ExceptionType)` for expected errors
- `monkeypatch` over `unittest.mock` for patching
- `tmp_path` fixture for temporary file operations

## Execution Timeouts

SSOT: `.claude/rules/testing/test-execution.md` — defines all numeric defaults; do not restate them as authoritative here.

- Every pytest invocation MUST carry a per-test runner timeout: `--timeout=10` (pytest-timeout plugin) or a `PYTEST_TIMEOUT=10` env prefix.
- The `pytest_timeout_guard` PreToolUse hook (`src/hook/quality/pytest_timeout_guard.py`) blocks Bash calls that omit it (exit 2).
- Set the Bash tool `timeout` explicitly per the SSOT: 60s (60000ms) for a single test file, 120s (120000ms) for a full suite.
- Canonical command form (diff-targeted, per `testing/test-execution.md`): `uv run pytest tests/foo/test_bar.py::test_case -q --timeout=10`.

## Coverage
- Target: 80%+ for critical paths (auth, payments, data mutations)
- Run: `pytest --cov=src --cov-report=term-missing --timeout=10` — changed-module scope for development; repo-wide only in CI
- Exclude: migrations, config files, type stubs
