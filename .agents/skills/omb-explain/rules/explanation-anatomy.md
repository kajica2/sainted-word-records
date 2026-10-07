# Explanation Anatomy

Detailed authoring guidance for rule 4 (classify the response type, apply exactly one
skeleton) and rule 3 (self-identifying references) of
`.claude/rules/common/explanation-style.md`. Read this file when writing a multi-topic
explanation, an unresolved-problem report, or an explanatory answer about how existing code
works.

## Four-Step Skeleton

Rule 4 names four skeletons in total, split across three worked-steps files by response type.
Two of the four are elaborated here: the unresolved-problem skeleton and the explanatory
skeleton the reader uses when they wrote the code being explained. The second (completed work)
has its own dedicated file: `report-anatomy.md`. The fourth (comprehension skeleton — the default
for an explanatory answer) has its own dedicated file: `comprehension-anatomy.md`.

### Unresolved problem — current state -> background -> scope of impact -> open items

1. **Current state.** State the observable symptom first, in one or two sentences, using only
   verified facts. Do not open with a document reference or a ticket number — open with what is
   actually happening right now.
2. **Background (how it got here).** Explain the sequence of decisions or events that produced
   the current state. If any part of the history could not be verified, say so explicitly and
   state how far verification reached (rule 7) — do not invent a plausible-sounding history to
   fill the gap.
3. **Scope of impact.** Name concretely who or what is affected: which callers, which
   environments, which downstream systems. Vague scope ("this could affect a lot of things") is
   not acceptable — either name it or state that scope could not be determined.
4. **Open items.** List what remains unresolved, phrased as concrete questions or decisions, not
   as a vague "TBD". If an item requires a decision from the reader, use the Decision Block
   (`decision-block.md`) instead of a bare list entry.

Omit any step with no content (rule 4). A one-line current-state fact with no unresolved history
does not need an empty Background heading.

### Explanatory skeleton — subject and scope -> current mechanism -> evidence -> boundaries and exceptions

Use this skeleton when the response answers "how does X work" or "why does the system behave
this way" for **existing** code or behavior — not for a problem being diagnosed and not for
completed work being reported.

1. **Subject and scope.** Name exactly what mechanism or code path is being explained, and what
   is explicitly out of scope. A reader should be able to tell from this step alone whether the
   explanation covers their question.
2. **Current mechanism.** Describe the verified control/data flow step by step. Prefer the order
   the code actually executes in over the order that is easiest to narrate.
3. **Evidence.** Attach the citations that substantiate the mechanism description, in the form
   that matches the claim (rule 8): `file:line-range` or `file::symbol` for investigated
   repository behavior, with an excerpt only when the excerpt substantiates the point. Do not
   attach evidence for claims that are actually inference or proposal — label those as such
   (rule 7) instead of dressing them up with a citation.
4. **Boundaries and exceptions.** State what the mechanism does NOT do, and any edge cases,
   error paths, or configuration flags that change its behavior. A mechanism explanation that
   omits its own exceptions is incomplete, not concise.

## Section Label Dictionary

Section headings are noun phrases (rule 2 of the parent contract). The table below converts
common conversational (interrogative or narrative) headings into the noun-phrase form the
contract requires. These pairs are quoted user-facing examples, written in the response
language they would actually appear in:

| Bad form (conversational, forbidden) | Good form (noun phrase, required) |
|---|---|
| `## 지금 무슨 문제가 있나` | `## 문제점` |
| `## 왜 만드는가` | `## 배경` |
| `## 왜 스킬 하나로는 안 되는가` | `## 설계 근거` |
| `## 이 보고가 왜 판단 불가능한가` | `## 진단` |

The pattern generalizes: a bad heading is phrased as a question the reader is imagined to be
asking ("왜 ~하는가", "지금 ~는가", "무엇이 ~인가"); the good heading names the noun-phrase
category the content falls into (Problem, Background, Design Rationale, Diagnosis). When
converting a heading, first identify which entry of the parent contract's Section Label
Dictionary the content belongs to, then use that label — do not invent a new noun phrase per
document when an existing label already fits.

## Reference Citation Cookbook

Rule 3 requires every reference and ordinal to be self-identifying: identity is established at
first mention, or by an immediately visible heading, column label, or legend. The patterns below
convert a bare reference into a self-identifying one.

