"""`cwd-lock` subcommand of `herdr_isolation.py` (stdlib only).

Rename-based mutual exclusion for same-cwd mutating Herdr delegations. See
`.claude/skills/omb-herdr/references/delegation.md` (§2 "Freeze scope and
persist identity", same-cwd mutating-lock paragraphs) for the full contract
this module implements: acquire/bind/release/takeover/status.

`--force release` is authorized by possession of the owner's `nonce` alone —
the nonce is intentionally exposed in every `status`/conflict JSON payload, so
the actual control is the delegation procedure's prose rule that only the
user, never the model on its own judgment, runs that command.

Not intended to be run standalone; imported by `herdr_isolation.py`, which
owns argv parsing dispatch and the shared JSON-emit / exit-code contract
(0 = ok, 3 = blocked/contended, 2 = usage or scan-incomplete error).
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import secrets
import shlex
import stat
import subprocess
import time
from pathlib import Path

EXIT_OK = 0
EXIT_BLOCKED = 3
EXIT_USAGE_ERROR = 2

_HERDR_TIMEOUT_S = 10
_DEFAULT_GRACE_S = 60
_MIN_TAKEOVER_MUTEX_GRACE_S = 5.0
_LOCK_DIR_NAME = "mutating.lock"
_TAKEOVER_MUTEX_NAME = "mutating.lock.takeover"
# Held (flock) across every mutating action; the kernel drops it when the holder dies.
_STATE_GUARD_NAME = "mutating.lock.guard"
# Covers a takeover's two bounded herdr probes.
_STATE_GUARD_WAIT_S = 3 * _HERDR_TIMEOUT_S
_TAKEOVER_TOKEN_FILE = "token"
_OWNER_REQUIRED_KEYS = {"session_id", "caller_pane", "server", "tab_id", "acquired_at", "nonce"}
_OWNER_STR_KEYS = ("session_id", "caller_pane", "nonce")
_OWNER_OPTIONAL_STR_KEYS = ("server", "tab_id")
# Strict Herdr pane/tab id shape: an id read back from owner.json is untrusted local state
# and is passed as `herdr <kind> get <id>` argv — reject anything that does not look like a
# real Herdr id instead of forwarding it to the subprocess call. `fullmatch` (not `.match`
# with a `$`-anchored pattern) so a trailing newline smuggled into owner.json cannot slip
# past the anchor — `$` alone matches just before a trailing "\n".
_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9:_-]*")


def _is_valid_id(value: str) -> bool:
    return bool(_ID_PATTERN.fullmatch(value))


class CwdLockError(Exception):
    """Records-dir or lock-file corruption; the caller treats this as exit 2."""


def _emit(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True))


def release_command(nonce: str, origin_cwd: str) -> str:
    """The operator-facing force-release command embedded in every 3-JSON.

    Both values are shell-quoted: the operator pastes this into a shell, and a
    checkout path may contain spaces or metacharacters.
    """
    return f"cwd-lock release --force --owner-nonce {shlex.quote(nonce)} --origin-cwd {shlex.quote(origin_cwd)}"


def current_server() -> str | None:
    value = os.environ.get("HERDR_SOCKET_PATH")
    if not value:
        return None
    return os.path.realpath(value)


# --------------------------------------------------------------------------
# records dir + lock file access (symlink-safe)
# --------------------------------------------------------------------------


def _reject_symlinked_component(path: Path) -> None:
    try:
        entry_stat = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISLNK(entry_stat.st_mode):
        raise CwdLockError(f"symlinked_component:{path.name}")
    if not stat.S_ISDIR(entry_stat.st_mode):
        raise CwdLockError(f"not_directory:{path.name}")


def _records_dir(origin_cwd: str) -> Path:
    origin = Path(os.path.realpath(origin_cwd))
    omb_dir = origin / ".omb"
    _reject_symlinked_component(omb_dir)
    if not omb_dir.exists():
        try:
            omb_dir.mkdir(mode=0o700)
            os.chmod(omb_dir, 0o700)
        except OSError as exc:
            raise CwdLockError(f"records_dir_create_failed:{exc}") from exc
    herdr_dir = omb_dir / "herdr"
    _reject_symlinked_component(herdr_dir)
    if not herdr_dir.exists():
        try:
            herdr_dir.mkdir(mode=0o700)
            os.chmod(herdr_dir, 0o700)
        except OSError as exc:
            raise CwdLockError(f"records_dir_create_failed:{exc}") from exc
    return herdr_dir


def _read_lock_owner(lock_dir: Path) -> dict | None:
    """None means "no lock held". Any corruption raises CwdLockError."""
    try:
        dir_stat = lock_dir.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISDIR(dir_stat.st_mode):
        raise CwdLockError(f"lock_dir_not_directory:{lock_dir.name}")

    owner_path = lock_dir / "owner.json"
    try:
        fd = os.open(str(owner_path), os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise CwdLockError(f"owner_read_failed:{exc}") from exc
    try:
        file_stat = os.fstat(fd)
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_uid != os.getuid():
            raise CwdLockError("owner_invalid")
        raw = b""
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            raw += chunk
    finally:
        os.close(fd)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CwdLockError(f"owner_malformed:{exc}") from exc
    if not isinstance(parsed, dict):
        raise CwdLockError("owner_malformed:not_a_dict")
    missing = _OWNER_REQUIRED_KEYS - parsed.keys()
    if missing:
        raise CwdLockError(f"owner_malformed:missing_keys:{','.join(sorted(missing))}")
    _validate_owner_types(parsed)
    return parsed


def _validate_owner_types(parsed: dict) -> None:
    """owner.json is untrusted local state — a value with the right keys but the
    wrong type (e.g. a numeric `caller_pane`, or a bool `acquired_at`) must not
    reach comparisons or the `herdr ... get <id>` subprocess call downstream."""
    for key in _OWNER_STR_KEYS:
        if not isinstance(parsed[key], str):
            raise CwdLockError(f"owner_malformed:bad_type:{key}")
    for key in _OWNER_OPTIONAL_STR_KEYS:
        value = parsed[key]
        if value is not None and not isinstance(value, str):
            raise CwdLockError(f"owner_malformed:bad_type:{key}")
    acquired_at = parsed["acquired_at"]
    # bool is an int subclass in Python — exclude it explicitly, or True/False would
    # silently pass an "is a number" check.
    if isinstance(acquired_at, bool) or not isinstance(acquired_at, (int, float)):
        raise CwdLockError("owner_malformed:bad_type:acquired_at")


def _write_json_via_fd(fd: int, tmp_or_target_path: Path, payload: str, replace_to: Path | None = None) -> None:
    """Write `payload` through the already-open `fd` at `tmp_or_target_path`, then
    optionally `os.replace` it into place at `replace_to`.

    On any failure — write or replace — `tmp_or_target_path` is removed. The fd is
    closed exactly once: via the file object's own close once `os.fdopen` succeeds
    (re-closing it here on top of that would raise EBADF and mask the real error),
    or directly if `os.fdopen` itself never returned one.
    """
    try:
        handle = os.fdopen(fd, "w")
    except OSError:
        os.close(fd)
        raise
    try:
        with handle:
            handle.write(payload)
        if replace_to is not None:
            os.replace(str(tmp_or_target_path), str(replace_to))
    except Exception:
        with contextlib.suppress(OSError):
            tmp_or_target_path.unlink()
        raise


def _write_owner_into(dir_path: Path, owner: dict) -> None:
    owner_path = dir_path / "owner.json"
    fd = os.open(str(owner_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    _write_json_via_fd(fd, owner_path, json.dumps(owner))


def _replace_owner(lock_dir: Path, owner: dict) -> None:
    tmp_path = lock_dir / f".owner.json.tmp.{os.getpid()}.{secrets.token_hex(4)}"
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    _write_json_via_fd(fd, tmp_path, json.dumps(owner), replace_to=lock_dir / "owner.json")


def _write_takeover_token(mutex_dir: Path, token: str) -> None:
    token_path = mutex_dir / _TAKEOVER_TOKEN_FILE
    fd = os.open(str(token_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    _write_json_via_fd(fd, token_path, token)


def _make_temp_lock_dir(records_dir: Path) -> Path:
    tmp = records_dir / f".mutating.lock.{os.getpid()}.{secrets.token_hex(4)}"
    tmp.mkdir(mode=0o700)
    return tmp


def _new_owner(session_id: str, caller_pane: str, tab_id: str | None = None) -> dict:
    return {
        "session_id": session_id,
        "caller_pane": caller_pane,
        "server": current_server(),
        "tab_id": tab_id,
        "acquired_at": time.time(),
        "nonce": secrets.token_hex(16),
    }


def _conflict_payload(owner: dict, origin_cwd: str, **extra: object) -> dict:
    payload = {
        "acquired": False,
        "owner": owner,
        "release_command": release_command(owner["nonce"], origin_cwd),
    }
    payload.update(extra)
    return payload


# --------------------------------------------------------------------------
# herdr liveness probe
# --------------------------------------------------------------------------


def _herdr_probe(kind: str, identifier: str) -> str:
    """Return "gone" only on a verified `pane_not_found`/`tab_not_found`."""
    try:
        result = subprocess.run(
            ["herdr", kind, "get", identifier],
            capture_output=True,
            text=True,
            timeout=_HERDR_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "alive_or_unknown"
    if result.returncode == 0:
        return "alive_or_unknown"
    raw = result.stderr if result.stderr.strip() else result.stdout
    try:
        body = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return "alive_or_unknown"
    code = body.get("error", {}).get("code")
    if code in ("pane_not_found", "tab_not_found"):
        return "gone"
    return "alive_or_unknown"


# --------------------------------------------------------------------------
# acquire / bind / release / takeover / status
# --------------------------------------------------------------------------


@contextlib.contextmanager
def _state_guard(origin_cwd: str):
    """Serialize acquire/bind/release/takeover for one cwd.

    Owner verification and the rename that removes or installs the lock must not
    interleave with another mutation: a release that read owner A could otherwise
    rename away a lock C acquired in between, letting D acquire alongside C.
    """
    path = _records_dir(origin_cwd) / _STATE_GUARD_NAME
    try:
        fd = os.open(str(path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    except OSError as exc:
        raise CwdLockError(f"state_guard_open_failed:{exc}") from exc
    try:
        deadline = time.monotonic() + _STATE_GUARD_WAIT_S
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise CwdLockError("state_guard_busy") from None
                time.sleep(0.05)
        yield
    finally:
        os.close(fd)


def _acquire(args: argparse.Namespace) -> int:
    records_dir = _records_dir(args.origin_cwd)
    lock_dir = records_dir / _LOCK_DIR_NAME
    owner = _new_owner(args.session, args.caller_pane)
    tmp = _make_temp_lock_dir(records_dir)
    _write_owner_into(tmp, owner)
    try:
        os.rename(str(tmp), str(lock_dir))
    except OSError:
        # Someone else already holds the lock — clean up our temp dir and inspect theirs.
        import shutil

        shutil.rmtree(str(tmp), ignore_errors=True)
        current = _read_lock_owner(lock_dir)
        if current is None:
            # The competing lock vanished between our failed rename and this read;
            # nothing more to reconcile here — report contention and let the caller retry.
            _emit({"acquired": False})
            return EXIT_BLOCKED
        if current["session_id"] == args.session and current["caller_pane"] == args.caller_pane:
            _emit({"acquired": True, "reentered": True, "nonce": current["nonce"]})
            return EXIT_OK
        _emit(_conflict_payload(current, args.origin_cwd))
        return EXIT_BLOCKED
    _emit({"acquired": True, "nonce": owner["nonce"]})
    return EXIT_OK


def _bind(args: argparse.Namespace) -> int:
    records_dir = _records_dir(args.origin_cwd)
    lock_dir = records_dir / _LOCK_DIR_NAME
    owner = _read_lock_owner(lock_dir)
    if owner is None or owner["session_id"] != args.session:
        _emit({"bound": False})
        return EXIT_BLOCKED
    owner = dict(owner)
    owner["tab_id"] = args.tab
    _replace_owner(lock_dir, owner)
    _emit({"bound": True, "tab_id": args.tab})
    return EXIT_OK


def _release(args: argparse.Namespace) -> int:
    records_dir = _records_dir(args.origin_cwd)
    lock_dir = records_dir / _LOCK_DIR_NAME
    owner = _read_lock_owner(lock_dir)
    if owner is None:
        _emit({"released": True, "note": "no_lock"})
        return EXIT_OK

    authorized = (not args.force and owner["session_id"] == args.session) or (
        args.force and owner["nonce"] == args.owner_nonce
    )
    if not authorized:
        _emit(_conflict_payload(owner, args.origin_cwd))
        return EXIT_BLOCKED

    captured_nonce = owner["nonce"]
    tombstone = records_dir / f".mutating.lock.released.{secrets.token_hex(4)}"
    try:
        os.rename(str(lock_dir), str(tombstone))
    except FileNotFoundError:
        _emit({"released": True, "note": "already_released"})
        return EXIT_OK
    except OSError as exc:
        raise CwdLockError(f"release_rename_failed:{exc}") from exc

    tombstone_owner = _read_lock_owner(tombstone)
    if tombstone_owner is not None and tombstone_owner["nonce"] == captured_nonce:
        import shutil

        shutil.rmtree(str(tombstone), ignore_errors=True)
        _emit({"released": True})
        return EXIT_OK

    # The lock changed between our rename and this re-read (a takeover or a
    # concurrent re-acquire raced us) — restore it rather than discard someone
    # else's live lock.
    try:
        os.rename(str(tombstone), str(lock_dir))
    except OSError:
        _emit({"released": False, "reason": "tombstone_orphaned", "tombstone": str(tombstone)})
        return EXIT_USAGE_ERROR
    _emit({"released": False, "restored": True})
    return EXIT_BLOCKED


def _takeover(args: argparse.Namespace) -> int:
    records_dir = _records_dir(args.origin_cwd)
    lock_dir = records_dir / _LOCK_DIR_NAME
    owner = _read_lock_owner(lock_dir)
    if owner is None:
        _emit({"acquired": False, "reason": "no_lock"})
        return EXIT_BLOCKED

    taker_server = current_server()
    owner_server = owner.get("server")
    if not owner_server or not taker_server or owner_server != taker_server:
        _emit(_conflict_payload(owner, args.origin_cwd, reason="foreign_or_unknown_server"))
        return EXIT_BLOCKED

    mutex_dir = records_dir / _TAKEOVER_MUTEX_NAME
    token = _claim_takeover_mutex(mutex_dir, args.grace_s)
    if token is None:
        _emit(_conflict_payload(owner, args.origin_cwd, reason="takeover_in_progress"))
        return EXIT_BLOCKED

    try:
        return _takeover_locked(args, records_dir, lock_dir, owner)
    finally:
        _release_takeover_mutex(mutex_dir, token)


def _claim_takeover_mutex(mutex_dir: Path, grace_s: float) -> str | None:
    """Create the takeover mutex dir, reclaiming one left behind by a process that
    crashed between mkdir and rmdir. A mutex older than max(grace_s, 5s) (by lstat
    mtime) is replaced atomically: rename it out of the way to a tombstone, then
    mkdir fresh — only the process whose rename actually moved the directory wins
    the claim. `grace_s` is clamped to a 5s floor so `--grace-s 0` cannot make a
    live mutex immediately reclaimable.

    On a successful claim, writes a unique ownership token into the mutex and
    returns it; the caller must pass that exact token to `_release_takeover_mutex`
    so a holder whose release is delayed can never delete a mutex a second process
    has since reclaimed. Returns None when the mutex is already held by someone
    else."""
    grace_s = max(grace_s, _MIN_TAKEOVER_MUTEX_GRACE_S)
    token = secrets.token_hex(16)
    try:
        mutex_dir.mkdir(mode=0o700)
        _write_takeover_token(mutex_dir, token)
        return token
    except FileExistsError:
        pass
    try:
        mutex_stat = mutex_dir.lstat()
    except FileNotFoundError:
        # Vanished between our failed mkdir and this lstat — one more try.
        try:
            mutex_dir.mkdir(mode=0o700)
            _write_takeover_token(mutex_dir, token)
            return token
        except FileExistsError:
            return None
    if not stat.S_ISDIR(mutex_stat.st_mode) or time.time() - mutex_stat.st_mtime <= grace_s:
        return None
    tombstone = mutex_dir.parent / f".{_TAKEOVER_MUTEX_NAME}.stale.{os.getpid()}.{secrets.token_hex(4)}"
    try:
        os.rename(str(mutex_dir), str(tombstone))
    except OSError:
        # Someone else already reclaimed or is holding it — not our win.
        return None

    import shutil

    shutil.rmtree(str(tombstone), ignore_errors=True)
    try:
        mutex_dir.mkdir(mode=0o700)
        _write_takeover_token(mutex_dir, token)
        return token
    except FileExistsError:
        return None


def _release_takeover_mutex(mutex_dir: Path, token: str) -> None:
    """Release the takeover mutex only if `token` still matches the token most
    recently written into it by `_claim_takeover_mutex` — a holder whose release
    is delayed past a reclaim must never delete the reclaimer's live mutex."""
    tombstone = mutex_dir.parent / f".{_TAKEOVER_MUTEX_NAME}.release.{os.getpid()}.{secrets.token_hex(4)}"
    try:
        os.rename(str(mutex_dir), str(tombstone))
    except OSError:
        return  # already gone — released, or reclaimed and moved away — nothing to do

    current_token = None
    with contextlib.suppress(OSError, UnicodeDecodeError):
        current_token = (tombstone / _TAKEOVER_TOKEN_FILE).read_text(encoding="utf-8")

    if current_token == token:
        import shutil

        shutil.rmtree(str(tombstone), ignore_errors=True)
        return

    # Not ours — restore it as the live mutex rather than discard someone else's
    # claim. If the restore itself races (e.g. the reclaimer already recreated the
    # mutex at that path), leave the tombstone in place; a future reclaim, once it
    # ages past the grace floor, will clean it up.
    with contextlib.suppress(OSError):
        os.rename(str(tombstone), str(mutex_dir))


