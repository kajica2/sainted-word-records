---
title: Rewrite Mode -- Improve While Preserving Intent
impact: HIGH
impactDescription: Prevents over-editing; keeps Claude focused on targeted revision not full rebuild
tags: modes, rewrite, revision, intent-preservation
---

## Rewrite Mode -- Improve While Preserving Intent

Use Rewrite mode when you have a working prompt or document that needs improvement but
whose core intent, structure, or constraints must be preserved. In Rewrite mode Claude
should make targeted changes and explain what changed and why, not produce a ground-up
replacement unless one is explicitly requested.

**When to use Rewrite mode:**
- A prompt works but produces verbose output; tighten the length guidance
- A rule file is accurate but unclear; improve wording without changing the rule
- A system prompt is functional but uses deprecated patterns (e.g., prefill); modernize
  the specific section

**Declare scope constraints explicitly.** Rewrite mode without a scope constraint gives
Claude latitude to overhaul the entire piece. If only one section needs work, name it.

**Incorrect (no mode; no scope; Claude rebuilds the whole prompt):**

```text
Improve this prompt.
<prompt>... 80-line agent prompt ...</prompt>
```

**Correct (Rewrite mode; scope is explicit; intent preservation is required):**

```text
MODE: Rewrite

Rewrite ONLY the tool-use section of the prompt below. Goal: replace the prefill-dependent
assistant turn with an explicit output-format instruction. Preserve all other sections
verbatim. Show a diff (before / after) for the changed section.

<prompt>
...
</prompt>
```

Reference: `anti-patterns-mode-mixing.md` for how mixing Rewrite with Build degrades quality.
