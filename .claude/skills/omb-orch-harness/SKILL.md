---
name: omb-orch-harness
description: "Harness domain orchestration — architecture review, prompt improvement, hook audit, frontmatter validation."
user-invocable: true
argument-hint: "[task description or harness concern]"
---

# Harness intent adapter

Read `.claude/skills/omb-harness/references/orchestration.md` before executing the
selected mode. It is the only owner of agent sequences, permission boundaries,
critique, watchdog, retries, and independent verification. This adapter detects
intent and passes the original task/target; it never calls the omb-harness wrapper.

## Intent Detection

Detect the user's intent and route to the matching workflow.

| Intent | Signals | Shared mode |
|---|---|---|
| Architecture review | review harness, harness audit, check configuration, what's configured, harness inventory | inventory |
| Improvement suggestion | improve harness, optimize agents, suggest improvements, harness recommendations | plan |
| Prompt improvement | improve prompts, review prompt quality, prompt score, prompt review | prompt |
| Hook audit | hook review, audit hooks, check hooks, hook configuration | hook-audit |
| Skill assignment audit | skill audit, check skill assignments, which agents load which skills | skill-audit |
| Frontmatter validation | validate frontmatter, check agent definitions, verify agents, verify skills | verify |
| New feature | create agent, add skill, new rule, add hook, new harness feature | new-feature |
| Problem diagnosis | harness broken, agent not working, skill not loading, hook failing, debug harness | fix |

## Intent Disambiguation

When the user's request matches multiple workflows:

1. **Specific signals win over general signals.** A keyword that appears in only one workflow is more specific than one that appears in multiple.
   - "hook review" → Hook Audit (specific), not Architecture Review (general "review")
   - "improve prompts" → Prompt Improvement (specific), not Improvement Suggestion (general "improve")
   - "validate agents" → Frontmatter Validation (specific), not Architecture Review
2. **When multiple workflows match with equal specificity**, select the most targeted workflow (fewer agent steps = more targeted).
3. **When ambiguity remains**, present the matching workflows to the user via AskUserQuestion and let them choose.

## Execution handoff

Pass the selected shared mode, authorized targets and original task to the shared
reference. Plan/audit/verify modes remain read-only; new-feature requires critique
before implementation. Return the shared flow's actual terminal envelope unchanged.

## Context Passing

Read `.claude/skills/omb-context/references/workflow-handoff.md` and relay
knowledge_context unchanged, including bundle_path, bundle_id, query_signature,
source_fingerprint, evidence_ids, adopted, rejected_with_reason and
unresolved_questions. Preserve root/layer/revision and complete conditions.
