---
description: "UI Rules"
paths: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.jsx", "src/**/*.tsx", "src/**/*.jsx", "**/components/**/*.tsx", "**/hooks/**/*.ts", ".claude/agents/**", ".claude/rules/**"]
---

# UI Rules

## Files

- `react.md` — Functional components, hooks, state management, controlled forms, custom hooks, Client vs Server components
- `nextjs.md` — App Router, Server Components, Client Components, layouts, loading/error boundaries, Route Handlers, Server Actions
- `tailwind.md` — Utility classes, design tokens, responsive prefixes, dark mode variants, `cn`/`clsx` composition, no inline styles
- `accessibility.md` — ARIA roles, keyboard navigation, focus management, color contrast, screen reader support, axe-core testing
- `tanstack.md` — Mother index (TanStack library enforcement policy + Quick Reference). **Has broad paths frontmatter** (auto-loads on frontend file edits) + INDEX explicit routing as supplementary entry
- `tanstack-query.md`, `tanstack-table.md`, `tanstack-form.md`, `tanstack-virtual.md` — TanStack splits (each with narrow paths frontmatter for auto-load)
- `zustand.md` — Zustand store rules: global state management, selectors, middleware (persist/devtools/immer), slice pattern, client-only constraint

## Triggers

Inject these rules when working on: React, Next.js, Tailwind, accessibility, `apps/web/**`,
`app/**`, `components/**`, `hooks/**`, `'use client'`, `useState`, `useEffect`,
`Server Component`, `className`, ARIA, `@testing-library/react`,
`@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-form`,
`@tanstack/react-virtual`, `zustand`,
`useQuery`, `useMutation`, `useInfiniteQuery`, `useSuspenseQuery`,
`useReactTable`, `useVirtualizer`,
`ColumnDef`, `QueryClient`, `QueryClientProvider`, `HydrationBoundary`, `dehydrate`,
`query-keys.ts`, `queryKey` factory,
EventSource, SSE consumer, `useEventStream`, `Last-Event-ID`.

Note on conflict-aware keywords: `useForm` triggers TanStack Form rules only when imported
from `@tanstack/react-form` (not react-hook-form). `useStore` from zustand (`create`) is for
global state; `form.useStore(selector)` is TanStack Form internal state — different APIs.
See `ui/zustand.md` and `ui/tanstack-form.md` for disambiguation.

## See also

- `../INDEX.md` (root)
- `../common/INDEX.md` (always-load manifest)
- `../common/design-patterns.md` (pattern selection + framework-idiom precedence)
- `../design/` (UI patterns, web design system)
- `../testing/vitest.md` (component testing with vitest + Testing Library)
