#!/usr/bin/env bash
# publish.sh — Publish a GitHub release for <version>: create + push the git
# tag, create the GitHub release via `gh`, upload assets, and verify — safely
# resumable via a phase journal at <repo-root>/.omb/release/<version>.state.
#
# Usage: publish.sh <repo-root> <version> <notes-file> [--assets a,b,c] [--draft] [--prerelease] [--resume]
#
# Output (always exits 0): a RESULT block of KEY=VALUE lines:
#   RELEASE_PUBLISH_STATUS=PUBLISHED|ALREADY_PUBLISHED|RESUMED|BLOCKED
#   RELEASE_PUBLISH_REASON=<reason>        # only when BLOCKED
#   RELEASE_URL=<url>
#   UPLOADED_ASSETS=a,b,c
#   NOTES_APPLIED=created|overwritten|unchanged|ci-owned|-
#   RESUMED_FROM=<phase or ->
#
# Phase sequence: create tag -> push tag -> `gh release create` -> upload
# assets -> verify. Each completed phase is appended to the journal as
# PHASE=<sha> so a later run (--resume) can skip already-completed work
# instead of retrying it. Collision checks are resume points, not dead
# ends: a local tag already at HEAD is reused, a pushed tag is not
# re-pushed, an existing release is not re-created, and only the assets
# still missing from the release are uploaded.
#
# Release body: <notes-file> is authoritative. An existing release's body is
# deliberately overwritten via `gh release edit` when it differs, because a
# repository whose CI reacts to `push: tags:` with
# `gh release create --generate-notes` wins the race against this script's
# release phase — without the overwrite the published release would carry
# GitHub's one-line auto-generated changelog instead of the rendered notes.
# Identical bodies are left alone, so re-runs perform no write.
#
# Safety invariants: never `git push --force`; never delete or move an
# existing tag, and never delete or re-create an existing release (its body
# is updated in place, per the paragraph above); every GitHub call goes through `gh`
# (no curl, no GH_TOKEN/GITHUB_TOKEN handling — gh uses its own stored
# credentials). See .claude/rules/languages/shell.md for the portability
# rules this script follows. Reference pattern: version-bump.sh (sibling
# script in this skill) for the RESULT-emission idiom and helper structure.
set -Eeuo pipefail

usage() {
    printf 'Usage: %s <repo-root> <version> <notes-file> [--assets a,b,c] [--draft] [--prerelease] [--resume]\n' "$(basename "$0")" >&2
}

# What happened to the release body. Read by `emit` as a global rather than
# passed as a 6th argument, so the ~20 early BLOCKED call sites (which run
# long before the release phase) need no change and report the "-" default.
NOTES_APPLIED="-"

# Prints the RESULT block and exits 0 — the contract is always-exit-0.
emit() {
    local status="$1" reason="$2" url="$3" uploaded="$4" resumed_from="$5"
    if [[ -n "$reason" ]]; then
        printf 'RELEASE_PUBLISH_REASON=%s\n' "$reason"
    fi
    printf 'RELEASE_PUBLISH_STATUS=%s\n' "$status"
    printf 'RELEASE_URL=%s\n' "$url"
    printf 'UPLOADED_ASSETS=%s\n' "$uploaded"
    printf 'NOTES_APPLIED=%s\n' "$NOTES_APPLIED"
    printf 'RESUMED_FROM=%s\n' "$resumed_from"
    exit 0
}

# Safety net: any unguarded command failure (a bug, not an expected
# collision) still honors the always-exit-0 contract instead of aborting
# under `set -e` with no RESULT block at all.
# shellcheck disable=SC2329  # invoked indirectly by the `trap ... ERR` below
on_error() {
    local exit_code=$?
    # `set -E` (below) makes this trap fire inside command-substitution
    # subshells too (e.g. `x="$(cmd)"`), not just top-level failures. Emitting
    # a RESULT block there would corrupt whatever $(...) capture is in
    # progress in the parent shell — propagate the real exit status instead
    # and let a caller-side `||`/status check handle it, or let the trap
    # re-fire at the top level once the subshell's own failure surfaces.
    if [[ "${BASH_SUBSHELL:-0}" -gt 0 ]]; then
        exit "$exit_code"
    fi
    emit BLOCKED "internal-error: unexpected failure (exit ${exit_code})" "" "" "-"
}
trap on_error ERR

