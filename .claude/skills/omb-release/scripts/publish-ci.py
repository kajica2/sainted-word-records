#!/usr/bin/env python3
"""Opt-in CI release ownership and deterministic release-history maintenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path


def load_policy(root: Path) -> dict | None:
    path = root / ".github/omb-release.json"
    if not path.exists():
        return None
    if path.is_symlink():
        raise ValueError("Release policy must not be a symlink")
    policy = json.loads(path.read_text())
    if (
        policy.get("schema_version") != 1
        or policy.get("publish_mode") != "github-actions"
        or not re.fullmatch(r"[A-Za-z0-9_.-]+\.ya?ml", str(policy.get("workflow", "")))
    ):
        raise ValueError("Invalid CI release policy")
    history = policy.get("release_history")
    if history is not None:
        relative = Path(history)
        if relative.is_absolute() or ".." in relative.parts or relative.suffix != ".md":
            raise ValueError("Invalid release history policy path")
        target = root / relative
        if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
            raise ValueError("Release history policy path escapes root")
    return policy


def update_history(root: Path, version: str, notes: str) -> str | None:
    policy = load_policy(root)
    if not policy or not policy.get("release_history"):
        return None
    version = version.removeprefix("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid release version")
    path = root / policy["release_history"]
    content = path.read_text()
    heading = f"## [{version}]"
    if heading in content:
        return policy["release_history"]
    date = datetime.now(UTC).date().isoformat()
    entry = f"{heading} - {date}\n\n{notes.strip()}\n\n"
    marker = "<!-- release-history -->"
    if marker in content:
        content = content.replace(marker, marker + "\n\n" + entry, 1)
    else:
        content = content.rstrip() + "\n\n" + entry
    path.write_text(content)
    return policy["release_history"]


def command(root: Path, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=root, capture_output=True, text=True, check=check, timeout=45)


def publish(root: Path, version: str, notes: Path, assets: list[Path], *, draft=False, prerelease=False) -> dict:
    policy = load_policy(root)
    if not policy:
        raise ValueError("CI publication requires an explicit policy")
    tag = "v" + version.removeprefix("v")
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", tag):
        raise ValueError("Invalid version tag")
    if draft or (prerelease and "-" not in tag):
        raise ValueError("CI release type must be encoded by the version tag; draft publication is CI-owned")
    if not notes.is_file() or not (root / ".github/workflows" / policy["workflow"]).is_file():
        raise ValueError("Missing release notes or configured CI workflow")
    names = set()
    for asset in assets:
        if not asset.is_file() or not re.fullmatch(r"[A-Za-z0-9_.-]+", asset.name) or asset.name in names:
            raise ValueError("Missing, ambiguous or unsafe release asset")
        names.add(asset.name)
    head = command(root, ["git", "rev-parse", "HEAD"]).stdout.strip()
    local = command(root, ["git", "rev-parse", "--verify", "refs/tags/" + tag + "^{commit}"], False)
    if local.returncode == 0 and local.stdout.strip() != head:
        raise ValueError("Existing local tag points to a different commit")
    remote = command(root, ["git", "ls-remote", "origin", "refs/tags/" + tag, "refs/tags/" + tag + "^{}"])
    remote_lines = [line.split() for line in remote.stdout.splitlines() if line.strip()]
    remote_sha = next(
        (sha for sha, ref in remote_lines if ref.endswith("^{}")), remote_lines[0][0] if remote_lines else None
    )
    if remote_sha and remote_sha != head:
        raise ValueError("Existing remote tag points to a different commit")
    journal = root / ".omb/release" / (tag + ".state")
    was_verified = journal.exists() and f"VERIFIED={head}" in journal.read_text()
    journal.parent.mkdir(parents=True, exist_ok=True)

    def record(phase):
        with journal.open("a") as stream:
            stream.write(f"{phase}={head}\n")

    if local.returncode:
        command(root, ["git", "tag", tag, head])
    record("TAG_CREATED")
    if not remote_sha:
        command(root, ["git", "push", "origin", "refs/tags/" + tag])
    record("TAG_PUSHED")
    timeout = max(0, min(7200, int(os.environ.get("OMB_RELEASE_CI_TIMEOUT", "1800"))))
    deadline = time.monotonic() + timeout
    while True:
        process = command(
            root,
            [
                "gh",
                "run",
                "list",
                "--workflow",
                policy["workflow"],
                "--commit",
                head,
                "--event",
                "push",
                "--limit",
                "30",
                "--json",
                "databaseId,headSha,headBranch,event,status,conclusion",
            ],
        )
        runs = json.loads(process.stdout)
        matching = [
            run
            for run in runs
            if run.get("headSha") == head and run.get("headBranch") == tag and run.get("event") == "push"
        ]
        if matching:
            run = max(matching, key=lambda item: item["databaseId"])
            if run["status"] == "completed":
                if run["conclusion"] != "success":
                    raise ValueError(
                        f"Release CI run {run['databaseId']} failed: {run['conclusion']}; no local fallback"
                    )
                break
        if time.monotonic() >= deadline:
            raise ValueError("Exact tag/SHA release workflow is missing or incomplete; resume after CI completes")
        time.sleep(5)
    release = json.loads(
        command(root, ["gh", "release", "view", tag, "--json", "url,isDraft,tagName,assets,body"]).stdout
    )
    if release.get("isDraft") or release.get("tagName") != tag or not release.get("body"):
        raise ValueError("CI did not finish publishing the requested release")
    remote_names = {asset["name"] for asset in release.get("assets", [])}
    if not names <= remote_names:
        raise ValueError("Published release is missing required assets")
    with tempfile.TemporaryDirectory(prefix="omb-release-verify-") as directory:
        for asset in assets:
            command(root, ["gh", "release", "download", tag, "--pattern", asset.name, "--dir", directory])
            downloaded = Path(directory) / asset.name
            if hashlib.sha256(downloaded.read_bytes()).digest() != hashlib.sha256(asset.read_bytes()).digest():
                raise ValueError(f"Published asset digest mismatch: {asset.name}")
    record("RELEASE_CREATED")
    record("ASSETS_UPLOADED")
    record("VERIFIED")
    return {
        "RELEASE_PUBLISH_STATUS": "ALREADY_PUBLISHED" if was_verified else "PUBLISHED",
        "RELEASE_URL": release["url"],
        "UPLOADED_ASSETS": ",".join(sorted(names)),
        "NOTES_APPLIED": "ci-owned",
        "RESUMED_FROM": "TAG_PUSHED" if remote_sha else "-",
    }


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--history":
        parser = argparse.ArgumentParser()
        parser.add_argument("--history", action="store_true")
        parser.add_argument("root", type=Path)
        parser.add_argument("version")
        parser.add_argument("notes", type=Path)
        args = parser.parse_args()
        try:
            notes = args.notes.read_text()
            version = args.version.removeprefix("v")
            section = re.search(r"(?ms)^## \[" + re.escape(version) + r"\][^\n]*\n(.*?)(?=^## |\Z)", notes)
            path = update_history(args.root, args.version, section[1] if section else notes)
            print("RELEASE_HISTORY_STATUS=" + ("UPDATED" if path else "SKIPPED"))
            print("RELEASE_HISTORY_FILE=" + (path or ""))
        except (OSError, ValueError, TypeError) as exc:
            print("RELEASE_HISTORY_STATUS=BLOCKED")
            print("RELEASE_HISTORY_REASON=" + str(exc).replace("\n", " "))
        return
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("version")
    parser.add_argument("notes", type=Path)
    parser.add_argument("--assets", default="")
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--prerelease", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    try:
        result = publish(
            args.root.resolve(),
            args.version,
            args.notes.resolve(),
            [Path(path).resolve() for path in args.assets.split(",") if path],
            draft=args.draft,
            prerelease=args.prerelease,
        )
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        result = {
            "RELEASE_PUBLISH_STATUS": "BLOCKED",
            "RELEASE_PUBLISH_REASON": str(exc).replace("\n", " "),
            "RELEASE_URL": "",
            "UPLOADED_ASSETS": "",
            "NOTES_APPLIED": "-",
            "RESUMED_FROM": "-",
        }
    for key, value in result.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
