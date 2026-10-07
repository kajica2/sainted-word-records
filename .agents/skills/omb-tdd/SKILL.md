---
name: omb-tdd
description: "TDD enforcement — RED-GREEN-IMPROVE cycles, mock discipline, 85%+ coverage gates. Load in implement/verify agents."
---

# Test-Driven Development Enforcement

## Usage Contract

**Task type:** Apply the domain guidance below to the caller's active task; this skill is a reference, not an independent workflow.

**Required input:** A concrete question, design, file, diff, or implementation decision within this skill's domain.

**Do:**
- Select only the relevant rules, reconcile them with repository-specific instructions, and cite concrete evidence when evaluating existing work.
- State assumptions and applicability limits when the available context is incomplete.

**Don't:**
- Do not invent repository facts, tool results, versions, or requirements.
- Do not apply examples mechanically when the project's source of truth conflicts with them.

**Completion:** Return actionable guidance or a checked result in the caller's requested format; identify any unresolved evidence gap explicitly.

<role>
You are a TDD enforcement expert. Your job is to ensure every implementation follows the RED-GREEN-IMPROVE cycle, uses properly typed mocks only at system boundaries, and meets the project's coverage thresholds (85% line, 80% branch). You block and require retry for any phase violation, banned mock pattern, or coverage shortfall.
</role>

This skill enforces strict TDD methodology across all implementation domains. It provides the RED-GREEN-IMPROVE cycle, mock discipline rules, coverage gates, and stack-specific testing guidance.

**Why this exists**: Agents bypass test quality by using loose mocks (empty objects, untyped MagicMock, `vi.fn()` with no type constraints) that pass but do not validate real behavior. This skill closes that gap.

## TDD Cycle — Strict Phase Gates

<tdd_cycle>
Every implementation task MUST follow this cycle. Phase violations result in `<omb>RETRY</omb>`.

**[HARD] During development, run only the smallest test target that proves the active behavior. Do not expand GREEN or IMPROVE to a repository-wide or domain-wide full suite; reserve full suites for CI, release, or an explicit user request.**

Before starting, think through: Which behavior unit from the design spec am I targeting? What is the minimal test that proves it works? What input-output pair makes the test unambiguous? Apply this brief reasoning before writing each RED test.

### Phase 1: RED — Write a Failing Test

1. Read the design specification to identify the target behavior.
2. Write a test that describes the expected behavior with realistic inputs and outputs.
3. Run the test. It MUST fail. If it passes, the test is not testing new behavior — rewrite it.
4. Do NOT write or modify production code in this phase.

### Phase 2: GREEN — Write Minimal Code to Pass

1. Write the simplest implementation that makes the failing test pass.
2. Do NOT modify tests in this phase.
3. Do NOT add functionality beyond what the test requires.
4. Run the smallest test target for the active behavior. It MUST pass.

### Phase 3: IMPROVE — Refactor While Green

1. Clean up duplication, improve naming, simplify logic.
2. Run the active behavior's targeted tests after each refactoring change. They MUST stay green.
3. Do NOT add new functionality or expand scope.
4. Do NOT write new tests in this phase — that starts a new RED cycle.

### Example: One RED-GREEN-IMPROVE Cycle

<example>
```
RED:    Write test_create_user_returns_201_with_valid_data → Run → FAILS (endpoint missing)
GREEN:  Add POST /users route with minimal logic → Run → PASSES
IMPROVE: Extract validation to Pydantic model, add type hints → Run → still PASSES
RED:    Write test_create_user_returns_409_for_duplicate_email → Run → FAILS (no uniqueness check)
GREEN:  Add duplicate email check → Run → PASSES
...continue until all behaviors from the design spec are covered
```
</example>

### Iteration

Repeat RED-GREEN-IMPROVE for each behavior unit until the design specification is fully implemented. One test at a time — not batch.

### Phase Violations (auto-RETRY)

- Writing production code before a failing test exists → RETRY
- Modifying tests during GREEN phase → RETRY
- Adding new features during IMPROVE phase → RETRY
- Skipping the test run after GREEN or IMPROVE → RETRY
</tdd_cycle>

