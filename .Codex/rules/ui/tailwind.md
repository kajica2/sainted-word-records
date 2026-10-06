---
description: Tailwind CSS v4 token, utility, responsive, dark mode, class composition, and focus-visible rules
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.css"
  - "tailwind.config.*"
  - "**/tailwind.config.*"
---

# Tailwind CSS Rules

## Utility and Token Policy

- Use Tailwind utilities as the primary styling mechanism.
- Tailwind v4 projects define design tokens with `@theme`; older projects may bridge through config and CSS variables.
- Token names must be semantic: `--color-surface`, `--color-text-muted`, `--color-ring`, not raw visual names like `blue-500`.
- Arbitrary values are allowed only for one-off integration constraints. Promote repeated arbitrary values to tokens.
- Inline `style` is banned except for dynamic values that cannot be represented safely as classes or CSS variables.
- Use `@apply` only for base styles, third-party resets, or stable component classes that cannot be expressed cleanly in markup.

## Responsive and Container Behavior

- Mobile-first classes are the default. Add `sm:`, `md:`, `lg:`, `xl:`, and `2xl:` only when the layout changes.
- Prefer container queries for reusable components whose layout depends on parent width.
- Fixed-format UI elements need stable dimensions with `size-*`, `aspect-*`, `min-*`, `max-*`, grid tracks, or container constraints.
- Test mobile, tablet, desktop, narrow container, long text, and empty states for changed UI.

## Dark Mode

- Dark mode must use semantic tokens or token-backed utilities.
- Do not hard-code light-only colors into components that render in dark mode.
- Token pairs must define foreground, background, border, muted, destructive, and ring behavior for both themes.
- Opacity variants must preserve contrast; do not use low-opacity text for required information.

## Class Composition

- Conditional classes must be detectable by Tailwind's class scanner.
- Use `clsx`, `cva`, `tailwind-merge`, or the project `cn` helper for conditional classes.
- Do not build class names through string interpolation such as `text-${color}-500`.
- Variant maps must enumerate full class strings.
- Keep class lists readable and grouped by layout, sizing, spacing, typography, color, effects, then states.

## Focus Indicator (HARD)

Default Tailwind blue focus rings are banned. Every interactive element must keep a visible keyboard focus indicator driven by `focus-visible` and design tokens.

### Banned

- `focus:ring-*` without `focus-visible:`
- `focus:ring-blue-*`, `focus:ring-sky-*`, `focus:ring-indigo-*`, or any hard-coded palette ring
- `focus:ring-2` or `focus:ring-4` without a token color
- `outline-none` or `focus:outline-none` without a same-element `focus-visible:` replacement
- Opacity suffixes `/0`, `/5`, and `/10` for required focus indicators

### Required Default

```tsx
className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
```

- `ring-ring` must resolve to the project ring token.
- `ring-offset-background` must resolve to the active surface token.
- Use `focus-visible:`, not `focus:`, so pointer clicks do not show keyboard rings.

### Fallback

If the project has no ring token yet, use a neutral temporary fallback and create a follow-up to add the token:

```tsx
className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400/40 focus-visible:ring-offset-1"
```

Browser default `:focus-visible` outlines are acceptable for prototypes when no custom ring classes are used.
