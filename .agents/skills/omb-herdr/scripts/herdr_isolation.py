#!/usr/bin/env python3
"""Deterministic isolation-gate helper for `omb-herdr` delegation (stdlib only).

Executes the decisive checks the delegation procedure used to perform as prose:
ancestor-symlink rejection, post-`worktree add` verification, tracked-symlink
escape detection (lexical + physical pending-stack resolution), a dirty-file
snapshot/compare pair, and the same-cwd mutating-delegation exclusion lock
(`cwd-lock`, implemented in the sibling `_herdr_cwd_lock` module). See
`.claude/skills/omb-herdr/references/delegation.md` (§2 "Freeze scope and
persist identity" — dirty-checkout isolation and same-cwd mutating lock
paragraphs) for the full contract.

Every subcommand prints exactly one JSON line to stdout and exits:
  0 = passed / operation succeeded
  3 = gate violation or lock contention (BLOCKED — caller treats as blocked)
  2 = usage error or the check itself could not complete (fail closed,
      also BLOCKED)
Callers MUST treat any non-zero exit as BLOCKED.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import secrets
import stat
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _herdr_cwd_lock as cwd_lock  # noqa: E402  (path must be set up first)

EXIT_OK = 0
EXIT_BLOCKED = 3
EXIT_USAGE_ERROR = 2

_GIT_TIMEOUT_S = 10
_MAX_SYMLINK_HOPS = 40


class IsolationError(Exception):
    """A check could not complete (records dir corruption, git failure, ...)."""


def _emit(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True))


# --------------------------------------------------------------------------
# ancestors
# --------------------------------------------------------------------------


def cmd_ancestors(args: argparse.Namespace) -> int:
    root = Path(args.root)
    path = Path(args.path)
    if not root.is_absolute() or str(root) != os.path.realpath(str(root)):
        _emit({"ok": False, "error": "root_not_canonical_absolute"})
        return EXIT_USAGE_ERROR
    if not path.is_absolute():
        _emit({"ok": False, "error": "path_not_absolute"})
        return EXIT_USAGE_ERROR
    try:
        rel = path.relative_to(root)
    except ValueError:
        _emit({"ok": False, "error": "path_outside_root"})
        return EXIT_USAGE_ERROR
    if ".." in rel.parts:
        _emit({"ok": False, "error": "path_contains_dotdot"})
        return EXIT_USAGE_ERROR
    normalized = Path(os.path.normpath(str(path)))
    try:
        normalized.relative_to(root)
    except ValueError:
        _emit({"ok": False, "error": "path_outside_root"})
        return EXIT_USAGE_ERROR

    symlinks: list[str] = []
    not_directories: list[str] = []
    leaf_exists = False
    current = root
    parts = rel.parts
    for index, part in enumerate(parts):
        current = current / part
        try:
            entry_stat = current.lstat()
        except FileNotFoundError:
            break
        is_last = index == len(parts) - 1
        rel_current = str(current.relative_to(root))
        if stat.S_ISLNK(entry_stat.st_mode):
            symlinks.append(rel_current)
            break
        if is_last:
            leaf_exists = True
            continue
        if not stat.S_ISDIR(entry_stat.st_mode):
            not_directories.append(rel_current)
            break

    ok = not (symlinks or not_directories or leaf_exists)
    _emit(
        {
            "ok": ok,
            "symlinks": symlinks,
            "not_directories": not_directories,
            "leaf_exists": leaf_exists,
        }
    )
    return EXIT_OK if ok else EXIT_BLOCKED


# --------------------------------------------------------------------------
# verify-worktree
# --------------------------------------------------------------------------


def cmd_verify_worktree(args: argparse.Namespace) -> int:
    iso_path = Path(args.path)
    result = subprocess.run(
        ["git", "-C", args.repo, "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        timeout=_GIT_TIMEOUT_S,
        check=False,
    )
    if result.returncode != 0:
        _emit({"ok": False, "error": "git_worktree_list_failed"})
        return EXIT_USAGE_ERROR
    try:
        real = os.path.realpath(str(iso_path))
    except OSError:
        _emit({"ok": False, "error": "realpath_failed"})
        return EXIT_USAGE_ERROR
    if real != str(iso_path):
        _emit({"ok": False, "error": "not_canonical", "realpath": real})
        return EXIT_BLOCKED

    found_block = False
    current_worktree: str | None = None
    has_detached = False
    for line in [*result.stdout.splitlines(), ""]:
        if line.startswith("worktree "):
            current_worktree = line[len("worktree ") :]
            has_detached = False
        elif line == "detached":
            has_detached = True
        elif line == "":
            if current_worktree is not None and has_detached and os.path.realpath(current_worktree) == real:
                found_block = True
            current_worktree = None
            has_detached = False

    if found_block:
        _emit({"ok": True})
        return EXIT_OK
    _emit({"ok": False, "reason": "not_registered_or_not_detached"})
    return EXIT_BLOCKED


# --------------------------------------------------------------------------
# tracked-symlinks
# --------------------------------------------------------------------------


def _iter_tracked_symlink_paths(worktree: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(worktree), "ls-files", "--stage", "-z"],
        capture_output=True,
        timeout=_GIT_TIMEOUT_S,
        check=False,
    )
    if result.returncode != 0:
        raise IsolationError("git_ls_files_failed")
    paths: list[str] = []
    for token in result.stdout.split(b"\0"):
        if not token:
            continue
        text = token.decode("utf-8", errors="surrogateescape")
        left, _, path = text.partition("\t")
        if not path:
            continue
        mode = left.split(" ", 1)[0]
        if mode == "120000":
            paths.append(path)
    return paths


def _lexical_check(rel: str, root: Path) -> tuple[bool, bool]:
    """Rule 1: raw target text joined against the tracked path's own dirname."""
    target = os.readlink(root / rel)
    if target.startswith("/"):
        return True, False
    joined = posixpath.normpath(posixpath.join(posixpath.dirname(rel), target))
    escapes = joined == ".." or joined.startswith("../")
    return False, escapes


