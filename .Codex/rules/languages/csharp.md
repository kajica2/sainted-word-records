---
paths: "**/*.cs,**/*.csproj,**/*.sln"
---

# C# Rules

Version: C# 12 / .NET 8

## Tooling

- Build: dotnet CLI or MSBuild
- Linting: .NET analyzers, StyleCop
- Testing: xUnit or NUnit
- Coverage: coverlet >= 85%

## Foundational Standards

Canonical: Microsoft C# Coding Conventions — https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions

- Use 4-space indentation; place braces on their own lines (Allman style).
- Use `PascalCase` for types, methods, properties, events, and public fields.
- Use `camelCase` for local variables and parameters.
- Use `_camelCase` (leading underscore) for private instance fields.
- Use the `I` prefix for interface names (e.g., `IUserService`).
- Add the `Async` suffix to all `async` method names (e.g., `GetUserAsync`).
- Enable nullable reference types in the project file; resolve all nullable warnings.
- Use `var` when the type is apparent from the right-hand side; otherwise state the type explicitly.
- Prefer expression-bodied members for simple single-expression getters and methods.
- Use `record` types for immutable data transfer objects.

## MUST

- Use nullable reference types (enable in csproj)
- Use records for immutable data
- Use async/await for I/O operations
- Use primary constructors for simple classes
- Dispose resources with using statements
- Document public APIs with XML comments

## MUST NOT

- Catch Exception without filtering
- Use async void (except event handlers)
- Ignore nullable warnings
- Use magic strings for configuration
- Block async code with .Result or .Wait()
- Store secrets in appsettings.json

## File Conventions

- *Tests.cs for test files
- One type per file
- Use PascalCase for public members
- Use camelCase for private fields (with _prefix)
- Match namespace to folder structure

## Testing

- Use xUnit with [Theory] for data-driven tests
- Use NSubstitute or Moq for mocking
- Use FluentAssertions for readable assertions
- Use Testcontainers for integration tests
