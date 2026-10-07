---
name: omb-lsp-common
description: "LSP decision tree — hover, goto_definition, find_references, diagnostics, rename, code_actions across any language."
---

# Common LSP Decision Tree

## Usage Contract

**Task type:** Apply the domain guidance below to the caller's active task; this skill is a reference, not an independent workflow.

**Required input:** A concrete question, design, file, diff, or implementation decision within this skill's domain.

**Do:**
- Select only the relevant rules, reconcile them with repository-specific instructions, and cite concrete evidence when evaluating existing work.
- State assumptions and applicability limits when the available context is incomplete.

**Don't:**
- Do not invent repository facts, tool results, versions, or requirements.
- Do not apply examples mechanically when the project's source of truth conflicts with them.

**Completion:** Return actionable guidance or a checked result in the caller's requested format; identify any unresolved evidence gap explicitly.

## When to Use LSP (vs Grep/Read)

- **Type info needed** → `lsp_hover` on symbol (faster than reading source)
- **Find definition** → `lsp_goto_definition` (follows imports, jumps to source)
- **Impact analysis** → `lsp_find_references` (all callers/usages of a symbol)
- **Validation after edit** → `lsp_diagnostics` on file (type errors, lint issues)
- **Safe rename** → `lsp_prepare_rename` then `lsp_rename` (cross-file, type-aware)
- **Quick fixes** → `lsp_code_actions` (auto-imports, extract function, etc.)

## When NOT to Use LSP

- Searching for string patterns across files → use Grep
- Reading file structure/layout → use Read
- Finding files by name → use Glob
- No LSP server running for the language → fall back to Grep + Read

## Decision Tree

1. "What type/signature is this?" → `lsp_hover`
2. "Where is this defined?" → `lsp_goto_definition`
3. "Who calls/uses this?" → `lsp_find_references`
4. "Did my edit break anything?" → `lsp_diagnostics`
5. "Rename this symbol safely" → `lsp_prepare_rename` → `lsp_rename`
6. "Fix this error automatically" → `lsp_code_actions`

## Best Practices

- Always run `lsp_diagnostics` after editing a file to catch regressions
- Use `lsp_hover` before `lsp_goto_definition` — hover often gives enough info
- Prefer `lsp_find_references` over Grep for symbol usage — Grep finds string matches, LSP finds semantic references
- Chain: `lsp_goto_definition` → `lsp_hover` at target to understand both location and type
- Use `lsp_code_actions` on diagnostic errors — LSP often has auto-fixes available

## Common Pitfalls

- LSP may not index files outside the workspace root
- Diagnostics may lag after rapid edits — re-request if results seem stale
- Some servers require the file to be saved before diagnostics update

## Language routing

Infer the language from the active file or use the caller's explicit language.
Apply this common decision tree once, then read only the matching specialist
reference. Existing language skill names are compatibility aliases to this hub.
If several languages are involved, select references per file; never load all
guides preemptively. Missing LSP capability uses the Grep/Read fallback above.

| Language | Specialist reference |
|---|---|
| css | [references/css.md](references/css.md) |
| docker | [references/docker.md](references/docker.md) |
| json | [references/json.md](references/json.md) |
| python | [references/python.md](references/python.md) |
| terraform | [references/terraform.md](references/terraform.md) |
| typescript | [references/typescript.md](references/typescript.md) |
| yaml | [references/yaml.md](references/yaml.md) |