## Mock Discipline

<mock_discipline>
Read `rules/mock-discipline.md` for the complete rule set. Summary below.

### Scope: Mock ONLY at System Boundaries

| Boundary | Mock tool | Example |
|----------|-----------|---------|
| External HTTP API | `responses` (Python), `msw` (TypeScript) | Payment provider, third-party auth |
| Database | Real DB with transaction rollback (integration), typed fixtures (unit) | PostgreSQL test instance |
| File system | `tmp_path` (pytest), `vi.mock('fs')` with typed returns | Config file reads |
| Clock/time | `freezegun` (Python), `vi.useFakeTimers()` (TypeScript) | Scheduled job tests |
| Random/UUID | Seed or mock the generator | ID generation |

### NEVER Mock

- The module, class, or function under test
- Internal utility functions in the same project
- Pydantic/Zod validation (test with real schemas)
- SQLAlchemy models (use real DB or in-memory SQLite)

### Mock Realism Rules

1. Mock return values MUST match the actual API/DB response shape — use typed models or interfaces.
2. Mock error scenarios MUST use realistic error types (not generic `Exception` or `Error`).
3. Every mock MUST have at least one assertion verifying it was called with expected arguments.
4. Mocks that return empty objects (`{}`, `[]`, `None` without justification) trigger auto-FAIL.

### Banned vs Correct — Quick Reference

<example_bad>
```python
# BANNED: untyped mock, empty return, no call assertion
service = MagicMock()
service.get_user.return_value = {}
result = create_order(service, order_data)
assert result.status == "created"  # never verified service.get_user was called correctly
```
</example_bad>

<example_good>
```python
# CORRECT: spec= constraint, typed return, call assertion
service = MagicMock(spec=UserService)
service.get_user.return_value = User(id=1, name="Alice", email="alice@test.com")
result = create_order(service, order_data)
assert result.status == "created"
service.get_user.assert_called_once_with(user_id=order_data.user_id)
```
</example_good>

### Banned Patterns

See `rules/mock-discipline.md` for the complete list with correct alternatives.
</mock_discipline>

## Coverage Gates

<coverage_gates>
Read `rules/coverage-gates.md` for enforcement commands per stack. Thresholds below.

| Scope | Minimum Line Coverage | Branch Coverage |
|-------|----------------------|-----------------|
| New code (changed files) | 85% | 80% |
| Critical paths (auth, payments, data mutations) | 95% | 90% |
| Utility/helper modules | 90% | 85% |
| Overall project | 85% (aspirational for legacy) | — |

### Measuring Coverage

**Python:**
```bash
pytest --timeout=10 --cov=src/package/changed_module.py --cov-report=term-missing --cov-fail-under=85 tests/test_changed_module.py::test_changed_behavior
```

`--timeout=10` is the per-test runner timeout required by `.Codex/rules/testing/test-execution.md` (the `pytest_timeout_guard` PreToolUse hook blocks pytest Bash calls that omit it).

**TypeScript:**
```bash
vitest run src/components/ChangedComponent.test.tsx --coverage --coverage.include='src/components/ChangedComponent.tsx' --coverage.thresholds.lines=85
```

vitest keeps its built-in 5s `testTimeout` default — do not raise it without a stated justification.

### What Counts as Coverage

- Line coverage: every executable line reached by at least one test
- Branch coverage: every `if/else`, `try/catch`, `match/case` branch exercised
- Coverage of mocked paths does NOT count toward coverage — the mock bypasses the real code

### Coverage Exclusions (legitimate)

- Migration files
- Configuration/bootstrap files
- Type stubs and interfaces (no runtime code)
- Generated code (OpenAPI clients, protobuf)
</coverage_gates>

## Stack-Specific Rules

<stack_rules>
Read the relevant rule file before writing tests for that domain.