| Bare form (forbidden) | Self-identifying form (required) | Pattern |
|---|---|---|
| `05 §2가 지목한 두 출처` | `문서 05(§2, "출처 신뢰도 기준")가 지목한 두 출처` | Attach the document's subject/title in parentheses at first mention. |
| `10 §2.1` | `10(§2.1) = CLI가 아는 설정 키 목록` | Use `{id} = {one-line identity}` when the reference recurs across the document — define it once, reuse the short id afterward. |
| `11 §10.1` | `문서 11 §10.1의 거버넌스 승인 절차` | Name the rule's subject inline instead of leaving the number to carry the meaning alone. |
| `그 필드` (after a table with no legend) | Add a legend row or restate the column label in the cell: `상태 필드(status)` | A table establishes identity only if it has a column label or legend; otherwise state identity in each cell. |
| `이 보고서` | `이 완료 보고서(§4 검증 섹션)` | When referring back to a document already being written, name the specific section, not just "this document". |

The underlying rule: a reader who has not read the referenced document, and has no other
context, must still be able to tell what the reference is and roughly what it says, from the
reference text alone — not by following a link and reading the source.

## Worked Example — Decision Request

Explaining a new `graph_version` tier to a reader who must approve or reject it.

### Bad version

> ## 지금 상황
>
> 티어 1·2 출처 신설. 05 §2가 지목한 두 출처, 10 §2.1, 11 §10.1을 반영했습니다.
>
> ## 1. 기계적 가드 3개가 반드시 먼저 터집니다
>
> 스키마 검증에서 `graph_version` 필드가 없으면 실패합니다.
>
> ## 판단이 필요한 작은 것 3개
>
> - 기본값을 뭘로 할지
> - 마이그레이션 순서
> - 롤백 범위

Four defects, each traceable to a HARD rule in the parent contract:

1. **Bare reference numbers** (violates rule 3) — `05 §2가 지목한 두 출처`, `10 §2.1`, `11 §10.1`
   give a number with no statement of what the document is or what the rule inside it says. A
   reader who has not opened document 05 cannot evaluate the claim.
2. **Missing history** (violates rule 4, background step) — the response opens with "티어 1·2
   출처 신설" as an announced fact, and never explains why the tier concept exists or what
   problem it solves. A reader cannot judge whether the tier is well-motivated.
3. **No decision support** (violates rule 9) — "판단이 필요한 작은 것 3개" lists three items with
   no options, no recommendation, and no stated impact. The reader is left to either approve the
   whole thing blind or reject it outright — there is no middle ground offered.
4. **Conversational subheadings** (violates rule 2) — "1. 기계적 가드 3개가 반드시 먼저 터집니다"
   is a sentence-form heading narrating what happens, not a noun phrase naming the section's
   content category.

### Good version, corrected along three axes

**Axis 1 — reorder** into the unresolved-problem skeleton: current state -> why this is not a
simple task -> what else is affected -> items needing a decision.

**Axis 2 — give every reference an identity.** `10` becomes `10 = CLI가 아는 설정 키 목록`,
defined once and reused.

**Axis 3 — show a real code excerpt** instead of a bare claim, e.g. `generate_schema.py:342`.

> ## 현재 상태
>
> `graph_version` 필드가 스키마에 없으면 검증이 실패합니다 (`generate_schema.py:342`,
> `REQUIRED_FIELDS`에 `graph_version` 추가).
>
> ## 설계 근거
>
> 문서 10(§2.1) = CLI가 아는 설정 키 목록 — 이 목록에 `graph_version`이 없으면 CLI가 신규 필드를
> 인식하지 못해 조용히 무시합니다. 문서 05(§2, "출처 신뢰도 기준")가 지목한 두 출처는 이 필드가
> 기록해야 할 근거의 최소 요건을 정의합니다.
>
> ## 영향 범위
>
> `generate_schema.py`를 호출하는 3개 진입점(§10.1, 문서 11의 거버넌스 승인 절차 대상) 모두
> 이 필드를 채워야 통과합니다.
>
> ## 판단이 필요한 항목
>
> **Options:**
> - 기본값 `null` 허용 — 기존 데이터와 호환되지만 검증을 약화시킴
> - 기본값 강제 지정 — 검증은 엄격해지지만 기존 데이터 전량 마이그레이션 필요
>
> **Recommendation:** 기본값 강제 지정 — 이번 변경의 목적이 검증 강화이므로 `null` 허용은 목적과
> 상충합니다.
>
> **Impact:** 마이그레이션 스크립트 1개 추가, 기존 레코드 재검증 1회 필요.
