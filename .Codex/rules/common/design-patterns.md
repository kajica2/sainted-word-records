# Design Patterns

Guidance for design-pattern selection and framework-idiom precedence.
It has no `paths:` frontmatter, so it loads globally at session start; cite it by path from skills.

This file holds ONLY pattern-selection guidance. It does not restate layer
ownership, dependency direction, or file-size limits — those live in the files
cited below.

## Framework-Idiom Precedence (HARD)

When a framework-standard idiom conflicts with an existing local convention, the framework idiom wins; flag the conflict in `concerns:`.

Application examples:

- FastAPI: prefer `Depends` over a hand-rolled dependency-injection container.
- LangGraph: prefer `StateGraph` over a hand-rolled dispatch/routing loop.

## Layer Rules

Layer ownership and dependency-direction rules are defined in
`.claude/rules/common/architectural-boundaries.md` (UI → API client → routers →
services → repositories → ORM/Redis/AI). Do not restate them here.

Supplementary layer mappings not covered there:

- AI: graph → node → tool. The graph owns topology; nodes own one
  responsibility each; tools own a single typed, validated side effect.
- UI: page → component → hook. The page composes; components render; hooks own
  data fetching and stateful logic.

## Pattern Selection

Apply a pattern only when it is simpler than the alternative; `EV-simple-1`
(no speculative abstractions) wins on conflict.

| Situation | Candidate pattern |
|-----------|-------------------|
| Proliferating conditional branches on a type or mode | Strategy |
| Complex object creation with many variants or steps | Factory |
| Crossing an external-system boundary (SDK, API, legacy) | Adapter |
| Behavior changes across a set of discrete states | State |

## God-File / God-Component Prohibition

File and function size limits are defined in
`.claude/rules/common/file-size-rules.md`. Do not restate them here.

Split by responsibility, not by arbitrary line count: separate data loading,
transformation, layout, and form/IO concerns into distinct units, each with one
clear reason to change. A file that crosses the size limit because it bundles
unrelated responsibilities must be split along those responsibility seams.
