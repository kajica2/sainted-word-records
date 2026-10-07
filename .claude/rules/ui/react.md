---
description: React 19 component, hook, state, effect, memoization, suspense, and accessibility rules
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.jsx"
  - "src/**/*.tsx"
  - "src/**/*.jsx"
  - "**/components/**/*.tsx"
  - "**/hooks/**/*.ts"
---

# React Rules

## Component Model

- Use function components only.
- Components must be pure: same props, state, and context produce the same render output.
- Do not cause side effects during render. Side effects belong in event handlers, Server Actions, data libraries, or Effects as a last resort.
- One exported component per file unless the subcomponents are private implementation details.
- Prefer composition and children over boolean prop flags. Two or more behavior flags usually means the API needs variants or compound components.

## Hooks

- Follow the Rules of Hooks: call hooks only at the top level of React functions or custom hooks.
- Custom hooks must start with `use` and encapsulate one concern.
- Do not call hooks conditionally, inside loops, after early returns, or inside nested functions.
- Keep dependencies complete. Do not silence hook lint rules without a comment explaining the invariant.
- Prefer local state first; lift state only when multiple siblings need it.

## State and Effects

- Derive values during render instead of duplicating derived state.
- Do not use `useEffect` for pure calculations, filtering, formatting, or prop-to-state mirroring.
- Use Effects for synchronization with external systems: subscriptions, imperative widgets, timers, network clients not handled by framework/data library.
- Effects must clean up subscriptions, timers, observers, and in-flight async work where cancellation matters.
- Use functional state updates when the next state depends on the previous state.

## Data and Async UI

- Use the project data layer for server state. Do not copy server data into local state unless editing a draft.
- Add Suspense boundaries where async UI can delay rendering.
- Add error boundaries around route-level or feature-level failure zones.
- Loading, empty, error, and permission-denied states are part of the component contract.

## Memoization

- In React Compiler-era code, use memoization intentionally, not by habit.
- Use `React.memo`, `useMemo`, and `useCallback` only for measured expensive work, stable context/provider values, or callbacks passed to memoized children.
- Avoid inline component definitions because they reset component identity and state.
- Do not memoize to hide impure rendering or unstable data modeling.

## Accessibility

- Interactive components need keyboard support, visible focus, and accessible names.
- Component APIs should make the accessible path easy: require labels or label IDs where needed.
- Images need meaningful `alt` text or empty alt when decorative.
- Forms need label, description, error, and validation wiring that screen readers can follow.
- Focus indicators must follow `.claude/rules/ui/tailwind.md` when Tailwind is used.

## SSE Hook Pattern

For consuming Server-Sent Events from a backend, encapsulate the lifecycle in a typed custom hook:

```tsx
// Illustrative — adapt to your stack
'use client';

import { useEffect, useState } from 'react';

type Status = 'idle' | 'open' | 'closed' | 'error';

export function useEventStream<T>(url: string, eventTypes: string[]) {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const source = new EventSource(url, { withCredentials: true });
    setStatus('open');

    const onMessage = (e: MessageEvent) => {
      const parsed = JSON.parse(e.data) as T;
      setEvents((prev) => [...prev, parsed]);
    };

    eventTypes.forEach((type) => source.addEventListener(type, onMessage));

    source.addEventListener('error', () => setStatus('error'));
    source.addEventListener('end', () => {
      setStatus('closed');
      source.close();
    });

    return () => {
      source.close();
      setStatus('closed');
    };
  }, [url, eventTypes.join(',')]);

  return { events, status };
}
```

Rules:

- One hook per stream lifecycle. Do not share an `EventSource` across components.
- Always register listeners for every event type the server emits (`token`, `tool_call`, `error`, `__end__`, etc.). Unregistered types are silently dropped.
- On terminal events (`__end__` or domain error), call `source.close()` explicitly — browsers may otherwise auto-reconnect.
- Cleanup on unmount is mandatory. Forgetting `source.close()` leaks open connections across navigation.
- Treat the typed event payload as untrusted at the boundary — validate before rendering.

See `ui/nextjs.md` for direct-connection (no Next.js proxy) guidance and `api/fastapi-sse.md` for the server-side wire format.
