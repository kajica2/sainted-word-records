# Obsidian Vault Layout Reference

## Standard directory structure

```
vault/
  .obsidian/         # app config (never touch)
  Attachments/       # images, PDFs, etc.
  daily/             # daily notes (YYYY-MM-DD.md)
  templates/         # note templates
  Book Notes/        # literature notes
  Maps of Content/   # MOCs (auto-generated)
  01 - Projects/    # Area: active work
  02 - Areas/       # Area: ongoing responsibilities
  03 - Resources/   # Reference material
  04 - Archives/    # Completed/inactive
```

## Frontmatter schema

```yaml
---
title: "Note Title"
alias: "shorthand"           # optional alternate name
tags: ["tag1", "area/tag2"]   # comma or newline separated
created: 2025-01-15
modified: 2025-06-30
type: "note"                 # note | daily | MOC | literature-note
status: "active"             # active | archived | reference
---

# Note Title

Content...
```

## Wikilink syntax

| Syntax | Renders as |
|---|---|
| `[[Note]]` | Link to note |
| `[[Note\|Display]]` | Link with custom text |
| `[[Note#Heading]]` | Link to specific heading |
| `[[Note^block]]` | Link to block |

## Tags

- Inline: `#tag` or `#area/tag`
- Frontmatter: `tags: [tag1, tag2]` or `tags: ["tag1"]`
- Nesting: `#area/work/2025`

## Daily notes

Filename format: `YYYY-MM-DD.md`
- Standard: `daily/YYYY-MM-DD.md`
- Or root: `YYYY-MM-DD.md`

Frontmatter:
```yaml
---
title: "{{date}}"
tags: [daily]
created: "{{date}}"
---
```
