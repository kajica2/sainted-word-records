---
description: Next.js App Router, Server Components, Client Components, Server Actions, caching, metadata, and security rules
paths:
  - "next.config.*"
  - "**/app/**/*.ts"
  - "**/app/**/*.tsx"
  - "**/pages/**/*.ts"
  - "**/pages/**/*.tsx"
  - "**/middleware.ts"
  - "**/instrumentation.ts"
---

# Next.js Rules

## App Router Default

- Prefer the App Router for new features. Treat the Pages Router as legacy unless the project is already Pages-only.
- Server Components are the default in `app/`. Add `"use client"` only at the smallest interactive boundary.
- Keep data fetching, secrets, database calls, and privileged server SDKs in Server Components, Server Actions, Route Handlers, or server-only modules.
- Client Components must receive serializable props and must not import server-only code.

## Server Actions and Route Handlers

- Validate every Server Action input with a schema or explicit parser.
- Re-check authentication and authorization inside Server Actions and Route Handlers; never rely on UI state.
- Use Route Handlers for HTTP integration boundaries, webhooks, file downloads, and non-UI API surfaces.
- Never expose server environment variables to Client Components unless they are intentionally public and prefixed appropriately.

## Caching and Revalidation

- Know whether data is static, request-scoped, user-scoped, or dynamic before caching.
- Use `use cache` only for deterministic server work that is safe to reuse.
- Tag cache entries with `cacheTag` when later invalidation is required.
- Use `updateTag` for read-your-own-writes behavior after mutations when appropriate.
- Use `revalidateTag` or path revalidation for eventual cache refresh after writes.
- Do not cache personalized data without including the user or tenant boundary in the cache key.

## File Conventions

- Use `layout.tsx` for shared shells, `page.tsx` for route UI, `loading.tsx` for async pending states, `error.tsx` for recoverable segment errors, and `not-found.tsx` for 404 states.
- Metadata must be declared through the metadata APIs or `generateMetadata`, not ad hoc `<head>` manipulation.
- Use `next/image`, `next/font`, `next/link`, and `next/script` for their intended optimization and security behavior.
- Add Suspense boundaries around slow async subtrees so loading states are intentional.

## Security

- Do not pass secrets, tokens, raw session objects, or full user records into Client Components.
- Avoid `dangerouslySetInnerHTML`; sanitize trusted content at the server boundary when unavoidable.
- Webhook Route Handlers must verify signatures before parsing trusted payloads.
- Middleware must stay small and deterministic; do not put heavy database work in middleware.

## SSE Consumption (EventSource)

When the frontend consumes Server-Sent Events from a backend (e.g., LangGraph runs streamed via FastAPI):

- **Connect EventSource directly to the backend SSE endpoint.** Do **not** proxy SSE through a Next.js Route Handler — proxy hops add buffering, terminate on cold-start, and prevent `Last-Event-ID` from flowing end-to-end.
- **Use Client Components for EventSource.** `EventSource` is a browser API — instantiate inside `'use client'` components, never in Server Components or Route Handlers.
- **Authenticate via cookies or short-lived tokens.** `EventSource` does not allow custom `Authorization` headers; rely on credentialed cookies (CORS `allow_credentials=True` on the server) or a one-shot signed URL.
- **Boundary distinction.** SSE through Redis Streams is for cross-pod, durable, replayable streams. React Server Components `<Suspense>` streaming is a separate Next.js primitive for initial render — do not conflate them.
- **CORS expectations.** The backend must allow the frontend origin with credentials and permit the `Last-Event-ID` request header. See `api/fastapi-sse.md` for the server-side contract.
- **Cleanup.** Close `EventSource` on unmount, route change, and visibility change to avoid orphaned long-lived connections.

See `ui/react.md` for the reusable hook pattern and `api/fastapi-sse.md` for the wire format.
