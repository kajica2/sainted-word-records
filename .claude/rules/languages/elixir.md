---
paths: "**/*.ex,**/*.exs,**/mix.exs"
---

# Elixir Rules

Version: Elixir 1.17+

## Tooling

- Build: Mix
- Linting: Credo
- Formatting: mix format
- Testing: ExUnit
- Type checking: Dialyzer

## Foundational Standards

Canonical: Elixir Style Guide — https://github.com/christopheradams/elixir_style_guide

- Use 2-space indentation; never tabs.
- Use `snake_case` for function names, variable names, and module attribute names.
- Use `CamelCase` for module names (e.g., `MyApp.UserController`).
- Name predicate functions with a `?` suffix (e.g., `valid?/1`).
- Name functions that raise on error with a `!` suffix (e.g., `fetch!/1`).
- Use the pipe operator `|>` to chain data-transformation steps; avoid deeply nested calls.
- Use pattern matching in function heads rather than case inside the body.
- Write `@moduledoc` and `@doc` for every public module and function.
- Include parentheses on zero-arity function calls to distinguish from variables.
- Never leave trailing whitespace.

## MUST

- Use pattern matching for control flow
- Use with for chained operations
- Use GenServer for stateful processes
- Use Supervisor trees for fault tolerance
- Write @spec for public functions
- Use @moduledoc and @doc for documentation

## MUST NOT

- Use try/catch for control flow
- Spawn processes without supervision
- Use mutable state (Agent misuse)
- Ignore dialyzer warnings
- Use string concatenation in loops
- Leave debug IO.inspect in production

## File Conventions

- *_test.exs for test files
- Use snake_case for modules and functions
- Use PascalCase for module names
- lib/ for application code
- test/ for test files

## Testing

- Use ExUnit with setup blocks
- Use Mox for mocking behaviors
- Use async: true for isolated tests
- Use ExMachina for test factories
