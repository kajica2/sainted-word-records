#!/usr/bin/env python3
"""Delegate language and identifier validation to the installed Wiki runtime."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    cli = Path(__file__).resolve().parents[3] / "bin" / "omb-cli.sh"
    args = sys.argv[1:] if argv is None else argv
    os.execv(str(cli), [str(cli), "wiki-runtime", "validate", *args])


if __name__ == "__main__":
    main()
