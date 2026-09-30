# Plain Language

Adapted from `~/.claude/skills/bc-humanizer/SKILL.md` (patterns 1-5 at lines 89, 99, 106, 113,
and 126; the overcorrection guard at lines 77-81), credited per the source-credit rule in
`.claude/rules/workflow/00-research.md`. Detailed authoring guidance for rule 11(b) of
`.claude/rules/common/explanation-style.md`: write the body in plain spoken register and avoid
the listed AI-writing patterns. **The ban itself is declared by rule 11(b)**; this file supplies
worked examples, the overcorrection guard, and the boundary of application only.

## Audience

Rule 11 fixes the reader for every response the rule fires on: a developer who did not write
this code. Write for that fixed reader without asking who they are first; this file inherits
the role rule 11 already set and adds no separate role-selection step of its own. Technical
terminology and architecture description stay intact; this is not a simplification mandate.

## Banned Patterns - Worked Examples

Each row names one of the patterns rule 11(b) bans, a banned example, and a replacement that
keeps the same meaning in plain spoken register.

| Pattern | Banned example | Replacement example |
|---|---|---|
| Translated-English construction | `AI에 대해 이야기하면` | `AI 이야기를 하면` |
| Empty intensifier | `정말 중요한 변경입니다` | `이 변경은 캐시 적중률을 12%p 올립니다` |
| Closing filler with no content | `앞으로가 기대됩니다` | `다음 단계는 로그 모니터링입니다` |
| Bold-label bullet as a section opener | `- **성능**: 처리 속도를 끌어올렸습니다.` | `처리 속도를 끌어올렸습니다.` |
| Colon announcing a list | `이번에 바뀐 것들:` | `이번 버전에서는 캐시 정책을 바꿨습니다.` |
| Em dash | `배포는 끝났다 — 다음은 모니터링이다` | `배포는 끝났다. 다음은 모니터링이다.` |
| Interpunct enumeration | `해시·정렬셋·TTL` | `해시, 정렬셋, TTL` |

## Overcorrection Guard

Applying every banned pattern above at maximum strength homogenizes the prose it touches: every
sentence ends up the same length, the same register, and the same shape, and the result reads
as machine-written again, just a different machine style instead of no machine style at all. A
sentence that already sounds natural is left alone. Do not rewrite a paragraph solely to prove
the ban was applied; rewrite only the clauses that actually match a pattern in the table above.
The irregularity of natural writing (a short sentence, a sentence that starts mid-thought, a
slightly spoken turn of phrase) is a feature, not a defect to normalize away.

## Exemptions

This ban does not override:

- **Rule 9's Decision Block.** The template in
  `.claude/skills/omb-explain/rules/decision-block.md:9-17` opens with a `**Options:**` label
  followed by a bullet list, the same bold-label-plus-bullet shape rule 11(b) otherwise bans.
  Rule 11(b) carries this carve-out directly ("This ban never overrides a format that rule 9 or
  a skill/workflow prescribes."); this file names the boundary case so the Decision Block shape
  is never flagged as a violation of the plain-language ban.
- Any output format a skill or workflow prescribes.
- Fenced code blocks, quotations, identifiers, and commit/PR titles.
- Sub-agent narrative report prose and sub-agent result envelopes, inherited from
  `.claude/rules/common/explanation-style.md:10-12`.
