#!/usr/bin/env python3
"""Stage recursive OKF indexes through the installed Wiki runtime.

The runtime builds the complete merged staged view bottom-up, adds every index
candidate to the current manifest, emits no YAML frontmatter, and places
``<!-- okf_version: 0.1 -->`` only in the root index body. This wrapper never
writes or publishes a live index independently.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    """Delegate ``--manifest`` and future compatible arguments unchanged."""
    cli = Path(__file__).resolve().parents[3] / "bin" / "omb-cli.sh"
    args = sys.argv[1:] if argv is None else argv
    os.execv(str(cli), [str(cli), "wiki-runtime", "index", *args])


if __name__ == "__main__":
    main()
