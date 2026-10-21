# Number Key Assignment Plan

A single, auditable mapping for **every number key** on the engine page.

## Goal

- One number = one specific action, no surprises.
- **No rotation** anywhere on bare digit keys. Rotation lives on its own
  chord / affordance so users can't trigger it accidentally.
- Layer select (the current default 1-9 behaviour) survives on a chord,
  not a bare key, so digits are "filter slots" by default.

## Why

The bare-digit keymap today is densely allocated and easy to confuse:

  1..9 select layers
  Shift+1..9 = story chapters
  Alt+1..6 = per-layer remap
  Cmd/Ctrl+1..9 = FX palette preset
  T+0..9 = look filter cycler
  0 = home (deselect)

Three keys touch the digit row at the same time (bare, Shift, T-pre) and
each one does something very different. That makes it impossible to
keep the visual behaviour stable while auditing whether rotation
bleeds in. The recent fix to the home key was a symptom of the same
underlying problem: digit semantics kept shifting.

This plan collapses the digit row to **TWO chord prefixes** —
plain digit = filter slot, prefixed digit = context — and explicitly
forbids any rotation behaviour on either.

## The Map

| Slot | Bare key | Shift+key | Cmd/Ctrl+key | Alt+key | T+key | Action |
|------|---------|-----------|---------------|---------|-------|--------|
| 0    | home    | —         | —             | —       | off / reset | slide every layer back to default; reset FX persona |
| 1    | filter 1 | chapter 1 | FX palette 1  | remap 1 | soft (ramped) | apply filter slot 1 — see §Filters |
| 2    | filter 2 | chapter 2 | FX palette 2  | remap 2 | old cinema (ramped) | filter slot 2 |
| 3    | filter 3 | chapter 3 | FX palette 3  | remap 3 | cinema cool (ramped) | filter slot 3 |
| 4    | filter 4 | chapter 4 | FX palette 4  | remap 4 | cinema teal (ramped) | filter slot 4 |
| 5    | filter 5 | chapter 5 | FX palette 5  | remap 5 | cinema amber (ramped) | filter slot 5 |
| 6    | filter 6 | chapter 6 | FX palette 6  | remap 6 | cinema rose (ramped) | filter slot 6 |
| 7    | filter 7 | chapter 7 | FX palette 7  | —       | cinema mono (ramped) | filter slot 7 |
| 8    | filter 8 | chapter 8 | FX palette 8  | —       | void warm (ramped) | filter slot 8 |
| 9    | filter 9 | chapter 9 | FX palette 9  | —       | echo (ramped) | filter slot 9 |

Bare digit behaviour **MUST NOT**:
- Toggle the rotationEnable checkbox on any layer
- Mutate layer.pos / layer.rotOffset
- Apply any audio reactor with `target: 'rot'`
- Call Layers.rotate or any rotation animation

This contract is enforced by a `getFilterCyclarSlot()` helper that the
digit handler dispatches to; the helper calls
`SWR_LOOK_FILTER_CYCLER.apply(slot)` and returns — nothing else.

## Filters (slot 1-9)

The bare-digit and T-prefixed paths both reach the same engine:
`SWR_LOOK_FILTER_CYCLER.apply(slot)`. Slot 0 stays reserved for the
"home / no filter" gesture (bare-0 key).

| Slot | Label           | Notes (trap-aware) |
|------|-----------------|--------------------|
| 0    | none / home     | zeroed setPersona() — true reset, not intensity 0 |
| 1    | soft            | low desat + slight cool |
| 2    | old cinema      | sepia commits; no temp/tone/glow (Trap 1) |
| 3    | cinema · cool   | cold temp + tone |
| 4    | cinema · teal   | mid cool + tone |
| 5    | cinema · amber  | warm temp + glow |
| 6    | cinema · rose   | slight warm + glow |
| 7    | cinema · mono   | grayscale + grain + vignette |
| 8    | void warm       | heavy desat + warm + blur |
| 9    | echo            | mut + mutAlgo:2 (Trap 6) + cool tone |

(Detail in `client/look-filter-cycler.client.js`.)

## What Goes Where

### Bare digits (0..9)

- 0 → `Layers.homeAll()` (existing) — writes a brief "home: layers
  back to start" status; emits `swr-keys-press` detail `{action:"home"}`.
- 1..9 → `SWR_LOOK_FILTER_CYCLER.apply(slot)`. Same code path as T+N,
  so the two surfaces stay in lockstep (Trap-1..6 schema guards hold
  for both).

