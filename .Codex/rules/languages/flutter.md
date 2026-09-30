---
paths: "**/*.dart,**/pubspec.yaml,**/pubspec.lock"
---

# Flutter/Dart Rules

Version: Flutter 3.24+ / Dart 3.5+

## Tooling

- Build: flutter CLI
- Linting: dart analyze, flutter_lints
- Formatting: dart format
- Testing: flutter test
- Package management: pub

## Foundational Standards

Canonical: Effective Dart — https://dart.dev/effective-dart

- Use `PascalCase` for types (classes, enums, typedefs, type parameters).
- Use `camelCase` for variables, parameters, and non-constant named constructors.
- Use `SCREAMING_CAPS` only for fundamental constants that are deeply canonical.
- Prefix private members with a leading underscore (`_fieldName`).
- Use 2-space indentation; limit lines to 80 columns.
- Add a trailing comma after the last argument in multi-line argument lists to trigger per-line formatting.
- Prefer `final` and `const`; use `const` constructors wherever possible.
- Use expression bodies for simple one-expression methods and getters.
- Document all public APIs with `///` doc comments.
- Prefer `async`/`await` over raw `Future.then()` chains.
- Avoid the `dynamic` type; use specific types or `Object?` with type checks.

## MUST

- Use Riverpod or Provider for state management
- Use go_router for navigation
- Use freezed for immutable models
- Use const constructors when possible
- Handle null safety properly
- Separate business logic from UI

## MUST NOT

- Use setState in complex widgets
- Use BuildContext across async gaps
- Ignore analyzer warnings
- Use dynamic type
- Block the UI thread
- Hardcode strings (use l10n)

## File Conventions

- *_test.dart for test files
- Use snake_case for file names
- Use PascalCase for classes
- Use camelCase for functions and variables
- lib/ for source, test/ for tests

## Testing

- Use flutter_test for widget tests
- Use mockito for mocking
- Use golden tests for UI verification
- Use integration_test for E2E
