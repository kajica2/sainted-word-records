---
paths:
  - "**/*.py"
  - "**/*.ts"
---

# API Contract Conventions

## JSON Field Naming

- Python code uses `snake_case`.
- Database columns use `snake_case`.
- TypeScript code uses `camelCase`.
- Public JSON APIs SHOULD use `camelCase` for frontend compatibility unless the existing API already uses `snake_case`.
- Do not mix `snake_case` and `camelCase` in the same API response shape.

Recommended Python/Pydantic approach:

```python
class UserResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    user_id: str
    display_name: str
```

Rules:

- MUST keep internal Python names `snake_case` even when JSON aliases are `camelCase`.
- MUST document any API that intentionally uses `snake_case`.
- MUST NOT expose database-only field names that do not match API meaning.

## Error Shape

All API-facing errors should be structured.

```json
{
  "error": {
    "code": "user_not_found",
    "message": "User was not found.",
    "details": null,
    "requestId": "req_123"
  }
}
```

Rules:

- Error messages MUST be actionable.
- Error codes MUST be stable.
- Error details MUST be safe for clients.
- Internal traces MUST go to logs, not responses.
- Validation errors MUST identify the invalid field and expected shape.

## Pagination

- Use cursor pagination for large, frequently updated collections.
- Use limit/offset only for small admin-like lists where correctness under mutation is not critical.
- Enforce maximum page sizes.
- Return stable ordering.

Rules:

- MUST NOT expose unbounded list endpoints.
- MUST NOT sort by non-indexed columns on large tables without review.
- MUST NOT return internal cursors that reveal sensitive data.
