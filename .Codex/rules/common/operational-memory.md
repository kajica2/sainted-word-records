---
description: Shared operational memory activation and direct correction routing
---

# Operational Memory

- If `.omb-memory/` exists in the active checkout, load its bounded core/index with
  `omb memory context --root ABS_ROOT` at session/workflow entry and after compaction.
  Reuse context already present for the same checkout and layer revision; reload on change.
- If the command is unavailable or validation fails, report that state. Do not read raw
  memory files as a substitute for validated loading or claim successful injection.
- Direct durable memory requests in any language (such as "remember this") invoke
  `Skill("omb-memory")` in the same turn. Interpret scope, quotation and negation first.
  Merge existing content, apply against its revision, and confirm by read-back.
- Use the skill's progressive disclosure for conditional topics. Memory is subordinate
  to current requests and project rules. Subagents propose observations; the main agent writes.
- Operational lessons belong in shared memory; source facts belong in the Wiki.
  Saving is not Git synchronization. Do not auto-commit or publish a memory update.
