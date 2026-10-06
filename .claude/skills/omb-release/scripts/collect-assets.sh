#!/usr/bin/env bash
# collect-assets.sh — Build (optional) and collect release artifacts into a
# clean per-version output directory, hashing each artifact and validating
# that no artifact escapes the output directory via a symlink.
#
# Usage: collect-assets.sh <repo-root> <version> [--build-cmd "<cmd>"] [--no-build]
#
# Output (always exits 0): a RESULT block of KEY=VALUE lines:
#   RELEASE_ASSETS_STATUS=COLLECTED|EMPTY|BLOCKED
#   RELEASE_ASSETS_REASON=<reason>         # only when BLOCKED
#   OUTPUT_DIR=<abs path>
#   SOURCE_SHA=<40-char sha>
#   BUILD_CMD=<exact command run, or ->
#   ASSETS=path1,path2,...
#
# The output directory <repo-root>/.omb/release/dist/<version>/ is emptied
# before each run (no stale artifact can leak into a release). When
# --build-cmd is given, the build subprocess receives the output dir both as
# $OMB_RELEASE_OUTPUT_DIR and as its final positional argument (matching
# scripts/build-harness-tarball.sh's `<output-dir> [version-label]` contract),
# and runs with GH_*/GITHUB_* env vars scrubbed (all GitHub operations in this
# skill go through `gh`, which uses its own stored credentials). Every
# collected artifact must be a regular file resolving inside the output dir —
# symlinks (especially escaping ones) are BLOCKED. All parsing, hashing, and
# validation is delegated to a single python3 heredoc (see
# .claude/rules/languages/shell.md — no GNU-only flags, no hand-rolled
# path/hash logic in sed/awk). Reference pattern: version-bump.sh (sibling
# script in this skill).
set -euo pipefail

usage() {
    printf 'Usage: %s <repo-root> <version> [--build-cmd "<cmd>"] [--no-build]\n' "$(basename "$0")" >&2
}

command -v python3 >/dev/null 2>&1 || {
    printf 'RELEASE_ASSETS_REASON=python3-not-found\n'
    printf 'RELEASE_ASSETS_STATUS=BLOCKED\n'
    exit 0
}

REPO_ROOT="${1:-}"
VERSION="${2:-}"
shift 2 || true

if [[ -z "${REPO_ROOT}" || -z "${VERSION}" ]]; then
    usage
    printf 'RELEASE_ASSETS_REASON=missing-repo-root-or-version\n'
    printf 'RELEASE_ASSETS_STATUS=BLOCKED\n'
    exit 0
fi

# Gate: <version> must be a bare semver, optionally "v"-prefixed (same
# grammar as version-bump.sh's SEMVER_RE). This is checked BEFORE VERSION is
# ever used to build a filesystem path — an absolute path or a "../" segment
# in VERSION would otherwise let pathlib's `/` operator replace or escape the
# release dist prefix, reaching an unrelated directory in shutil.rmtree.
SEMVER_PATTERN='^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
if [[ ! "${VERSION}" =~ ${SEMVER_PATTERN} ]]; then
    printf 'RELEASE_ASSETS_REASON=invalid-version: %s (expected semver, optionally v-prefixed)\n' "${VERSION}"
    printf 'RELEASE_ASSETS_STATUS=BLOCKED\n'
    exit 0
fi

BUILD_CMD=""
NO_BUILD="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build-cmd)
            BUILD_CMD="${2:-}"
            shift 2 || shift
            ;;
        --no-build)
            NO_BUILD="1"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ "${NO_BUILD}" == "1" ]]; then
    BUILD_CMD=""
fi

REPO_ROOT="${REPO_ROOT}" \
VERSION="${VERSION}" \
BUILD_CMD="${BUILD_CMD}" \
NO_BUILD="${NO_BUILD}" \
python3 - <<'PYEOF'
import hashlib
import os
import shlex
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(os.environ["REPO_ROOT"]).resolve()
VERSION = os.environ["VERSION"]
BUILD_CMD = os.environ.get("BUILD_CMD", "")
NO_BUILD = os.environ.get("NO_BUILD", "0") == "1"

