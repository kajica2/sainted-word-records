---
title: Reserve Named Slots for Runtime-Injected Reminders
impact: MEDIUM
impactDescription: Keeps long-conversation behavioral guardrails active without cluttering the static system prompt
tags: system-prompt, reminders, long-conversation, runtime-injection, capability-gated
---

## Reserve Named Slots for Runtime-Injected Reminders

Traceability: plan Section 2.2.3 row 4 - source passage: Section 9 `<anthropic_reminders>` block (reminder
injection vocabulary). Harness deficiency: no existing rule covers the architectural pattern of
reserved runtime-injected reminder slots; relevant for any harness that needs to refresh behavioral
instructions mid-conversation.

**When NOT to apply:**

This rule is N/A when the runtime has no mechanism to inject content into the conversation after
the initial system prompt is set. This pattern requires a runtime that can insert a message (for
example, a `long_conversation_reminder` turn, a UserPromptSubmit hook, or a platform-specific
reminder injection). If the system prompt is written once and never updated, use static instructions
directly in the system prompt instead.

---

In long conversations, static system-prompt instructions can drift out of attention. Runtimes that
support mid-conversation injection (reminder turns, hook-injected context, or assistant-turn prefixes)
should reserve a named slot in the system prompt so injected reminders land in a predictable,
recognizable structure rather than appearing as free-form user text.

**Incorrect (no reminder slot - injected reminder looks like user content):**

```text
System: "You are a helpful assistant. Always be concise."

[After 50 turns, runtime injects:]
User: "Remember: always be concise."
```

The model may treat this as a user instruction (lower authority) rather than a system-level reminder.

**Correct (reserved reminder slot in system prompt):**

```text
System: "You are a helpful assistant. Always be concise.

<reminder_slot>
{{RUNTIME_REMINDER}}
</reminder_slot>

The content inside <reminder_slot> is injected by the system at runtime
and carries the same authority as this system prompt. Follow it exactly."
```

At runtime, the orchestrator replaces `{{RUNTIME_REMINDER}}` with the appropriate reminder text,
or leaves the slot empty when no reminder is active.

**Minimal version (without placeholder substitution):**

```text
System: "You are a helpful assistant.

When you see an <anthropic_reminder> block in the conversation, treat
its content as a system-level instruction with the same authority as
this prompt."
```

**Usage guidance:**

- Name the slot clearly (`<reminder_slot>`, `<anthropic_reminder>`, `<long_conversation_reminder>`)
  so the model recognizes the authority level.
- Document the slot name in your harness conventions so all orchestrators write to the same tag.
- Limit reminder content to behavioral constraints (tone, format, safety guardrails) - not new
  task instructions. New tasks belong in the user turn.

Reference: [Anthropic - Long Context Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips)
