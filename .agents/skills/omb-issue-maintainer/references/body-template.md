# Korean issue addition

Fill the template with verified context in Korean. Preserve paths, symbols, exact source quotations, and URLs. Omit sections 4–6 when no decision is needed; do not invent options. State uncertainty explicitly. This is `body_addition`, not a replacement for the original issue. Do not include the writer's body markers in the addition.

```markdown
## 1. 맥락(배경)

{현재 동작, 영향을 받는 사용자·경로, 기대 동작과 실제 문제}

## 2. 원인

- 확인된 사실: {고정 SHA의 코드·재현·댓글에서 확인한 사실과 근거}
- 가설 / 미확인: {추가 확인이 필요한 원인과 확인 방법; 없으면 생략}

## 3. 해결방안

{변경할 동작, 영향 범위, 검증 방법}
{통합하는 원본마다 고유 요구사항·제약·회귀 조건을 빠짐없이 반영}

## 4. 의사결정 옵션

| 옵션 | 변경 내용 | 장점 | 비용·제약 |
|------|-----------|------|----------|
| A | {실행 가능한 대안} | {근거} | {근거} |
| B | {실행 가능한 대안} | {근거} | {근거} |

## 5. 추천 옵션

{추천 옵션과 적용 조건; 사람의 미해결 결정을 승인된 것으로 표현하지 않음}

## 6. 추천 사유

{요구사항 충족, 영향 범위, 운영·유지보수 비용에 대한 근거}

## 7. 관련 PR / Issue

- {실제로 확인한 링크와 관계: 원본 / 대표 / 참고 / 구현 PR}
- {브랜치가 달라 링크만 유지하는 경우 그 이유}

## 8. 관련 코드

| 파일과 줄 | 브랜치 / 고정 커밋 SHA | 확인한 사실 |
|-----------|------------------------|-------------|
| [{path}:{line_start}-{line_end}](https://github.com/{owner}/{repo}/blob/{full_commit_sha}/{path}#L{line_start}-L{line_end}) | `{branch}` / `{full_commit_sha}` | {해당 인용으로 확인한 범위만 서술} |

## 완료 조건

- [ ] {관찰 가능한 공통 완료 조건}
- [ ] {원본별 고유 요구사항과 회귀 검증}
- [ ] {통합 backport일 경우 각 브랜치 이름과 완료 기준}
```

For consolidation, write a `RequirementCoverage` entry for every distinct retained source requirement: `source_issue`, verbatim `source_quote`, and exact `canonical_quote` present in this addition. One superficial quote per source is not sufficient. Preserve unresolved requirements; if their completeness or shared completion cannot be established, retain links and leave the sources open.

The renderer owns only this boundary:

```text
<!-- omb-issue-maintainer:body:v1:start -->
{body_addition}
<!-- omb-issue-maintainer:body:v1:end -->
```

It appends or replaces one valid owned block and preserves every byte outside it. Empty additions preserve the original byte-for-byte. Malformed owned markers require deferral.
