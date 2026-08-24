#!/usr/bin/env python3
"""
Add a '?' icon button to every engine study page that opens the
SWR_KEYS keyboard shortcut help overlay.

The button is inserted just after the <span class="spacer"></span> marker
in the header so it sits at the right edge — visible on every viewport.

Idempotent: skips if a 'swr-keys-help-btn' id is already present.

Run from the project root:
    python3 _apply_keys_help_icon.py
"""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINES = [
    "aurora", "chrome", "eclipse", "film", "fractal",
    "glitch", "grid", "hallucination", "neon", "pulse",
    "smoke", "void", "watercolor",
]

OLD = '<span class="spacer"></span>'
NEW = (
    '<span class="spacer"></span>'
    '<button class="tbtn" id="swr-keys-help-btn" '
    'title="Keyboard shortcuts (?)" '
    'style="font-family:ui-monospace,monospace;font-weight:700;'
    'min-width:24px;padding:5px 8px;line-height:1;'
    'position:relative;z-index:10001;">?</button>'
)


def main() -> int:
    root = ROOT / "versions"
    for name in ENGINES:
        path = root / f"{name}.html"
        if not path.exists():
            print(f"  SKIP  {name}: not found")
            continue
        text = path.read_text()
        if 'id="swr-keys-help-btn"' in text:
            print(f"  NONE  {name}: already has help button")
            continue
        if OLD not in text:
            print(f"  FAIL  {name}: no <span class=\"spacer\"></span> anchor")
            continue
        text = text.replace(OLD, NEW, 1)
        path.write_text(text)
        print(f"  PATCH {name}: help button added")
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
