# Frozen OKF v0.1 contract

This rule freezes the OKF behavior used by `omb-wiki`. It is derived from the
`knowledge-catalog` snapshot at commit
`d44368c15e38e7c92481c5992e4f9b5b421a801d`, captured on 2026-07-19. Runtime
behavior never reads that repository or follows later upstream changes.

## Validation levels

### `spec`

- A concept is UTF-8 Markdown and its YAML frontmatter is a mapping.
- `type` is a non-empty string.
- Unknown types and extension keys are accepted and preserved.
- `index.md` and `log.md` are reserved files, not concepts.
- This level does not require `title`, `description`, or `timestamp`.
- This level does not validate links, H1 headings, Korean, domain shape, or
  vocabulary membership.

### `reference`

Apply every `spec` rule, then require truthy `type`, `title`, `description`, and
`timestamp`. Do not validate ISO timestamp syntax, sentence count, Korean, domain
shape, or links.

### `publication`

Apply every `reference` rule, then require an ISO-8601 `timestamp`, Korean
`title` and `description` where linguistically applicable, one explicit schema
and subtype from `schemas/domains.yml`, every required and activated conditional
section, byte-preserved identifiers, verified evidence, and valid links.

There is no hidden controlled vocabulary and no generic fallback schema.

## Parser and serialization

The installed runtime is the single parser. It uses `yaml.safe_load` and
`yaml.safe_dump(sort_keys=False, allow_unicode=True)`. Non-mapping or
unterminated frontmatter is invalid. Semantic round trips preserve unknown key
order and nested values; original YAML quoting style is not contractual.

OKF permits H1 headings and Markdown links. Indexes have no YAML frontmatter.
OMB publication policy is additional to the frozen `spec` and `reference`
levels and must never be described as an upstream OKF requirement.
