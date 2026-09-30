---
title: Migrate from budget_tokens to reasoning_effort Enum
impact: MEDIUM
impactDescription: Avoids silent breakage when budget_tokens is ignored or errors on Claude 4.6+
tags: migration, budget-tokens, reasoning-effort, extended-thinking, claude-4-7
---

## Migrate from budget_tokens to reasoning_effort Enum

`budget_tokens` (an integer controlling how many tokens the model may spend on internal reasoning)
was the Claude 3-era mechanism for tuning extended thinking depth. In Claude 4.6+ the reasoning
budget is expressed as a level enum: `reasoning_effort` (values: `none`, `low`, `medium`, `high`,
`max`; `budget_tokens` is ignored or raises a validation error depending on SDK version).

Passing `budget_tokens` on a Claude 4.6/4.7 model is a silent no-op in some SDK versions and an
explicit error in others. Migrate to `reasoning_effort` to get deterministic behavior and the full
adaptive-thinking capability.

**Incorrect (budget_tokens for Claude 4.6+ model):**

```python
response = client.messages.create(
    model="claude-sonnet-4-6",
    thinking={"type": "enabled", "budget_tokens": 10000},
    messages=[{"role": "user", "content": "Solve this step by step..."}],
)
```

**Correct (reasoning_effort enum):**

```python
response = client.messages.create(
    model="claude-sonnet-4-6",
    thinking={"type": "enabled"},
    effort="high",          # none | low | medium | high | max
    max_tokens=16000,       # give room for thinking tokens
    messages=[{"role": "user", "content": "Solve this step by step..."}],
)
```

**Mapping guide:**

| Old budget_tokens | Equivalent reasoning_effort | Notes |
|------------------|-----------------------------|-------|
| 0 / disabled      | `none`                      | No thinking; fastest |
| <= 2,000          | `low`                       | Classification, routing |
| 2,001 - 8,000     | `medium`                    | Most tasks |
| 8,001 - 32,000    | `high`                      | Complex coding, analysis |
| > 32,000          | `max`                       | Novel research (Opus only) |

**Migration checklist:**

- [ ] Search codebase for `budget_tokens` in API call sites.
- [ ] Replace `thinking={"type": "enabled", "budget_tokens": N}` with `effort="<level>"`.
- [ ] Keep `thinking={"type": "enabled"}` if you want adaptive thinking to activate on hard queries.
- [ ] Remove `thinking={"type": "enabled"}` entirely if you want `effort="none"` (no thinking).
- [ ] Set `max_tokens` >= 8,000 for `medium`/`high`; >= 16,000 for `max` to avoid token-limit truncation
      of the thinking block.
- [ ] Confirm with SDK docs that your SDK version supports `effort` parameter.

Reference: [Anthropic - Effort Parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
