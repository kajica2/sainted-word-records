---
title: Use TanStack Query for Client-Side Data Fetching
impact: MEDIUM-HIGH
impactDescription: deduplication, caching, Suspense-ready prefetching
tags: client, tanstack-query, react-query, caching, suspense, prefetch
---

# client-tanstack-query

**Required for all new server state.** TanStack Query v5+ centralizes server cache, deduplicates concurrent requests, and integrates with Suspense and prefetch.

## Performance benefits
- **Dedup**: Concurrent `useQuery` calls with the same key share a single in-flight request.
- **Stale-time**: Configure `staleTime` to skip refetches within a TTL window — eliminates request waterfalls between sibling components.
- **Suspense + prefetch**: Pair `useSuspenseQuery` with server-side `prefetchQuery` + `HydrationBoundary` to avoid client-side loading states.
- **Background refetch**: `refetchOnWindowFocus` keeps data fresh without blocking the UI.

## When to use
Every new client component that reads from an API. Replace `useEffect + fetch` patterns.

## Forbidden alternatives for new code
- `swr` and subpath imports — see `client-swr-dedup` (kept for legacy maintenance only).
- `axios` interceptor caching — manual cache invalidation is error-prone.

## Reference
- Full enforcement rules: `.claude/rules/ui/tanstack-query.md`
- Mother index: `.claude/rules/ui/tanstack.md`
