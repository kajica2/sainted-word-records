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
| Required approvals | **1** | one human review; the repo has no CODEOWNERS file |
| Dismiss stale approvals when a new commit is pushed | **on** | an approval must be for the code that merges |
| Require approval from the most recent pusher | **on** | stops the author approving their own PR |
| Require conversation resolution | **on** | no unresolved threads at merge time |
| Allowed merge methods | **Merge** and **Squash** | the history contains merge commits (`Merge branch 'cursor/…'`) and squash merges (`feat(neon): … (#266)`) |

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
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["merge", "squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          { "context": "check + verify + build-size" }
        ],
        "strict_required_status_checks": true
      }
    }
  ]
}
```

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

## 4. How to verify it worked

### 4.1 The ruleset is live and active

```bash
gh api repos/kajica2/sainted-word-records/rulesets \
  --jq '.[] | {name, enforcement, target, rules: [.rules[].type]}'

gh api repos/kajica2/sainted-word-records/branches/main/protection \
  --jq '{required_status_checks, required_pull_request_reviews, enforce_admins}'
```

Expect: `enforcement: active`, a `pull_request` rule with
`required_approving_review_count: 1`, and a `required_status_checks` entry whose
`context` is exactly `check + verify + build-size`.

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
*"At least 1 approving review is required"* or *"Required status check
`check + verify + build-size` is expected"*. A merge button that is merely
greyed out for the wrong reason is not a verification — read the message.

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
