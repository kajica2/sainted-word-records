# Protecting `main` — the exact ruleset, and how to verify it

> **This document is for a repo admin. It was written by an agent that is not
> allowed to change branch protection, and did not try.**
>
> The KAI SWARM recovery programme ([Issue #269](https://github.com/kajica2/sainted-word-records/issues/269))
> found a structural gap: `main` had **no CI baseline by construction**, and it is
> **not protected**. Vercel auto-deploys `main`, so an unreviewed direct push
> reaches production without the browser smoke suite ever running.

---

## 1. The gap, in facts

| Fact | Where it comes from |
|---|---|
| The CI workflow runs on **pull requests to `main`** and on **pushes to `main`** | `.github/workflows/ci.yml` — `on.push.branches: [main]` |
| The CI job is named `check + verify + build-size` | `.github/workflows/ci.yml` — `jobs.ci.name` |
| Vercel auto-deploys `main` to production | project `sainted-word-records` |
| `main` reports `protected: false` | GitHub branch metadata, 2026-11-02 22:37 UTC |

The consequence is precise: **a green run in the Actions list that says `main`
is not this workflow.** The green `main` runs observed on 2026-11-02 were
*Register Invite Codes* — a different workflow entirely.

Two independent failures are therefore possible today:

1. a direct push to `main` reaches production with no smoke suite ever
   running against it;
2. a PR is merged with a red or missing check, because nothing requires the
   check.

> **Update, 2026-11-05 (#275).** `ci.yml` now triggers on `push.branches:
> [main]` as well as `pull_request` — the duplicate-context bug that made
> the required check ambiguous is fixed, and every commit gets exactly ONE
> `check + verify + build-size` run. `main` therefore DOES get a CI run of
> its own now, so failure (1) above is already half-closed: a direct push
> still reaches production unreviewed, but it is no longer invisible. The
> ruleset below is what closes it: it makes the check a gate rather than a
> report.

A branch ruleset closes both.

---

## 2. The settings, step by step (UI)

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**

| Field | Value |
|---|---|
| Ruleset Name | `main` |
| Enforcement status | **Active** |
| Target branch | **Include** → `main` (the default branch) |
| Bypass list | **empty** — no actor may push without the ruleset |

### Restrict pushes
* **Do not allow anyone to push to this branch.**
* Do **not** tick "Restrict deletions" only — you want both creation and update
  blocked, i.e. every change to `main` arrives through a pull request.

### Require a pull request before merging
| Setting | Value | Why |
|---|---|---|
| Required approvals | **0** | **this repository has ONE collaborator**, and GitHub refuses a self-approval outright (*"Review Can not approve your own pull request"*) — so a required approval could never be satisfied and the ruleset would wedge `main` permanently. See §2b. |
| Dismiss stale approvals when a new commit is pushed | **on** | an approval must be for the code that merges |
| Require approval from the most recent pusher | **off** | moot at 0 approvals, and it is the setting that makes the wedge worst — it bars the only person who could approve |
| Require conversation resolution | **on** | no unresolved threads at merge time |
| Allowed merge methods | **Squash** and **Rebase** | `required_linear_history` forbids a merge commit, so "Merge" is unreachable however the list reads. The history contains merge commits (`Merge branch 'cursor/…'`) and squash merges (`feat(neon): … (#266)`); the linear-history rule means new merges must be squash or rebase. |

> **Two of these values contradict each other in the UI.** "Require linear
> history" disables the *Create a merge commit* button outright, so leaving
> "Merge" in the allowed list does not make merge commits available — it
> only makes the list look inconsistent. Pick **Squash and Rebase**.

### 2b. The one-collaborator problem (read this before setting approvals)

This repository has **exactly one** collaborator with push access, and every
branch commit is pushed as that account. GitHub **refuses a self-approval**
at the API level:

```
GraphQL: Review Can not approve your own pull request (addPullRequestReview)
```

So a ruleset that asks for **1 approving review** can never be satisfied here.
It does not fail loudly and it does not wait — the PR simply sits at
`mergeStateStatus=BLOCKED`, `reviewDecision=REVIEW_REQUIRED`, forever. That
was measured on PR #276: a **green** required check, and still unmergeable.

`require_last_push_approval: true` makes it strictly worse: it bars the one
person who could have approved.

**For a solo operator the working shape is `required_approving_review_count:
0`.** The real gate is then the status check: every change arrives through a
pull request, and `check + verify + build-size` must be green on it. What is
lost is the "a second human must look at this" property — which was never
available here anyway.

**If a second collaborator is ever added**, put the count back to 1 (and
`require_last_push_approval` back to on). The ruleset can be edited in place:
the `rules` array is replaced wholesale on update, so a PUT must carry every
rule, not just the one being changed.

### Require status checks to pass
| Setting | Value |
|---|---|
| Status check | **`check + verify + build-size`** |
| Require branches to be up to date before merging | **on** (strict) |

> **The context string is the JOB name, not `CI / check + verify + build-size`.**
> GitHub's UI *displays* `CI / check + verify + build-size` (workflow / job), but the
> branch-protection API matches on the job name alone. If you paste the UI string,
> the rule is created and then never satisfied — and the symptom is a PR that can
> never be merged. If you are unsure, type it into the picker: GitHub's dropdown
> only offers contexts it has actually seen on a PR to `main`.

### Bypass list
Leave it empty. The whole point is that **no path to production skips the gate**.

---

## 3. The same thing as a ruleset (API)

For an admin who would rather script it:

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_approving_review_count": 0,
        "required_review_thread_resolution": true,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          { "context": "check + verify + build-size" }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
```

> **The parameter is `strict_required_status_checks_policy`.** The shorter
> `strict_required_status_checks` is **rejected** by the API with
> `422 — Invalid property /rules/2: data matches no possible input`. The
> payload above is the one that is applied to this repository (ruleset
> `26608109`) as of 2026-11-05.
>
> **`required_approving_review_count` is 0, not 1, on purpose.** See §2b: this
> repository has one collaborator, GitHub refuses a self-approval, and a
> required approval would leave `main` permanently unmergeable. The status
> check is the gate.

```bash
gh api --method POST repos/kajica2/sainted-word-records/rulesets \
  --input ruleset.json
```

**One mapping to be careful about.** In the UI, *"Restrict pushes → Do not allow
anyone to push to this branch"* is expressed by the **absence** of the `update`
rule: a ruleset that lists `creation`, `update` and `deletion` allows push
admins to push directly (with force-push blocked), while a ruleset **without**
`update` requires every change to arrive through a pull request. The JSON above
omits `creation`/`update`/`deletion` for that reason — that is the strict
reading, and it is what the UI step in §2 produces.

> A repository administrator can always break a ruleset (the UI offers an
> explicit "break" action that is itself audited). This reduces the accidental
> and the unreviewed path. It does not make the platform tamper-proof, and the
> document does not claim it does.

---

## 3b. What was applied on 2026-11-05

The ruleset in §3 was **applied to this repository on 2026-11-05** (ruleset
`26608109`, enforcement `active`, target `main`, bypass list empty). The API
answered `current_user_can_bypass: never` — **nobody, including the repository
owner, can push around it**; the only way through is the audited "break" the
ruleset action in the UI.

### The first application wedged `main`, and why

The ruleset in §3 was **applied to this repository on 2026-11-05** (ruleset
`26608109`, enforcement `active`, target `main`, bypass list empty). The API
answered `current_user_can_bypass: never` — **nobody, including the repository
owner, can push around it**; the only way through is the audited "break" the
ruleset action in the UI.

Applying it needed one correction to the payload above (§3): the API rejects
`strict_required_status_checks` and requires
`strict_required_status_checks_policy`. The ruleset was created without the
status-check rule, then updated with it — the update is a full replacement of
the `rules` array, so all three rules must be in it.

**The payload as first written also wedged `main`, and that was not obvious.**
It asked for **1 approving review** with `require_last_push_approval: true`.
This repository has one collaborator, and GitHub refuses a self-approval, so
the review could never be satisfied: every PR sat at
`mergeStateStatus=BLOCKED` with `reviewDecision=REVIEW_REQUIRED` while its
required check sat **green**. The ruleset was not "waiting for a review" — it
was waiting for a person who does not exist.

The fix is in §2b: `required_approving_review_count: 0` and
`require_last_push_approval: false`. The ruleset was edited in place (the
`rules` array is replaced wholesale, so the PUT carried all three rules). The
status check remains the gate.

### What was verified, and what was not

| Check | Result |
|---|---|
| §4.1 the ruleset is live and active | **verified** — `GET /rulesets/26608109` → `enforcement: active`, `bypass_actors: []`, `current_user_can_bypass: never`; `GET /rules/branches/main` returns all three rules as applying to `main` |
| §4.2 a direct push is refused | **verified, without touching `main`** — `PATCH /git/refs/heads/main` with the branch's **current** sha (a no-op update, so the ref could not change) → **`422 Repository rule violations found — Changes must be made through a pull request`** |
| §4.3 the required context is the check that runs | **verified** — `gh pr checks` reports the context as `check + verify + build-size`, exactly as configured (not `CI / check + verify + build-size`) |
| §4.4 a red or missing check blocks the merge | **verified** — PR #276 has a **green** required check and was still `mergeStateStatus=BLOCKED` while the approval count was 1: the review gate held it. After the count went to 0 the PR merged on its green check, which is the intended behaviour for a one-collaborator repository |
| §4.5 the workflow runs where it should | **verified** — the CI run on the merge commit `60cb1722` is green, and `main` pushes now trigger the workflow |

**§4.2 was deliberately probed with a no-op rather than a real commit.** A
real `git push origin HEAD:main` would have moved `main` — and Vercel deploys
`main` — if the ruleset had been misconfigured. The same-sha `PATCH` asks the
server exactly the same question ("may this ref be updated?") and cannot change
the ref either way.

### 4.1 The ruleset is live and active

```bash
gh api repos/kajica2/sainted-word-records/rulesets \
  --jq '.[] | {name, enforcement, target, rules: [.rules[].type]}'

gh api repos/kajica2/sainted-word-records/branches/main/protection \
  --jq '{required_status_checks, required_pull_request_reviews, enforce_admins}'
```

Expect: `enforcement: active`, a `pull_request` rule with
`required_approving_review_count: 0` and `require_last_push_approval: false`
(see §2b), and a `required_status_checks` entry whose `context` is exactly
`check + verify + build-size`.

> The `branches/main/protection` endpoint reports the **legacy** branch
> protection API, which a ruleset does not populate — it will show
> `enabled: false` and empty `required_status_checks` even though the
> ruleset is live and active. That is not a failure; read the ruleset
> endpoint instead.

### 4.2 A direct push is refused

```bash
git push origin HEAD:main
# remote: error: GH006: Protected branch update failed.
# remote: error: Changes must be made through a pull request.
```

### 4.3 The required check is the one that runs

```bash
gh pr list --state open --limit 1 --json number
gh pr checks <number>
# check + verify + build-size   pass
```

If `gh pr checks` reports the context as `CI / check + verify + build-size` but
the PR still cannot merge, the ruleset is requiring the wrong string. Fix the
context to the job name.

### 4.4 A red check blocks the merge

Open a PR whose CI fails and try to merge. GitHub must refuse with
*"Required status check `check + verify + build-size` is expected"*. A merge
button that is merely greyed out for the wrong reason is not a verification —
read the message.

> With `required_approving_review_count: 0` the **only** refusal message you
> should see is the status-check one. If the message says *"At least 1
> approving review is required"*, the approval count is still 1 — see §2b.

### 4.5 The workflow still runs where it should

The ruleset does **not** change when the workflow runs. `ci.yml` triggers on
both events, and each commit gets exactly ONE run of the required job:

- `pull_request` → `main`: the required check runs ✓
- push → `main`: the required check runs ✓ (since #275 — see the update note
  in §1). The ruleset makes that push impossible anyway, so it is a
  post-merge REPORT rather than a gate; the gate is the PR's own run.

This is the shape that makes the ruleset safe to enforce: the check fires on
the merge itself, so a broken `main` is caught within one run rather than
being discovered by the next person to touch the repo.

The earlier shape of this workflow — `push.branches-ignore: [main]` — was
wrong in a way that only the ruleset could have masked, and it also
published a DUPLICATE `check + verify + build-size` context for every
branch commit that had an open PR (one from `push`, one from
`pull_request`). GitHub matches a required check by context NAME, so the
pair was ambiguous and a green commit reported UNSTABLE. #275 fixed the
trigger to `push.branches: [main]`.

> **Note on CI minutes.** A push to `main` now costs one more run than it
> used to. That is the deliberate trade: the run reports on the merged
> result instead of leaving `main` unverified.

---

## 5. What this does not do

- It does not merge anything, and it does not deploy anything.
- It does not change the Node version used by CI (20) or by Vercel (24). That
  reconciliation needs a cross-version test matrix first.
- It does not replace the `check:full` gate itself. It makes the gate
  **mandatory** instead of advisory.
- **It does not give a solo repository a second pair of eyes.** With
  `required_approving_review_count: 0` the guarantee is *"every change to
  `main` passed the full suite on a pull request"* — not *"a human read it
  first"*. That second property needs a second collaborator (§2b); it cannot
  be configured into existence.

---

## 6. Why now — and what must be true first

The baseline run on clean `main` (`3e663405`, 2026-11-04) failed **9 of 33**
`check:full` steps. The repair was [PR #275](https://github.com/kajica2/sainted-word-records/pull/275),
merged as `60cb1722` on 2026-11-05 with all 14 CI steps green.

There was a second, less obvious precondition, found on the same day: **the gate
is not yet deterministic.** On the *same commit* `8aa49ada`, two CI runs started
six seconds apart gave opposite verdicts:

| Run | Event | Verdict |
|---|---|---|
| [41865245728](https://github.com/kajica2/sainted-word-records/actions/runs/41865245728) | push | **failure** — `full: 1/33 step(s) FAILED: npm run check:bench-smoke` |
| [41865260224](https://github.com/kajica2/sainted-word-records/actions/runs/41865260224) | pull_request | **success** |

The failing assertion was a timing threshold in `scripts/check-bench-smoke.mjs`
(`offQ - onQ >= 4` — the non-interpolated sampling error must exceed the
interpolated one by at least 4 ms). The failed run measured **0.0 vs 3.5 ms**;
the passing run measured **0.0 vs 9.7 ms**. The measurement is against a
real-time audio clock, so the margin depended on runner scheduling.

**Why this matters for the ruleset specifically:** a required status check that
is occasionally red turns every merge into a coin toss. The operator will learn
to re-run the failed check, and the gate stops being a signal. The old
workflow ran on both `push` (non-`main`) and `pull_request` to `main`, so every
PR ran the whole suite **twice, concurrently** — which is exactly the
condition that produced the two opposite verdicts above.

Both preconditions are now met:

1. **the `check:bench-smoke` timing flake is fixed** — the assertion no longer
   compares two RUNS (whose difference is only as large as the phase allows);
   it sweeps the buffer and asks for a label deliberately *between* two
   samples, where the non-interpolated answer is as far wrong as it can be.
   The measured difference is half a period (8.3 ms at 16.7 ms), whatever the
   runner's scheduling does. The cold first run is discarded and the A/V floor
   moved into the median, so a slow runner no longer fails a run that measured
   correctly. The fix is mutation-tested: disabling interpolation fails three
   assertions.
2. **the repair landed** — PR #275 merged as `60cb1722`, green locally on all
   33 `check:full` steps and green on CI.
3. **the duplicate run is gone** — `ci.yml` now triggers on `push.branches:
   [main]` and `pull_request`, so each commit gets exactly ONE run of the
   required job. The concurrent double-run that produced the coin toss is
   gone.
4. **next: apply the ruleset**, then re-run the baseline to confirm `main` is
   green.

Applying the ruleset before those fixes was not wrong — it would have been
*safe* — but it would have blocked the repair from landing until the check
was green, and it would have turned any future flake into a blocked merge.
That is a feature for a deterministic gate and a bug for a flaky one.
