---
paths:
  - "apps/web/**/*.{ts,tsx}"
  - "src/**/*.{ts,tsx}"
  - "**/components/**/*.{ts,tsx}"
  - "**/features/**/*.{ts,tsx}"
---

# TanStack Frontend Stack Rules

Mandatory conventions for TanStack library usage. Enforces required libraries and forbidden
alternatives. Applies to both Next.js App Router and Vite SPA environments.

## Entry Points

This mother file auto-loads via the `paths:` frontmatter above when editing frontend files.

Additional explicit entry points:

- `.claude/rules/ui/INDEX.md` Triggers match (T2.1)
- `.claude/rules/INDEX.md` Agent → Rules Routing table `ui-*` row (T2.2)

Each split file carries its own narrow `paths:` frontmatter for additional auto-load.

## Topic Index

| Topic                                                                                                        | File                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------ |
| QueryClient setup, Query Key factory, Optimistic Update, Suspense, HydrationBoundary, Next.js 15 fetch cache | `ui/tanstack-query.md`   |
| ColumnDef, headless + (shadcn conditional), server pagination + URL sync                                     | `ui/tanstack-table.md`   |
| v1 GA Form API, Zod schema-first, useStore vs form.store disambiguation                                      | `ui/tanstack-form.md`    |
| v3 useVirtualizer exact pattern, 50+/100+ thresholds                                                         | `ui/tanstack-virtual.md` |
| Context first → zustand                                                                                      | `ui/zustand.md`          |

## Quick Reference (HARD — 1:1 match with split Required sections)

- [HARD] All server state → TanStack Query v5+ (use `isPending`)
- [HARD] Query Keys → centralized `lib/query-keys.ts` factory; inline strings forbidden
- [HARD] After mutation: invalidation OR optimistic update required (choose one)
- [HARD] Forms → TanStack Form v1+ + Zod; new react-hook-form imports forbidden
- [HARD] Tables → TanStack Table v8 hooks; v7/MUI DataGrid/AG Grid new adoption forbidden
- [HARD] 100+ item lists → TanStack Virtual v3 `useVirtualizer` required; 50+ recommended
- [HARD] Global lightweight state → React Context first; use `zustand` if Context is burdensome (see `ui/zustand.md`). `@tanstack/react-store` deprecated — `redux`/`recoil`/`jotai` new adoption forbidden
- [HARD] `@tanstack/react-router`/start: new adoption forbidden for both Next.js and Vite (Vite changeable via separate ADR)
- [HARD] `swr` new adoption forbidden; axios interceptor caching forbidden

## Environment Branches

- **Next.js**: Provider in `app/providers.tsx` (`'use client'`) + `getQueryClient()` (new per request on server, singleton in browser). Server Component prefetch + `HydrationBoundary` required. **Next.js 15 default fetch cache changed (`no-store`) — use per-data-category cache strategy**: static/public data → `cache: 'force-cache'` or `next: { revalidate: N }`; user/tenant-scoped data → `cache: 'no-store'` + include userId/tenantId in query key. Aligns with `nextjs.md:31-36`.
- **Vite SPA**: Provider in `main.tsx` root. Single `new QueryClient()`. No hydration. Recommended `staleTime`: 0–30 s (real-time UI), 60 s+ (static data).

## See Also

`ui/zustand.md` (global lightweight state SoT), `ui/react.md`, `ui/nextjs.md`, `ui/INDEX.md`, `omb-react-perf/rules/client-tanstack-query.md`, `30_Constraints/tanstack_migration`
