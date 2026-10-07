---
name: omb-lsp-typescript
description: "TypeScript LSP patterns — tsserver type checking, path alias resolution, .d.ts navigation, and type narrowing."
---

# Typescript LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/typescript.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
