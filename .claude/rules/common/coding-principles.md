---
description: coding principles — directional guidance for every implementation task
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Coding Principles

HARD Rules = verifiable constraints; Principles = directional guidance. On conflict, HARD wins.

## 1. Think Before Coding

**"State the problem and success criterion before writing a single line."**

- Write down what you are trying to do in one sentence before opening a file.
- Define done: what exact output, behavior, or test result proves success?
- List assumptions explicitly — unverified assumptions are deferred risks.

**The test:** Can you state what "done" looks like without reading any code?

### Before / After

```python
# Before — no criterion, assumption-driven
async def fix_login():
    user = db.get_user(request.email)
    return {"ok": True}
# After — criterion-first: 401 on bad password, 200 + JWT on success
async def login(payload: LoginRequest) -> LoginResponse:
    user = await user_repo.get_by_email(payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    return LoginResponse(token=create_jwt(user.id))
```

## 2. Simplicity First

**"The simplest solution that works — not the most general one."**

- Prefer concrete types over generic abstractions until the second real caller arrives.
- A function with one caller does not need a `Protocol`/`ABC`/plugin registry.
- Three similar lines beat a premature abstraction that obscures intent.

**The test:** Can a reader understand this in under 30 seconds without opening another file?

### Before / After

```python
# Before — premature abstraction with Protocol for one endpoint
class ValidatorProtocol(Protocol):
    def validate(self, payload: dict) -> bool: ...

class EmailValidator:
    def validate(self, payload: dict) -> bool:
        return "@" in payload.get("email", "")

def handle(payload: dict, v: ValidatorProtocol = EmailValidator()) -> None:
    if not v.validate(payload):
        raise ValueError
# After — direct
def handle(payload: dict) -> None:
    if "@" not in payload.get("email", ""):
        raise HTTPException(status_code=422, detail="invalid email")
```

## 3. Surgical Changes

**"Every line in the diff must trace back to a plan requirement."**

- Implement only what the plan specifies — no drive-by refactors, no gold-plating.
- If a side issue is spotted, file it as a separate task; do not fix it inline.
- Keep the diff small: each hunk must map to a plan item.

**The test:** Can every changed line be justified by a specific plan requirement?

### Before / After

```typescript
// Before — fixes bug AND opportunistically refactors unrelated layout
function UserCard({ user }: { user: User }) {
  const avatarUrl = user.avatar ?? "/default.png";           // planned
  return <div className="user-profile-card">{/* ... */}</div>; // unplanned rename
}
// After — surgical: only the planned bug fix
function UserCard({ user }: { user: User }) {
  const avatarUrl = user.avatar ?? "/default.png"; // plan §3.1
  return <div className="user-card">{/* unchanged */}</div>;
}
```

## 4. Goal-Driven Execution

**"Every step has a verifiable success signal — run it before claiming done."**

- After each step, run the proof: type checker, test, or CLI output.
- Never claim DONE until fresh verification evidence has been read, not assumed.
- If a step's success signal is unclear, define it before starting the step.

**The test:** Have you run the actual verification command and read its output?

### Before / After

```bash
# Before — claim without evidence
# "Added the Pydantic validator, it should work now."

# After — run proof, read output, then claim
uv run pytest apps/api/tests/test_login.py -v --timeout=10
# PASSED test_login_invalid_password_returns_401
# PASSED test_login_valid_returns_jwt
# Coverage: 92% — criterion met
```

## See Also

- `.claude/rules/workflow/03-implement.md` — Scope Guard (implement only what the plan specifies)
- `.claude/rules/workflow/04-verify.md` — Evidence-Based Reporting (run proof before claiming done)
- `.claude/rules/workflow/05-test.md` — TDD Cycle (RED-GREEN-IMPROVE)
