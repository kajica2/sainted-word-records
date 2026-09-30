---
paths: "**/*.py,**/pyproject.toml,**/requirements*.txt"
---

# Python Rules

Version: Python 3.11+

## Tooling

- Linting: ruff (not flake8)
- Formatting: black, isort (or ruff format)
- Type checking: mypy or pyright
- Testing: pytest with coverage >= 85%
- Package management: uv or Poetry

## Foundational Standards

Canonical: PEP 8 — https://peps.python.org/pep-0008/

- Use `snake_case` for function, method, module, and variable names.
- Use `PascalCase` for class names.
- Use `UPPER_SNAKE_CASE` for module-level constants.
- Use 4 spaces for indentation; never tabs.
- Limit lines to 79 characters (hard); project cap is 99 characters.
- Surround top-level function and class definitions with two blank lines.
- Separate methods within a class with one blank line.
- Order imports: stdlib, then third-party, then local — each group separated by a blank line.
- Never use wildcard imports (`from module import *`).
- Add a single space after commas; no space before a colon in a slice (`a[1:3]`).
- Use consistent string quotes across a file (prefer double quotes).
- Place spaces around binary operators (`a = b + c`), but not inside brackets.
- Write docstrings with triple double-quotes (`"""..."""`) following PEP 257.

## MUST

- Use type hints for all function signatures
- Use async/await for I/O-bound operations
- Validate inputs with Pydantic v2
- Configure ruff in pyproject.toml
- Use context managers for resource management
- Document public APIs with docstrings

## MUST NOT

- Use bare except clauses
- Mutate default arguments (mutable defaults)
- Use wildcard imports (from x import *)
- Ignore type checker errors with # type: ignore without reason
- Store secrets in code or config files
- Use print() for logging (use logging module)

## File Conventions

- test_*.py or *_test.py for test files
- __init__.py for package initialization
- conftest.py for pytest fixtures
- Use snake_case for modules and functions
- Use PascalCase for classes

## Testing

- Use pytest fixtures for setup/teardown
- Use pytest-asyncio for async tests
- Use parametrize for test variations
- Mock external services with pytest-mock