def _takeover_locked(args: argparse.Namespace, records_dir: Path, lock_dir: Path, owner: dict) -> int:
    stale = _is_stale(args, owner)
    if not stale:
        _emit(_conflict_payload(owner, args.origin_cwd, reason="not_stale"))
        return EXIT_BLOCKED

    captured_nonce = owner["nonce"]
    tombstone = records_dir / f".mutating.lock.released.{secrets.token_hex(4)}"
    try:
        os.rename(str(lock_dir), str(tombstone))
    except OSError:
        _emit({"acquired": False, "reason": "race_lost"})
        return EXIT_BLOCKED

    tombstone_owner = _read_lock_owner(tombstone)
    if tombstone_owner is None or tombstone_owner["nonce"] != captured_nonce:
        try:
            os.rename(str(tombstone), str(lock_dir))
        except OSError as exc:
            raise CwdLockError(f"takeover_tombstone_orphaned:{exc}") from exc
        _emit({"acquired": False, "restored": True})
        return EXIT_BLOCKED

    import shutil

    shutil.rmtree(str(tombstone), ignore_errors=True)
    new_owner = _new_owner(args.session, args.caller_pane)
    tmp = _make_temp_lock_dir(records_dir)
    _write_owner_into(tmp, new_owner)
    try:
        os.rename(str(tmp), str(lock_dir))
    except OSError:
        shutil.rmtree(str(tmp), ignore_errors=True)
        current = _read_lock_owner(lock_dir)
        if current is not None:
            _emit(_conflict_payload(current, args.origin_cwd, reason="race_lost"))
        else:
            _emit({"acquired": False, "reason": "race_lost"})
        return EXIT_BLOCKED

    _emit({"acquired": True, "nonce": new_owner["nonce"]})
    return EXIT_OK


