---
name: omb-lsp-docker
description: "Dockerfile LSP patterns — dockerfile-language-server validation, hadolint integration, multi-stage build navigation."
---

# Docker LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/docker.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
