---
name: omb-lsp-json
description: "JSON LSP patterns — vscode-json-languageserver schema validation for tsconfig, package.json, and settings files."
---

# Json LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/json.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
