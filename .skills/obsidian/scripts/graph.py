#!/usr/bin/env python3
"""Build a link graph from wikilinks and external links in a vault."""
import sys
import re
from pathlib import Path
from collections import defaultdict

VAULT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else None  # optional: write MOC to this path

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]")
EXTERNAL = re.compile(r"\[([^\]]+)\]\((https?://[^\)]+)\)")

def notes(vault):
    return [n for n in vault.rglob("*.md")]

def slug_to_path(slug, vault):
    """Resolve a wikilink slug to an actual file path."""
    for ext in ("", ".md"):
        p = vault / (slug + ext)
        if p.exists():
            return p
        # case-insensitive scan
        for n in vault.rglob("*.md"):
            if n.stem.lower() == slug.lower():
                return n
    return None

def build_graph(vault):
    wikilinks = defaultdict(set)  # note -> set of linked notes
    externals = defaultdict(set)  # note -> set of external URLs
    all_notes = set()

    for n in notes(vault):
        rel = n.relative_to(vault)
        all_notes.add(rel)
        text = n.read_text(encoding="utf-8", errors="ignore")

        for m in WIKILINK.finditer(text):
            target = m.group(1).strip()
            target_path = slug_to_path(target, vault)
            if target_path:
                wikilinks[rel].add(target_path.relative_to(vault))

        for m in EXTERNAL.finditer(text):
            externals[rel].add(m.group(2))

    return wikilinks, externals, all_notes

def print_graph(vault):
    wikilinks, externals, all_notes = build_graph(vault)
    print(f"Notes: {len(all_notes)}\n")
    for note in sorted(wikilinks):
        links = sorted(wikilinks[note])
        if links:
            print(f"{note}")
            for link in links:
                print(f"  -> {link}")

def write_moc(vault, out_path, title="Map of Content"):
    wikilinks, externals, all_notes = build_graph(vault)
    lines = [
        f"# {title}",
        "",
        f"// Auto-generated: {len(all_notes)} notes",
        "",
    ]
    # Sort by number of incoming links (most-linked first)
    incoming = defaultdict(list)
    for note, links in wikilinks.items():
        for link in links:
            incoming[link].append(note)
    sorted_notes = sorted(all_notes, key=lambda n: len(incoming.get(n, [])), reverse=True)
    for note in sorted_notes:
        links = sorted(wikilinks.get(note, []))
        lines.append(f"## [[{note.stem}]]")
        if incoming.get(note):
            lines.append(f"// {len(incoming[note])} backlink(s)")
        for link in links:
            lines.append(f"- [[{link.stem}]]")
        lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"MOC written: {out_path}")

if not VAULT:
    print("Usage: graph.py <vault_path> [moc_output_path]")
    sys.exit(1)

vault = Path(VAULT).expanduser()
if OUT:
    write_moc(vault, Path(OUT))
else:
    print_graph(vault)
