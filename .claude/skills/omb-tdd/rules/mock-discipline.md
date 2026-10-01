# Mock Discipline Rules

Mocks are necessary at system boundaries. They become harmful when used to bypass real logic, return unrealistic data, or avoid testing actual behavior.

## Banned Mock Patterns

### Python — Auto-FAIL

```python
# BANNED: Untyped MagicMock (matches any attribute access, hides real errors)
service = MagicMock()

# BANNED: Empty dict return (does not match actual response shape)
mock_repo.get_user.return_value = {}

# BANNED: None return without testing the null case explicitly
mock_service.fetch.return_value = None

# BANNED: Mocking the unit under test
with patch("src.services.user_service.create_user") as mock:
    result = create_user(data)  # This tests nothing

# BANNED: Mocking internal utilities
with patch("src.utils.hash_password") as mock_hash:
    mock_hash.return_value = "hashed"  # Test hash_password directly instead

# BANNED: Mock with no call assertion
mock_client.post = MagicMock(return_value=Response(200))
result = send_notification(user)
assert result.success  # Never verified mock_client.post was called correctly
```

### Python — Required Alternatives

```python
# CORRECT: Typed mock return matching actual Pydantic model
mock_repo.get_user.return_value = User(id=1, name="Alice", email="alice@test.com", role="admin")

# CORRECT: spec= constrains the mock to the real interface
mock_service = MagicMock(spec=UserService)

# CORRECT: Side effect for error testing with realistic exception
mock_client.post.side_effect = httpx.ConnectError("Connection refused")

# CORRECT: Call argument verification
mock_repo.create.assert_called_once_with(
    name="Alice",
    email="alice@test.com",
    hashed_password=ANY,  # exact value not important, but arg must be passed
)

# CORRECT: Integration test with real DB and transaction rollback
async def test_create_user_persists(db_session: AsyncSession):
    repo = UserRepository(db_session)
    user = await repo.create(CreateUserSchema(name="Alice", email="alice@test.com"))
    assert user.id is not None
    assert user.name == "Alice"
    # db_session rolls back automatically via fixture
```

### TypeScript — Auto-FAIL

```typescript
// BANNED: Untyped mock with empty return
vi.fn().mockResolvedValue({})

// BANNED: Cast to any bypasses type checking entirely
const mockService = vi.fn() as any

// BANNED: Undefined return without testing undefined handling
vi.fn().mockReturnValue(undefined)

// BANNED: Mocking the component under test
vi.mock("./UserCard")  // then testing UserCard — circular

// BANNED: Mocking internal hooks
vi.mock("./useFormatDate")  // test useFormatDate directly instead

// BANNED: vi.mock on fetch/axios without realistic response shape
vi.fn().mockResolvedValue({ data: {} })
```

### TypeScript — Required Alternatives

```typescript
// CORRECT: Typed mock matching actual interface
const mockUser: User = { id: 1, name: "Alice", email: "alice@test.com", role: "admin" }
vi.fn<[], Promise<User>>().mockResolvedValue(mockUser)

// CORRECT: MSW for HTTP mocking (intercepts at network level)
import { http, HttpResponse } from "msw"
server.use(
  http.get("/api/users/1", () => {
    return HttpResponse.json({ id: 1, name: "Alice", email: "alice@test.com" })
  })
)

// CORRECT: Error scenario with realistic error
server.use(
  http.get("/api/users/1", () => {
    return new HttpResponse(null, { status: 404 })
  })
)

// CORRECT: Spy with call verification
const saveSpy = vi.spyOn(userService, "save")
await userService.createUser({ name: "Alice" })
expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Alice" }))
```

## Mock Scope Rules

### Where Mocking is Appropriate

1. **External HTTP APIs** — Use `responses`/`httpretty` (Python) or `msw` (TypeScript). Mock at the HTTP transport level, not at the client class level.
2. **Database** — For unit tests: typed fixtures or factory functions. For integration tests: real database with transaction rollback per test.
3. **File system** — `tmp_path` (pytest) creates real temporary files. `memfs` or `vi.mock('fs')` with typed returns for TypeScript.
4. **Clock/time** — `freezegun.freeze_time` (Python) or `vi.useFakeTimers()` (TypeScript).
5. **Randomness/UUIDs** — Seed the generator or mock `uuid.uuid4` with a deterministic return.
6. **Third-party SDKs** — Only when the SDK makes external calls. Use `spec=` (Python) or `satisfies` (TypeScript) to constrain the mock to the real interface.

### Where Mocking is NOT Appropriate

1. **The function/class under test** — If you mock it, you are testing the mock, not the code.
2. **Internal utility functions** — Test them directly with real inputs.
3. **Validation logic** — Pydantic models, Zod schemas, custom validators should run with real data.
4. **ORM models** — Use a real database session or in-memory SQLite, not mock models.
5. **Configuration loading** — Use environment variable overrides, not mock config.

## Fixture Pitfalls

Fixtures are a common source of hangs and false passes. A defective autouse fixture can hang a whole test run with no obvious cause (see the Timeout Triage Protocol in the omb-tdd `SKILL.md`). Guard against these:

1. **Filesystem/env assumptions** — Autouse fixtures that read or write files MUST use `tmp_path` / `tmp_path_factory` (pytest). Never assume a developer-machine path (e.g. `/Users/me/data`, a real home directory, a checked-out repo path) exists in the test environment — it will not exist in CI or a fresh worktree, and the fixture hangs or errors at collection.
2. **Fixture scope leakage** — `module`- or `session`-scoped fixtures hold state across tests. A fixture that caches a connection, config object, or computed value can leak stale state into later tests, producing order-dependent passes/failures. Default to function scope; widen scope only when the held resource is genuinely immutable for the test session.
3. **Hardcoded path assertions** — Do not assert against a literal path string. Assert against the env/config value the code actually derives the path from (e.g. `assert result == settings.data_dir / "out.json"`), so the test follows the configuration instead of pinning a machine-specific literal.
4. **Monkeypatch without cache invalidation** — When a fixture or test monkeypatches a setting or config value, it MUST pair the patch with the matching cache invalidation in the same fixture/test (e.g. `clear_settings_cache()`). A cached settings object captured before the patch makes the patch a silent no-op — the code under test keeps reading the old value while the test believes it changed it.

## Mock Verification Checklist

For every mock in a test file, verify:

1. **Return type matches real interface** — Compare mock return with the actual function's return type annotation.
2. **Error mock uses real exception type** — `httpx.ConnectError`, not `Exception("error")`.
3. **At least one call assertion exists** — `assert_called_once_with`, `assert_called_with`, `toHaveBeenCalledWith`, or equivalent.
4. **Call arguments are verified** — Not just call count. Check that the right data was passed.
5. **Both success and error paths are tested** — Happy path mock + error path mock in separate tests.
