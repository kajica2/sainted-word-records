# First-Time Onboarding Intro + Keyboard Shortcuts Panel

> For: engine.html only
> Trigger: first visit per browser (localStorage `swr.onboarded.v1`)
> Re-open: click `?` button in toolbar (already exists, currently dead)
> Storage: same key shape as `swr.persona.v1` for consistency

## Scope (smallest reversible change)

1. **Build a Shortcuts panel** that lists every real shortcut in the engine.
2. **Auto-show it on first visit** with a 600ms delay (so the engine boots first).
3. **Wire the existing `#swr-keys-help-btn`** to open/close the panel.
4. **Persist dismissal** in localStorage so it never auto-shows again.
5. **Escape closes the panel.** Click on backdrop closes the panel.

## Shortcuts to list (verified in source — NOT invented)

Source: `engine.html:5018-5043`, `1163`, `5806-5811`, `5857-5862`, `3173`, `5284`, `5702`, `5284`, `5985`

| Shortcut | Action |
|---|---|
| `Space` | Play / pause the song |
| `R` | Rotate selected clip +90° (Shift+R = -90°) |
| `L` | Add a new layer |
| `D` | Toggle auto-drift / manual drag |
| `?` | Open / close this shortcuts panel |
| `Esc` | Close this panel (and other open panels) |
| `Shift+←` / `Shift+→` | Previous / next visual version (12 variants) |
| `←` / `→` | Previous / next preset |

### Toolbar buttons that matter (no shortcut but essential first-day info)

- **▶ Launch** / **🎬 Export video** — chosen by the user (the export button triggers 30s auto-export)
- **● REC** — start/stop recording (uses size preset)
- **+ Add** (Library) — drop files anywhere on the page
- **+ Layer** — add a visual layer (also `L`)
- **RE-MAP** — re-derive clip assignments to layers
- **↻ ROT** — rotate active clip (also `R`)
- **Theme button** (☼) — light/dark/system

## Files

- Modify: `engine.html`
  - Add HTML for the panel
  - Add CSS for the panel
  - Add JS to show/auto-open/persist/close

## Verification

- `npm run check:syntax` parses
- New verifier: `verify-onboarding-intro.mjs`
  - Loads engine.html with fresh localStorage → panel auto-shows after delay
  - Click dismiss → panel closes, localStorage `swr.onboarded.v1` set
  - Reload with localStorage set → panel does NOT auto-show
  - Click `?` button → panel opens again
  - Press Escape → panel closes
- `npm run check` (full)

## Out of scope (explicit non-goals)

- NOT touching the persona onboarding (separate `swr.persona.v1` key).
- NOT introducing new shortcuts (only documenting existing ones).
- NOT changing the `?` button's position or style.
- NOT adding a tooltip tour — just the panel.