DIST_ROOT = REPO_ROOT / ".omb" / "release" / "dist"
OUTPUT_DIR = DIST_ROOT / VERSION
MANIFEST_NAME = ".omb-build-manifest"


def emit(status, output_dir="", source_sha="", build_cmd="-", assets=None, reason=None):
    """Print the RESULT block and exit 0 — the contract is always-exit-0."""
    lines = []
    if reason is not None:
        lines.append(f"RELEASE_ASSETS_REASON={reason}")
    lines.append(f"RELEASE_ASSETS_STATUS={status}")
    lines.append(f"OUTPUT_DIR={output_dir}")
    lines.append(f"SOURCE_SHA={source_sha}")
    lines.append(f"BUILD_CMD={build_cmd}")
    lines.append(f"ASSETS={','.join(assets or [])}")
    print("\n".join(lines))
    sys.exit(0)


def source_sha():
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def scrubbed_build_env():
    """Copy the parent environment, dropping every GH_*/GITHUB_* var so a
    build command cannot read a GH_TOKEN/GITHUB_TOKEN this skill holds (all
    GitHub operations here go through `gh`'s own stored credentials, never an
    env var). This is a narrow guarantee: it does not sandbox the build
    command's filesystem access, and unrelated ambient credentials reachable
    through other env vars (e.g. HOME, XDG_CONFIG_HOME) still pass through —
    --build-cmd is operator-supplied, so broader sandboxing is out of scope."""
    return {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GH_") and not key.startswith("GITHUB_")
    }


def run_build(build_cmd, output_dir):
    args = shlex.split(build_cmd) + [str(output_dir)]
    env = scrubbed_build_env()
    env["OMB_RELEASE_OUTPUT_DIR"] = str(output_dir)
    return subprocess.run(args, cwd=REPO_ROOT, env=env, capture_output=True, text=True, check=False)


def collect_and_validate(output_dir):
    """Return (assets, blocked_reason). Assets are paths relative to
    output_dir for regular, non-sidecar files that resolve inside it."""
    assets = []
    output_real = Path(os.path.realpath(output_dir))
    for entry in sorted(output_dir.rglob("*")):
        if entry.is_dir():
            continue
        if entry.suffix == ".sha256":
            continue
        rel = entry.relative_to(output_dir)
        if str(rel) == MANIFEST_NAME:
            continue
        if entry.is_symlink():
            return None, f"symlink artifact not allowed: {rel}"
        if not entry.is_file():
            return None, f"non-regular-file artifact not allowed: {rel}"
        real = Path(os.path.realpath(entry))
        if output_real not in real.parents and real != output_real:
            return None, f"artifact escapes output dir: {rel}"
        assets.append(str(rel))
    return assets, None


