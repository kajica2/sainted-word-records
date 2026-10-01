---
name: omb-lsp-python
description: "Python LSP patterns — pyright/pylsp type checking, import resolution, and refactoring workflows."
---

# Python LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/python.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