command -v git >/dev/null 2>&1 || emit BLOCKED "git-not-found" "" "" "-"
command -v gh >/dev/null 2>&1 || emit BLOCKED "gh-not-found" "" "" "-"

if [[ $# -lt 3 ]]; then
    usage
    emit BLOCKED "missing-required-arguments" "" "" "-"
fi

# An opt-in repository has exactly one publisher: its tag-triggered workflow.
# Validate the policy in the helper before creating or pushing any tag.
if [[ -e "$1/.github/omb-release.json" || -L "$1/.github/omb-release.json" ]]; then
    command -v python3 >/dev/null 2>&1 || emit BLOCKED "python3-required-for-ci-release" "" "" "-"
    python3 "$(dirname "$0")/publish-ci.py" "$@"
    exit 0
fi

REPO_ROOT="$1"
VERSION="$2"
NOTES_FILE="$3"
shift 3

ASSETS_CSV=""
DRAFT=0
PRERELEASE=0
RESUME=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --assets)
            ASSETS_CSV="${2:-}"
            shift 2
            ;;
        --draft)
            DRAFT=1
            shift
            ;;
        --prerelease)
            PRERELEASE=1
            shift
            ;;
        --resume)
            RESUME=1
            shift
            ;;
        *)
            shift
            ;;
    esac
done

[[ -d "$REPO_ROOT" ]] || emit BLOCKED "repo-root-not-found: ${REPO_ROOT}" "" "" "-"
[[ -f "$NOTES_FILE" ]] || emit BLOCKED "notes-file-not-found: ${NOTES_FILE}" "" "" "-"

# Gate: <version> must be a bare semver, optionally "v"-prefixed (same
# grammar as version-bump.sh's SEMVER_RE and collect-assets.sh's gate). This
# is checked BEFORE VERSION is used to build TAG or JOURNAL_PATH — an
# absolute path or a "../" segment in VERSION would otherwise let
# JOURNAL_PATH escape .omb/release/, and "vv1.4.0"/"V1.4.0"-style inputs
# would defeat the tag-normalization idempotency below.
SEMVER_PATTERN='^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
if [[ ! "$VERSION" =~ $SEMVER_PATTERN ]]; then
    emit BLOCKED "invalid-version: ${VERSION} (expected semver, optionally v-prefixed)" "" "" "-"
fi

# All git calls below are plain (no `-C`) so the git shim's logged argv
# starts with the subcommand itself (e.g. "git push ..."), matching the
# call-log assertions in tests/scripts/test_release_publish.py. NOTES_FILE
# and --assets paths must therefore be absolute (as version-bump.sh's
# sibling callers already pass them).
cd "$REPO_ROOT" 2>/dev/null || emit BLOCKED "repo-root-not-accessible: ${REPO_ROOT}" "" "" "-"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || emit BLOCKED "repo-root-not-a-git-work-tree: ${REPO_ROOT}" "" "" "-"

# Tag normalization (idempotent): strip a single leading "v" if present,
# then prepend exactly one "v" — "1.4.0" and "v1.4.0" both become "v1.4.0",
# never "vv1.4.0". SKILL.md step 11 passes bare semver (version-bump.sh's
# NEW_VERSION); this repo's own tags are "v"-prefixed (git/collaboration.md).
TAG="v${VERSION#v}"

# Journal is keyed by the raw <version> argument as given, not the
# normalized tag, per the RESULT-block contract above.
JOURNAL_PATH="${REPO_ROOT}/.omb/release/${VERSION}.state"
mkdir -p "$(dirname "$JOURNAL_PATH")"
touch "$JOURNAL_PATH"

# Returns the last recorded value for a phase key, or empty if absent.
get_phase() {
    grep "^$1=" "$JOURNAL_PATH" 2>/dev/null | tail -n1 | cut -d'=' -f2- || true
}

# Appends PHASE=value only when it is new or has changed — keeps the
# journal a clean, idempotent record of completed phases.
record_phase() {
    local existing
    existing="$(get_phase "$1")"
    if [[ "$existing" != "$2" ]]; then
        printf '%s=%s\n' "$1" "$2" >> "$JOURNAL_PATH"
    fi
}

