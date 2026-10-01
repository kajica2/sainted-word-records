<!--
Release notes template consumed by `omb-release/SKILL.md` Step 11.

Tokens: {{VERSION}}, {{HIGHLIGHTS}}, {{BREAKING}}, {{VERIFICATION}}, {{ASSETS}}, {{COMPARE_URL}}.

Each token's source, required detail level, and format are defined by the
"Notes Authoring Contract" table in `SKILL.md` Step 11. A rendered example that
satisfies that contract is at `references/release-notes-example.md`. Neither is
restated here — this file owns the section skeleton only.

Rendering rules (enforced by the skill, not by this file):
- Render this file to a real temp file, then pass it as `publish.sh`'s <notes-file>
  argument — never interpolate its content into a shell string.
- Omit the `## Breaking Changes` section ENTIRELY when {{BREAKING}} has no content —
  do not emit an empty heading.
- `## Verification` reports only checks actually run this session. Since CI is not
  awaited by default (`--wait-ci` opts in), the CI line states status verbatim at
  publish time (e.g. "CI: in progress at publish time" or "CI: not checked (default,
  no --wait-ci)") rather than implying green.
- Body prose (`{{HIGHLIGHTS}}`, `{{BREAKING}}`, `{{VERIFICATION}}` free text) follows
  `OMB_DOCUMENTATION_LANGUAGE`; the tag name and this file's own section headers below
  stay in English, matching the "titles/paths/commands stay English" convention used
  by `omb-pr`'s PR body.
-->
## Highlights

{{HIGHLIGHTS}}

## Breaking Changes

{{BREAKING}}

## Verification

{{VERIFICATION}}

## Assets

{{ASSETS}}

**Full Changelog**: {{COMPARE_URL}}
