---
title: Harness Migration Checklist for Claude 4.6 to 4.7
impact: HIGH
impactDescription: Prevents silent regressions when moving a harness from 4.6 to 4.7
tags: claude-4-7, migration, harness, checklist, audit
---

## Harness Migration Checklist for Claude 4.6 to 4.7

Migrating a harness from Claude 4.6 to 4.7 requires auditing prompt text,
effort settings, and delegation patterns. The behavioral differences are
subtle but compound: a 4.6 harness dropped onto 4.7 often silently produces
lower-quality output rather than outright failures.

**Incorrect (drop-in replacement without audit):**

```text
Change model: claude-sonnet-4-6 --> claude-sonnet-4-7
Ship unchanged prompts and effort settings.
```

**Correct (structured audit before migration):**

```text
Run the 14-item checklist below on every agent and skill prompt
before switching the model field.
```

**Migration checklist (audit each agent and skill prompt):**

Literal instruction handling:
- [ ] Replace all hedged directives ("if possible", "try to", "feel free to")
      with precise imperatives ("Do X. Raise error if Y.")
- [ ] Verify every step in the prompt is a concrete, verifiable action

User-facing update scaffolding:
- [ ] Remove "say what you are about to do" boilerplate
- [ ] Remove "summarize each step after completion" instructions
- [ ] Remove "keep the user informed" generic progress narration

Subagent delegation:
- [ ] Add explicit "Spawn a subagent for..." directives where 4.6 spontaneously
      delegated
- [ ] Remove references to implicit delegation behavior

Tool-use triggering:
- [ ] Replace implicit tool hints with explicit tool-name instructions
      ("Use Read to read...", "Use Bash to run...")
- [ ] Verify every required tool call is named in the prompt

Effort levels:
- [ ] Audit every `effort=max` setting (now triggers full extended thinking)
- [ ] Confirm `xhigh` is used only where deep reasoning is warranted
- [ ] Set `effort=low` for routing, classification, and formatting agents

Model field:
- [ ] Update `model:` in all agent and skill frontmatter
- [ ] Update default model in settings.json if set globally

Post-migration smoke test:
- [ ] Run at least one representative task per agent
- [ ] Compare output quality and token usage against 4.6 baseline

Reference: [Anthropic -- Claude 4.7 Model Card](https://www.anthropic.com/news/claude-4)