| Domain | Rule file | Key patterns |
|--------|-----------|-------------|
| Python/FastAPI | `rules/tdd-python-fastapi.md` | httpx AsyncClient, Pydantic model testing, async fixtures |
| Python/Database | `rules/tdd-python-db.md` | Transaction rollback, factory fixtures, migration testing |
| Python/AI | `rules/tdd-python-ai.md` | Graph state testing, tool unit tests, prompt regression |
| TypeScript/React | `rules/tdd-typescript-react.md` | RTL queries, hook testing, MSW for API mocking |
| TypeScript/Electron | `rules/tdd-typescript-electron.md` | IPC handler testing, preload mock, main process isolation |

### Decision Tree

1. Identify which stack your implementation targets.
2. Read the corresponding rule file BEFORE writing any test.
3. Follow the file's test structure template.
4. Use the file's recommended fixtures and mock patterns.
</stack_rules>

## Tool Usage and Autonomy

<tool_usage>
### Tool Usage Conditions

Use tools as follows when enforcing TDD in an implement or verify agent:

| Action | Tool | When |
|--------|------|------|
| Run tests or coverage commands | Bash | After writing each RED test; after GREEN; after each IMPROVE change. Set the Bash tool `timeout` parameter: 60000ms (single file) / 120000ms (full suite = CI/release/explicit-request only) per `.Codex/rules/testing/test-execution.md`. pytest commands also carry `--timeout=10`. |
| Read test files for mock quality scan | Read | During verify phase, for each test file in changed files list |
| Read rule files (`rules/mock-discipline.md`, `rules/coverage-gates.md`) | Read | Before writing tests for a new stack or when checking violations |
| Read design specification | Read | At the start of the RED phase, before writing any test |

Read only the files needed for the current phase. Do not read entire directories when a single targeted file suffices.

### Autonomy and Escalation

- **Act first**: Implement the TDD cycle steps directly without asking for confirmation. Run tests, write code, and refactor autonomously.
- **Emit RETRY** (not BLOCKED) when a TDD gate fails and the agent can correct itself: coverage shortfall, banned mock pattern, missing test. The agent should fix and re-run, not stop.
- **Emit BLOCKED** only when a prerequisite is missing and recovery is impossible without human input: coverage tool unavailable, design specification missing, stack rule file absent.
- **Never ask the user** to approve each test or each coverage run. Apply the gates automatically and report results in the output envelope.

### Context Management

- Scope Bash runs to the smallest affected target, for example `pytest --timeout=10 tests/test_<module>.py::<test_name>`.
- Read test files one at a time during the mock quality scan; do not load the entire test directory.
- No context compaction or /clear is needed within a single TDD enforcement run.

### Timeout Triage Protocol

When a test run times out, suspect the **test code first** — not the production code, and not the timeout value. A defective autouse fixture pointing at a nonexistent path can hang a run indefinitely. Work this order before touching the timeout:

1. **Lint and compile the test file** — `ruff check <test_file>` and `python -m py_compile <test_file>`. Catches syntax errors, broken imports, and malformed fixtures that hang at collection.
2. **Run the single failing test in isolation** — `pytest -x --timeout=10 <test_file>::<test>`. `-x` fails fast on the first error so you see the real cause instead of a wall of timeouts.
3. **Inspect fixtures and monkeypatch** — check autouse fixtures for path/env assumptions (real developer-machine paths that do not exist in this environment), and confirm every settings/config monkeypatch is paired with its cache invalidation (e.g. `clear_settings_cache()`) — an unpaired patch silently does nothing and the test hangs or misbehaves.

Only after these three steps may you consider re-running or raising the timeout. **Re-running the unchanged command with a longer wait is FORBIDDEN** — it just burns the same time again on the same defect.
</tool_usage>

## Integration with Implement Agents

<implement_integration>
When this skill is loaded in an implement agent, the execution order MUST include these TDD steps:

### Mandatory Execution Order Changes

Insert these steps after reading the design spec and existing code:

```
Step N:   RED — Write failing tests for the target behavior.
          Place tests in the correct directory per stack conventions.
          Use typed mock returns and realistic test data.
          Run tests — they MUST fail.
Step N+1: GREEN — Write minimal implementation to pass tests.
          Do NOT modify tests. Run the target behavior's smallest test — it MUST pass.
Step N+2: IMPROVE — Refactor implementation while tests stay green.
          Run the same targeted tests after each change.
```

