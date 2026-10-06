<!--
A worked example of a contract-compliant release body — the rendered output of
`templates/release-notes.md`, not another template. The authoring contract it
demonstrates lives in `SKILL.md` Step 11 ("Notes Authoring Contract"); this file
adds no rules of its own.

Read it for the *shape* of `## Highlights`: one bullet per user-visible change
unit, each opening with a bold lead-in naming what changed, then saying what
changed and what it now makes possible. Compare that against what GitHub's
`--generate-notes` would have produced for the same release:

    ## What's Changed
    * feat(release): add omb-release skill by @someone in <pr-url>
    * fix(perms): drop Write(path) rules by @someone in <pr-url>

    **Full Changelog**: <compare-url>

Everything below the line is illustrative content for a fictional v1.4.0. The
section headers, the tag, and the assets table are the fixed parts; the prose
follows `OMB_DOCUMENTATION_LANGUAGE` (this example is written in English).
-->

## Highlights

- **Release automation skill (`/omb:release`)** — automates the full release
  path: version bump, `CHANGELOG.md` / `README.md` updates, commit, push to the
  primary branch, tagging, and publishing a GitHub Release with its build
  artifacts. It is repository-agnostic, so projects other than this one can
  adopt it without inheriting this repository's own release layout.
- **Release body is now authoritative** — when a repository's CI creates the
  release on tag push, the skill updates that release's body in place instead
  of leaving GitHub's auto-generated changelog as the published notes. The
  result no longer depends on which side wins the race.
- **`Write(path)` permission entries retired** — file-editing grants are now
  written only as `Edit(path)`. Claude Code matches file permission checks
  against `Edit` rules alone, so the previous `Write(path)` entries were inert
  rules that appeared to grant access but never did.
- Internal: wiki spec notes migrated to the governance-note schema, and the
  release-script test fixtures were split into a shared module.

## Breaking Changes

`Write(path)` entries in `permissions.allow` are removed by `omb init` and
`omb update`. Projects that hand-added their own `Write(...)` grants must
rewrite them as `Edit(...)` — the old form was already non-functional, so no
effective permission changes.

## Verification

- `uv run pytest tests/scripts/ -q --timeout=10` — 42 passed.
- `shellcheck .claude/skills/omb-release/scripts/publish.sh` — no findings.
- `scripts/build-harness-tarball.sh` — rebuilt at release commit `abc1234`;
  the provenance manifest's `SOURCE_SHA` matches HEAD at publish time.
- The full test suite was not run in this session.
- CI: not checked (default, no `--wait-ci`).

## Assets

| Asset | Size | SHA-256 |
|-------|------|---------|
| `harness-v1.4.0.tar.gz` | 1,042,371 B | `d537de9b9ccc7a0a1b6cdbdb4ad02966486e02ca685cb7dc3b2a0e6f164cb209` |
| `harness-local.tar.gz` | 1,042,371 B | `d537de9b9ccc7a0a1b6cdbdb4ad02966486e02ca685cb7dc3b2a0e6f164cb209` |

**Full Changelog**: https://github.com/example-org/example-repo/compare/v1.3.0...v1.4.0
