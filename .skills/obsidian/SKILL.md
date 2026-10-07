---
name: obsidian
description: Read, search, create, and link notes in an Obsidian vault. Use when the user mentions Obsidian, vault, graph view, backlinks, daily notes, tags, frontmatter, or Dataview.
---

# Obsidian Skill

## When to use
Use this skill when the user wants to:
- search or read an Obsidian vault
- create or update notes
- add backlinks, tags, aliases, or frontmatter
- generate graph/MOC structures
- work with daily notes or templates

## Rules
1. Always locate the vault path first.
2. Prefer reading existing notes before writing.
3. Never delete or overwrite without explicit confirmation.
4. Preserve existing frontmatter unless told otherwise.
5. Use `[[wikilinks]]` for internal links.
6. Keep notes atomic and linked.

## Workflow
1. Identify vault path.
2. Search for relevant notes.
3. Read before editing.
4. Write with frontmatter + backlinks.
5. Report changed files.

## Vault path
Obtain the path from the user. Common locations:
- `~/Obsidian/VaultName`
- `~/notes`
- `~/Documents/Vault`

If the user has not provided a vault path, ask for it before proceeding.

## Tool access
- `read` — read notes, frontmatter, search results
- `glob` — find notes by name, tag, or pattern
- `grep` — full-text search within the vault
- `write` — create or overwrite notes
- `edit` — surgically update frontmatter or body content
- `bash` — run Python scripts from `scripts/` subdirectory

## Graph / MOC generation
For graph views and Maps of Content (MOCs):
1. Identify all notes in a domain or series.
2. Build a link graph from `[[wikilinks]]` and external links.
3. Create or update a MOC note with the full link list.
4. Preserve existing MOC structure unless told to rebuild.

## Daily notes
- Path pattern: `<vault>/<YYYY-MM-DD>.md` or `<vault>/daily/<YYYY-MM-DD>.md`
- Use today's date if none specified: `YYYY-MM-DD`
- Template: frontmatter with `date`, `tags`, then body
