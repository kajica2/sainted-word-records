---
paths: "**/*.scala,**/*.sc,**/build.sbt"
---

# Scala Rules

Version: Scala 3.4+

## Tooling

- Build: sbt or Mill
- Linting: Scalafix, WartRemover
- Formatting: scalafmt
- Testing: ScalaTest or MUnit

## Foundational Standards

Canonical: Scala Style Guide — https://docs.scala-lang.org/style/

- Use 2-space indentation.
- Use `PascalCase` for classes, traits, and objects; `camelCase` for methods and values.
- Do not use underscores in identifiers (except in import wildcards).
- Prefer `val` over `var`; use `var` only in performance-critical inner loops.
- Provide explicit return types on all public methods and values.
- Use immutable collections (`List`, `Map`, `Set`) by default.
- Use pattern matching over long `if`/`else if` chains.
- Avoid the `return` keyword; the last expression in a block is the return value.
- Discourage postfix operator notation (e.g., `list size` should be `list.size`).
- Use companion objects for factory methods and related constants, not utility classes.

## MUST

- Use immutable collections by default
- Use case classes for data types
- Use for-comprehensions for monadic operations
- Use extension methods over implicits
- Use given/using for context parameters
- Handle errors with Either or effect types

## MUST NOT

- Use null (use Option instead)
- Use var except in performance-critical code
- Use Any or AnyRef as type bounds
- Throw exceptions for control flow
- Use implicit conversions
- Ignore compiler warnings

## File Conventions

- *Spec.scala or *Test.scala for test files
- Use PascalCase for types and objects
- Use camelCase for values and methods
- Package structure matches directory
- Companion object in same file

## Testing

- Use ScalaTest or MUnit
- Use property-based testing with ScalaCheck
- Use mock libraries sparingly
- Test effect types properly
