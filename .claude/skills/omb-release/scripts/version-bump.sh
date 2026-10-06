#!/usr/bin/env bash
# version-bump.sh — Detect and bump the release version across a repository's
# root-level version-bearing files (pyproject.toml, package.json, Cargo.toml,
# VERSION/version.txt), with mirror rewrites for package-lock.json and the
# README.md shields badge.
#
# Usage: version-bump.sh <repo-root> --detect
#        version-bump.sh <repo-root> --bump <patch|minor|major|X.Y.Z[-pre]> [--sync-workspaces]
#
# Output (always exits 0): a RESULT block of KEY=VALUE lines:
#   RELEASE_VERSION_STATUS=DETECTED|BUMPED|NONE|BLOCKED
#   RELEASE_VERSION_REASON=<reason>        # only when BLOCKED
#   CURRENT_VERSION=X.Y.Z
#   NEW_VERSION=X.Y.Z                      # only when BUMPED
#   VERSION_FILES=path1,path2,...
#
# Root-level detection only: nested/workspace package.json files (e.g.
# apps/web/package.json) are never read as a source and never rewritten
# unless --sync-workspaces is passed. All parsing/rewriting is delegated to a
# single python3 heredoc (see .claude/rules/languages/shell.md — no GNU-only
# flags, no hand-rolled TOML/JSON editing in sed/awk). Reference pattern:
# scripts/release-local.sh.
set -euo pipefail

usage() {
    printf 'Usage: %s <repo-root> --detect\n' "$(basename "$0")" >&2
    printf '       %s <repo-root> --bump <patch|minor|major|X.Y.Z[-pre]> [--sync-workspaces]\n' "$(basename "$0")" >&2
}

command -v python3 >/dev/null 2>&1 || {
    printf 'RELEASE_VERSION_REASON=python3-not-found\n'
    printf 'RELEASE_VERSION_STATUS=BLOCKED\n'
    exit 0
}

REPO_ROOT="${1:-}"
shift || true

if [[ -z "${REPO_ROOT}" ]]; then
    usage
    printf 'RELEASE_VERSION_REASON=missing-repo-root\n'
    printf 'RELEASE_VERSION_STATUS=BLOCKED\n'
    exit 0
fi

MODE=""
BUMP_ARG=""
SYNC_WORKSPACES="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --detect)
            MODE="detect"
            shift
            ;;
        --bump)
            MODE="bump"
            BUMP_ARG="${2:-}"
            shift 2 || shift
            ;;
        --sync-workspaces)
            SYNC_WORKSPACES="1"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ "${MODE}" != "detect" && "${MODE}" != "bump" ]]; then
    usage
    printf 'RELEASE_VERSION_REASON=missing-mode\n'
    printf 'RELEASE_VERSION_STATUS=BLOCKED\n'
    exit 0
fi

if [[ "${MODE}" == "bump" && -z "${BUMP_ARG}" ]]; then
    usage
    printf 'RELEASE_VERSION_REASON=missing-bump-arg\n'
    printf 'RELEASE_VERSION_STATUS=BLOCKED\n'
    exit 0
fi

REPO_ROOT="${REPO_ROOT}" \
MODE="${MODE}" \
BUMP_ARG="${BUMP_ARG}" \
SYNC_WORKSPACES="${SYNC_WORKSPACES}" \
python3 - <<'PYEOF'
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(os.environ["REPO_ROOT"]).resolve()
MODE = os.environ["MODE"]
BUMP_ARG = os.environ.get("BUMP_ARG", "")
SYNC_WORKSPACES = os.environ.get("SYNC_WORKSPACES", "0") == "1"

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
CORE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def emit(status, current_version="", new_version=None, version_files=None, reason=None):
    """Print the RESULT block and exit 0 — the contract is always-exit-0."""
    lines = []
    if reason is not None:
        lines.append(f"RELEASE_VERSION_REASON={reason}")
    lines.append(f"RELEASE_VERSION_STATUS={status}")
    lines.append(f"CURRENT_VERSION={current_version}")
    if new_version is not None:
        lines.append(f"NEW_VERSION={new_version}")
    lines.append(f"VERSION_FILES={','.join(version_files or [])}")
    print("\n".join(lines))
    sys.exit(0)


def extract_section(text, name):
    """Return the text of a TOML table (e.g. "project") up to the next
    top-level "[..." header, or "" if the table is absent."""
    header = re.search(rf"^\[{re.escape(name)}\]\s*$", text, re.M)
    if not header:
        return ""
    start = header.end()
    rest = text[start:]
    next_header = re.search(r"^\[", rest, re.M)
    end = start + next_header.start() if next_header else len(text)
    return text[start:end]


def sub_first(text, pattern, replacement):
    return re.sub(pattern, replacement, text, count=1, flags=re.M)


