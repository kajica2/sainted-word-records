#!/usr/bin/env python3
"""Deterministic architecture inventory scanner for `omb-architect` (stdlib only).

Scans Python, TypeScript/JavaScript, and shell source files under a scope directory
and reports oversized files, oversized functions, duplicate symbols/bodies, naming
violations, and package smells as a single deterministic JSON report (optional
Markdown summary). See `.omb/plans/2026-09-03-omb-refactoring-e2e-pipeline.md` CU-1
for the full contract this script implements.

`--out`/`--markdown` output paths are confined to `{root}/.omb/architect/` and
`--root` (when given) must resolve inside the process working directory — both are
enforced by `resolve_output_path`/`validate_root` to keep this auto-approved CLI from
writing outside its designated scratch area (it must not be able to clobber
`.omb/db/worktrees.db` or `.omb/plans/*.md` either).
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
import tokenize
from datetime import UTC, datetime
from pathlib import Path

_EXCLUDED_DIR_NAMES = frozenset(
    {"node_modules", ".git", "worktrees", ".omb", ".venv", "dist", "build", "__pycache__", "coverage"}
)
_SOURCE_EXTENSIONS = frozenset({".py", ".ts", ".tsx", ".js", ".jsx", ".sh"})
_LANGUAGE_MAP = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".sh": "shell",
}
_GOD_FILE_NAMES = frozenset({"utils.py", "helpers.ts", "services.ts", "utils.ts", "helpers.py", "common.py"})
_SAME_NAME_EXCLUDED = frozenset({"main", "__init__", "setUp", "tearDown"})

_SNAKE_CASE_RE = re.compile(r"^[a-z_][a-z0-9_]*$")
_PASCAL_CASE_RE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
_UPPER_SNAKE_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_DUNDER_RE = re.compile(r"^__.*__$")
_CAMEL_CASE_RE = re.compile(r"^[a-z][a-zA-Z0-9]*$")

_TS_RESERVED = frozenset(
    {"if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "finally"}
)
_TS_FUNCTION_RE = re.compile(r"^\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
_TS_ARROW_RE = re.compile(
    r"^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
_TS_CLASS_RE = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)")
_TS_METHOD_RE = re.compile(
    r"^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{"
)
_TS_CONST_RE = re.compile(r"^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$")
_TS_LINE_COMMENT_RE = re.compile(r"//.*")


class InventoryError(Exception):
    """Raised for an invalid `--scope`, `--out`, or `--markdown` argument (exit 2)."""


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="architect_inventory",
        description="Deterministic architecture inventory scanner (stdlib only).",
    )
    parser.add_argument("--scope", required=True)
    parser.add_argument("--root", default=None, help="Must resolve inside the current working directory.")
    parser.add_argument("--out", default=None, help="Must resolve inside {root}/.omb/.")
    parser.add_argument("--markdown", default=None, help="Must resolve inside {root}/.omb/.")
    parser.add_argument("--max-lines", type=int, default=800)
    parser.add_argument("--warn-lines", type=int, default=400)
    parser.add_argument("--max-function-lines", type=int, default=50)
    args = parser.parse_args(argv)
    args.root_raw = args.root
    args.root = Path(args.root).resolve() if args.root else Path.cwd().resolve()
    return args


def _is_within_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_root(root: Path, root_raw: str | None) -> None:
    """Reject a `--root` that resolves outside the process working directory.

    Only applies when `--root` was explicitly passed; the implicit `Path.cwd()`
    default always trivially satisfies this check.
    """
    if root_raw is None:
        return
    cwd = Path.cwd().resolve()
    if root != cwd and not _is_within_root(root, cwd):
        raise InventoryError(f"root '{root_raw}' is outside the working directory")


def resolve_scope(root: Path, scope: str) -> Path:
    candidate = Path(scope)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if not _is_within_root(resolved, root):
        raise InventoryError(f"scope '{scope}' is outside root '{root}'")
    if not (resolved.is_file() or resolved.is_dir()):
        raise InventoryError(f"scope '{scope}' does not exist")
    return resolved


def resolve_output_path(root: Path, value: str) -> Path:
    """Resolve an `--out`/`--markdown` path, confined to `{root}/.omb/architect/`.

    Outputs are restricted to this skill's own `.omb/architect/` subtree (not the
    full root, and not all of `.omb/`) so an auto-approved invocation cannot write
    outside the harness's designated scratch area (e.g. `.claude/settings.json`)
    nor overwrite sibling harness state such as `.omb/db/worktrees.db`.
    """
    omb_base = (root / ".omb" / "architect").resolve()
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if not _is_within_root(resolved, root):
        raise InventoryError(f"output path '{value}' is outside root '{root}'")
    if not _is_within_root(resolved, omb_base):
        raise InventoryError(f"output path '{value}' must be inside {root}/.omb/architect")
    return resolved


def iter_source_files(scope: Path) -> list[Path]:
    if scope.is_file():
        return [scope] if scope.suffix in _SOURCE_EXTENSIONS else []
    results: list[Path] = []
    for path in scope.rglob("*"):
        if not path.is_file() or path.suffix not in _SOURCE_EXTENSIONS:
            continue
        rel_parts = path.relative_to(scope).parts
        if _EXCLUDED_DIR_NAMES.intersection(rel_parts[:-1]):
            continue
        results.append(path)
    results.sort(key=lambda p: p.relative_to(scope).as_posix())
    return results


def _make_function_record(name: str, kind: str, lineno: int, end_lineno: int, body_hash: str | None = None) -> dict:
    return {
        "name": name,
        "kind": kind,
        "lineno": lineno,
        "end_lineno": end_lineno,
        "lines": end_lineno - lineno + 1,
        "over_max_function": False,
        "body_hash": body_hash,
    }


def _tokenize_body(body_text: str) -> tuple[int, str]:
    remaining = body_text.splitlines(keepends=True)
    position = [0]

    def _readline() -> str:
        if position[0] < len(remaining):
            line = remaining[position[0]]
            position[0] += 1
            return line
        return ""

    parts: list[str] = []
    logical_lines = 0
    try:
        for tok in tokenize.generate_tokens(_readline):
            if tok.type == tokenize.COMMENT:
                continue
            if tok.type == tokenize.NEWLINE:
                logical_lines += 1
                continue
            if tok.type in (tokenize.NL, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER, tokenize.ENCODING):
                continue
            if tok.string.strip():
                parts.append(tok.string)
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return 0, ""

    normalized = re.sub(r"\s+", " ", " ".join(parts)).strip()
    return logical_lines, normalized


def _python_body_hash(source_lines: list[str], node: ast.AST) -> str | None:
    body = getattr(node, "body", None)
    if not body:
        return None
    start = body[0].lineno
    end = getattr(node, "end_lineno", start)
    body_text = "\n".join(source_lines[start - 1 : end])
    logical_lines, normalized = _tokenize_body(body_text)
    if logical_lines < 8 or not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _walk_python_defs(tree: ast.Module):
    def visit(node: ast.AST, in_class: bool):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                yield child, "class"
                yield from visit(child, True)
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                yield child, ("method" if in_class else "function")
                yield from visit(child, False)
            else:
                yield from visit(child, in_class)

    yield from visit(tree, False)


def _check_python_module_constant(name: str, value_node: ast.AST, lineno: int, naming_out: list[dict]) -> None:
    if not isinstance(value_node, ast.Constant):
        return
    if _DUNDER_RE.match(name):
        return  # `__version__ = "1.0"` and friends are conventional module metadata, not constants
    is_upper_identifier = name.isupper()
    is_literal_scalar = isinstance(value_node.value, (int, str, float, bool))
    if (is_upper_identifier or is_literal_scalar) and not _UPPER_SNAKE_RE.match(name):
        naming_out.append(
            {"lineno": lineno, "symbol": name, "kind": "constant", "rule": "python-constant-upper-snake-case"}
        )


def inspect_python(path: Path) -> tuple[list[dict], list[dict]]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    source_lines = source.splitlines()
    functions: list[dict] = []
    naming: list[dict] = []

    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            _check_python_module_constant(stmt.targets[0].id, stmt.value, stmt.lineno, naming)

    for node, kind in _walk_python_defs(tree):
        end_lineno = getattr(node, "end_lineno", node.lineno)
        if kind == "class":
            functions.append(_make_function_record(node.name, "class", node.lineno, end_lineno))
            if not _PASCAL_CASE_RE.match(node.name):
                naming.append(
                    {"lineno": node.lineno, "symbol": node.name, "kind": "class", "rule": "python-class-pascal-case"}
                )
        else:
            body_hash = _python_body_hash(source_lines, node)
            functions.append(_make_function_record(node.name, kind, node.lineno, end_lineno, body_hash))
            if not _SNAKE_CASE_RE.match(node.name):
                naming.append(
                    {
                        "lineno": node.lineno,
                        "symbol": node.name,
                        "kind": "function",
                        "rule": "python-function-snake-case",
                    }
                )

    return functions, naming


def _strip_ts_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.DOTALL)
    lines = [_TS_LINE_COMMENT_RE.sub("", line) for line in text.split("\n")]
    return "\n".join(lines)


def _find_ts_end_lineno(lines: list[str], start_idx: int) -> int:
    depth = 0
    started = False
    for idx in range(start_idx, len(lines)):
        for ch in lines[idx]:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
                if started and depth == 0:
                    return idx + 1
    return start_idx + 1


def _check_ts_function_naming(name: str, lineno: int, naming_out: list[dict]) -> None:
    if name and name[0].isupper():
        return
    if not _CAMEL_CASE_RE.match(name):
        naming_out.append({"lineno": lineno, "symbol": name, "kind": "function", "rule": "ts-function-camel-case"})


def _match_ts_function_forms(line: str, lineno: int, lines: list[str], idx: int, naming: list[dict]) -> dict | None:
    for pattern, kind in ((_TS_FUNCTION_RE, "function"), (_TS_ARROW_RE, "function"), (_TS_METHOD_RE, "method")):
        match = pattern.match(line)
        if match and match.group(1) not in _TS_RESERVED:
            end = _find_ts_end_lineno(lines, idx)
            _check_ts_function_naming(match.group(1), lineno, naming)
            return _make_function_record(match.group(1), kind, lineno, end)
    return None


def _match_ts_class(line: str, lineno: int, lines: list[str], idx: int, naming: list[dict]) -> dict | None:
    match = _TS_CLASS_RE.match(line)
    if not match:
        return None
    end = _find_ts_end_lineno(lines, idx)
    if not _PASCAL_CASE_RE.match(match.group(1)):
        naming.append({"lineno": lineno, "symbol": match.group(1), "kind": "class", "rule": "ts-class-pascal-case"})
    return _make_function_record(match.group(1), "class", lineno, end)


def _match_ts_constant(line: str, lineno: int, naming: list[dict]) -> None:
    match = _TS_CONST_RE.match(line)
    if not match:
        return
    name, rhs = match.group(1), match.group(2)
    if "function" in rhs or "=>" in rhs:
        return
    if not _UPPER_SNAKE_RE.match(name):
        naming.append({"lineno": lineno, "symbol": name, "kind": "constant", "rule": "ts-constant-upper-snake-case"})


def inspect_typescript(path: Path) -> tuple[list[dict], list[dict]]:
    text = path.read_text(encoding="utf-8")
    lines = _strip_ts_comments(text).split("\n")
    functions: list[dict] = []
    naming: list[dict] = []

    for idx, line in enumerate(lines):
        lineno = idx + 1
        record = _match_ts_function_forms(line, lineno, lines, idx, naming)
        if record is None:
            record = _match_ts_class(line, lineno, lines, idx, naming)
        if record is not None:
            functions.append(record)
            continue
        _match_ts_constant(line, lineno, naming)

    return functions, naming


def _is_same_name_excluded(name: str) -> bool:
    return name in _SAME_NAME_EXCLUDED or name.startswith("test_")


def find_duplicates(functions: list[dict]) -> list[dict]:
    duplicates: list[dict] = []

    by_name: dict[str, set] = {}
    for fn in functions:
        if fn["kind"] != "class" and not _is_same_name_excluded(fn["name"]):
            by_name.setdefault(fn["name"], set()).add(fn["path"])
    for name in sorted(by_name):
        paths = by_name[name]
        if len(paths) >= 2:
            duplicates.append({"kind": "same_name", "name": name, "locations": [{"path": p} for p in sorted(paths)]})

    by_hash: dict[str, list[dict]] = {}
    for fn in functions:
        body_hash = fn.get("body_hash")
        if body_hash:
            by_hash.setdefault(body_hash, []).append(fn)
    for body_hash in sorted(by_hash):
        entries = by_hash[body_hash]
        if len(entries) >= 2:
            locations = sorted(
                ({"path": e["path"], "name": e["name"], "lineno": e["lineno"]} for e in entries),
                key=lambda loc: (loc["path"], loc["lineno"]),
            )
            duplicates.append({"kind": "same_body", "body_hash": body_hash, "locations": locations})

    return duplicates


def _has_subdirectory(abs_dir: Path) -> bool:
    return any(child.is_dir() and child.name not in _EXCLUDED_DIR_NAMES for child in abs_dir.iterdir())


def find_package_smells(files: list[dict], scope: Path) -> list[dict]:
    by_dir: dict[str, list[dict]] = {}
    for entry in files:
        parent = Path(entry["path"]).parent
        key = "" if str(parent) == "." else parent.as_posix()
        by_dir.setdefault(key, []).append(entry)

    smells: list[dict] = []
    for directory in sorted(by_dir):
        entries = by_dir[directory]
        languages = {e["language"] for e in entries}
        parts = Path(directory).parts if directory else ()
        abs_dir = scope / directory if directory else scope

        if "python" in languages and "tests" not in parts and not (abs_dir / "__init__.py").exists():
            smells.append({"path": directory, "smell": "missing_init", "detail": "missing __init__.py"})
        source_count = len(entries)
        if source_count > 15 and not _has_subdirectory(abs_dir):
            smells.append(
                {"path": directory, "smell": "flat_package", "detail": f"{source_count} files, no sub-packages"}
            )
        if len(parts) > 5:
            smells.append({"path": directory, "smell": "deep_nesting", "detail": f"depth {len(parts)}"})
        if "python" in languages and languages.intersection({"typescript", "javascript"}):
            smells.append(
                {"path": directory, "smell": "mixed_language_dir", "detail": "python and TS/JS in same directory"}
            )

    smells.sort(key=lambda s: (s["path"], s["smell"]))
    return smells


def _build_summary(
    files: list[dict],
    functions: list[dict],
    duplicates: list[dict],
    naming_violations: list[dict],
    package_smells: list[dict],
    scan_errors: list[dict],
) -> dict:
    hotspots_sorted = sorted(files, key=lambda f: (-f["lines"], f["path"]))[:10]
    return {
        "file_count": len(files),
        "function_count": len(functions),
        "duplicate_count": len(duplicates),
        "naming_violation_count": len(naming_violations),
        "package_smell_count": len(package_smells),
        "scan_error_count": len(scan_errors),
        "hotspots": [{"path": f["path"], "lines": f["lines"]} for f in hotspots_sorted],
    }


def _scan_file(
    path: Path,
    rel: str,
    args: argparse.Namespace,
    scan_errors: list[dict],
) -> tuple[dict | None, list, list]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        scan_errors.append({"path": rel, "stage": "read", "message": str(exc)})
        return None, [], []

    lines = len(text.splitlines())
    suffix = path.suffix
    file_functions: list[dict] = []
    file_naming: list[dict] = []
    if suffix == ".py":
        try:
            file_functions, file_naming = inspect_python(path)
        except SyntaxError as exc:
            scan_errors.append({"path": rel, "stage": "parse", "message": str(exc)})
            return None, [], []
        except (OSError, UnicodeDecodeError) as exc:
            scan_errors.append({"path": rel, "stage": "read", "message": str(exc)})
            return None, [], []
    elif suffix in (".ts", ".tsx", ".js", ".jsx"):
        file_functions, file_naming = inspect_typescript(path)

    entry = {
        "path": rel,
        "language": _LANGUAGE_MAP[suffix],
        "lines": lines,
        "over_warn": lines > args.warn_lines,
        "over_max": lines > args.max_lines,
        "god_file_name": path.name in _GOD_FILE_NAMES,
    }
    return entry, file_functions, file_naming


def build_report(root: Path, scope: Path, args: argparse.Namespace) -> dict:
    files: list[dict] = []
    functions: list[dict] = []
    naming_violations: list[dict] = []
    scan_errors: list[dict] = []

    for path in iter_source_files(scope):
        rel = path.relative_to(scope).as_posix()
        entry, file_functions, file_naming = _scan_file(path, rel, args, scan_errors)
        if entry is None:
            continue
        files.append(entry)
        for fn in file_functions:
            fn["path"] = rel
            if fn["kind"] != "class":
                fn["over_max_function"] = fn["lines"] > args.max_function_lines
            functions.append(fn)
        for nv in file_naming:
            nv["path"] = rel
            naming_violations.append(nv)

    duplicates = find_duplicates(functions)
    package_smells = find_package_smells(files, scope)
    summary = _build_summary(files, functions, duplicates, naming_violations, package_smells, scan_errors)
    generated_at = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

    return {
        "scope": str(scope),
        "root": str(root),
        "generated_at": generated_at,
        "thresholds": {
            "max_lines": args.max_lines,
            "warn_lines": args.warn_lines,
            "max_function_lines": args.max_function_lines,
        },
        "files": files,
        "functions": functions,
        "duplicates": duplicates,
        "naming_violations": naming_violations,
        "package_smells": package_smells,
        "scan_errors": scan_errors,
        "summary": summary,
    }


def render_markdown(report: dict) -> str:
    lines = [
        "# Architecture Inventory Report",
        "",
        f"- Scope: `{report['scope']}`",
        f"- Generated at: {report['generated_at']}",
        "",
    ]
    lines += ["## Hotspots", "", "| Path | Lines |", "| --- | --- |"]
    lines += [f"| {h['path']} | {h['lines']} |" for h in report["summary"]["hotspots"]]
    longest = sorted(report["functions"], key=lambda f: (-f["lines"], f["path"], f["name"]))[:10]
    lines += ["", "## Longest Functions", "", "| Path | Name | Lines |", "| --- | --- | --- |"]
    lines += [f"| {fn['path']} | {fn['name']} | {fn['lines']} |" for fn in longest]
    lines += ["", "## Duplicate Clusters", ""]
    for dup in report["duplicates"]:
        label = dup["name"] if dup["kind"] == "same_name" else dup["body_hash"][:8]
        paths = ", ".join(loc["path"] for loc in dup["locations"])
        lines.append(f"- {dup['kind']} `{label}`: {paths}")
    lines += ["", "## Naming Violations", ""]
    lines += [
        f"- `{nv['path']}:{nv['lineno']}` {nv['symbol']} ({nv['kind']}) — {nv['rule']}"
        for nv in report["naming_violations"]
    ]
    lines += ["", "## Package Smells", ""]
    lines += [f"- `{s['path']}` {s['smell']}: {s['detail']}" for s in report["package_smells"]]
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        validate_root(args.root, args.root_raw)
        scope = resolve_scope(args.root, args.scope)
        out_path = resolve_output_path(args.root, args.out) if args.out else None
        markdown_path = resolve_output_path(args.root, args.markdown) if args.markdown else None
    except InventoryError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    report = build_report(args.root, scope, args)
    text = json.dumps(report, indent=2)
    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    if markdown_path is not None:
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(render_markdown(report), encoding="utf-8")

    return 0


if __name__ == "__main__":
    sys.exit(main())
