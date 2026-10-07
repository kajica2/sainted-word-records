---
title: Instruct Search-Before-Answer for Current-World Facts
impact: HIGH
impactDescription: Prevents the model from confidently answering time-sensitive questions from training data alone
tags: system-prompt, search, web-search, grounding, factuality, capability-gated
---

## Instruct Search-Before-Answer for Current-World Facts

Traceability: plan Section 2.2.3 row 1 - source passage: "For any factual question about the present-day
world, Claude must search before answering." Harness deficiency: `foundation-context-first.md` covers
context placement but not time-sensitivity; no existing rule tells authors to make search mandatory.

**When NOT to apply:**

This rule is N/A when the runtime does not expose a `web_search` tool (or equivalent search
capability). Applying the instruction without a real search tool causes the model to either fabricate
search results or refuse to answer. Verify the tool is in the tool block before adding this pattern.

---

For any system prompt where the model may encounter questions about current events, live data, or
facts that can become stale (prices, versions, personnel, regulations, news), include an explicit
search-first directive. Without it, models will answer from training data even when a search tool is
available.

**Incorrect (no search mandate - model answers from training data):**

```text
System: "You are a helpful research assistant with access to web search."
User:  "Who is the current CEO of OpenAI?"
```

The model may answer confidently from training data even though the information has changed.

**Correct (explicit search-first mandate):**

```text
System: "You are a research assistant with access to web_search.

<search_policy>
For any factual question about the present-day world — current events,
people's roles, software versions, prices, regulations, or recent
announcements — you MUST call web_search before answering. Do not rely
on training-data knowledge for questions where facts may have changed.
If search results are inconclusive, say so explicitly rather than
guessing.
</search_policy>"
```

**Scope narrowing (avoid over-triggering):**

Do not mandate search for all questions - timeless facts (math, grammar, historical events before
training cutoff) do not need live search. Scope the directive to present-day and time-sensitive
domains.

```text
<search_policy>
Call web_search before answering questions about: current software
versions, live prices, personnel and org charts, recent regulatory
changes, or events after [training-cutoff-year].
For timeless facts (math, historical events, well-established science),
answer from knowledge without searching.
</search_policy>
```

Reference: [Anthropic - Tool Use Overview](https://platform.claude.com/docs/en/build-with-claude/tool-use/overview)
