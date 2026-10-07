---
title: Set a 15-Word Quote Cap and Paraphrase Default for Third-Party Content
impact: HIGH
impactDescription: Reduces legal exposure from verbatim reproduction of third-party text in search-grounded or retrieval-augmented agents
tags: system-prompt, copyright, quotes, paraphrase, safety, legal, capability-gated
---

## Set a 15-Word Quote Cap and Paraphrase Default for Third-Party Content

Traceability: plan Section 2.2.3 row 3 - source passage: Section 2.1 `<MANDATORY_COPYRIGHT_REQUIREMENTS>`
(15-word quote cap, one-quote-per-source, paraphrase-default). Harness deficiency:
`safety-data-handling.md` covers credential/PII handling but not third-party text reproduction;
a search-grounded agent without copyright limits drifts into verbatim quoting.

**When NOT to apply:**

This rule is N/A when the prompt does not involve retrieving, synthesizing, or quoting third-party
textual content (for example, a pure code-generation agent with no web search or document retrieval).
Apply only when the system uses search results, document chunks, or scraped content that may contain
copyrighted text.

---

Search-grounded and RAG agents will naturally reproduce source text verbatim unless constrained.
Verbatim reproduction beyond short quotes is a copyright risk. The safe pattern is: short direct
quote (<=15 words) to anchor attribution, then paraphrase everything else.

**Incorrect (verbatim reproduction of retrieved article):**

```text
System: "You are a research assistant. Summarize what you find."
```

Without limits, the model may copy entire paragraphs from retrieved sources.

**Correct (explicit copyright constraints):**

```text
System: "You are a research assistant.

<copyright_policy>
When working with third-party content (articles, documentation,
books, websites):
- Never reproduce more than 15 consecutive words verbatim from a
  single source.
- Include at most one direct quote per source per response.
- Default to paraphrasing; quote only when the exact wording is
  essential to meaning.
- Always attribute the source immediately after any direct quote:
  (Source: [title or URL]).
- If a user explicitly asks for a longer excerpt, explain the
  15-word policy and offer an accurate paraphrase instead.
</copyright_policy>"
```

**Strict mode (for high-risk contexts):**

```text
<copyright_policy>
Do not reproduce any text verbatim from retrieved sources.
Summarize all information in your own words and cite sources
by title and URL only.
</copyright_policy>
```

**Why 15 words:** This aligns with the "short excerpt" threshold widely cited in fair-use analysis
for factual works. It is not a legal bright line, but it is a reasonable operational limit. For
legal-sensitive deployments, consult counsel and tighten accordingly.

Reference: [Anthropic - Responsible Use Guide](https://www.anthropic.com/responsible-disclosure-policy)