# ---------------------------------------------------------------------------
# Root-level source discovery. Each entry: version, kind, files (for listing),
# target (the file that actually carries the version string, for rewriting).
# ---------------------------------------------------------------------------

def discover_hatch_dynamic(pyproject_path):
    if not pyproject_path.is_file():
        return None
    text = pyproject_path.read_text()
    if not re.search(r'dynamic\s*=\s*\[\s*"version"\s*\]', text):
        return None
    hatch_match = re.search(r'\[tool\.hatch\.version\]\s*\n\s*path\s*=\s*"([^"]+)"', text)
    if not hatch_match:
        return None
    target = REPO_ROOT / hatch_match.group(1)
    if not target.is_file():
        return None
    version_match = re.search(r'^__version__\s*=\s*"([^"]+)"', target.read_text(), re.M)
    if not version_match:
        return None
    return {
        "version": version_match.group(1),
        "kind": "hatch",
        "label": "pyproject.toml (hatch)",
        "files": [pyproject_path, target],
        "target": target,
    }


def discover_pyproject_static(pyproject_path):
    if not pyproject_path.is_file():
        return None
    text = pyproject_path.read_text()
    section = extract_section(text, "project")
    version_match = re.search(r'^version\s*=\s*"([^"]+)"', section, re.M)
    if not version_match:
        return None
    return {
        "version": version_match.group(1),
        "kind": "pyproject-static",
        "label": "pyproject.toml",
        "files": [pyproject_path],
        "target": pyproject_path,
    }


def discover_root_package_json(package_json_path):
    if not package_json_path.is_file():
        return None
    try:
        data = json.loads(package_json_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    version = data.get("version")
    if not isinstance(version, str) or not SEMVER_RE.match(version):
        return None
    return {
        "version": version,
        "kind": "package-json",
        "label": "package.json",
        "files": [package_json_path],
        "target": package_json_path,
    }


def discover_cargo(cargo_path):
    if not cargo_path.is_file():
        return None
    section = extract_section(cargo_path.read_text(), "package")
    version_match = re.search(r'^version\s*=\s*"([^"]+)"', section, re.M)
    if not version_match:
        return None
    return {
        "version": version_match.group(1),
        "kind": "cargo",
        "label": "Cargo.toml",
        "files": [cargo_path],
        "target": cargo_path,
    }


def discover_generic_version_file(path):
    if not path.is_file():
        return None
    content = path.read_text().strip()
    if not SEMVER_RE.match(content):
        return None
    return {
        "version": content,
        "kind": "generic",
        "label": path.name,
        "files": [path],
        "target": path,
    }


def discover_primary_entries():
    entries = []
    pyproject_path = REPO_ROOT / "pyproject.toml"

    hatch_entry = discover_hatch_dynamic(pyproject_path)
    if hatch_entry:
        entries.append(hatch_entry)
    else:
        static_entry = discover_pyproject_static(pyproject_path)
        if static_entry:
            entries.append(static_entry)

    package_json_entry = discover_root_package_json(REPO_ROOT / "package.json")
    if package_json_entry:
        entries.append(package_json_entry)

    cargo_entry = discover_cargo(REPO_ROOT / "Cargo.toml")
    if cargo_entry:
        entries.append(cargo_entry)

    for name in ("VERSION", "version.txt"):
        generic_entry = discover_generic_version_file(REPO_ROOT / name)
        if generic_entry:
            entries.append(generic_entry)
            break

    return entries


# ---------------------------------------------------------------------------
# Mirrors — rewritten only, never read as a version source.
# ---------------------------------------------------------------------------

def lockfile_path():
    path = REPO_ROOT / "package-lock.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if "version" in data or (
        isinstance(data.get("packages"), dict) and "" in data["packages"]
    ):
        return path
    return None


def readme_badge_path(old_version):
    path = REPO_ROOT / "README.md"
    if not path.is_file():
        return None
    pattern = r"version-" + re.escape(old_version) + r"-[a-zA-Z]+"
    if re.search(pattern, path.read_text()):
        return path
    return None


# ---------------------------------------------------------------------------
# Rewriters (bump mode only).
# ---------------------------------------------------------------------------

def rewrite_pyproject_static(path, old_version, new_version):
    text = path.read_text()
    path.write_text(
        sub_first(text, r'(^version\s*=\s*")' + re.escape(old_version) + r'(")', rf"\g<1>{new_version}\g<2>")
    )


def rewrite_hatch_target(target, old_version, new_version):
    text = target.read_text()
    target.write_text(
        sub_first(text, r'(^__version__\s*=\s*")' + re.escape(old_version) + r'(")', rf"\g<1>{new_version}\g<2>")
    )


def rewrite_package_json(path, new_version):
    data = json.loads(path.read_text())
    data["version"] = new_version
    path.write_text(json.dumps(data, indent=2) + "\n")


