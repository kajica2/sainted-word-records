# Test-Execution Timeout Discipline

**SSOT for test-run timeouts.** This file loads globally at session start (no `paths:`
frontmatter): it governs how tests are *executed*, not which files are edited, so
path-scoping cannot guarantee it is loaded at the moment a test runs.

A defective autouse fixture (pointing at a nonexistent path) once hung a background
test run with no timeout and burned hours. Every layer below is defense against that.

## Default Timeouts (SSOT — other files cross-reference, never restate)

| Layer | Value | Applies to |
|-------|-------|-----------|
| Per-test runner timeout | 10s | every pytest invocation (`--timeout=10`) |
| Single test file | 60s (60000ms) | Bash tool `timeout` for one-file runs |
| Full suite | 120s (120000ms) | Bash tool `timeout` for whole-suite runs (CI, release, or explicit user request only) |
| Integration test | 60s/test | see `testing/integration.md:37` ("60s per test, 10min total") |

LLM-calling tests MAY exceed these limits **only with an explicit stated reason** in the
command rationale. No silent bumps.

## HARD Rules

- **[HARD] Development test runs MUST be diff-targeted** — in every OMB workflow
  (plan, plan-review, run, verify, doc, pr), run only the tests mapped to the
  change diff. Do not run a repository-wide or domain-wide suite (e.g.
  `pytest tests/`, `pytest tests/api/`, bare `vitest run`) during development;
  reserve full suites for CI, release, or an explicit user request, and state
  that reason in the command rationale when you do.
  - **Diff derivation**: changed files = merge-base of the repository default
    branch (resolve `refs/remotes/origin/HEAD`; fall back to `main`, then
    `master`) and `HEAD`, diffed
    against the working tree, unioned with staged and unstaged changes. This is
    the same union omb-verify Step 1.3 already computes (plan `Artifacts:` ∪
    `git diff --name-only` vs base).
  - **Mapping (deterministic, in order)**:
    1. Tests named by the active plan/ticket for the change unit.
    2. Convention mapping — `src/<pkg>/<module>.py` → `tests/**/test_<module>.py`;
       `<Component>.tsx` → `<Component>.test.tsx` (same directory or `__tests__/`).
       In a monorepo workspace the mapping is workspace-prefixed:
       `<workspace>/src/<module>.py` → `<workspace>/tests/test_<module>.py`
       (e.g. `apps/api/src/x.py` → `apps/api/tests/test_x.py`).
    3. Harness files (`.claude/rules/**`, `.claude/agents/**`, `.claude/skills/**`,
       `CLAUDE.md`, `AGENTS.md`, `settings.json`) → the contract tests that read
       them: `tests/harness/test_rules_contract.py`,
       `tests/scripts/test_agent_bash_hygiene_consistency.py`,
       `tests/scripts/test_skill_md_no_stale_hook_refs.py`,
       `tests/scripts/test_settings_seed_consistency.py`,
       `tests/scripts/test_omb_setup_fixture_parity.py` (asserts
       `.claude/skills/omb-setup/tests/fixtures/samples/**` — other fixture
       trees fall through to tier 4),
       `tests/hooks/test_settings_hook_timeouts.py` (asserts `settings.json`,
       per `workflow/08-hook-conventions.md` HARD rule #7),
       `tests/skills/test_omb_targeted_tdd_contract.py` (asserts this rule's
       wording and the targeted-TDD text in plan/run/tdd skills) — select by
       which asserted path set the changed file belongs to.
    4. No mapped test exists: for application/source code, write the missing
       test first (TDD RED). For prose-only harness files outside every
       asserted contract-test path set, a documented grep/lint audit with a
       stated pass condition satisfies the mapping. In neither case
       may a full suite substitute for a missing mapping.
  - **Verify stage**: run the union of tests mapped from the whole diff once.
    Coverage gates are computed per changed module over that union run
    (`--cov=<pkg>.<module>` — dotted module path; a `src/.../*.py` file path is
    not a valid pytest-cov target — per omb-tdd coverage-gates). If a changed
    module under-reports because its coverage comes from tests outside the
    mapping, widen the selection to the test files that import that module
    (grep `import <module>` under `tests/`) — still never the domain directory.
    A widely-shared module flagged by @core-critique may widen further, with the
    reason stated.
  - **Enforcement**: `@plan-evaluator` `test.commands` rubric item; the
    diff-scope check in `omb-verify` Step 3 (Static Analysis Baseline); the
    rule-text assertion in `tests/harness/test_rules_contract.py`. The
    `pytest_timeout_guard` hook enforces timeouts only — scope is rule-enforced
    (second line of defense).
- **[HARD] Every test-running Bash call sets the Bash tool `timeout` parameter** — 60000ms
  for a single file, 120000ms for a full suite. Foreground Bash has an implicit ~120s
  default, but setting it explicitly is required: it reveals intent and stays consistent
  with background and long-run cases.
- **[HARD] pytest must carry a per-test runner timeout** — `--timeout=10` (pytest-timeout
  plugin) or a `PYTEST_TIMEOUT=10` env prefix. The `pytest_timeout_guard` PreToolUse hook
  (`src/hook/quality/pytest_timeout_guard.py`) blocks violations with exit 2. Scope:
  Claude's Bash tool calls only — user-typed `! pytest ...` is not intercepted.
- **[HARD] Background test runs** (`run_in_background: true` or trailing `&`): a runner-level
  timeout (`--timeout=` / `PYTEST_TIMEOUT=`) is REQUIRED — the Bash tool `timeout` parameter
  is empirically verified NOT to kill background jobs (a `sleep 30` with `timeout: 5000` ran
  to completion). Output MUST be checked immediately on completion.
  Small fixes (≤2 files) prefer foreground, one-file-at-a-time runs.
- **[HARD] vitest: bare `vitest` (watch mode — never terminates) is forbidden; always use
  `vitest run`.** Keep the built-in `testTimeout` default (5s); do not raise it without a
  stated justification.

## Enforcement Limits (the hook is best-effort)

The `pytest_timeout_guard` hook is the first line of defense, but it fails open by design:

- The hook Registry fails open on handler exceptions (`src/hook/registry.py:41`).
- `bash -c "pytest ..."`, heredoc-fed interpreters (`bash <<'EOF' ... pytest ... EOF`), and
  wrappers like `tox` / `make test` are intentionally fail-open.

This rule text is the **second line of defense** — apply the discipline even where the hook
cannot see the command.

## CI Enforcement (the third line of defense)

The `python-test` job in `.github/workflows/ci.yml` runs the suite where the
`pytest_timeout_guard` hook cannot see it, so CI carries the discipline in the workflow
itself:

- The pytest invocation carries the SSOT per-test default (`--timeout=10`), matching the
  Default Timeouts table above.
- The job declares `timeout-minutes: 20` as a backstop for hangs a per-test timeout
  cannot catch (collection/import hang, first-fixture hang before any test starts),
  keeping a wedged job far below GitHub's 360-minute default.
- `tests/scripts/test_ci_pytest_timeout.py` parses `ci.yml` and asserts both invariants
  (per-test timeout present; `timeout-minutes` backstop declared), so this rule-vs-CI
  alignment cannot silently regress.

## Timeout Triage Protocol (summary — details in omb-tdd skill)

On a test-run timeout, suspect the **test code first**, in this order:

1. `ruff` + `python -m py_compile` the test file (catches syntax / import errors).
2. Run a single test with `-x` to fail fast on the first error.
3. Inspect fixtures / monkeypatch for environment assumptions.

Only then consider re-running or raising timeouts. **Re-running with a longer wait,
unchanged, is forbidden** — it just burns the same hours again.

## Test-Code Self-Check (pre-run, summary)

Before running, confirm the test code does not contain these failure seeds:

- Autouse fixtures must not assume environment paths exist — prefer `tmp_path`.
- No hardcoded path-literal assertions — assert against env-derived values.
- Every monkeypatch of config/settings pairs with the matching cache invalidation
  (e.g. `clear_settings_cache()`), or the patch silently does nothing.

## See Also

- `testing/pytest.md` — pytest structure, fixtures, async, coverage.
- `testing/vitest.md` — vitest component testing.
- `testing/integration.md` — integration timeouts (60s/test, 10min total).
- `workflow/05-test.md` — TDD cycle, coverage targets, mock strategy.
- `omb-tdd` skill — full Timeout Triage Protocol and mock discipline.
- `OpenWiki lesson` admission gate — this rule closes the gate for timeout and test-selection gotchas; route future timeout lessons to updates of this file instead of new lesson notes.
