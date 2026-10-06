---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
---

# General Naming Conventions (Language-Agnostic)

Cross-language naming rules for booleans, collections, ID types, timestamps, and errors.

## Boolean Names

Use positive boolean names.

Preferred prefixes:

- `is_` / `is` for state: `is_active`, `isActive`.
- `has_` / `has` for possession: `has_permission`, `hasPermission`.
- `can_` / `can` for capability: `can_edit`, `canEdit`.
- `should_` / `should` for decisions: `should_retry`, `shouldRetry`.
- `was_` / `was` for past state: `was_sent`, `wasSent`.
- `did_` / `did` for completed actions: `did_sync`, `didSync`.

Rules:

- MUST NOT use double negatives such as `isNotDisabled`.
- MUST NOT use ambiguous booleans such as `flag`, `status`, `enabled` without domain context.
- MUST use enums or string unions when there are more than two meaningful states.

## Collection Names

- Use plural nouns for arrays/lists/sets: `users`, `orders`, `messages`.
- Use `By<Key>` / `_by_<key>` for maps: `userById`, `user_by_id`.
- Use `Ids` / `_ids` suffix for identifier collections: `selectedUserIds`, `selected_user_ids`.
- Use `Count` / `_count` suffix for counts: `activeUserCount`, `active_user_count`.
- Use `Total` for totals that may span pages or filters.

Rules:

- MUST NOT name collections `list`, `array`, `dict`, `map`, or `items` without domain context.
- MUST NOT use singular names for collections.
- MUST NOT use plural names for single objects.

## ID Names

- Use `id` only when the entity is obvious in the current scope.
- Use `<entity>_id` in Python and `<entity>Id` in TypeScript outside tiny scopes.
- Use UUID strings consistently when the domain uses UUIDs.
- Use `external_<entity>_id` / `externalEntityId` for provider-owned IDs.
- Use `public_<entity>_id` / `publicEntityId` for non-sensitive public identifiers.

Rules:

- MUST NOT confuse database IDs with provider IDs.
- MUST NOT expose internal sequential IDs when enumeration is a concern.
- MUST NOT name unrelated identifiers simply `id` in the same function.

## Time and Duration Names

- Use `_at` / `At` for timestamps: `created_at`, `createdAt`.
- Use `_date` / `Date` for date-only values.
- Use `_seconds`, `_minutes`, `_ms` / `Seconds`, `Minutes`, `Ms` for durations.
- Use `expires_at` / `expiresAt` for absolute expiration timestamps.
- Use `ttl_seconds` / `ttlSeconds` for relative TTLs.

Rules:

- MUST NOT use ambiguous names like `time`, `date`, or `timeout` without unit or meaning.
- MUST NOT store local-time timestamps without timezone intent.
- MUST NOT mix milliseconds and seconds in the same variable name.

## Function Names

Function names should start with a verb.

Common verbs:

- `get` for retrieval that should exist or may throw.
- `find` for retrieval that may return none.
- `list` for collections.
- `create`, `update`, `delete`, `archive`, `restore` for mutations.
- `validate` for validation.
- `parse` for string/object parsing.
- `format` for display formatting.
- `map` / `to` for conversion.
- `build` for construction.
- `ensure` for invariant enforcement that may create or throw.
- `require` for authorization or mandatory preconditions.

Rules:

- MUST NOT name functions by implementation detail when business meaning is clearer.
- MUST NOT use `handle` unless the function truly handles an event or request.
- MUST NOT use `process` without a domain suffix such as `processPayment`.

## General Naming Rules

- Use meaningful domain names.
- Include units in names: `timeout_seconds`, `retryDelayMs`, `sizeBytes`.
- Include cardinality: `user_ids`, `usersById`, `selectedUserIds`.
- Include lifecycle when important: `draft_response`, `pendingInvitation`, `archivedUsers`.
- Include actor or tenant context when permission-sensitive: `actor_user_id`, `tenantId`.

Rules:

- MUST NOT use vague names like `data`, `info`, `payload`, `obj`, `tmp`, `res`, `result` unless scope is tiny and obvious.
- MUST NOT use abbreviations except: `db`, `api`, `auth`, `url`, `uri`, `id`, `json`, `html`, `css`, `jwt`, `llm`, `orm`, `k8s`.
- MUST NOT encode type using Hungarian notation such as `strName` or `arrUsers`.
- MUST NOT use single-letter variables except in tiny mathematical or iterator contexts.
- MUST NOT use misleading names that hide side effects.
