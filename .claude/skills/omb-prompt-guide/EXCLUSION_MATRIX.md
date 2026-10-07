# Consumer-product patterns excluded from harness prompt-engineering guide

This file records which patterns from the extracted Claude Opus 4.7 system prompt sample
are explicitly out of scope for `omb-prompt-guide`. It also provides a semantic review
log to confirm that no excluded concept leaked into the five `system-prompt-*.md` rules.

---

## Banned Concepts

The following patterns are present in the extracted 4.7 system prompt sample but are
consumer-product-specific. They MUST NOT appear in any rule file under
`.claude/skills/omb-prompt-guide/rules/`.

| Concept | Reason excluded |
|---------|----------------|
| `child-safety` | Consumer product safeguard — not a promptable harness pattern |
| `wellbeing` | Consumer product emotional support guidance — not applicable to coding harness |
| `voice-note` | Claude.ai voice feature — harness has no audio I/O surface |
| `past-chats` | Claude.ai persistent conversation history — not a harness concern |
| `persistent-storage` | Claude.ai memory product feature — harness uses agent-memory files instead |
| `product-information` | Claude.ai product FAQ and pricing context — irrelevant to API harness |
| `memory-system` | Claude.ai built-in memory product — replaced by `.claude/agent-memory/` in harness |
| `anthropic-reminders` | Injected anthropic_reminders block — product-specific injection mechanism |
| `computer-use skill-loading` | Claude.ai computer-use capability loading — harness uses explicit tool allowlists |

---

## Cyber-Safeguards Deferral

The `claude-4-7-cyber-safeguards.md` rule was dropped from this plan (R3, ADV-2 fix).

If cyber-refusal prompt-engineering becomes needed in a future harness context, it MUST be
scheduled as a separate plan with a mandatory `@security-audit` gate before any rule file
is written. This exclusion is intentional and not a gap — it prevents untested security
guidance from entering the prompt-engineering guide without expert review.

---

## Semantic Review Log

The five `system-prompt-*.md` rules were reviewed to confirm no banned concept leaked in.

| system-prompt-*.md rule | Reviewer | Date | Verdict | Notes |
|-------------------------|----------|------|---------|-------|
| `system-prompt-search-first.md` | Pending | — | Pending | — |
| `system-prompt-tool-discovery.md` | Pending | — | Pending | — |
| `system-prompt-copyright-limits.md` | Pending | — | Pending | — |
| `system-prompt-reminder-framework.md` | Pending | — | Pending | — |
| `system-prompt-request-evaluation.md` | Pending | — | Pending | — |

Verdict values: `CLEAN` (no banned concept found) or `FAIL: <concept>` (banned concept
present — rule must be revised before merge).

Reviewer should be `@harness-prompt-engineer` or `@security-audit`. Date format: YYYY-MM-DD.
