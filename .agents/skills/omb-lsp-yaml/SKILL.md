---
name: omb-lsp-yaml
description: "YAML LSP patterns — yaml-language-server schema validation for docker-compose, k8s manifests, GitHub Actions."
---

# Yaml LSP compatibility entry

Load `Skill("omb-lsp-common")` and read its `references/yaml.md`
for this language. Pass the active task, file, and question unchanged.
The hub owns shared tool selection and fallback; the reference preserves
language-specific diagnostics, navigation, configuration, and pitfalls.
Do not run a second generic LSP workflow from this alias.
