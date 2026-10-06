#!/usr/bin/env python3
"""Delegate wiki operations to the installed oh-my-braincrew runtime."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    """Execute the canonical wiki runtime with the supplied operation arguments."""
    cli = Path(__file__).resolve().parents[3] / "bin" / "omb-cli.sh"
    args = sys.argv[1:] if argv is None else argv
    os.execv(str(cli), [str(cli), "wiki-runtime", *args])


if __name__ == "__main__":
    main()
