# Coverage Gates

Coverage thresholds are enforced by verify agents. Implement agents MUST run coverage against the changed source and the smallest test target that proves the active behavior, then report the result before marking DONE. Repository-wide and domain-wide test targets are reserved for CI, release, or an explicit user request.

## Thresholds

| Scope | Line Coverage | Branch Coverage |
|-------|-------------|-----------------|
| Changed files (new code) | 85% minimum | 80% minimum |
| Critical paths (auth, payments, mutations) | 95% minimum | 90% minimum |
| Utility/helper modules | 90% minimum | 85% minimum |

## Commands by Stack

### Python (pytest-cov)

```bash
# Coverage on one changed source file using one proving test
pytest --timeout=10 --cov=src/package/changed_module.py --cov-report=term-missing --cov-fail-under=85 tests/test_changed_module.py::test_changed_behavior

# Branch coverage for the same target
pytest --timeout=10 --cov=src/package/changed_module.py --cov-branch --cov-report=term-missing tests/test_changed_module.py::test_changed_behavior

# HTML report for detailed inspection of the same target
pytest --timeout=10 --cov=src/package/changed_module.py --cov-report=html tests/test_changed_module.py::test_changed_behavior
```

### TypeScript (vitest)

```bash
# Coverage with threshold enforcement for one proving test file
vitest run src/components/ChangedComponent.test.tsx --coverage --coverage.include='src/components/ChangedComponent.tsx' --coverage.thresholds.lines=85 --coverage.thresholds.branches=80

# Text coverage report for the same target
vitest run src/components/ChangedComponent.test.tsx --coverage --coverage.include='src/components/ChangedComponent.tsx' --coverage.reporter=text
```

## What Counts Toward Coverage

### Counts

- Every executable statement reached by a test
- Every branch of `if/else`, `switch/case`, `try/catch` exercised
- Every branch of ternary operators exercised
- Default parameter values exercised

### Does NOT Count

- Lines executed through mocked code paths (the mock runs, not the real code)
- Type annotations, interfaces, type-only imports
- Comments and blank lines
- Unreachable code after `return`, `throw`, `raise`

## Legitimate Exclusions

These patterns may be excluded from coverage requirements:

```python
# Python: pragma: no cover (use sparingly, justify in comment)
if TYPE_CHECKING:  # pragma: no cover
    from typing import Protocol

# Infrastructure bootstrapping
if __name__ == "__main__":  # pragma: no cover
    uvicorn.run(app)
```

```typescript
// TypeScript: istanbul ignore (use sparingly, justify in comment)
/* istanbul ignore next -- platform-specific code */
if (process.platform === "win32") { ... }
```

### Allowed exclusions

- `TYPE_CHECKING` blocks (no runtime code)
- `__main__` guards
- Platform-specific branches that cannot be tested in CI
- Generated code (OpenAPI clients, protobuf stubs)
- Migration files

### NOT allowed exclusions

- Error handling branches (test them)
- Validation logic (test them)
- Edge cases you find hard to test (find a way)
- "Too complex to test" functions (simplify them first)

## Reporting Format

When reporting coverage in result envelopes, use this format:

```
Coverage: 87% lines (42/48 statements), 82% branches (14/17)
Uncovered:
  - src/api/routes.py:45-48 — error handler for rate limit exceeded
  - src/services/auth.py:112 — token refresh edge case
```

Verify agents MUST report exact uncovered lines when coverage falls below threshold.