HEAD_SHA="$(git rev-parse HEAD)"

# Informational only: the deepest phase already recorded before this run,
# reported back to the caller when --resume was passed.
RESUMED_FROM="-"
if [[ "$RESUME" -eq 1 ]]; then
    for phase in VERIFIED ASSETS_UPLOADED RELEASE_CREATED TAG_PUSHED TAG_CREATED; do
        if [[ -n "$(get_phase "$phase")" ]]; then
            RESUMED_FROM="$phase"
            break
        fi
    done
fi

DID_NEW_WORK=0

# --- Phase 1: tag (never move an existing tag) --------------------------
if git rev-parse --verify -q "refs/tags/${TAG}" >/dev/null 2>&1; then
    TAG_COMMIT="$(git rev-parse "${TAG}^{commit}")"
    if [[ "$TAG_COMMIT" != "$HEAD_SHA" ]]; then
        emit BLOCKED "tag ${TAG} points at ${TAG_COMMIT}, expected HEAD ${HEAD_SHA} — refusing to move an existing tag" "" "" "$RESUMED_FROM"
    fi
    record_phase TAG_CREATED "$HEAD_SHA"
else
    if ! git tag "$TAG"; then
        emit BLOCKED "failed to create tag ${TAG}" "" "" "$RESUMED_FROM"
    fi
    record_phase TAG_CREATED "$HEAD_SHA"
    DID_NEW_WORK=1
fi

# --- Phase 2: push (never --force) ---------------------------------------
# Prefer the dereferenced commit for an annotated tag (refs/tags/TAG^{}); an
# annotated tag's plain ref resolves to the tag object, not the commit, so
# comparing that directly against HEAD_SHA would false-mismatch every
# annotated tag. Fall back to the plain ref for lightweight tags.
REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/${TAG}^{}" 2>/dev/null | cut -f1 || true)"
if [[ -z "$REMOTE_TAG_SHA" ]]; then
    REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/${TAG}" 2>/dev/null | cut -f1 || true)"
fi
if [[ -z "$REMOTE_TAG_SHA" ]]; then
    if ! git push origin "$TAG"; then
        emit BLOCKED "failed to push tag ${TAG} to origin" "" "" "$RESUMED_FROM"
    fi
    record_phase TAG_PUSHED "$HEAD_SHA"
    DID_NEW_WORK=1
elif [[ "$REMOTE_TAG_SHA" != "$HEAD_SHA" ]]; then
    emit BLOCKED "remote tag ${TAG} already exists at ${REMOTE_TAG_SHA}, expected HEAD ${HEAD_SHA} — refusing to overwrite an existing remote tag" "" "" "$RESUMED_FROM"
else
    record_phase TAG_PUSHED "$HEAD_SHA"
fi

# --- Phase 3: release (created strictly after the tag is pushed) --------
RELEASE_EXISTS=0
if gh release view "$TAG" >/dev/null 2>&1; then
    RELEASE_EXISTS=1
fi

if [[ "$RELEASE_EXISTS" -eq 0 ]]; then
    CREATE_ARGS=("$TAG" --notes-file "$NOTES_FILE" --title "$TAG")
    if [[ "$DRAFT" -eq 1 ]]; then
        CREATE_ARGS+=(--draft)
    fi
    if [[ "$PRERELEASE" -eq 1 ]]; then
        CREATE_ARGS+=(--prerelease)
    fi
    if ! gh release create "${CREATE_ARGS[@]}"; then
        emit BLOCKED "gh release create failed for ${TAG} — fix the underlying issue and rerun with --resume" "" "" "$RESUMED_FROM"
    fi
    NOTES_APPLIED="created"
    record_phase RELEASE_CREATED "$HEAD_SHA"
    DID_NEW_WORK=1
