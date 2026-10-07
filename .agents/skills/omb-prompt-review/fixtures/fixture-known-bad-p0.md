---
fixture: fixture-known-bad-p0
expected_templates: []
expected_min_priority: P0
---

# Fixture: Known Bad P0 (Missing clarity.task-objective)

This prompt is deliberately P0-FAIL. It has no identifiable task objective.
The reviewer must produce at least one actionable P0 ticket with non-empty
Evidence and a Remediation that cites a specific rule file path.

## Prompt Under Review

```
You are an assistant. Do things correctly and be helpful. Make sure to
handle everything properly and produce good results. Always try your best
and ensure the output is of high quality.

Remember to be thorough and complete in everything you do.
```

## Expected Outcome

The reviewer MUST produce at least one P0 ticket for `clarity.task-objective`
because:

1. **No task is specified**: the prompt contains zero task-specific instructions. There is no description of what the model is being asked to do ("Do things correctly", "produce good results" are not tasks).
2. **No output format**: there is no indication of what output is expected.
3. **No domain or context**: the prompt provides no domain, role specificity, or input description.
4. **Vague qualifiers everywhere**: "correctly", "properly", "good results", "high quality", "thorough", "complete" — all fail `clarity.specificity` in addition to `clarity.task-objective`.

### Required ticket structure

The P0 ticket for `clarity.task-objective` MUST include:
- **Evidence**: a quoted phrase from the prompt demonstrating the absence of a task (e.g., "Do things correctly and be helpful" — no task specified)
- **Impact**: one sentence explaining what goes wrong if unfixed (model cannot produce useful output without knowing the task)
- **Remediation**: a specific fix citing a rule file — e.g., "Add a `<task>` section per `foundation-specificity.md` that describes the exact action, input, and expected output"
- **Status**: OPEN

### Additional expected tickets

Beyond the P0, the reviewer should also raise:
- P1 or P2 for `clarity.specificity` (all qualifiers are vague)
- P1 or P2 for `structure.xml-tags` (no XML structure)
- P2 for `examples.present` (no examples)

These additional tickets are advisory; only the P0 `clarity.task-objective` ticket is required to satisfy V5a.

### Template precedence check

- OVERENGINEERED: DOES NOT FIRE (no caps stacking, no mode mixing triggering it)
- MODE-CONFUSION: DOES NOT FIRE (no task means no mode can be detected)
- Item-level tickets: FIRE (at minimum one P0 for `clarity.task-objective`)