def _is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return candidate == root


def _physical_check(root: Path, rel_path: str, max_hops: int = _MAX_SYMLINK_HOPS) -> dict:
    """Rule 2: physical pending-stack resolution with the dangling-remainder rule."""
    stack: list[str] = list(Path(rel_path).parts)
    resolved = root
    hops = 0
    while stack:
        component = stack.pop(0)
        if component == "..":
            if resolved == root:
                return {"absolute": False, "escapes": True, "loop": False}
            resolved = resolved.parent
            continue

        candidate = resolved / component
        try:
            entry_stat: os.stat_result | None = candidate.lstat()
        except (FileNotFoundError, NotADirectoryError):
            entry_stat = None

        if entry_stat is not None and stat.S_ISLNK(entry_stat.st_mode):
            target = os.readlink(candidate)
            if target.startswith("/"):
                return {"absolute": True, "escapes": False, "loop": False}
            hops += 1
            if hops > max_hops:
                return {"absolute": False, "escapes": False, "loop": True}
            stack = list(Path(target).parts) + stack
            continue

        if entry_stat is not None and stat.S_ISDIR(entry_stat.st_mode):
            resolved = candidate
            continue

        # Missing, or exists but is neither a directory nor a symlink.
        if stack:
            if any(part == ".." for part in stack):
                return {"absolute": False, "escapes": True, "loop": False}
            combined = candidate
            for part in stack:
                combined = combined / part
            normalized = Path(os.path.normpath(str(combined)))
            if not _is_within(normalized, root):
                return {"absolute": False, "escapes": True, "loop": False}
            return {"absolute": False, "escapes": False, "loop": False}
        resolved = candidate

    return {"absolute": False, "escapes": False, "loop": False}