def rewrite_cargo(path, old_version, new_version):
    text = path.read_text()
    path.write_text(
        sub_first(text, r'(^version\s*=\s*")' + re.escape(old_version) + r'(")', rf"\g<1>{new_version}\g<2>")
    )


def rewrite_generic_version_file(path, new_version):
    path.write_text(new_version + "\n")


def rewrite_package_lock(path, new_version):
    data = json.loads(path.read_text())
    if "version" in data:
        data["version"] = new_version
    packages = data.get("packages")
    if isinstance(packages, dict) and isinstance(packages.get(""), dict):
        packages[""]["version"] = new_version
    path.write_text(json.dumps(data, indent=2) + "\n")


def rewrite_readme_badge(path, old_version, new_version):
    text = path.read_text()
    pattern = r"(version-)" + re.escape(old_version) + r"(-[a-zA-Z]+)"
    path.write_text(sub_first(text, pattern, rf"\g<1>{new_version}\g<2>"))


def sync_workspace_package_jsons(new_version):
    """--sync-workspaces only: rewrite nested package.json "version" fields."""
    touched = []
    root_package_json = REPO_ROOT / "package.json"
    for candidate in REPO_ROOT.rglob("package.json"):
        if candidate == root_package_json or "node_modules" in candidate.parts:
            continue
        try:
            data = json.loads(candidate.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if "version" not in data:
            continue
        data["version"] = new_version
        candidate.write_text(json.dumps(data, indent=2) + "\n")
        touched.append(candidate)
    return touched


# ---------------------------------------------------------------------------
# Bump-argument resolution.
# ---------------------------------------------------------------------------

def resolve_new_version(current_version, bump_arg):
    if SEMVER_RE.match(bump_arg):
        return bump_arg
    core_match = CORE_RE.match(current_version)
    if not core_match:
        return None
    major, minor, patch = (int(group) for group in core_match.groups())
    if bump_arg == "major":
        return f"{major + 1}.0.0"
    if bump_arg == "minor":
        return f"{major}.{minor + 1}.0"
    if bump_arg == "patch":
        return f"{major}.{minor}.{patch + 1}"
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    entries = discover_primary_entries()

    if not entries:
        emit("NONE", current_version="")

    distinct_versions = sorted({entry["version"] for entry in entries})
    if len(distinct_versions) > 1:
        conflict_desc = ", ".join(f"{entry['label']}={entry['version']}" for entry in entries)
        emit(
            "BLOCKED",
            current_version="",
            reason=f"conflicting root version sources: {conflict_desc}",
        )

    current_version = entries[0]["version"]

    mirror_lockfile = lockfile_path()
    mirror_readme = readme_badge_path(current_version)

    if MODE == "detect":
        version_files = []
        for entry in entries:
            for file_path in entry["files"]:
                version_files.append(str(file_path))
        if mirror_lockfile:
            version_files.append(str(mirror_lockfile))
        if mirror_readme:
            version_files.append(str(mirror_readme))
        emit("DETECTED", current_version=current_version, version_files=version_files)

    # MODE == "bump"
    new_version = resolve_new_version(current_version, BUMP_ARG)
    if new_version is None:
        emit(
            "BLOCKED",
            current_version=current_version,
            reason=f"invalid bump argument: {BUMP_ARG!r}",
        )

    touched = []
    for entry in entries:
        if entry["kind"] == "hatch":
            rewrite_hatch_target(entry["target"], current_version, new_version)
            touched.append(entry["target"])
        elif entry["kind"] == "pyproject-static":
            rewrite_pyproject_static(entry["target"], current_version, new_version)
            touched.append(entry["target"])
        elif entry["kind"] == "package-json":
            rewrite_package_json(entry["target"], new_version)
            touched.append(entry["target"])
        elif entry["kind"] == "cargo":
            rewrite_cargo(entry["target"], current_version, new_version)
            touched.append(entry["target"])
        elif entry["kind"] == "generic":
            rewrite_generic_version_file(entry["target"], new_version)
            touched.append(entry["target"])

    if mirror_lockfile:
        rewrite_package_lock(mirror_lockfile, new_version)
        touched.append(mirror_lockfile)

    if mirror_readme:
        rewrite_readme_badge(mirror_readme, current_version, new_version)
        touched.append(mirror_readme)

    if SYNC_WORKSPACES:
        touched.extend(sync_workspace_package_jsons(new_version))

    emit(
        "BUMPED",
        current_version=current_version,
        new_version=new_version,
        version_files=[str(path) for path in touched],
    )


try:
    main()
except Exception as exc:  # noqa: BLE001 — top-level guard for the always-exit-0 contract
    emit("BLOCKED", current_version="", reason=f"internal-error: {exc}")
PYEOF