def _is_stale(args: argparse.Namespace, owner: dict) -> bool:
    if owner["nonce"] != args.stale_nonce:
        return False
    if time.time() - owner["acquired_at"] <= args.grace_s:
        return False
    caller_pane = owner["caller_pane"]
    if _is_valid_id(caller_pane) and _herdr_probe("pane", caller_pane) == "gone":
        return True
    tab_id = owner.get("tab_id")
    if tab_id is None or not _is_valid_id(tab_id):
        return False
    return _herdr_probe("tab", tab_id) == "gone"


def _status(args: argparse.Namespace) -> int:
    records_dir = _records_dir(args.origin_cwd)
    owner = _read_lock_owner(records_dir / _LOCK_DIR_NAME)
    if owner is None:
        _emit({"held": False})
        return EXIT_OK
    _emit({"held": True, "owner": owner})
    return EXIT_OK


# --------------------------------------------------------------------------
# argparse wiring
# --------------------------------------------------------------------------


def add_subparser(sub: argparse._SubParsersAction) -> None:
    parser = sub.add_parser("cwd-lock")
    actions = parser.add_subparsers(dest="action", required=True)

    p_acquire = actions.add_parser("acquire")
    p_acquire.add_argument("--origin-cwd", required=True)
    p_acquire.add_argument("--session", required=True)
    p_acquire.add_argument("--caller-pane", required=True)

    p_bind = actions.add_parser("bind")
    p_bind.add_argument("--origin-cwd", required=True)
    p_bind.add_argument("--session", required=True)
    p_bind.add_argument("--tab", required=True)

    p_release = actions.add_parser("release")
    p_release.add_argument("--origin-cwd", required=True)
    p_release.add_argument("--session", default=None)
    p_release.add_argument("--force", action="store_true")
    p_release.add_argument("--owner-nonce", default=None)

    p_takeover = actions.add_parser("takeover")
    p_takeover.add_argument("--origin-cwd", required=True)
    p_takeover.add_argument("--session", required=True)
    p_takeover.add_argument("--caller-pane", required=True)
    p_takeover.add_argument("--stale-nonce", required=True)
    p_takeover.add_argument("--grace-s", type=float, default=_DEFAULT_GRACE_S)

    p_status = actions.add_parser("status")
    p_status.add_argument("--origin-cwd", required=True)


def dispatch(args: argparse.Namespace) -> int:
    if args.action == "release" and not args.force and not args.session:
        _emit({"ok": False, "error": "release_requires_session_or_force"})
        return EXIT_USAGE_ERROR
    if args.action == "release" and args.force and not args.owner_nonce:
        _emit({"ok": False, "error": "force_release_requires_owner_nonce"})
        return EXIT_USAGE_ERROR
    mutations = {"acquire": _acquire, "bind": _bind, "release": _release, "takeover": _takeover}
    try:
        if args.action in mutations:
            with _state_guard(args.origin_cwd):
                return mutations[args.action](args)
        if args.action == "status":
            return _status(args)
    except CwdLockError as exc:
        _emit({"ok": False, "error": str(exc)})
        return EXIT_USAGE_ERROR
    _emit({"ok": False, "error": f"unknown_action:{args.action}"})
    return EXIT_USAGE_ERROR
