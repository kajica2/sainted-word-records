---
title: Match reasoning_effort to Task Complexity in Claude 4.7
impact: HIGH
impactDescription: Prevents cost overruns and latency spikes from over-reasoning on simple tasks
tags: claude-4-7, effort, reasoning-effort, cost-optimization, performance
---

## Match reasoning_effort to Task Complexity in Claude 4.7

Claude 4.7 accepts five `reasoning_effort` levels: `max`, `xhigh`, `high`,
`medium`, and `low`. Claude 4.6 accepted only `high`, `medium`, and `low`.
The new `xhigh` and `max` levels unlock deeper reasoning for long-horizon
tasks but cost significantly more tokens. Match the level to actual task
complexity to avoid waste.

**Incorrect (uniform high effort regardless of task type):**

```text
All sub-agents: effort=high
-- routing agent: effort=high  (overkill for a classification task)
-- code formatter: effort=high (overkill for a structural rewrite)
-- security audit: effort=high (underpowered for deep analysis)
```

**Correct (effort matched to task complexity):**

```text
-- routing / classification: effort=low
-- code formatting, CRUD: effort=low
-- test writing, standard implementation: effort=medium
-- code review, API design, refactoring: effort=high
-- security audit, architecture critique: effort=xhigh
-- novel research, long-horizon autonomous work: effort=max
```

**Effort level reference for Claude 4.7:**

| Level | Thinking behavior | Typical use |
|-------|------------------|-------------|
| `low` | Minimal thinking | Routing, classification, formatting |
| `medium` | Moderate thinking | Standard coding, summarization |
| `high` | Deep thinking on hard queries | Code review, design, multi-step reasoning |
| `xhigh` | Extended thinking | Security audits, architecture decisions |
| `max` | Maximum reasoning depth | Novel research, long-horizon agents |

**Migration note from 4.6:** prompts that set `effort=max` on 4.6 (where
`max` was an alias for `high`) will now trigger full extended thinking on 4.7.
Review every `effort=max` directive and confirm it is warranted.

Reference: [Anthropic -- Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
