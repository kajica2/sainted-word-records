---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# TypeScript / JavaScript Naming Conventions

Naming is a project-level consistency requirement. Names communicate domain meaning, type, unit, cardinality, and lifecycle.

## TypeScript-Specific Naming

| Concept | TypeScript / JavaScript |
| --- | --- |
| Local variable | `userId` |
| Function | `getUser` |
| Class / Type | `UserService` |
| Constant | `MAX_RETRIES` for true constants |
| API JSON field | `userId` |
| Env var | `DATABASE_URL` |

## General Rules

- Use meaningful domain names.
- Include units in names: `retryDelayMs`, `sizeBytes`.
- Include cardinality: `userIds`, `usersById`, `selectedUserIds`.
- Include lifecycle when important: `draftResponse`, `pendingInvitation`, `archivedUsers`.
- Include actor or tenant context when permission-sensitive: `tenantId`.

Rules:

- MUST NOT use vague names like `data`, `info`, `payload`, `obj`, `tmp`, `res`, `result` unless scope is tiny and obvious.
- MUST NOT use abbreviations except: `db`, `api`, `auth`, `url`, `uri`, `id`, `json`, `html`, `css`, `jwt`, `llm`, `orm`, `k8s`.
- MUST NOT encode type using Hungarian notation such as `strName` or `arrUsers`.
- MUST NOT use single-letter variables except in tiny mathematical or iterator contexts.
- MUST NOT use misleading names that hide side effects.

## Boolean Names (TypeScript)

Use positive boolean names with prefixes:

- `is` for state: `isActive`.
- `has` for possession: `hasPermission`.
- `can` for capability: `canEdit`.
- `should` for decisions: `shouldRetry`.
- `was` for past state: `wasSent`.
- `did` for completed actions: `didSync`.

Rules:

- MUST NOT use double negatives such as `isNotDisabled`.
- MUST NOT use ambiguous booleans such as `flag`, `status`, `enabled` without domain context.
- MUST use enums or string unions when there are more than two meaningful states.

Bad:

```ts
const status = true;
const notInvalid = false;
```

Good:

```ts
const isEmailVerified = true;
const canRetryPayment = false;
```

## Collection Names (TypeScript)

- Use plural nouns for arrays/sets: `users`, `orders`, `messages`.
- Use `By<Key>` for maps: `userById`, `ordersByStatus`.
- Use `Ids` suffix for identifier collections: `selectedUserIds`.
- Use `Count` suffix for counts: `activeUserCount`.
- Use `Total` for totals that may span pages: `totalOrderCount`.

Rules:

- MUST NOT name collections `list`, `array`, `dict`, `map`, or `items` without domain context.
- MUST NOT use singular names for collections.
- MUST NOT use plural names for single objects.

## Function Names (TypeScript)

Start with a verb: `get`, `find`, `list`, `create`, `update`, `delete`, `archive`, `restore`, `validate`, `parse`, `format`, `build`, `ensure`, `require`.

- Async TypeScript functions that return promises do not need `Async` suffix unless both sync and async versions exist.

Rules:

- MUST NOT name functions by implementation detail when business meaning is clearer.
- MUST NOT use `handle` unless the function truly handles an event or request.
- MUST NOT use `process` without a domain suffix such as `processPayment`.

## ID Names (TypeScript)

- Use `id` only when the entity is obvious in the current scope.
- Use `<entity>Id` in TypeScript outside tiny scopes.
- Use UUID strings consistently when the domain uses UUIDs.
- Use `external<Entity>Id` for provider-owned IDs.
- Use `public<Entity>Id` for non-sensitive public identifiers.

Rules:

- MUST NOT confuse database IDs with provider IDs.
- MUST NOT expose internal sequential IDs when enumeration is a concern.
- MUST NOT name unrelated identifiers simply `id` in the same function.

## Time and Duration Names (TypeScript)

- Use `At` for timestamps: `createdAt`.
- Use `Date` for date-only values.
- Use `Seconds`, `Minutes`, `Ms` for durations.
- Use `expiresAt` for absolute expiration timestamps.
- Use `ttlSeconds` for relative TTLs.

Rules:

- MUST NOT use ambiguous names like `time`, `date`, or `timeout` without unit or meaning.
- MUST NOT store local-time timestamps without timezone intent.
- MUST NOT mix milliseconds and seconds in the same variable name.

## Error Names (TypeScript)

- Error codes must be lowercase snake_case.
- Error response fields must be stable and client-safe.

```ts
const errorCode = 'payment_authorization_failed';
```

Rules:

- MUST NOT use `error.message` from internal exceptions as public API text without sanitization.
- MUST NOT use unstable natural-language text as the only error identifier.
