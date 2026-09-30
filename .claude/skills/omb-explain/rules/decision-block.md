# Decision Block

Detailed authoring guidance for rule 9 of `.claude/rules/common/explanation-style.md`: attach
the three-part option/recommendation/impact set to every substantive unresolved choice. Read
this file when a response surfaces a decision the user has not yet made.

## Template

```
**Options:**
- {option A} — {what it means}
- {option B} — {what it means}

**Recommendation:** {recommended option} — {why}

**Impact:** {how the development direction and deliverables change under this choice}
```

Three required parts, each with a distinct job:

1. **Options** — the feasible options and what each one means. List every option that is
   actually viable, not a padded list that includes options nobody would pick. Each option needs
   a one-clause explanation of what choosing it actually does — not just a label.
2. **Recommendation** — the recommended option and why. A decision block without a
   recommendation forces the reader to do the analysis themselves; state a position and the
   reasoning behind it, even if the reader is free to override it.
3. **Impact** — how the development direction and deliverables change under this choice. This is
   the part most often skipped. State concretely what happens differently downstream depending
   on which option is picked — not a restatement of the option description.

When a constraint leaves only one viable path, do not invent alternatives to fill the template.
State the constraint and the basis for the choice instead:

```
Only {option} is viable: {constraint that eliminates the alternatives}.
```

Fabricating a second option just to satisfy the three-part shape is worse than omitting the
template — it misrepresents a forced move as a real choice.

## When to Add AskUserQuestion

Adding an `AskUserQuestion` tool call after the Decision Block prose is **not mandatory**. Add
it only when the choice genuinely needs one — that is, when all of the following hold:

- The decision is substantive enough that proceeding without an answer would mean guessing at
  the user's intent, not just picking the recommended default and moving on.
- The options are mutually exclusive and further work depends on which one is chosen (rule 9's
  "how the development direction and deliverables change" is non-trivial — the two branches
  produce materially different work).
- The user has not already signaled a preference elsewhere in the conversation that the
  Recommendation can safely follow.

Do **not** add `AskUserQuestion` when:

- The Decision Block is documenting a choice already made (e.g. a completed-work report
  explaining why an option was picked) — that is a record, not an open question.
- The recommendation is strong enough that proceeding with it and letting the user correct
  course later is lower-cost than stopping to ask (e.g. cosmetic naming, internal-only
  refactoring choices with no external contract).
- A single-fact or one-line response is being given — rule 0 (scope) already excludes
  structure rules from these responses, and forcing a decision block onto them would violate
  "never add a heading or a skeleton step to fill length."

The prose Decision Block is the default; `AskUserQuestion` is an escalation on top of it for the
subset of decisions where silent progress under the recommended default would be the wrong
outcome.

## Worked Example

A substantive choice, decided in prose only (no `AskUserQuestion` needed, because the
recommendation is strong and reversible):

> ## 판단이 필요한 항목
>
> **Options:**
> - 캐시 TTL을 5분으로 설정 — 최신성은 낮아지지만 백엔드 부하가 줄어듭니다.
> - 캐시 TTL을 30초로 설정 — 최신성은 높아지지만 백엔드 부하가 커집니다.
>
> **Recommendation:** 5분 — 이 데이터는 하루에 한 번만 갱신되므로 30초 TTL이 주는 최신성 이득이
> 없습니다.
>
> **Impact:** 5분을 선택하면 캐시 무효화 로직을 추가로 구현할 필요가 없습니다. 30초를 선택하면
> 갱신 시점마다 무효화 이벤트를 발행하는 별도 구현이 필요해집니다.

A forced-path case, where inventing a second option would misrepresent the constraint:

> Only 기본값 강제 지정이 가능합니다: `graph_version` 필드가 스키마 검증의 필수 항목으로
> 이미 등록되어(`generate_schema.py:342`), `null` 허용은 검증 자체를 무력화하므로 이번 변경의
> 목적과 상충합니다.

A genuinely open, high-stakes choice where the two branches diverge in scope and further work
depends on the answer — this is the case where appending an `AskUserQuestion` call after the
prose is warranted, because proceeding on a guessed default would risk building the wrong
deliverable:

> ## 판단이 필요한 항목
>
> **Options:**
> - 기존 API를 하위 호환으로 유지하며 신규 필드를 optional로 추가 — 마이그레이션 불필요, 기존
>   클라이언트 영향 없음.
> - 기존 API를 breaking change로 교체 — 마이그레이션 필요, 모든 클라이언트가 갱신되어야 함.
>
> **Recommendation:** optional 추가 — 다만 이 API를 사용하는 외부 파트너가 있는지 확인되지
>   않아, 확정하기 전에 사용자 확인이 필요합니다.
>
> **Impact:** optional 추가를 선택하면 이번 스프린트 내 배포가 가능합니다. breaking change를
>   선택하면 파트너 공지 기간(최소 2주)이 선행되어야 하므로 일정이 크게 달라집니다.
>
> (여기서 `AskUserQuestion`을 호출해 사용자에게 두 옵션 중 하나를 선택하도록 요청합니다.)
