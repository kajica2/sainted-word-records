---
paths: "**/*.rs,**/Cargo.toml,**/Cargo.lock"
---

# Rust Rules

Version: Rust 1.92+ (2024 edition)

## Tooling

- Build: Cargo
- Linting: clippy
- Formatting: rustfmt
- Testing: cargo test
- Coverage: cargo-llvm-cov >= 85%

## Foundational Standards

Canonical: Rust API Guidelines — https://rust-lang.github.io/api-guidelines/

- Use `snake_case` for functions, methods, modules, and variables.
- Use `PascalCase` for types, traits, and enum variants.
- Use `SCREAMING_SNAKE_CASE` for constants and statics.
- Implement conversions via `From`/`Into` traits rather than custom `to_x()` methods.
- Return iterators from functions rather than `Vec` when callers may not need all elements.
- Use the `?` operator for error propagation; avoid `unwrap`/`expect` in library code.
- Use `thiserror` for library error types; use `anyhow` for application-level error handling.
- Run `rustfmt` as the authoritative formatter; do not override its decisions.
- Run `clippy` and resolve all warnings before committing.
- Elide lifetimes where the compiler can infer them.
- Derive traits in canonical order: `Debug, Clone, Copy, PartialEq, Eq, Hash, Default`.

## MUST

- Use Result and Option for error handling
- Implement proper error types with thiserror
- Use async/await with tokio for I/O
- Document public items with /// comments
- Use clippy with pedantic warnings
- Prefer references over cloning

## MUST NOT

- Use unwrap() in production code
- Use unsafe without clear justification
- Ignore clippy warnings without allow attribute
- Clone large data structures unnecessarily
- Use panic! for recoverable errors
- Leave TODO comments in production

## File Conventions

- Tests in same file with #[cfg(test)] module
- Integration tests in tests/ directory
- Use snake_case for modules and functions
- Use PascalCase for types and traits
- Use SCREAMING_CASE for constants

## Testing

- Use #[test] for unit tests
- Use proptest for property-based testing
- Use mockall for mocking traits
- Use test fixtures with rstest