else
    # The release already exists — most often because the repository's own CI
    # reacted to the tag push (Phase 2) by creating it with
    # `--generate-notes`. Reconcile its body to <notes-file>, which is
    # authoritative. Compare first so an already-correct body performs no
    # write and the run still reports ALREADY_PUBLISHED.
    #
    # A body that cannot be read (gh/API failure) must not be mistaken for an
    # empty body that happens to match empty notes — the sentinel forces the
    # differs-branch, i.e. fail toward applying the notes.
    EXISTING_BODY="$(gh release view "$TAG" --json body --jq '.body' 2>/dev/null)" \
        || EXISTING_BODY="<omb:release-body-unreadable>"

    if [[ "$EXISTING_BODY" == "$(cat "$NOTES_FILE")" ]]; then
        NOTES_APPLIED="unchanged"
    else
        if ! gh release edit "$TAG" --notes-file "$NOTES_FILE"; then
            emit BLOCKED "gh release edit failed for ${TAG} — the release exists but its body could not be updated to the rendered notes; fix the underlying issue and rerun with --resume" "" "" "$RESUMED_FROM"
        fi
        NOTES_APPLIED="overwritten"
    fi
    record_phase RELEASE_CREATED "$HEAD_SHA"
fi

# --- Phase 4: assets — upload only what's missing (assets only after the
#     release exists) ------------------------------------------------------
UPLOADED_LIST=""
if [[ -n "$ASSETS_CSV" ]]; then
    GH_VIEW_ASSETS_STATUS=0
    EXISTING_NAMES="$(gh release view "$TAG" --json assets --jq '.assets[].name' 2>/dev/null)" || GH_VIEW_ASSETS_STATUS=$?

    if [[ -z "$EXISTING_NAMES" && -n "${GH_RELEASES_DIR:-}" && -d "${GH_RELEASES_DIR}/${TAG}/assets" ]]; then
        # Hermetic-test fallback: the fake `gh` used by tests cannot enumerate
        # uploaded assets via --json, so also check the fixture's own asset
        # directory when GH_RELEASES_DIR is set. Unset in real usage, where
        # the --json query above is the sole source of truth.
        EXISTING_NAMES="$(ls -1 "${GH_RELEASES_DIR}/${TAG}/assets" 2>/dev/null || true)"
    elif [[ "$GH_VIEW_ASSETS_STATUS" -ne 0 ]]; then
        # A genuinely failed query (auth expiry, transient network error) is
        # not the same as "no assets present". Treating it as empty would let
        # the upload below re-upload every asset; --clobber would then
        # silently overwrite already-published binaries.
        emit BLOCKED "failed to query existing release assets for ${TAG} (gh release view --json exited ${GH_VIEW_ASSETS_STATUS}) — rerun with --resume once gh access is restored" "" "" "$RESUMED_FROM"
    fi

    IFS=',' read -r -a ASSET_PATHS <<< "$ASSETS_CSV"
    for asset_path in "${ASSET_PATHS[@]}"; do
        [[ -z "$asset_path" ]] && continue
        asset_name="$(basename "$asset_path")"
        if printf '%s\n' "$EXISTING_NAMES" | grep -qxF -- "$asset_name"; then
            continue
        fi
        if ! gh release upload "$TAG" "$asset_path"; then
            emit BLOCKED "failed to upload asset ${asset_name} to release ${TAG}" "" "" "$RESUMED_FROM"
        fi
        if [[ -z "$UPLOADED_LIST" ]]; then
            UPLOADED_LIST="$asset_name"
        else
            UPLOADED_LIST="${UPLOADED_LIST},${asset_name}"
        fi
        DID_NEW_WORK=1
    done
    record_phase ASSETS_UPLOADED "$HEAD_SHA"
fi

# --- Phase 5: verify -------------------------------------------------------
if ! gh release view "$TAG" >/dev/null 2>&1; then
    emit BLOCKED "release ${TAG} could not be verified after publish steps" "" "" "$RESUMED_FROM"
fi
record_phase VERIFIED "$HEAD_SHA"

RELEASE_URL="$(gh release view "$TAG" --json url --jq '.url' 2>/dev/null || true)"

if [[ "$DID_NEW_WORK" -eq 1 ]]; then
    STATUS="PUBLISHED"
else
    STATUS="ALREADY_PUBLISHED"
fi

emit "$STATUS" "" "$RELEASE_URL" "$UPLOADED_LIST" "$RESUMED_FROM"
