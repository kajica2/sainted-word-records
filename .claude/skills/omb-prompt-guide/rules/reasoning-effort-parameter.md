---
title: Match Effort Level to Task Complexity
impact: MEDIUM
impactDescription: Optimizes cost and latency
tags: effort, performance, cost-optimization, adaptive-thinking
---

## Match Effort Level to Task Complexity

The `effort` parameter controls reasoning depth across Claude 4.6 and 4.7 models. It works
with both adaptive thinking and disabled thinking modes. Sonnet 4.6 defaults to `high` effort
- consider explicitly setting it to avoid unexpected latency.

> **Claude 4.7 note:** 4.7 follows effort directives more strictly than 4.6. Setting `low`
> will suppress thinking more aggressively; setting `max` will engage deeper reasoning than
> before. Calibrate explicitly - do not rely on model defaults.

**Effort levels (complete set):**

| Level | Use case | Thinking behavior |
|-------|----------|-------------------|
| `low` | Classification, routing, formatting, high-volume tasks | Minimal or no thinking |
| `medium` | Most applications, balanced speed/quality | Moderate thinking on harder queries |
| `high` | Complex coding, analysis, multi-step reasoning (Sonnet 4.6 default) | Deep thinking on complex queries |
| `xhigh` | Hard multi-step reasoning, advanced code generation | Extended thinking, more thorough than `high` |
| `max` | Novel research, long-horizon autonomous work (Opus recommended) | Maximum reasoning depth |

**Incorrect (default effort for all tasks):**

```text
Using the same effort level for every sub-agent regardless
of task complexity (wastes tokens on simple tasks, under-reasons
on hard tasks).
```

**Correct (effort matched to task complexity):**

```text
Sub-agent effort allocation:
- core-explore (file discovery): effort=low
- code-review (correctness check): effort=medium
- api-design (architecture): effort=high
- core-critique (pre-mortem): effort=high
```

**Model-specific guidance:**
- **Sonnet 4.6**: Defaults to `high`. Set `medium` for most apps; `low` for latency-sensitive workloads. Set `max_tokens=64000` at medium/high to give room for thinking.
- **Sonnet 4.7**: Obeys effort directives more literally. Use `xhigh` for hard reasoning tasks where Sonnet 4.6 needed `max`.
- **Opus 4.6**: Use for hardest problems. Does extensive upfront exploration at higher effort. If overthinking, add: "Choose an approach and commit to it. Avoid revisiting decisions unless new information contradicts your reasoning."
- **Opus 4.7**: Stricter instruction-following means `high` is meaningfully different from `max`. Prefer `high` for most tasks; reserve `max` for genuinely novel long-horizon work.
- **Haiku 4.5**: No effort parameter. Use for fast, simple tasks.

Reference: [Anthropic - Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