Repeat for each behavior unit in the design.

### Self-Check Before DONE

Before reporting `<omb>DONE</omb>`, verify:

- [ ] Every public function/endpoint has at least one test
- [ ] Tests include both happy path and at least one error scenario
- [ ] No banned mock patterns used (check `rules/mock-discipline.md`)
- [ ] Coverage meets threshold: run coverage command and report the number
- [ ] Tests pass independently (no test depends on another test's state)
- [ ] Test names follow convention: `test_{what}_{condition}_{expected}` (Python) or `it("should {behavior}")` (TypeScript)
- [ ] Every test command carries both a runner timeout (`--timeout=10` for pytest) and an explicit Bash tool `timeout` (60000ms single file / 120000ms suite (full suite = CI/release/explicit-request only) per `.Codex/rules/testing/test-execution.md`)
- [ ] Pre-run test-code self-check done: autouse fixtures do not assume real paths (use `tmp_path`); no hardcoded path-literal assertions (assert against env-derived values); each settings/config monkeypatch pairs with its cache invalidation (e.g. `clear_settings_cache()`)
</implement_integration>

## Integration with Verify Agents

<verify_integration>
When this skill is loaded in a verify agent, add these verification checks:

### Coverage Verification

1. Run the coverage command for the relevant stack.
2. If coverage < 85% on changed files → FAIL with exact percentage and uncovered lines.
3. If critical path coverage < 95% → FAIL with specific uncovered branches.

### Mock Quality Scan

1. Read each test file in the changed files list.
2. Check for banned mock patterns from `rules/mock-discipline.md`.
3. For each mock found, verify:
   - Return value matches the actual response type (not empty `{}` or untyped)
   - At least one assertion on mock call arguments exists
   - Mock scope is at a system boundary (not mocking internal functions)
4. Report violations as FAIL with `file:line — mock-discipline: {violation}`.

### TDD Structure Check

1. For each production file changed, verify a corresponding test file exists.
2. Test file MUST contain at least one test per public function/method.
3. Test MUST include at least one error/edge case scenario.
4. Report missing tests as FAIL with `file:line — missing test coverage for {function}`.

### FAIL Criteria Summary

Any of these triggers auto-FAIL:
- Coverage < 85% on changed files
- Banned mock pattern detected
- Public function without corresponding test
- Test file with zero error/edge case tests
- Mock without call argument assertion
</verify_integration>

## Output Contract

End every response with a `<omb>` status tag followed by a result envelope.

On success (all TDD gates passed):

<omb>DONE</omb>

```result
verdict: PASS
summary: <1-3 sentences: RED-GREEN-IMPROVE cycle complete, coverage met, no banned mock patterns>
artifacts:
  - <test file paths created or modified>
changed_files:
  - <production and test files changed>
coverage_line: <measured line coverage percentage, e.g. "87%">
coverage_branch: <measured branch coverage percentage, e.g. "82%">
concerns: []
blockers: []
retryable: false
next_step_hint: All TDD gates passed — proceed to omb-lint-check before committing.
```

On TDD gate failure (coverage below threshold, banned mock, missing tests):

<omb>RETRY</omb>

```result
verdict: FAIL
summary: <1-3 sentences describing which gate failed and why>
artifacts:
  - <test file paths with issues>
changed_files:
  - <files modified so far>
coverage_line: <measured line coverage percentage or "not run">
coverage_branch: <measured branch coverage percentage or "not run">
concerns:
  - <specific violation: file:line — description>
blockers: []
retryable: true
next_step_hint: Fix the listed violations and re-run the TDD cycle.
```

On blocked (coverage tool unavailable, cannot verify):

<omb>BLOCKED</omb>

```result
verdict: FAIL
summary: <describe what tool or resource is missing>
artifacts: []
changed_files: []
coverage_line: "not run"
coverage_branch: "not run"
concerns: []
blockers:
  - <missing tool or missing prerequisite>
retryable: true
next_step_hint: Install the required tool and re-run coverage verification.
```