### Rotation

- The `R` key, the `Shift+R` "force auto-swap now", and the ↻ button on
  the layer strip all do rotation. Number keys do **not**.
- Layer selection has been REMOVED from digit keys. If a user wants to
  pick a layer, they have:
  - Click on the layer in the panel / stage
  - `Tab` / `Shift+Tab` to cycle (`[,]`)
  - The ↻ button on the layer strip
- This is a behaviour change. Existing muscle memory for "press 1 → select
  top layer" is broken. Mitigation: the help menu always shows the new
  map; pressing `?` (or the help button) is one keystroke away.

### Story chapters

- Shift+1..9 advances STORY (`window.SWR.Story.enter`) — unchanged.

### FX palette

- Cmd/Ctrl+1..9 applies an FX-preset from `VersionsPresets.SHORTCUT_PRESETS`
  — unchanged.

### Remap

- Alt+1..6 swaps the asset at that layer slot
  (`Layers.autoMapLayer(slot)`) — unchanged.

### Filter prefix

- T+0..9 is the original look-filter cycler. T prefix is now redundant
  with bare digits (it lands at the same `apply()`) — kept as a
  compatibility shortcut for users with existing muscle memory.

### Action consumers

- `debug-overlay.client.js` reads `swr-keys-press` for the event log.
  The new mapping adds `action:'filter-N'` entries alongside
  `action:'home'` and `action:'look-N'` (T+N) so the debug overlay can
  show where a state change came from.

## Why no rotation on digits (and what replaces it)

The user reported that pressing 1 caused visible rotation. The most
likely cause: an audio reactor with `target: 'rot'` was firing on layer
selection (which selected layer 0 by default and exposed its' reactor
output to the engine). Even without picking the layer manually, R-key
binding or audio modulation can add rotation.

This plan removes the ambiguity by **never letting bare digits touch a
layer**:

1. `engine-keys.client.js` handler for bare digits is one function:
   `applyFilterFromDigit(n)` → `SWR_LOOK_FILTER_CYCLER.apply(n)`.
2. There is no path from any digit handler to a layer's `pos`,
   `rotOffset`, `rotationEnabled`, or any reactor.
3. The enum `REJECTED_DIGIT_TARGETS = ['rot', 'rotationEnabled', 'pos',
   'rotOffset', 'reactor']` is documented in the module header so a
   refactor that breaks the contract shows up in code review.

## Implementation Order

1. Add the contract constant in `engine-keys.client.js`
   (`REJECTED_DIGIT_TARGETS`).
2. Replace the current `/^[1-9]$/.test(key)` handler with
   `applyFilterFromDigit(parseInt(key, 10))`.
3. Wire `applyFilterFromDigit` to `SWR_LOOK_FILTER_CYCLER.apply(slot)`;
   1..9 is the same code path as T+1..9.
4. Update the help / overlay strings:
   - `0` → "home — slide every layer back to its origin"
   - `1..9` → "apply look filter N (soft, old cinema, ...)"
   - `T+1..9` → "alias of bare 1..9, kept for muscle memory"
   - `Shift+1..9` → "story chapter N"
   - `Cmd/Ctrl+1..9` → "FX palette preset"
   - `Alt+1..6` → "remap layer slot"
5. Update `scripts/check-look-filter-cycler-unit.mjs` assertions where
   they assume digit keys select layers — they're now apply-filter.
6. Update debug overlay's "layers" log: it still shows Layers.list, but
   the new digit keys won't select anything, so the "selected" mark
   never changes via digit. The overlay can keep showing who is selected
   because clicks / `[/]` still drive it.

## Files Touched

- `engine-keys.client.js`               — replace bare-digit handler
- `client/look-filter-cycler.client.js` — already wired (no change)
- `lib/layers.client.js`                — already has `homeAll()`
- `client/debug-overlay.client.js`     — accept `action:'filter-N'`
- `scripts/check-look-filter-cycler-unit.mjs` — confirm tests still pass
- `docs/PLANS/number-key-assignment.md`  — this file

## Verification

- Open the engine page; press 1..9 with audio playing. The FX state
  updates but no layer visibly rotates, scales, or shifts.
- Open the help panel; the new mapping is shown.
- Click a layer in the panel; `[/]` cycles selection. Bare digits do
  not. `0` homes + deselects.

