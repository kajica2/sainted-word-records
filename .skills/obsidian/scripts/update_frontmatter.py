#!/usr/bin/env python3
"""Update frontmatter fields in a note without touching the body."""
import sys
import re
from pathlib import Path

if len(sys.argv) < 3:
    print("Usage: update_frontmatter.py <note_path> <key>:<value> [key:value ...]")
    sys.exit(1)

path = Path(sys.argv[1])
updates = {}
for arg in sys.argv[2:]:
    if ":" in arg:
        k, v = arg.split(":", 1)
        updates[k.strip()] = v.strip()

text = path.read_text(encoding="utf-8", errors="ignore")

fm_match = re.search(r"^(---\n)(.*?)(\n---)", text, re.DOTALL)
if fm_match:
    fm_text = fm_match.group(2)
    fm_lines = fm_text.splitlines()
    # Update or append
    for k, v in updates.items():
        found = False
        for i, line in enumerate(fm_lines):
            if line.strip().startswith(k + ":"):
                fm_lines[i] = f"{k}: {v}"
                found = True
                break
        if not found:
            fm_lines.append(f"{k}: {v}")
    new_fm = fm_match.group(1) + "\n".join(fm_lines) + fm_match.group(3)
    new_text = new_fm + text[fm_match.end():]
else:
    # Prepend frontmatter
    fm_lines = [f"{k}: {v}" for k, v in updates.items()]
    new_text = "---\n" + "\n".join(fm_lines) + "\n---\n\n" + text

path.write_text(new_text, encoding="utf-8")
print(f"Updated: {path}")
print("Fields:", {k: v for k, v in updates.items()})
