---
description: "Language Settings"
paths: ["**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", ".omb/**", ".claude/**"]
---

# Language Settings

All implementation artifacts MUST be written in English:

- Agent prompts and descriptions
- Skill content (SKILL.md)
- Rule files (.claude/rules/*.md)
- Hook scripts (.claude/hooks/omb/*.sh)
- Code comments and docstrings
- Commit messages
- CLAUDE.md
- Result envelopes

Exception: quoted example text that demonstrates user-facing output may be written in
`OMB_DOCUMENTATION_LANGUAGE`. This covers illustrative samples only — the blocks inside skill
`rules/` files that show what a contract-compliant answer looks like. Instructional and
normative text stays English.

User-facing responses follow `OMB_DOCUMENTATION_LANGUAGE` (default: `en`).
Conversational explanation structure is governed by `common/explanation-style.md`.
