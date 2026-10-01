# Report Anatomy

Detailed authoring guidance for the completed-work skeleton (rule 4, second variant) and rule 5
("do not lead a completion report with verification statistics") of
`.claude/rules/common/explanation-style.md`. Read this file when reporting that a task,
implementation, or fix is finished.

## Five-Step Completion-Report Order

The completed-work skeleton, instantiated for a task-completion report:

1. **Change and rationale.** What changed, and why — the rationale, not a restatement of the
   original request. Answer "why did this change happen" before anything else. This is the step
   rule 5 protects: verification numbers do not belong here, and they do not belong first in the
   report at all.
2. **Impact.** Who or what is affected by the change — callers, consumers, other services, other
   teams. Name concrete affected parties; do not use "everything" or "nothing" without evidence.
3. **Trade-offs.** What was lost or given up to make the change (rule 10). State a removal,
   reduction, or deprecation as a fact, never as an unqualified win. If nothing was lost, say so
   explicitly rather than omitting the step silently.
4. **Verification.** Evidence that the change works, interpreted against a baseline and an
   expected value (rule 6) — never a bare count. This step comes fourth, not first.
5. **Next steps.** What remains, in priority order. If nothing remains, say so; do not pad with
   generic follow-ups.

Omit a step only when it genuinely has no content (rule 4) — a trivial one-line fix with no
trade-off does not need an empty Trade-offs heading, but skipping a step because writing it is
inconvenient is not permitted.

## Number Interpretation

Rule 6 requires every number used as evidence to be interpreted against its baseline and
expected value. A count with no baseline forces the reader to guess whether it is good or bad
news.

**Bad (uninterpreted dump):**

> 398 passed, 1 skipped (400 → -2)

This states a delta with no explanation of whether `-2` is expected or a regression, and does
not say what happened to the skipped test.

**Good (baseline + expected value stated):**

> 398 passed, 1 skipped (400 → -2) — the two fewer passing tests are expected: they covered the
> `graph_version` axis removed in this change. The one skip is `test_legacy_migration`, disabled
> pending the follow-up migration script (Next Steps, item 1).

Conversion pattern: `{count} {result} ({baseline} → {delta})` is not sufficient by itself — it
must be followed by a clause stating *why* the delta is expected, or flagging it as unexpected
and unresolved. Apply the same pattern to any other interpreted metric, e.g.
`0 violations / 19 files` becomes `0 violations / 19 files — full pass, up from 3 violations
before this change (all three were the missing `graph_version` field check)`.

Identifiers are exempt from this rule (rule 6): a port number, a version string, a line number,
or an option number does not need baseline interpretation because it is not being used as
evidence of a result.

## Failure Checklist

Six defects to check for before sending a completion report. Each pairs with the HARD rule it
violates.

1. **서술 순서가 중요도순이 아님** (violates rule 5 / the five-step order above) — 검증 숫자가
   맨 앞, 철회 근거는 8번째 문단, 잃은 것(추적성)은 "하나만 짚어둡니다" 아래에 배치됨. 중요도가
   아니라 작성 순서로 문단이 배열되어 있다는 신호다.
2. **해석 없는 숫자 덤프** (violates rule 6) — `398 passed, 1 skipped (400 → -2)`,
   `0 violations / 19 files` 를 좋은 신호인지 나쁜 신호인지 밝히지 않고 나열. 읽는 사람이 델타의
   의미를 스스로 추측해야 한다.
3. **벌거벗은 참조표** (violates rule 3) — `19 | §1.1 버전 축, §10 거버넌스 절 전체` 처럼 문서
   19·05가 무엇이고 §1.1이 무슨 규칙이었는지 없음. 표에 범례나 열 레이블이 없으면 각 셀에 정체성을
   직접 적어야 한다.
4. **결론만 있고 경위 없음** (violates rule 4, step 1) — "그래프 버전 축을 전면 철회했습니다"로
   시작해 왜 도입했고 무엇이 바뀌어 철회에 이르렀는지가 빠짐. 결론보다 먼저 "왜"가 나와야 한다.
5. **사실을 기울여 표현** (violates rule 10) — "덤으로 미결 하나가 사라졌습니다" — 해결된 것이
   아니라 대상이 없어진 것인데 이득처럼 읽힘. 삭제·축소·소멸은 해결된 문제로 재포장하지 않는다.
6. **맥락 없는 마무리 한 줄** (violates rule 4, step 5) — "다음 작업 후보는 `agents/pm_agent/`
   참조 구현입니다" 를 왜 그것이 다음인지 설명 없이 던짐. Next Steps 항목도 우선순위와 근거가
   있어야 한다.

## Worked Example — Completion Report

A bad report exhibiting all six defects above, contrasted with a rewrite in the five-step order.

### Bad version

> ## 검증 결과
>
> 398 passed, 1 skipped (400 → -2). 0 violations / 19 files.
>
> ...(중략, 8개 문단 이후)...
>
> 그래서 그래프 버전 축을 전면 철회했습니다. 근거는 문서 19 | §1.1 버전 축, §10 거버넌스 절
> 전체였습니다.
>
> 하나만 짚어둡니다: 덤으로 미결 하나가 사라졌습니다.
>
> 다음 작업 후보는 `agents/pm_agent/` 참조 구현입니다.

This example leads with an uninterpreted verification dump (defect 2, also defect 1 — wrong
order), buries the rationale eight paragraphs in (defect 4), cites document 19 with no stated
identity (defect 3), reframes a removed unresolved item as a bonus gain (defect 5), and ends
with an unexplained next step (defect 6).

### Good version, five-step order

> ## 변경 및 근거
>
> 그래프 버전 축(`graph_version` 필드와 그 검증 경로)을 전면 철회했습니다. 문서 19(§1.1, "버전
> 축 정의")와 문서 05(§10, "거버넌스 승인 절차")를 재검토한 결과, 버전 축이 해결하려던 문제(스키마
> 하위 호환성 추적)는 이미 §10 거버넌스 승인 절차가 별도로 담당하고 있어 중복 구현이었습니다.
>
> ## 영향
>
> `generate_schema.py`를 호출하는 3개 진입점과, 버전 축을 참조하던 CLI 옵션 1개가 제거 대상입니다.
> 이 옵션을 사용하던 외부 호출자는 없었습니다(최근 30일 로그 확인).
>
> ## 트레이드오프
>
> 버전 축이 제공하던 세밀한 필드 단위 추적성을 잃었습니다. 이는 손실이며, §10 거버넌스 절차가
> 문서 단위 추적성만 제공하므로 완전히 동등한 대체는 아닙니다. 미결 항목이었던 "버전 축 기본값
> 결정" 하나는 대상 자체가 사라지며 함께 제거되었습니다 — 해결된 것이 아니라 대상이 없어진
> 것입니다.
>
> ## 검증
>
> 398 passed, 1 skipped (400 → -2) — 2개 감소는 예상된 결과입니다(제거된 버전 축을 다루던 테스트
> 2개). 1개 skip은 `test_legacy_migration`으로, 다음 단계의 마이그레이션 스크립트 완료 후
> 재활성화합니다. 0 violations / 19 files — 이전 3건에서 0건으로, 제거된 필드를 참조하던
> lint 규칙 3개가 함께 제거되어 발생한 감소입니다.
>
> ## 다음 단계
>
> 1. `test_legacy_migration` 재활성화를 위한 마이그레이션 스크립트 작성.
> 2. 버전 축 제거로 참조 구현이 필요 없어진 `agents/pm_agent/`를 정리 대상 후보로 검토 —
>    거버넌스 절차 전환 후 남은 유일한 참조 구현이기 때문입니다.
