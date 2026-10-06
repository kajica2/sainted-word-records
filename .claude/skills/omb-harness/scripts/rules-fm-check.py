#!/usr/bin/env python3
"""rules-fm-check.py — Validate frontmatter in .claude/rules/**/*.md files.

Rules:
- INDEX.md files: frontmatter optional.
- Mother files (file basename == parent directory name, e.g. ai/langgraph.md): frontmatter optional.
- All other files in subdirectories of .claude/rules/: if frontmatter is present,
  it MUST include a `paths:` array with at least one non-empty string entry.

Exit codes:
  0 — all checks passed
  1 — one or more files failed validation
"""

import argparse
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Frontmatter parsing (stdlib only — no pyyaml required)
# ---------------------------------------------------------------------------


def parse_frontmatter(text: str) -> dict | None:
    """Parse YAML frontmatter between leading --- delimiters.

    Returns a dict with parsed keys, or None if no frontmatter is present.
    Only parses top-level keys with list or scalar values (sufficient for paths:).
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None

    end = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end = i
            break

    if end is None:
        return None

    fm_lines = lines[1:end]
    result: dict = {}
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        # Skip blank lines and comments
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        # Top-level key: value
        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            key, _, rest = line.partition(":")
            key = key.strip()
            rest = rest.strip()
            if rest == "":
                # Possible block sequence next
                items = []
                i += 1
                while i < len(fm_lines):
                    sub = fm_lines[i]
                    stripped = sub.strip()
                    if stripped.startswith("- "):
                        items.append(stripped[2:].strip().strip('"').strip("'"))
                        i += 1
                    elif stripped == "-":
                        items.append("")
                        i += 1
                    elif stripped == "" or stripped.startswith("#"):
                        i += 1
                    else:
                        # End of block
                        break
                result[key] = items
            else:
                # Inline value
                # Strip quotes
                val = rest.strip('"').strip("'")
                result[key] = val
                i += 1
        else:
            i += 1
    return result


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------


def is_index_file(path: Path) -> bool:
    return path.name.upper() == "INDEX.MD"


def is_mother_file(path: Path, rules_root: Path) -> bool:
    """Mother pattern: file is in a subdirectory of rules_root and its stem
    equals its parent directory name (e.g. ai/langgraph.md or ai/deepagents.md)."""
    try:
        rel = path.relative_to(rules_root)
    except ValueError:
        return False
    parts = rel.parts
    if len(parts) < 2:
        # Directly in rules root — not in a subdirectory
        return False
    parent_dir = parts[-2]
    file_stem = path.stem
    return file_stem == parent_dir


def is_in_subdirectory(path: Path, rules_root: Path) -> bool:
    """Return True if the file is in a subdirectory of rules_root (not rules_root itself)."""
    try:
        rel = path.relative_to(rules_root)
    except ValueError:
        return False
    return len(rel.parts) >= 2


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_paths_entry(entry: str, _path: Path, verbose: bool) -> list[str]:
    """Validate a single paths: entry. Returns list of warning strings."""
    warnings = []
    if not entry:
        warnings.append("  WARN: empty string in paths: array")
        return warnings

    # Optionally expand brace patterns for extra validation.
    # braceexpand is not stdlib; skip silently if unavailable.
    try:
        import braceexpand  # type: ignore

        expanded = list(braceexpand.braceexpand(entry))
        if verbose:
            print(f"  INFO: paths entry '{entry}' expands to {len(expanded)} pattern(s)")
    except ImportError:
        pass  # braceexpand not available — warn but do not fail
    except Exception as exc:
        warnings.append(f"  WARN: could not expand brace pattern '{entry}': {exc}")

    return warnings


def check_file(path: Path, rules_root: Path, verbose: bool) -> tuple[bool, list[str]]:
    """Check a single markdown file. Returns (passed, messages)."""
    messages: list[str] = []

    text = path.read_text(encoding="utf-8")
    fm = parse_frontmatter(text)

    in_subdir = is_in_subdirectory(path, rules_root)
    is_index = is_index_file(path)
    is_mother = is_mother_file(path, rules_root)

    exempt = is_index or is_mother or not in_subdir

    if verbose:
        fm_present = fm is not None
        messages.append(f"  index={is_index} mother={is_mother} in_subdir={in_subdir} exempt={exempt} fm={fm_present}")

    if exempt:
        # Frontmatter is optional; no paths: requirement
        if fm is not None and "paths" in fm:
            # Has paths — validate entries anyway
            paths_val = fm["paths"]
            if not isinstance(paths_val, list):
                messages.append("  WARN: paths: is present but not a list")
            else:
                for entry in paths_val:
                    messages.extend(validate_paths_entry(entry, path, verbose))
        return True, messages

    # Non-exempt file in a subdirectory
    if fm is None:
        # No frontmatter — OK (no requirement violated)
        return True, messages

    # Frontmatter is present — paths: MUST be a non-empty list of non-empty strings
    if "paths" not in fm:
        messages.append("  FAIL: frontmatter present but missing `paths:` key")
        return False, messages

    paths_val = fm["paths"]
    if not isinstance(paths_val, list):
        messages.append("  FAIL: `paths:` must be a YAML list")
        return False, messages

    if len(paths_val) == 0:
        messages.append("  FAIL: `paths:` array must contain at least one entry")
        return False, messages

    all_ok = True
    for entry in paths_val:
        if not entry:
            messages.append("  FAIL: `paths:` contains an empty string entry")
            all_ok = False
        else:
            messages.extend(validate_paths_entry(entry, path, verbose))

    return all_ok, messages


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate paths: frontmatter in .claude/rules/**/*.md files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--rules-dir",
        default=None,
        metavar="DIR",
        help=(
            "Path to .claude/rules/ directory. "
            "Defaults to <project-root>/.claude/rules/ where project root is "
            "detected by walking up from CWD looking for CLAUDE.md or .claude/."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-file classification details.",
    )
    args = parser.parse_args()

    # Resolve rules directory
    if args.rules_dir:
        rules_root = Path(args.rules_dir).resolve()
    else:
        # Auto-detect: walk up from CWD
        cwd = Path.cwd()
        candidate = cwd
        rules_root = None
        for _ in range(10):
            probe = candidate / ".claude" / "rules"
            if probe.is_dir():
                rules_root = probe
                break
            parent = candidate.parent
            if parent == candidate:
                break
            candidate = parent
        if rules_root is None:
            print("ERROR: Could not locate .claude/rules/. Use --rules-dir.", file=sys.stderr)
            return 1

    if not rules_root.is_dir():
        print(f"ERROR: Rules directory not found: {rules_root}", file=sys.stderr)
        return 1

    # Collect all markdown files
    md_files = sorted(rules_root.rglob("*.md"))
    if not md_files:
        print(f"No markdown files found under {rules_root}")
        return 0

    passed_count = 0
    failed_count = 0
    warned_count = 0

    for path in md_files:
        rel = path.relative_to(rules_root)
        _ok, messages = check_file(path, rules_root, args.verbose)
        has_fail = any("FAIL" in m for m in messages)
        has_warn = any("WARN" in m for m in messages)

        if has_fail:
            status = "FAIL"
            failed_count += 1
        elif has_warn:
            status = "WARN"
            warned_count += 1
            passed_count += 1
        else:
            status = "PASS"
            passed_count += 1

        if args.verbose or has_fail or has_warn:
            print(f"[{status}] {rel}")
            for msg in messages:
                print(msg)
        elif status == "PASS" and args.verbose:
            print(f"[{status}] {rel}")

    # Summary
    total = len(md_files)
    print(f"\n--- Summary: {total} files checked | {passed_count} PASS | {failed_count} FAIL | {warned_count} WARN ---")

    if failed_count > 0:
        print(
            f"\nFAIL: {failed_count} file(s) have frontmatter with missing/invalid paths:.",
            file=sys.stderr,
        )
        return 1

    print("PASS: all files satisfy frontmatter rules.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
