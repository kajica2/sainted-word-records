---
description: TanStack Query v5 conventions — QueryClient, query key enum, base hooks, mutation invalidation, and data fetching rules
paths:
  - "src/hooks/query/**/*.ts"
  - "src/hooks/mutation/**/*.ts"
  - "src/providers/QueryProvider.tsx"
---

# TanStack Query Rules

> **Required version**: @tanstack/react-query >= 5.0.0

Covers: QueryClient setup, Query Key enum, Base Query/Mutation hooks, invalidateKeys pattern,
`isPending` convention, data fetching patterns.

---

## Required

- [HARD] All server state managed via TanStack Query v5+. Use `isPending` (not `isLoading`).
- [HARD] Query Keys centralized in `src/hooks/query/common.ts` via `enum QueryKey`. Inline key strings forbidden.
- [HARD] Mutation Keys centralized in `src/hooks/mutation/common.ts` via `enum MutationKey`.
- [HARD] After every mutation: provide `invalidateKeys` or manual `invalidateQueries` in `onSuccess` — stale reads are bugs.
- [HARD] Query hooks live in `src/hooks/query/use*Queries.ts`. Mutation hooks live in `src/hooks/mutation/use*Mutations.ts`.

---

## QueryClient Setup

Single `QueryProvider` in `src/providers/QueryProvider.tsx`. Do not create multiple QueryClient instances.

```tsx
// src/providers/QueryProvider.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

Rules:

- `staleTime` and `gcTime` are set at the QueryClient level. Override per-query only when necessary.
- Do not expose `queryClient` globally. Access via `useQueryClient()` inside components and hooks.

---

## Query Key Enum (`src/hooks/query/common.ts`)

All query keys are centralized in the `QueryKey` enum. Inline string keys are forbidden.

```ts
export enum QueryKey {
  // Domain grouping with descriptive names
  Agents = "AGENTS",
  Agent = "AGENT",
  AgentStats = "AGENT_STATS",

  Users = "USERS",
  User = "USER",
  // ...
}
```

### Key Composition in Hooks

Use `[QueryKey.EnumValue, ...params]` arrays. The enum value is always the first element;
dynamic parameters (IDs, filters, pagination) follow.

```ts
// List with params — params object as second element
queryKey: [QueryKey.Agents, params];

// Detail by ID — ID as second element
queryKey: [QueryKey.Agent, agentId];

// Nested resource — parent ID then child params
queryKey: [QueryKey.WorkspaceModels, workspaceId, params];
```

### Invalidation Scope

When invalidating after mutations, use the broadest matching key:

```ts
// Invalidates ALL queries starting with [QueryKey.Agents, ...]
invalidateKeys: [[QueryKey.Agents]];

// Invalidates only a specific agent detail
invalidateKeys: [[QueryKey.Agent, agentId]];
```

Rules:

- New query domains MUST be added to the `QueryKey` enum before use.
- List keys and detail keys SHOULD be separate enum values (e.g. `Agents` for list, `Agent` for detail)
  so list invalidation does not unnecessarily refetch detail queries.
- When a mutation affects multiple domains, provide multiple entries in `invalidateKeys`.

---

## Mutation Key Enum (`src/hooks/mutation/common.ts`)

All mutation keys use the `MutationKey` enum. Same structure as `QueryKey`.

```ts
export enum MutationKey {
  CreateAgent = "CREATE_AGENT",
  DeleteAgent = "DELETE_AGENT",
  // ...
}
```

---

## Base Query Hook (`src/hooks/query/baseQuery.ts`)

`useBaseQuery` wraps `useQuery` with the shared `fetchApi` client from `src/lib/api/core.ts`.
`buildQueryString` is co-located in `baseQuery.ts` for query string construction.

```ts
import { useBaseQuery } from "./baseQuery";
import { QueryKey } from "./common";

