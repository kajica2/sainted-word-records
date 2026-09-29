# House grading rules

The finishing rules for engine output, and where each one is enforced. They
exist so an editor does not have to rescue a render: if the render already sits
inside these ceilings, the Premiere/Resolve/CapCut step is a trim, not a fix.

Golden rule: **if you notice the saturation, it's too high.** Clarity, mood and
the graphics should be what the viewer notices.

## Where each rule lives

| # | Rule | Enforced by | Notes |
|---|---|---|---|
| 1 | Vibrance first, saturation last | **Finishing stage** | Needs per-pixel luminance weighting; see the measurement below. |
| 1 | Saturation +0…+8 max | **Engine** — `lib/swr-natural.client.js` `GRADE.saturation` | The house value is a *trim* (0.92, i.e. −8%); the constant documents the +8 ceiling for boosts. |
| 2 | Contrast creates the clear look | **Engine** — `GRADE.contrast` / `GRADE.brightness` | Tone curve is one pivot-symmetric pair; the derived points are exposed as `GRADE.black` / `GRADE.white`. |
| 2 | Lift blacks slightly, don't wash them out | **Engine** — `GRADE.black` = 0.030 | The old 0.85-contrast grade lifted blacks to 0.079 — this is the "washed out" case the rule warns about. |
| 2 | Highlights just below clipping | **Engine** — `GRADE.white` = 0.930 | The rules' 90–95 IRE band for whites. |
| 2 | Clarity/sharpen +5…+15 | **Finishing stage** | Needs a blurred copy; a full-res blur measured 8.6 fps on a variant page (see below). |
| 3 | Selective colour, not global saturation | **Finishing stage** | Per-hue weights (boost blues/teals and reds, leave skin/orange/yellow alone). |
| 3 | Don't grade the artist's face like the background | **Finishing stage** | Same reason. |
| 4 | Grade graphics separately from footage | **Engine** — structural | The grade is applied to the footage canvas only (fx-postprocess overlay or stage); the DOM chrome, titles and watermark are never in that chain, and the dashboard's overlay canvas (beat flash, transitions) sits above it. |
| 4 | Glow 5…15% opacity max | **Page CSS** | Text/logo glow is per-page styling, not part of the shared grade. |
| 4 | Keep whites white and blacks black | **Engine** — `GRADE.white` / `GRADE.black` | No tinting in the chain: `saturate`/`contrast`/`brightness` only. |
| 5 | No clipping, whites 90–95 IRE | **Engine** — `GRADE.white` | |
| 5 | Add ~5% film grain to hide banding | **Engine** — `GRADE.grain` = 0.05 | A 64px noise tile (±32 levels around mid grey) drawn as one `overlay` fill in the module's existing composite pass, so it costs one draw, not a pass. |

The spec constants live in `lib/swr-natural.client.js` (`GRADE`), and the
applied CSS chain is derived from them (`SWR_NATURAL.gradeCSS`) — the numbers are
written once. `SWR_NATURAL.GRADE.black` / `.white` are computed from
`contrast` + `brightness`, so the rules' tone targets always match what the
browser applies.

## Why the per-hue half is not in the engine

The rules' per-pixel steps need effects the CSS filter path cannot express
(vibrance's luminance weighting, per-hue selection, a blurred copy for clarity).
The only other *presentational* option — an SVG filter chain referenced as
`filter: url(#…)`, which can express all of them — was measured on a real variant
(`versions/hallucination.html`, 1280×720, headless):

| Filter on the stage | fps |
|---|---|
| none | 59.9 |
| `saturate(0.45) contrast(0.85) brightness(1.05)` (the old grade) | 30.0 |
| `url(#…)` — saturation matrix + S-curve | 15.0 |
| + tiled grain | 12.0 |
| + clarity (blur + arithmetic) | 8.6 |
| all of the above | 6.7 |

So the SVG path costs 4–9× the CSS chain for a look that is 22 pages' frame
budget. Baking a per-pixel grade into the stage instead would compound on the
feedback/trail pages (the module's echo buffer reads the stage back), and a
separate graded overlay canvas would have to clone each page's canvas geometry.

Decision: the engine enforces the tone, saturation and grain rules exactly (they
are cheap), and the per-hue rules stay a finishing-stage step — which is where
the rules' own software settings (Lumetri, Color Warper, CapCut) live anyway.

## Verifying

- `npm run check:grade-smoke` — the spec's tone points and caps are inside the
  rules' ranges, the chain is applied to exactly one canvas (never doubled), and
  the grain floor really lands in the stage pixels (A/B against
  `SWR_NATURAL.setEnabled(false)`).
- `npm run check:clip-evolution-unit` — the follower + `setEnabled` contract that
  the grade hangs off.
