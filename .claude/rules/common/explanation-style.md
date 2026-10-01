# Explanation Style

**SSOT for user-facing conversational explanation prose.** This file loads globally at session
start (no `paths:` frontmatter): it governs how the main session *explains*, which is not tied to
which files are edited.

## Scope

- **Applies to**: conversational explanation prose the main session emits to the user.
- **Does not apply to**: sub-agent narrative report prose, sub-agent `result` envelopes, code,
  identifiers, file paths, commands, and commit/PR **titles** — all stay English per `CLAUDE.md`
  HARD rules and `common/language-settings.md`.

## HARD Rules

Rules are layered. Structure rules fire only above a threshold; accuracy rules fire whenever the
corresponding claim appears. The comprehension layer declares its own firing condition inside
its rule.

### Scope layer

0. **Scope.** Structure rules (1-5) apply only to multi-topic explanations, substantive decision
   requests, and completion reports with two or more outcomes. They do not apply to single-fact
   queries, yes/no confirmations, code-only responses, or one-line command-result reports.
   **Never add a heading or a skeleton step to fill length.** Accuracy rules (6-10) apply whenever
   the corresponding claim appears, regardless of response length.

### Structure layer

1. Explanation prose follows `OMB_DOCUMENTATION_LANGUAGE`.
2. **Section headings are noun phrases.** Interrogative or sentence-form headings are forbidden.
   Examples: Problem, Background, Current State, Root Cause, Changes, Code, Impact, Trade-offs,
   Decision, Verification, Risks, Next Steps. **This is not a closed set.** A user-specified format,
   and any output format prescribed by a skill or workflow, take precedence over this rule.
3. **References and ordinals must be self-identifying.** Identity is established at first mention,
   or by an immediately visible heading, column label, or legend. Do not use a document number,
   section, ticket, field, or ordinal whose referent is ambiguous. `05 §2` (bad) ->
   `the version-resolution rule in document 05 (§2)` (good). A table may establish identity through
   a column label or legend; if it does not, state it in each cell.
4. **Classify the response type first and apply exactly one skeleton.** The three skeletons below
   and the comprehension skeleton of rule 11(c) together cover every response type rule 0 admits;
   apply exactly one. For an explanatory answer, the comprehension skeleton is the default and the
   third skeleton below applies when the reader wrote the code being explained.
   - Unresolved problem: current state -> background (how it got here) -> scope of impact -> open items
   - Completed work: change and rationale -> impact -> trade-offs (what was lost) -> verification -> next steps
   - Explanatory answer (how existing code or behavior works): subject and scope -> current mechanism
     -> evidence -> boundaries and exceptions

   **Omit any step with no content.** Do not create an empty section to satisfy the form (same intent
   as the density rule in `workflow/01-plan.md:30-31`).
5. **Do not lead a completion report with verification statistics.** What was done and why comes first.

### Accuracy layer

6. **Interpret every number used as evidence against its baseline and expected value.**
   `398 passed (400 -> -2)` (bad) -> `398 passed — -2 is expected because the two version tests were
   deleted with it` (good). **Identifiers are exempt**: ports, versions, line numbers, option numbers.
7. **Distinguish fact, inference, proposal, and unknown.** When reporting a reversal of a prior
   decision, describe the original adoption rationale **only if it was verified**. If it could not be
   confirmed, say so and state how far verification reached, then justify the reversal using verified
   changes alone. Do not invent the history.
8. **Support code claims in the form that matches the claim.** Investigated current repository
   behavior is cited as `file:line-range` or `file::symbol`; attach an excerpt only when it
   substantiates the claim (same format as `workflow/01-plan.md:66-67`). **For proposals, external
   libraries, generated code, or anything unverifiable, state that status and do not invent a location.**
9. **Attach the three-part set to every substantive unresolved choice**: (a) the feasible options and
   what each means, (b) the recommended option and why, (c) how the development direction and
   deliverables change under that choice. When a constraint leaves only one viable path, do not invent
   alternatives — state the constraint and the basis for the choice.
10. **Separate gains, costs, removals, and unresolved items, and state them factually.** Do not
    describe a deletion, a reduction, or the disappearance of a target as a solved problem. Use an
    analogy only when it preserves the technical relationship, and never as a substitute for the
    technical explanation.

### Comprehension layer

11. **Explain for a reader who did not write the code.** Fires on the responses rule 0 admits for
    the structure rules, and on any request asking how existing code or behavior works. Never fires
    on rule 0's excluded set: single-fact queries, yes/no confirmations, code-only responses, and
    one-line command-result reports.
    (a) Lead with what the system does for a user. An identifier is trailing evidence for a claim
        (rule 8), not the subject — unless the request names that identifier or the file containing
        it, or the mechanism has no accurate name other than the identifier; then name it first and
        say what it does. A named identifier stays available as the subject for follow-up turns on
        the same mechanism.
    (b) Write the body in plain spoken register; headings stay noun phrases (rule 2). Do not use
        translated-English constructions, empty intensifiers, closing filler with no content,
        bold-label bullets as section openers, a colon announcing a list, em dashes, or interpunct
        enumeration. This ban never overrides a format that rule 9 or a skill/workflow prescribes.
        Worked examples: `.claude/skills/omb-explain/rules/plain-language.md`.
    (c) **Comprehension skeleton** — Background, Intuition, Mechanism, Decision and what follows.
        This is the default skeleton for an explanatory answer under (a)'s audience; rule 4 names
        the exception. Worked steps: `.claude/skills/omb-explain/rules/comprehension-anatomy.md`.
    (d) When the response uses the comprehension skeleton, a toy example or a diagram precedes the
        real control flow.
    Rule 0's prohibition on adding a heading or a step to fill length applies here unchanged.

> Rules 2, 8, and 9 are aligned with repository precedent. `workflow/01-plan.md:39` states
> "Headings are adaptive", so a closed heading set would conflict with that precedent and would turn
> the prescribed output formats of `omb-plan` and `omb-verify` into violations.
> `workflow/01-plan.md:66-67` defines the evidence format as `file:line-range` or `file::symbol` with
> conditional excerpts.

Detailed templates and worked examples are delegated to `.claude/skills/omb-explain/`
(progressive disclosure) — the same split `omb-doc` uses for its `rules/` directory, including
`.claude/skills/omb-explain/rules/comprehension-anatomy.md` and
`.claude/skills/omb-explain/rules/plain-language.md`.