def sha256_of(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_sha256_sidecars(output_dir, assets):
    for rel in assets:
        target = output_dir / rel
        digest = sha256_of(target)
        sidecar = target.with_name(target.name + ".sha256")
        sidecar.write_text(f"{digest}  {target.name}\n")


def write_build_manifest(output_dir, sha, build_cmd, assets):
    """Bind the collected assets to the exact commit and command that built
    them, so a later --no-build run can prove the artifacts are not stale."""
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [f"SOURCE_SHA={sha}", f"BUILD_CMD={build_cmd}", f"BUILT_AT={built_at}"]
    for rel in assets:
        lines.append(f"{sha256_of(output_dir / rel)}  {rel}")
    (output_dir / MANIFEST_NAME).write_text("\n".join(lines) + "\n")


def validate_manifest_for_no_build(output_dir, assets, current_sha):
    """Return a blocked_reason (or None) proving --no-build's existing
    artifacts came from this exact commit and are unmodified since."""
    manifest_path = output_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return f"missing provenance manifest ({MANIFEST_NAME}) — cannot verify existing artifacts are not stale"

    recorded_sha = None
    recorded_digests = {}
    for line in manifest_path.read_text().splitlines():
        if line.startswith("SOURCE_SHA="):
            recorded_sha = line[len("SOURCE_SHA=") :]
        elif line.startswith("BUILD_CMD=") or line.startswith("BUILT_AT="):
            continue
        elif line.strip():
            parts = line.split(None, 1)
            if len(parts) == 2:
                digest, relpath = parts
                recorded_digests[relpath] = digest

    if recorded_sha != current_sha:
        return (
            f"provenance manifest SOURCE_SHA ({recorded_sha}) does not match current HEAD "
            f"({current_sha}) — artifacts are stale"
        )

    for rel in assets:
        expected = recorded_digests.get(rel)
        if expected is None:
            return f"provenance manifest missing digest for asset: {rel}"
        actual = sha256_of(output_dir / rel)
        if expected != actual:
            return f"provenance manifest digest mismatch for asset {rel} — file changed since manifest was written"

    return None


def main():
    sha = source_sha()
    build_cmd_reported = "-"

    if BUILD_CMD:
        # Defense in depth: independently re-assert OUTPUT_DIR resolves
        # inside the release dist root immediately before the rmtree below.
        # The bash-level semver gate is the real control; this is the
        # second, unconditional layer against the exact class of bug this
        # guards (an unvalidated VERSION reaching an arbitrary-directory
        # delete via pathlib's "/" operator).
        if not OUTPUT_DIR.resolve().is_relative_to(DIST_ROOT.resolve()):
            raise RuntimeError(f"OUTPUT_DIR escapes release dist root: {OUTPUT_DIR}")
        # Start from a clean output dir only when actually building — no
        # stale artifact from a prior run can leak into a fresh build.
        if OUTPUT_DIR.exists():
            shutil.rmtree(OUTPUT_DIR)
        OUTPUT_DIR.mkdir(parents=True)
        result = run_build(BUILD_CMD, OUTPUT_DIR)
        build_cmd_reported = f"{BUILD_CMD} {OUTPUT_DIR}"
        if result.returncode != 0:
            emit(
                "BLOCKED",
                output_dir=str(OUTPUT_DIR),
                source_sha=sha,
                build_cmd=build_cmd_reported,
                reason=f"build command failed (exit {result.returncode}): {result.stderr.strip()[:200]}",
            )
    elif not OUTPUT_DIR.exists():
        OUTPUT_DIR.mkdir(parents=True)

    assets, blocked_reason = collect_and_validate(OUTPUT_DIR)
    if blocked_reason is not None:
        emit(
            "BLOCKED",
            output_dir=str(OUTPUT_DIR),
            source_sha=sha,
            build_cmd=build_cmd_reported,
            reason=blocked_reason,
        )

    if not assets:
        emit("EMPTY", output_dir=str(OUTPUT_DIR), source_sha=sha, build_cmd=build_cmd_reported, assets=[])

    if NO_BUILD:
        # --no-build trusts artifacts it did not just produce — require
        # proof they came from this exact commit and are unmodified since,
        # or BLOCK (unknown provenance is exactly the stale-artifact case).
        manifest_reason = validate_manifest_for_no_build(OUTPUT_DIR, assets, sha)
        if manifest_reason is not None:
            emit(
                "BLOCKED",
                output_dir=str(OUTPUT_DIR),
                source_sha=sha,
                build_cmd=build_cmd_reported,
                reason=manifest_reason,
            )

    write_sha256_sidecars(OUTPUT_DIR, assets)
    if BUILD_CMD:
        write_build_manifest(OUTPUT_DIR, sha, build_cmd_reported, assets)
    emit(
        "COLLECTED",
        output_dir=str(OUTPUT_DIR),
        source_sha=sha,
        build_cmd=build_cmd_reported,
        assets=assets,
    )


try:
    main()
except Exception as exc:  # noqa: BLE001 — top-level guard for the always-exit-0 contract
    emit("BLOCKED", output_dir=str(OUTPUT_DIR), reason=f"internal-error: {exc}")
PYEOF
