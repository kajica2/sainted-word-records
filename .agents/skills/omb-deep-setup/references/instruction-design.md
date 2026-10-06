# Instruction Design Evidence

Research checked: 2026-09-11. These sources explain loading behavior; the workflow's
file and scan budgets are project design choices, not vendor limits. Recheck official
documentation when a runtime changes; do not infer behavior from another agent's loader.

| Source | Relevant behavior | Setup consequence |
|---|---|---|
| [Claude memory: AGENTS.md](https://code.claude.com/docs/en/memory#agents-md) | CLAUDE can import shared AGENTS text; imports resolve relative to the importing file and expand eagerly. Nested CLAUDE files load when their subtree is read. Recursive imports have a four-hop maximum. | Use a root bridge and local bridges. Keep scoped content out of root imports; preserve Claude-only instructions. |
| [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | Instructions accumulate from project root toward cwd. Each directory selects AGENTS.override.md before AGENTS.md and configured fallback names. The default combined project-document limit is 32 KiB. | Audit override shadows, configured fallback names, and aggregate bytes. Do not promise that every descendant AGENTS file loads in a root-started session. |
| [Claude best practices](https://code.claude.com/docs/en/best-practices) | Concise instructions should focus on commands, conventions, and gotchas that need guidance; keep useful facts current. | Prefer evidence-backed, actionable local differences over exhaustive code descriptions. |

## Review questions

1. Does each instruction affect an actual project decision, and where is its evidence?
2. Does a scoped file add a local rule instead of repeating its parent?
3. Can the command run from the stated cwd, and was it executed or only read from a manifest?
4. Do existing overrides, scoped rules, or imports already supply this guidance?
5. Does deduplication preserve the meaning and loading of every user-owned policy?
6. Do line counts conceal an oversized UTF-8 chain or an eager import of unrelated areas?

The expected benefits are clearer ownership of shared guidance, fewer repeated discovery
steps, and less unrelated folder guidance in context. Actual adherence, token consumption,
and task speed require representative before/after task measurements. Do not present
these expectations as measured improvements.
