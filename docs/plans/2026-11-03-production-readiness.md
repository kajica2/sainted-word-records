# Production readiness programme — 2026-11-03

## Problem
The repository has substantial checks, but main is unprotected, deployment is independent of CI, and the visual-correction check can manufacture a passing DOM. This plan tracks completion evidence rather than treating documented intentions as controls.

## Milestones
| Order | Scope | Acceptance evidence |
|---|---|---|
| 1 | Trustworthy CI and visual assertions | Missing controls fail without injection; CI runs on main and PRs; exact commit has passing checks |
| 2 | Release enforcement | Protect main with required review and checks; confirm canonical Vercel project; verify promotion uses tested SHA |
| 3 | Durable production configuration | Fail closed when durable stores are absent; verified database TLS; shared rate limiting; configuration tests |
| 4 | Security hardening | Private-media policy, write-request protections and staged CSP, with adversarial tests |
| 5 | Operations | Named incident owner, alerts, backup retention and demonstrated restore/rollback |
| 6 | Maintenance | Documentation reconciled with code; dependency scans; incremental extraction of duplicated engine logic |

## Initial implementation
- Run existing CI on pushes including main; set read-only workflow permissions and an explicit timeout.
- Change the visual checker to observe controls without creating them, and fail when controls remain missing.
- Exercise missing Settings, Profile, Save, top bar, action container, panel and scenes in dependency-free regression tests.
- Run visual assertions against the checked-out source on PRs/main, replacing the fixed-delay live-domain probe. This establishes source assertions; it does not prove deployment health.

## Existing work and dependencies
Preserve PR #267 (CI repair), #271 (slow-frame benchmark), and #272 (silent media-source reset). Their chain must be reviewed and reconciled before declaring baseline CI healthy. Keep #264 (QA foundation), #268 (scene persistence), and #270 (audio changes) separate.
This branch starts from main; it intentionally does not duplicate those fixes or increase media budgets.

## Verification
Run node --test tests/visual-correct.test.mjs and node --check scripts/visual-correct.mjs.
The PR workflows must run the full repository checks and real-browser Command Center check. Fixture tests establish failure detection only; browser and deployment verification remain required.

## Boundaries
No production merge, deployment, secret changes, or repository protection changes in this milestone. At most two concurrent workstreams, no paid model APIs.
Branch protection and Vercel release controls remain pending settings work; running CI on main alone does not prevent deployment.
No dependencies are introduced.

## Rejected approaches
- DOM injection inside QA: hides missing shipped controls.
- Fixed sleep followed by shared production URL: can test the wrong commit.
- Replacing existing repair PRs: duplicates work and obscures dependencies.
