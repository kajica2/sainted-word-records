# Forward Risk (Topic 6 — @core-critique)

Defines the structure of Topic 6 (RISKS) in the `@core-critique` reviewer prompt.
`@core-critique` is already a mandatory reviewer (see
`.claude/rules/workflow/02-review-plan.md`); this adds structure to its risk analysis
without adding a new agent or a new rubric item.

## Pre-mortem Framing

Open the analysis with a pre-mortem instruction: assume this plan has already failed.
Name the three most likely causes and a mitigation for each. Independence across
reviewers is already guaranteed by parallel spawn (`.claude/rules/workflow/02-review-plan.md`
Step 3), so no separate independence step is needed here.

## Registers

Exactly three registers apply, plus one conditional register.

### Register 1 — Blast Radius (always applies)

Enumerate everything that would be affected by the change:

- Direct call sites, each with `file:line`.
- Event consumers.
- Workers and jobs.
- Migrations.
- Public API surface.

Classify total reach as one of: `local | internal | external-contract`. An
`external-contract` classification raises review intensity — treat findings against it
with a higher default priority.

### Register 2 — Rollback Safety (TRIGGER: schema, contract, or persisted-data change)

When the plan changes a schema, a public contract, or persisted data shape, walk through
three stages:

1. **expand** — is a rollback safe here? State the assertion explicitly.
2. **migrate** — is a rollback safe here? State the assertion explicitly.
3. **contract** — is a rollback safe here? State the assertion explicitly.

State which app version must interoperate with which schema version (N-1 compatibility)
across the expand/migrate/contract sequence.

When the trigger is absent, this block does not exist at all — omit it entirely rather
than writing "N/A".

### Register 3 — Assumption Register (always applies)

Mark every assumption the plan depends on as one of:

- `VERIFIED` — with an evidence pointer (`file:line` or command output).
- `UNVERIFIED` — no evidence found.

Only high-impact `UNVERIFIED` items are escalated to the user-confirmation list; low-impact
`UNVERIFIED` items are noted but do not block.

### Conditional — LLM Evaluation (TRIGGER: prompt, chain, agent, or RAG change)

When the plan changes a prompt, a chain, an agent, or a RAG pipeline, require:

- Golden dataset reference.
- Deterministic assertions.
- Judge rubric.
- Baseline-vs-candidate regression gate.

When the trigger is absent, no block — omit this section entirely.

## Rubric and Veto Interaction

`@core-critique` BLOCKING already promotes to a minimum of P1 through the existing veto
rule — see `.claude/rules/workflow/09-ticket-schema.md`. No rubric change is required to
support these four registers; they structure the existing Topic 6 output, they do not add
a new scored dimension.
