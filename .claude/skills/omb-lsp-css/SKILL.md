---
name: omb-lsp-css
description: "CSS/Tailwind LSP patterns — tailwindcss-language-server class resolution, design token lookup, @apply navigation."
---

# Css LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/css.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
