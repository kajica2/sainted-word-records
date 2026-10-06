#!/usr/bin/env python3
"""Create a new note with frontmatter in an Obsidian vault."""
import sys
import re
from pathlib import Path

VAULT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TITLE = sys.argv[2] if len(sys.argv) > 2 else ""
TAGS = sys.argv[3].split(",") if len(sys.argv) > 3 and sys.argv[3] else []
ALIAS = sys.argv[4] if len(sys.argv) > 4 else ""
CONTENT = sys.argv[5] if len(sys.argv) > 5 else ""

if not VAULT or not TITLE:
    print("Usage: create_note.py <vault_path> <title> [tags,comma,sep] [alias] [content]")
    sys.exit(1)

vault = Path(VAULT).expanduser()
slug = re.sub(r"[^\w\-]", "-", TITLE.lower()).strip("-")
path = vault / f"{slug}.md"

if path.exists():
    print(f"EXISTS: {path}")
    sys.exit(2)

tags_line = ""
if TAGS:
    tags_str = "[" + ", ".join(f'"{t.strip()}"' for t in TAGS) + "]"
    tags_line = f"tags: {tags_str}\n"

alias_line = f'alias: "{ALIAS}"\n' if ALIAS else ""

fm = f"""---
title: "{TITLE}"
{tags_line}{alias_line}created: {str(__import__('datetime').date.today())}
---

# {TITLE}

{CONTENT}
""".strip()

path.write_text(fm + "\n", encoding="utf-8")
print(f"Created: {path}")
