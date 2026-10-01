#!/usr/bin/env python3
"""Compatibility guard for the retired direct-write Wiki migration.

Automatic in-place migration cannot satisfy the current schema-selection,
candidate-validation, compare-and-swap, and user-decision contracts. Callers
must migrate each target through the canonical ``omb-wiki add`` or ``update``
transaction instead.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    """Reject the unsafe legacy migration path with actionable guidance."""
    parser = argparse.ArgumentParser(
        description="Legacy Wiki migration guard; direct migration is unsupported",
    )
    parser.add_argument("--root", default="docs/wiki")
    parser.add_argument("--manifest")
    parser.add_argument("--dry-run", action="store_true")
    parser.parse_args(argv)

    print(
        "Direct Wiki migration is retired. Select an explicit schema/subtype for "
        "each target and use omb-wiki add or omb-wiki update; those commands stage "
        "candidates and publish only through .claude/bin/omb-cli.sh wiki-runtime.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
