# Standalone review lifecycle

The `pr-review` CLI owns review-only state, observations and publication leases.
It does not create or manage scheduled jobs. All paths returned by `prepare` are
bound to the supplied primary root/worktree and original approved request.

```text
pr-review observe --state /absolute/returned/state.json
pr-review release --state /absolute/returned/state.json --lease-token TOKEN --observation-file /absolute/observation.json
pr-review close --state /absolute/returned/state.json --cleanup-evidence-file /absolute/cleanup.json
```

An observation acquires a bounded lease. Two separately observed identical clean
PR snapshots establish readiness; a changed head, base, diff or checks invalidates
that readiness. Releasing a lease requires the matching token and an actual
observation object. `snapshot` alone is read-only and never grants a lease.
Expired or foreign tokens cannot publish. Preserve a still-live publication lease
when a different observer sees a closed PR.

After publication, release the lease and close with cleanup evidence containing
`status: "not_applicable"` only when the helper verifies a terminal outcome.
Closed/merged PRs enter terminal cleanup instead of reopening publication.
Use the returned next action; never manufacture a successful cleanup record.

Existing review-only version1 states under `.omb/goal-monitor/<run-id>/state.json`
remain readable through their explicit paths. This path compatibility does not
restore the retired host's goal monitoring, cron bindings or runtime profile.
Do not enumerate or migrate existing operating state during a source upgrade.
