# Protecting `main` — the exact ruleset, and how to verify it

> **This document is for a repo admin. It was written by an agent that is not
> allowed to change branch protection, and did not try.**
>
> The KAI SWARM recovery programme ([Issue #269](https://github.com/kajica2/sainted-word-records/issues/269))
> found a structural gap: `main` has **no CI baseline by construction**, and it is
> **not protected**. Vercel auto-deploys `main`, so an unreviewed direct push
> reaches production without the browser smoke suite ever running.

---

## 1. The gap, in facts

| Fact | Where it comes from |
|---|---|
| The CI workflow runs on **pull requests to `main`** and on **pushes to non-`main` branches** | `.github/workflows/ci.yml` — `on.push.branches-ignore: [main]` |
| The CI job is named `check + verify + build-size` | `.github/workflows/ci.yml` — `jobs.ci.name` |
| Vercel auto-deploys `main` to production | project `sainted-word-records` |
| `main` reports `protected: false` | GitHub branch metadata, 2026-11-02 22:37 UTC |

The consequence is precise: **a green run in the Actions list that says `main`
is not this workflow.** The green `main` runs observed on 2026-11-02 were
*Register Invite Codes* — a different workflow entirely.

Two independent failures are therefore possible today:

1. a direct push to `main` reaches production with no smoke suite at all;
2. a PR is merged with a red or missing check, because nothing requires the check.

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

The ruleset does **not** change when the workflow runs. `ci.yml` deliberately
excludes `main` pushes:

- `pull_request` → `main`: the required check runs ✓
- push → a non-`main` branch: the required check runs ✓
- push → `main`: **no CI run** — and after the ruleset, no direct push is
  possible anyway, so the merge is covered by the PR's check.

If the project later wants a CI run on `main` itself (a post-merge
verification, not a gate), that is a separate, additive workflow change:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

**Do not add it as part of this change.** It doubles the CI minutes on every
merge and, on a busy `main`, the post-merge run and the PR run can interleave.
The ruleset is the gate; the extra workflow is a report.

---

## 5. What this does not do

- It does not merge anything, and it does not deploy anything.
- It does not change the Node version used by CI (20) or by Vercel (24). That
  reconciliation needs a cross-version test matrix first.
- It does not replace the `check:full` gate itself. It makes the gate
  **mandatory** instead of advisory.

---

## 6. Why now

The baseline run on clean `main` (`3e663405`, 2026-11-04) failed **9 of 33**
`check:full` steps. A repair candidate exists (the integration branch, green on
all 33 locally) but has no CI-hosted verdict yet. **A ruleset on a red `main`
would block every merge** — including the one that carries the repair.

So the order matters:

1. land the repair (integration branch → draft PR → CI green → merge by a human);
2. then apply the ruleset;
3. then re-run the baseline to confirm `main` is green.

Applying the ruleset first is not wrong — it is *safe* — but it will stop the
repair from landing until the check is green, which is a feature, not a bug.
