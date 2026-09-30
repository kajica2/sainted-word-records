# Operational Memory Content Policy

## Keep the next action clear

Each memory should answer: when does this apply, what should the worker do, why,
what are the exceptions, and what supports it? Store one coherent procedure or
decision per topic. Code and project instructions remain authoritative when they differ.

| Tier | Contents | Budget and selection |
|---|---|---|
| `MEMORY.md` | Project working priorities; a few costly universal mistakes; short repository/SoT routing triggers | Shared + local: 60 lines / 4,000 Unicode characters, including blank lines; hard rejection, no truncation |
| `knowledge/index.md` | Immediate topic/directory descriptions that let a worker decide what to open | Shared + local: 20 lines / 1,200 characters; generated, always included |
| Child `index.md` | Immediate children of one operation/category | Generated, at most 40 lines; read on demand |
| Topic | Conditions, procedure, rationale, exceptions, evidence and scope | 80 lines preferred; over 150 lines / 12,000 characters warns to split; begin with 1–3 relevant topics |

File/tree safety caps also apply: 128 KiB per file, 512 files / 4 MiB per store.
These are parser safeguards, not an invitation to fill the model context.

Put broad, frequently needed rules in core only when they change behavior across tasks.
Put specific commands, workarounds, tests, repository contracts and writing procedures
in topics. Move details out before expanding core. Do not copy Wiki source facts or
existing rules; reference their verified entrypoints and record the operational trigger.

## Topic format: OKF v0.2 plus an OMB profile

Only the root index declares `okf_version: "0.2"`. Child indexes have no frontmatter.
Topics use `type`, `title`, `description`, `status`, `sources`, and `omb.conditions`.
Status is `draft`, `stable`, or `deprecated`; only stable material guides normal recall.
Preserve unknown extension fields when updating a document. `verified` is optional
and requires actual verification; successful file storage never creates it.

```yaml
---
type: procedure
title: Public API change coordination
description: Read when changing an API consumed by another repository.
status: stable
sources:
  - resource: "User instruction, 2026-09-21: check API consumers"
omb:
  conditions: [public-api-change]
---
```

The sample source is illustrative; replace it with the actual dated instruction or a
stable source reference. Do not invent a transcript URL, commit, line range, or reviewer.
Use repository-relative source paths with a commit when available. Keep volatile
verification timestamps out of unchanged documents to preserve idempotent updates.

## What and when to write

| Signal | Action |
|---|---|
| Explicit remember/correct/forget instruction | Apply in the same turn after reading the existing scope; record the dated user assertion |
| A verified project convention was missing | Add a narrowly scoped topic supported by the checked source/test |
| A procedure saved work and was actually validated | Record conditions, commands, proof and exceptions; avoid universal claims from one trial |
| A test or source contradicts an old memory | Narrow, replace, or deprecate the old entry; explain supporting evidence |
| The same correction recurs | Check whether it was loaded and applied; repair the existing entry or routing, avoid duplicate append |
| Nothing new, duplicate instruction, or temporary request | no-op; do not create a daily diary |

## Multi-repository map

Use `knowledge/repositories/<repository-id>.md` for each relevant repository.
Record its stable identity, role, relative workspace location, instruction entrypoint,
owned contracts and consumers, producer/consumer direction, linked repositories,
and triggers requiring coordinated work. Include the actual discovery evidence.
The core needs only the routing summary, not the complete directory tree.

Example content shape (fill only after inspecting the real workspace):

- Condition: a public response or authentication contract changes in the backend.
- Action: inspect the named frontend consumer and contract tests; check compatibility
  and update both sides when required by the request.
- Location: verified relative path and repository identity, not a developer's home path.
- Exceptions: internal-only endpoints without external consumers, if verified.
- Evidence: committed contract/consumer paths or an explicit user instruction.

No implicit sibling scan or write authorization follows from a map entry. Configure
shared memory explicitly in `config.yaml`; local updates never write the shared layer.
Relative layouts must exist on each collaborator's machine. An unavailable configured
repository is an error to resolve, not permission to silently omit its guidance.

## SoT and documentation update routes

Use `knowledge/workflows/sot-update.md` with these fields in prose:

- **Trigger:** which code, API, decision or contract change requires documentation.
- **Source evidence:** what source/test is authoritative and must be rechecked.
- **Target:** verified repository identity and relative document/index path.
- **Authoring route:** exact skill name, where it is installed, and the reference
  instructions needed to invoke it; record `unknown` until inspected.
- **Timing:** before PR, after verification, or another actual project requirement.
- **Completion:** the authoring tool's real finish condition and validation result.
- **Exceptions:** missing skill/repository or incomplete upstream run; preserve state
  and report the gap instead of hand-editing protected generated artifacts.

For a target such as `deep-platform-wiki`, discover its actual SoT rules and exact skill
before recording the route. The name alone is not evidence of an installed command.

## Updating and sharing

Read existing content, merge by meaning, remove superseded instructions, apply against
the observed revision, and read back. Use a separate explicit transaction per Git root.
Manual edits or Git merges require `omb memory check --root ABS_ROOT` before use.
Review memory changes alongside the task that produced them. Git history carries the
change trace; local `.omb/memory-runtime/` journals and locks must not be committed.
