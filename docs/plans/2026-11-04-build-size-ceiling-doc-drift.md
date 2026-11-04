# Build-size ceiling: the documented number is stale

**Date:** 2026-11-04
**Status:** the AGENTS.md correction needs one manual edit (see "The fix" below).

## What is wrong

`AGENTS.md` states the CI build-size ceiling in two places, and both are wrong:

- **Line 605** — "build-size budget `≤ 180MB` (188,743,680 bytes …)"
- **Line 616** — "the ceiling is **188,743,680 B (180 MiB)**"

The workflow's actual constant is different:

```
.github/workflows/ci.yml
  BUDGET_BYTES=189792256      # 181 MiB
```

The ceiling was raised from 188,743,680 to 189,792,256 on 2026-11-03. The workflow
comment says why: the prior 180 MiB cap "left ~438KB headroom — media already on main
consumes it, so PR CI was red while deploy-on-main stayed green". The same commit added
the per-directory `check:media-budget` gate so a future growth names the offending
directory instead of only showing that the total moved.

`scripts/check-doc-truth.mjs` does **not** catch this: it verifies that a cited file
path, route, or global name resolves — it does not compare numeric claims against the
code that uses them. A budget constant is exactly the kind of claim that drifts
silently, because nothing reads the number back out of the workflow.

## The fix (one manual edit to AGENTS.md)

Both lines should read **189,792,256 bytes (181 MiB)**.

Line 605 becomes:

> … → `npm run build` → build-size budget → per-directory media budget. The build-size
> ceiling is **189,792,256 bytes (181 MiB)**, set as `BUDGET_BYTES` in the workflow and
> counted with `find dist/ -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}'` on a
> clean build. It was 188,743,680 B (180 MiB) until 2026-11-03, when the ~438 KB of
> headroom the shipped media had already consumed made PR CI red; per-directory growth
> is gated separately by `check:media-budget`.

Line 616 should likewise cite 189,792,256 B (181 MiB).

**Why this was not applied automatically:** `AGENTS.md` is a protected agent-instruction
file. The write guard requires an interactive approval, and the prompt timed out twice
in the session that found this. It needs one human edit.

## A second, related drift in line 616

That line also says a local `dist/` is ~35 MB larger than CI's because
"35,054,969 B of `keyart/brutalist/` is untracked under the `.gitignore:35` pattern
(58 of the 78 keyart files … are force-tracked)".

**That is no longer true.** All 58 keyart files are now git-tracked, so the local build
and the CI build are directly comparable:

```
local dist (clean build):  189,352,252 B
CI ceiling:                189,792,256 B
headroom:                     440,004 B  (0.42M)
```

The "do not quote a local `du` as the deployed size" advice still holds for a different
reason: macOS has no `find -printf`, so a local measurement uses `stat -f '%z'` and the
two counting methods can differ. But the *magnitude* of the local/CI gap is now ~0,
not ~35 MB, and the reason (untracked keyart) is gone.

## Measurement note

CI counts with GNU `find -printf` (Ubuntu runners). On macOS use:

```bash
find dist/ -type f -exec stat -f '%z' {} + | awk '{s+=$1} END {print s+0}'
```

`du -sh` is NOT the number — it reports allocated blocks, not bytes.
