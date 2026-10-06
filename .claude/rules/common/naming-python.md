---
paths:
  - "**/*.py"
---

# Python Naming Conventions

Naming is a project-level consistency requirement. Names communicate domain meaning, type, unit, cardinality, and lifecycle.

## Python-Specific Naming

| Concept | Python |
| --- | --- |
| Local variable | `user_id` |
| Function | `get_user` |
| Class / Type | `UserService` |
| Constant | `MAX_RETRIES` |
| DB table | `users` |
| DB column | `created_at` |
| API JSON field | internal `user_id`, alias `userId` |
| Redis key | `app:env:v1:user:123` |
| Env var | `DATABASE_URL` |

## General Rules

- Use meaningful domain names.
- Include units in names: `timeout_seconds`, `size_bytes`.
- Include cardinality: `user_ids`, `users_by_id`, `selected_user_ids`.
- Include lifecycle when important: `draft_response`, `pending_invitation`, `archived_users`.
- Include actor or tenant context when permission-sensitive: `actor_user_id`.

Rules:

- MUST NOT use vague names like `data`, `info`, `payload`, `obj`, `tmp`, `res`, `result` unless scope is tiny and obvious.
- MUST NOT use abbreviations except: `db`, `api`, `auth`, `url`, `uri`, `id`, `json`, `html`, `css`, `jwt`, `llm`, `orm`, `k8s`.
- MUST NOT encode type using Hungarian notation such as `str_name` or `arr_users`.
- MUST NOT use single-letter variables except in tiny mathematical or iterator contexts.
- MUST NOT use misleading names that hide side effects.

## Boolean Names (Python)

Use positive boolean names with prefixes:

- `is_` for state: `is_active`.
- `has_` for possession: `has_permission`.
- `can_` for capability: `can_edit`.
- `should_` for decisions: `should_retry`.
- `was_` for past state: `was_sent`.
- `did_` for completed actions: `did_sync`.

Rules:

- MUST NOT use double negatives such as `is_not_disabled`.
- MUST NOT use ambiguous booleans such as `flag`, `status`, `enabled` without domain context.
- MUST use enums or string unions when there are more than two meaningful states.

## Collection Names (Python)

- Use plural nouns for lists/sets: `users`, `orders`, `messages`.
- Use `by_<key>` for dicts: `user_by_id`, `orders_by_status`.
- Use `_ids` suffix for identifier collections: `selected_user_ids`.
- Use `_count` suffix for counts: `active_user_count`.

Rules:

- MUST NOT name collections `list`, `array`, `dict`, `map`, or `items` without domain context.
- MUST NOT use singular names for collections.
- MUST NOT use plural names for single objects.

## Function Names (Python)

Start with a verb: `get`, `find`, `list`, `create`, `update`, `delete`, `archive`, `restore`, `validate`, `parse`, `format`, `build`, `ensure`, `require`.

Rules:

- MUST NOT name functions by implementation detail when business meaning is clearer.
- MUST NOT use `handle` unless the function truly handles an event or request.
- MUST NOT use `process` without a domain suffix such as `process_payment`.

## AI / Graph Naming (Python)

- LangGraph node names use `snake_case` verb phrases.
- Router functions use `route_after_<node_name>`.
- Tools use action-oriented names such as `search_documents` or `create_ticket`.
- Prompt names include domain and purpose: `support_intent_classifier_prompt`.
- Memory keys are namespaced: `user_profile.preferences`, `workflow.summary`.

Rules:

- MUST NOT name graph nodes `step1`, `agent`, `llm`, `run`, or `process`.
- MUST NOT name tools `lookup`, `call_api`, or `do_thing` without domain meaning.
- MUST NOT name prompts generically as `prompt` in shared modules.

## Error Names (Python)

- Python exception classes must end with `Error`.
- Error codes must be lowercase snake_case.
- Error response fields must be stable and client-safe.

```python
class PaymentAuthorizationError(Exception):
    pass
```

Rules:

- MUST NOT use `error.message` from internal exceptions as public API text without sanitization.
- MUST NOT use unstable natural-language text as the only error identifier.