def cmd_tracked_symlinks(args: argparse.Namespace) -> int:
    worktree = Path(args.worktree)
    try:
        root = Path(os.path.realpath(str(worktree)))
        tracked_paths = _iter_tracked_symlink_paths(worktree)
    except (IsolationError, OSError):
        _emit({"ok": False, "error": "scan_incomplete"})
        return EXIT_USAGE_ERROR

    absolute: list[str] = []
    escapes: list[str] = []
    loop: list[str] = []
    for rel in tracked_paths:
        try:
            lexical_absolute, lexical_escapes = _lexical_check(rel, root)
            physical = _physical_check(root, rel)
        except OSError:
            _emit({"ok": False, "error": "scan_incomplete"})
            return EXIT_USAGE_ERROR
        if lexical_absolute or physical["absolute"]:
            absolute.append(rel)
        elif physical["loop"]:
            loop.append(rel)
        elif lexical_escapes or physical["escapes"]:
            escapes.append(rel)

    ok = not (absolute or escapes or loop)
    _emit({"ok": ok, "absolute": absolute, "escapes": escapes, "loop": loop})
    return EXIT_OK if ok else EXIT_BLOCKED


# --------------------------------------------------------------------------
# dirty-map / compare-dirty
# --------------------------------------------------------------------------


def _parse_porcelain_paths(raw: bytes) -> list[str]:
    """Split `git status --porcelain=v1 -z` output; a rename yields two paths."""
    tokens = raw.split(b"\0")
    paths: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if not token:
            index += 1
            continue
        text = token.decode("utf-8", errors="surrogateescape")
        # Porcelain v1 format is a fixed two-char XY status, one space, then the
        # path — XY's first character may itself be a literal space, so this
        # cannot be split on the first space token like a normal field.
        code, path = text[:2], text[3:]
        if not path:
            index += 1
            continue
        paths.append(path)
        if code[:1] in ("R", "C") and index + 1 < len(tokens):
            index += 1
            old_path = tokens[index].decode("utf-8", errors="surrogateescape")
            if old_path:
                paths.append(old_path)
        index += 1
    return paths


