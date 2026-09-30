---
fixture: fixture-mode-mixing
expected_templates:
  - MODE-CONFUSION
expected_min_priority: P1
---

# Fixture: Mode Mixing (Build + Learn + Critique)

This prompt intentionally mixes Build, Learn, and Critique mode language simultaneously.
No aggressive CRITICAL/MUST/NEVER stacking is present.

## Prompt Under Review

```
You are a senior software engineer. Help me with the authentication module.

First, explain how JWT authentication works and what the key concepts are.
Teach me the difference between access tokens and refresh tokens.

Then, implement a complete JWT authentication service in Python using FastAPI.
Write the login endpoint, token generation, and token validation functions.
Create the full production-ready implementation with all edge cases handled.

Also, review the overall approach and evaluate whether this is the best design.
Assess the security posture of this architecture. Judge whether the token rotation
strategy meets industry standards. Rate the implementation quality.
```

## Expected Outcome

The reviewer MUST produce a MODE-CONFUSION template ticket because:

1. The prompt mixes all three modes simultaneously:
   - **Learn markers present**: "explain how JWT authentication works", "Teach me the difference"
   - **Build markers present**: "implement a complete JWT authentication service", "Create the full production-ready implementation"
   - **Critique markers present**: "review the overall approach", "evaluate whether this is the best design", "Assess the security posture", "Judge whether", "Rate the implementation quality"

2. `clarity.task-objective` MUST FAIL because the task switches between explaining, building, and reviewing without a unified objective.

3. `clarity.no-conflicts` MUST FAIL because the instructions conflict: you cannot simultaneously be a teacher, a builder, and a reviewer in one prompt without contradicting the expected output format and depth.

4. OVERENGINEERED MUST NOT fire because there are no aggressive CRITICAL/MUST/NEVER stacked directives (Sub-signal A absent), no 4.7-native scaffolding instructions (Sub-signal C absent), and no explicit agent context requiring subagent guidance (Sub-signal B absent).

### Required ticket structure

The MODE-CONFUSION ticket MUST include:
- Evidence quoting the three mixed-mode language fragments (Learn, Build, Critique excerpts)
- Suppressed items listed: `clarity.task-objective`, `clarity.no-conflicts`
- Remediation citing `modes-four-modes.md` and recommending a single declared mode

### Template precedence check

- MODE-CONFUSION: FIRES
- OVERENGINEERED: DOES NOT FIRE
- No standalone `clarity.task-objective` or `clarity.no-conflicts` tickets (suppressed by template)