export const useGetAgents = (params?: AgentListParams) => {
  return useBaseQuery<AgentListResponse>({
    queryKey: [QueryKey.Agents, params],
    url: "/agents",
    params,
  });
};
```

Use `useBaseInfiniteQuery` for paginated / infinite-scroll endpoints:

```ts
export const useGetInfiniteAgents = (params?: AgentListParams) => {
  return useBaseInfiniteQuery<AgentListResponse>({
    queryKey: [QueryKey.Agents, params],
    url: "/agents",
    params,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
};
```

When `useBaseQuery` is not suitable (custom fetch logic, non-GET methods), use `useQuery` directly
with the API function from `src/lib/api/*.ts`:

```ts
export const useGetAgent = (agentId: string) => {
  return useQuery<AgentDetail, ApiError>({
    queryKey: [QueryKey.Agent, agentId],
    queryFn: () => getAgent(agentId),
    enabled: !!agentId,
  });
};
```

Rules:

- Always provide the `enabled` option when the query depends on a runtime value (ID, userId, etc.).
- Return the hook result directly; do not destructure and re-wrap.
- API functions live in `src/lib/api/*.ts`, not inside hook files.
- `fetchApi` from `src/lib/api/core.ts` is the shared HTTP client — do not use raw `fetch` in hooks.

---

## Base Mutation Hook (`src/hooks/mutation/baseMutation.ts`)

`useBaseMutation` wraps `useMutation` with `fetchApi`, toast notifications, and automatic
query invalidation via `invalidateKeys`.

### `invalidateKeys` Pattern (Preferred)

Pass `invalidateKeys` to auto-invalidate related queries in `onSuccess`. The base hook
calls `useQueryClient()` internally and runs `Promise.all` over the provided keys.

```ts
export const useCreateAgent = () => {
  return useBaseMutation<AgentActionResponse, ApiError, CreateAgentPayload>({
    mutationKey: [MutationKey.CreateAgent],
    fnOption: {
      url: "/agents",
      method: "POST",
    },
    invalidateKeys: [[QueryKey.Agents]],
    showSuccessToast: true,
    successMessage: "Agent created.",
  });
};
```

Multiple invalidation targets:

```ts
export const useSyncUserResource = () => {
  return useBaseMutation<UserResourceSyncResponse, ApiError, SyncPayload>({
    mutationKey: [MutationKey.SyncUserResource],
    fnOption: {
      url: (variables) => `/admin/users/${variables.userId}/sync`,
      method: "POST",
    },
    invalidateKeys: [[QueryKey.ResourceSummary], [QueryKey.UserResources]],
    showSuccessToast: true,
    successMessage: "Resources synced.",
  });
};
```

### Manual `onSuccess` (When extra logic needed)

When you need custom logic beyond invalidation (e.g. redirect, state reset), use `onSuccess`
alongside or instead of `invalidateKeys`:

```ts
export const useDeleteAgent = () => {
  return useBaseMutation<AgentActionResponse, ApiError, string>({
    mutationKey: [MutationKey.DeleteAgent],
    fnOption: {
      url: (variables) => `/agents/${variables}`,
      method: "DELETE",
    },
    invalidateKeys: [[QueryKey.Agents]],
    showSuccessToast: true,
    successMessage: "Agent deleted.",
    onSuccess: () => {
      router.push("/agents"); // extra logic beyond invalidation
    },
  });
};
```

### Direct `useMutation` (When `useBaseMutation` is not suitable)

When the mutation requires a custom `mutationFn` (e.g. calling a typed API function):

```ts
export const useDeleteAgent = () => {
  const queryClient = useQueryClient();
  return useMutation<AgentActionResponse, ApiError, string>({
    mutationKey: [MutationKey.DeleteAgent],
    mutationFn: (agentId) => deleteAgent(agentId),
    onSuccess: async () => {
      toast.success("Agent deleted.");
      await queryClient.invalidateQueries({ queryKey: [QueryKey.Agents] });
    },
  });
};
```

Rules:

- Every mutation MUST have `mutationKey` from the `MutationKey` enum.
- Every mutation that changes server state MUST invalidate queries — via `invalidateKeys` or manual `invalidateQueries`.
- Prefer `invalidateKeys` for simple invalidation. Use `onSuccess` only when extra side effects are needed.
- `invalidateKeys` and `onSuccess` can coexist — invalidation runs first, then `onSuccess` callback.
- Do not call both `setQueryData` (optimistic) and `invalidateQueries` in the same mutation. Choose one strategy.
- `useBaseMutation` handles `useQueryClient()` internally — do not call `useQueryClient()` when using `invalidateKeys`.

---

## `isPending` vs `isLoading` (v5 Migration)

TanStack Query v5 renamed `isLoading` to `isPending` for query results.

| v4 (deprecated) | v5 (correct) | Meaning                                                           |
| --------------- | ------------ | ----------------------------------------------------------------- |
| `isLoading`     | `isPending`  | No cached data and fetch in progress                              |
| —               | `isLoading`  | v5 alias: `isPending && isFetching` (identical to v4 `isLoading`) |
| `isFetching`    | `isFetching` | Any fetch in progress (including background refetch)              |

```tsx
// Correct (v5)
const { data, isPending, error } = useGetAgents(params);

if (isPending) return <Skeleton />;

// Wrong (v4 pattern)
const { data, isLoading, error } = useGetAgents(params);
```

Rules:

- [HARD] Use `isPending` for first-load states. Use `isFetching` for background refetch indicators.
- `isLoading` from `useState` or custom hooks (e.g. `useAuth`, `usePolling`) is unrelated to this rule.
  This rule applies only to TanStack Query hook return values.

---

## Query Hook File Structure

One file per domain. File name matches the pattern `use{Domain}Queries.ts`.

```
src/hooks/query/
  common.ts                        # QueryKey enum
  baseQuery.ts                     # useBaseQuery, useBaseInfiniteQuery, buildQueryString
  useAdminQueries.ts               # Admin domain queries
  useAgentQueries.ts               # Agent domain queries
  useUserQueries.ts                # User domain queries
  useWorkspaceQueries.ts           # Workspace domain queries
  useModelQueries.ts               # Model domain queries
  useToolQueries.ts                # Tool domain queries
  ...

src/hooks/mutation/
  common.ts                        # MutationKey enum
  baseMutation.ts                  # useBaseMutation (with invalidateKeys support)
  useAdminMutations.ts             # Admin domain mutations
  useAgentMutations.ts             # Agent domain mutations
  ...
```

Rules:

- Keep query hooks and mutation hooks in separate files, never mixed.
- Group by domain (agents, users, workspaces), not by page.
- Do not put API fetch functions in hook files. API layer lives in `src/lib/api/*.ts`.

---

## Polling and Refetch

For data that needs periodic refresh (infra metrics, job status):

```ts
export const useGetLatestMetrics = () => {
  return useQuery<MetricSnapshot[], ApiError>({
    queryKey: [QueryKey.LatestMetrics],
    queryFn: () => getLatestMetrics(),
    refetchInterval: 30_000, // 30 seconds
  });
};
```

Rules:

- Prefer `refetchInterval` over custom `setInterval` + manual refetch.
- Set `refetchIntervalInBackground: false` for non-critical polling to save bandwidth.
- For custom polling with abort control, use `usePolling` hook at `src/hooks/usePolling.ts`.

---

## Error Handling

All queries use `ApiError` from `src/lib/api/errors.ts` as the error type.

```ts
useQuery<ResponseType, ApiError>({
  queryKey: [QueryKey.SomeKey],
  queryFn: () => someFetchFn(),
});
```

Rules:

- Always specify the `ApiError` type parameter. Do not use untyped `Error`.
- Mutation error toasts are handled by `useBaseMutation` (`showErrorToast: true` by default).
- For queries, handle errors at the component level or with error boundaries.

---

## Anti-Patterns

```ts
// Bad: inline query key string
useQuery({ queryKey: ['agents', params], ... });

// Bad: missing invalidation after mutation
useMutation({
  mutationFn: deleteAgent,
  onSuccess: () => { toast.success('Deleted'); }, // no invalidateKeys or invalidateQueries!
});

// Bad: v4 isLoading from TanStack Query result
const { data, isLoading } = useGetAgents();

// Bad: raw fetch inside hook
export const useGetAgents = () => {
  return useQuery({
    queryKey: [QueryKey.Agents],
    queryFn: async () => {
      const res = await fetch('/api/agents'); // use fetchApi from src/lib/api/core.ts
      return res.json();
    },
  });
};

// Bad: mixing query and mutation in one file
// useAgentQueries.ts should not contain useCreateAgent mutation

// Bad: calling useQueryClient() when invalidateKeys is sufficient
export const useCreateAgent = () => {
  const queryClient = useQueryClient(); // unnecessary with invalidateKeys
  return useBaseMutation({
    invalidateKeys: [[QueryKey.Agents]], // handles invalidation internally
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKey.Agents] }); // redundant
    },
  });
};
```

---

## See Also

- `ui/react.md` — React component and hook conventions
- `ui/nextjs.md` — Next.js App Router, Server/Client components
- `common/coding-principles.md` — Think-before-coding, simplicity-first
