#!/usr/bin/env python3
"""Search notes in an Obsidian vault by name, tag, or full-text."""
import sys
import re
import os
from pathlib import Path

VAULT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
QUERY = sys.argv[2] if len(sys.argv) > 2 else ""
MODE = sys.argv[3] if len(sys.argv) > 3 else "name"  # name | tag | full

def notes(vault):
    return list(vault.rglob("*.md"))

def search_name(query, vault):
    q = query.lower()
    return [n for n in notes(vault) if q in n.stem.lower()]

def search_tag(query, vault):
    q = query.lower()
    results = []
    tag_pattern = re.compile(r"^tags?\s*:\s*\[([^\]]*)\]|#[a-zA-Z0-9_\-/]+", re.MULTILINE)
    for n in notes(vault):
        text = n.read_text(encoding="utf-8", errors="ignore")
        # frontmatter tags
        fm_match = re.search(r"^---\n(.*?)\n---", text, re.DOTALL)
        if fm_match:
            fm = fm_match.group(1)
            if q in fm.lower():
                results.append(n)
                continue
        # inline tags
        for m in tag_pattern.finditer(text):
            if q in m.group(0).lower():
                results.append(n)
                break
    return results

def search_full(query, vault):
    q = query.lower()
    results = []
    for n in notes(vault):
        try:
            if q in n.read_text(encoding="utf-8", errors="ignore").lower():
                results.append(n)
        except OSError:
            pass
    return results

def frontmatter_of(path):
    text = Path(path).read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"^---\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out

if not VAULT:
    print("Usage: search.py <vault_path> <query> [name|tag|full]")
    sys.exit(1)

vault = Path(VAULT).expanduser()
if not vault.is_dir():
    print(f"Not a directory: {vault}")
    sys.exit(1)

if MODE == "tag":
    results = search_tag(QUERY, vault)
elif MODE == "full":
    results = search_full(QUERY, vault)
else:
    results = search_name(QUERY, vault)

print(f"Found {len(results)} note(s):\n")
for r in results[:50]:
    fm = frontmatter_of(r)
    rel = r.relative_to(vault)
    tags = fm.get("tags", "")
    alias = fm.get("alias", "")
    print(f"  {rel}")
    if alias:
        print(f"    alias: {alias}")
    if tags:
        print(f"    tags: {tags}")