def _snapshot_path(top: Path, rel: str) -> dict:
    abs_path = top / rel
    try:
        entry_stat = abs_path.lstat()
    except FileNotFoundError:
        return {"kind": "deleted"}

    if stat.S_ISLNK(entry_stat.st_mode):
        target = os.readlink(abs_path)
        digest = hashlib.sha256(target.encode("utf-8", "surrogateescape")).hexdigest()
        return {"kind": "symlink", "mode": "120000", "digest": digest}

    if stat.S_ISDIR(entry_stat.st_mode):
        if (abs_path / ".git").exists():
            return {"kind": "submodule"}
        return {"kind": "other"}

    if not stat.S_ISREG(entry_stat.st_mode):
        return {"kind": "other"}

    try:
        fd = os.open(str(abs_path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return {"kind": "other"}
    try:
        fd_stat = os.fstat(fd)
        if not stat.S_ISREG(fd_stat.st_mode):
            return {"kind": "other"}
        hasher = hashlib.sha256()
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            hasher.update(chunk)
        mode = "100755" if fd_stat.st_mode & 0o111 else "100644"
        return {"kind": "file", "mode": mode, "digest": hasher.hexdigest()}
    finally:
        os.close(fd)


def cmd_dirty_map(args: argparse.Namespace) -> int:
    top_result = subprocess.run(
        ["git", "-C", args.repo, "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        timeout=_GIT_TIMEOUT_S,
        check=False,
    )
    if top_result.returncode != 0:
        _emit({"ok": False, "error": "git_toplevel_failed"})
        return EXIT_USAGE_ERROR
    top = Path(top_result.stdout.strip())

    status_result = subprocess.run(
        ["git", "-C", args.repo, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        capture_output=True,
        timeout=_GIT_TIMEOUT_S,
        check=False,
    )
    if status_result.returncode != 0:
        _emit({"ok": False, "error": "git_status_failed"})
        return EXIT_USAGE_ERROR

    entries: dict[str, dict] = {}
    for rel in _parse_porcelain_paths(status_result.stdout):
        entries[rel] = _snapshot_path(top, rel)

    out_path = Path(args.out)
    payload = json.dumps({"repo": str(top), "entries": entries})
    # Write through a freshly created temp file (O_EXCL|O_NOFOLLOW rules out both a
    # pre-existing file and a symlink race) then atomically replace --out — os.replace
    # swaps the directory entry itself rather than following an existing symlink there,
    # so a pre-planted symlink at --out is displaced instead of dereferenced.
    tmp_path = out_path.parent / f".{out_path.name}.tmp.{os.getpid()}.{secrets.token_hex(4)}"
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    cwd_lock._write_json_via_fd(fd, tmp_path, payload, replace_to=out_path)
    _emit({"ok": True, "out": str(out_path), "count": len(entries)})
    return EXIT_OK


def cmd_compare_dirty(args: argparse.Namespace) -> int:
    try:
        expected = json.loads(Path(args.expected).read_text()).get("entries", {})
        actual = json.loads(Path(args.actual).read_text()).get("entries", {})
    except (OSError, json.JSONDecodeError):
        _emit({"ok": False, "error": "read_failed"})
        return EXIT_USAGE_ERROR

    added: list[str] = []
    removed: list[str] = []
    changed: list[str] = []
    for key in sorted(set(expected) | set(actual)):
        expected_entry = expected.get(key)
        actual_entry = actual.get(key)
        if expected_entry is None:
            added.append(key)
        elif actual_entry is None:
            removed.append(key)
        elif expected_entry != actual_entry:
            changed.append(key)

    ok = not (added or removed or changed)
    _emit({"ok": ok, "added": added, "removed": removed, "changed": changed})
    return EXIT_OK if ok else EXIT_BLOCKED


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="herdr_isolation", description="Herdr isolation gate helper (stdlib only).")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ancestors = sub.add_parser("ancestors")
    p_ancestors.add_argument("--root", required=True)
    p_ancestors.add_argument("--path", required=True)

    p_verify = sub.add_parser("verify-worktree")
    p_verify.add_argument("--repo", required=True)
    p_verify.add_argument("--path", required=True)

    p_tracked = sub.add_parser("tracked-symlinks")
    p_tracked.add_argument("--worktree", required=True)

    p_dirty = sub.add_parser("dirty-map")
    p_dirty.add_argument("--repo", required=True)
    p_dirty.add_argument("--out", required=True)

    p_compare = sub.add_parser("compare-dirty")
    p_compare.add_argument("--expected", required=True)
    p_compare.add_argument("--actual", required=True)

    cwd_lock.add_subparser(sub)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    try:
        if args.command == "ancestors":
            return cmd_ancestors(args)
        if args.command == "verify-worktree":
            return cmd_verify_worktree(args)
        if args.command == "tracked-symlinks":
            return cmd_tracked_symlinks(args)
        if args.command == "dirty-map":
            return cmd_dirty_map(args)
        if args.command == "compare-dirty":
            return cmd_compare_dirty(args)
        if args.command == "cwd-lock":
            return cwd_lock.dispatch(args)
    except IsolationError as exc:
        _emit({"ok": False, "error": str(exc)})
        return EXIT_USAGE_ERROR
    except (subprocess.TimeoutExpired, OSError) as exc:
        # A slow git probe or a filesystem error still owes the caller one JSON line
        # and exit 2, so the delegation workflow gets a structured BLOCKED reason.
        _emit({"ok": False, "error": f"operational_failure:{type(exc).__name__}:{exc}"})
        return EXIT_USAGE_ERROR
    parser.error(f"unknown command {args.command!r}")
    return EXIT_USAGE_ERROR  # pragma: no cover — argparse.error raises SystemExit


if __name__ == "__main__":
    sys.exit(main())
