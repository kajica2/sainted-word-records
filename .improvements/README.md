# .improvements/

Long-running integration plans drafted by the autonomous improvement worker.

## Layout

- `YYYY-MM-DDTHH-MM-<type>-<slug>.md` — a plan (one per cron cycle, mostly)
- `STATE.json` — last-cycle cursor; updated by the worker each run
- `archive/` — plans older than ~30 days that haven't been integrated

Cycle ID format: local-time `YYYY-MM-DDTHH-MM` (matches the cron's timestamp).
Slug: short kebab description.

## Plan types

| Type | Meaning |
|------|---------|
| `speed` | A perf win on the render path, audio path, or bundle size |
| `quality` | A refactor / dedup / cleanup with measurable payoff |
| `industry-template` | A new industry landing page + demo flow + asset picks |
| `use-case` | A concrete persona scenario with copy + UX flow |
| `image-asset` | A generated image for an existing surface (spec, not the image itself) |

## How a plan becomes work

1. Worker drafts the plan here.
2. You (or a session agent) read it cold — it must be self-contained.
3. If approved: integrate by hand or assign to a follow-up agent; move the plan to `archive/` with `integrated: YYYY-MM-DD` in STATE once done.
4. Worker avoids re-proposing archived topics (see `STATE.json:covered_topics`).

## The worker

Cron job `engine-improvement-worker` runs every 2h from the `default` profile, attached to this repo's `workdir`. Pause with `hermes cron pause <job_id>`; resume with `hermes cron resume <job_id>`. See `~/.hermes/skills/engine-improvement-worker/SKILL.md` for the loop spec.