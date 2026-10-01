---
title: Add Explicit Subagent Guidance for Claude 4.7
impact: HIGH
impactDescription: Prevents silent collapse to direct action when spawning subagents is required
tags: claude-4-7, subagents, delegation, orchestration
---

## Add Explicit Subagent Guidance for Claude 4.7

Claude 4.7 defaults favor fewer subagents than 4.6. Where 4.6 would
proactively spawn parallel investigators, 4.7 tends to work directly unless
explicitly instructed to delegate. Harness prompts that relied on 4.6's
spontaneous delegation behavior must now state subagent expectations
explicitly.

**Incorrect (implicit -- 4.7 works directly instead of spawning):**

```text
Investigate the authentication system and then implement OAuth.
```

**Correct (explicit delegation -- 4.7 spawns as instructed):**

```text
Spawn a subagent to investigate how our authentication system handles
token refresh and whether we have existing OAuth utilities. Wait for
the subagent report, then implement OAuth based on the findings.
Do not read auth files yourself -- delegate that investigation.
```

**Patterns requiring explicit guidance in 4.7:**

| Use case | What to add to the prompt |
|----------|---------------------------|
| Parallel file investigation | "Spawn N subagents in parallel, one per directory." |
| Independent code review | "After implementation, spawn a review subagent." |
| Long-horizon research | "Use subagents for research; keep main context clean." |
| Domain isolation | "Delegate [domain] work to a subagent. Do not do it inline." |

**When 4.7 delegates without prompting:**
- Tasks explicitly marked with `Agent()` in harness configs
- Subagent-only agents (system prompt forces delegation)
- Background tasks configured in agent frontmatter

**Calibration note:** if a 4.6 prompt relied on the model deciding to
spawn subagents on its own, audit those prompts and add explicit
`Spawn a subagent for...` directives for 4.7.

Reference: [Anthropic -- Claude 4.7 Model Card](https://www.anthropic.com/news/claude-4)
