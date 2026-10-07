---
paths:
  - "**/stores/**/*.{ts,tsx}"
  - "**/store/**/*.{ts,tsx}"
  - "apps/web/**/components/**/*.{ts,tsx}"
  - "apps/web/**/hooks/**/*.{ts,tsx}"
  - "apps/web/**/features/**/*.{ts,tsx}"
---

# Zustand Store Rules

Covers: When to use global state, zustand usage, client-only constraint,
selector discipline, middleware patterns, async actions, store composition,
subscriptions, testing, anti-patterns, forbidden alternatives.

See `ui/tanstack.md` for the full TanStack Quick Reference (Query, Table, Form, Virtual).

---

## Required

- [HARD] Global state: prefer React Context first. Use zustand only when Context becomes burdensome (deep Provider nesting, severe props drilling, cross-cutting state).
- [HARD] One store per domain. Do not create a single god-store with all application state.
- [HARD] Store instances are client-only. Never instantiate or access in Server Components.
- [HARD] Always use selectors when consuming store state in components.

---

## Decision: Context vs Zustand

Use React Context when:
- State is scoped to a feature or subtree
- The Provider depth is 1-2 levels
- No complex computed selectors needed

Use zustand when:
- Context boilerplate is excessive (many providers, deeply nested)
- Multiple unrelated components need the same cross-cutting state
- Fine-grained subscriptions needed (avoids re-render on unrelated state changes)
- State needs persistence (localStorage, sessionStorage)
- DevTools debugging is required
- State must be accessed outside React (utilities, event handlers, interceptors)

### Zustand vs TanStack Query — Responsibility Split

- [HARD] Server data fetching, caching, refetching, and invalidation belong to TanStack Query. Do not fetch from Zustand.
- Zustand manages **client-only state** exclusively.

| Data type | Owner | Examples |
|-----------|-------|----------|
| Server data (CRUD, list, detail) | TanStack Query | todos, users, products |
| Auth state (token, session) | Zustand | user, token, role |
| UI state (toggles, modals, theme) | Zustand | sidebarOpen, theme, activeTab |
| Form wizard / multi-step state | Zustand | step, formData |
| Caching + automatic refetch needed | TanStack Query | any data |

---

## Basic Pattern

### Store Definition

```tsx
import { create } from "zustand";

interface AppState {
  // State
  sidebarOpen: boolean;
  theme: "light" | "dark";

  // Actions
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark") => void;
  reset: () => void;
}

const initialState = {
  sidebarOpen: false,
  theme: "light" as const,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
  reset: () => set(initialState),
}));
```

### Component Consumption

```tsx
export function SidebarToggle() {
  const isOpen = useAppStore((s) => s.sidebarOpen);
  const toggle = useAppStore((s) => s.toggleSidebar);
  return (
    <button onClick={toggle}>
      {isOpen ? "Close" : "Open"}
    </button>
  );
}
```

### `set` Behavior

- `set({ theme: "dark" })` — shallow merge (keeps other fields intact).
- `set((s) => ({ count: s.count + 1 }))` — updater function for state derived from previous value.
- `set(state, true)` — second arg `true` replaces the entire state instead of merging. Use only for full reset.

### `get` for Reading Current State in Actions

```tsx
export const useCounterStore = create<CounterState>((set, get) => ({
  count: 0,
  doubleCount: () => {
    const current = get().count;
    set({ count: current * 2 });
  },
}));
```

Use `get()` when an action needs to read current state before deciding what to set. Prefer `set((s) => ...)` updater for simple derived updates.

---

## Selector Rules

- [HARD] Always use selectors. Never call `useAppStore()` without a selector — it subscribes to the entire store and causes unnecessary re-renders.
- Colocate actions with state in the store definition.
- For derived state, compute inside the selector or use a separate selector function.
- Use `useShallow` for selecting multiple fields as an object.

### Single Field

```tsx
// Bad — subscribes to everything
const { sidebarOpen, theme } = useAppStore();

// Good — subscribes to one slice
const sidebarOpen = useAppStore((s) => s.sidebarOpen);
```

### Multiple Fields

```tsx
import { useShallow } from "zustand/react/shallow";

// Bad — new object reference every render, re-renders on ANY state change
const { user, isLoading } = useAppStore((s) => ({
  user: s.user,
  isLoading: s.isLoading,
}));

// Good — useShallow compares each field individually
const { user, isLoading } = useAppStore(
  useShallow((s) => ({ user: s.user, isLoading: s.isLoading })),
);
```

### Derived State

```tsx
// Good — derived value computed in selector
const isDark = useAppStore((s) => s.theme === "dark");
const itemCount = useCartStore((s) => s.items.length);
const totalPrice = useCartStore((s) =>
  s.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
);
```

### Reusable Selectors

```tsx
// stores/auth.selectors.ts
export const selectUser = (s: AuthState) => s.user;
export const selectIsLoggedIn = (s: AuthState) => s.user !== null;
export const selectUserRole = (s: AuthState) => s.user?.role ?? "guest";

// Component
const isLoggedIn = useAuthStore(selectIsLoggedIn);
```

---

## Accessing Store Outside React

Zustand stores work outside React components — useful for API interceptors, utility functions, and event handlers.

```tsx
// In an axios interceptor or fetch wrapper
const token = useAuthStore.getState().token;

// Subscribe to changes outside React
const unsub = useAuthStore.subscribe((state) => {
  if (!state.token) redirectToLogin();
});

// Set state from anywhere
useAuthStore.setState({ token: newToken });
```

Rules:
- `getState()` returns a snapshot — it does not subscribe to updates.
- `subscribe()` returns an unsubscribe function. Always clean up in non-permanent contexts.
- Avoid calling `setState()` from outside React during SSR / server rendering.

---

## Middleware Patterns

### Persist (localStorage/sessionStorage)

```tsx
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingsState {
  locale: string;
  fontSize: number;
  setLocale: (locale: string) => void;
  setFontSize: (size: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      locale: "en",
      fontSize: 14,
      setLocale: (locale) => set({ locale }),
      setFontSize: (fontSize) => set({ fontSize }),
    }),
    {
      name: "settings-storage", // localStorage key
      storage: createJSONStorage(() => localStorage), // default; use sessionStorage if needed
      partialize: (state) => ({
        // persist only selected fields (omit actions)
        locale: state.locale,
        fontSize: state.fontSize,
      }),
      version: 1, // bump when schema changes
      migrate: (persisted, version) => {
        // handle schema migrations
        if (version === 0) {
          return { ...(persisted as object), fontSize: 14 };
        }
        return persisted as SettingsState;
      },
    },
  ),
);
```

#### Persist Rules

- Always use `partialize` to exclude action functions from storage.
- Use `version` + `migrate` when the persisted schema changes — otherwise old data breaks hydration.
- Use `createJSONStorage(() => sessionStorage)` for session-scoped persistence.
- `skipHydration: true` enables manual hydration timing (call `useStore.persist.rehydrate()` when ready).

#### Hydration Mismatch (SSR)

```tsx
// Prevent hydration mismatch in Next.js
export function useSettingsHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useSettingsStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    if (useSettingsStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}

// Usage
function SettingsPanel() {
  const hydrated = useSettingsHydrated();
  const fontSize = useSettingsStore((s) => s.fontSize);
  if (!hydrated) return <Skeleton />;
  return <div style={{ fontSize }}>...</div>;
}
```

### DevTools

```tsx
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export const useAuthStore = create<AuthState>()(
  devtools(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }, false, "auth/setUser"),
      logout: () => set({ user: null, token: null }, false, "auth/logout"),
    }),
    {
      name: "AuthStore",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
```

#### DevTools Rules

- Third argument to `set()` is the action name shown in DevTools: `set(newState, replace, actionName)`.
- Use `domain/action` naming convention for action names: `"auth/setUser"`, `"cart/addItem"`.
- Disable in production with `enabled: process.env.NODE_ENV === "development"`.

### Immer (Complex Nested Updates)

```tsx
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateQuantity: (id: string, qty: number) => void;
  removeItem: (id: string) => void;
}

export const useCartStore = create<CartState>()(
  immer((set) => ({
    items: [],
    addItem: (item) =>
      set((state) => {
        const existing = state.items.find((i) => i.id === item.id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          state.items.push(item);
        }
      }),
    updateQuantity: (id, qty) =>
      set((state) => {
        const item = state.items.find((i) => i.id === id);
        if (item) item.quantity = qty;
      }),
    removeItem: (id) =>
      set((state) => {
        state.items = state.items.filter((i) => i.id !== id);
      }),
  })),
);
```

#### When to Use Immer

| State Shape | Without Immer | With Immer |
|-------------|---------------|------------|
| Flat object `{ a, b, c }` | `set({ a: newA })` — simple | Overkill |
| Nested 1 level `{ user: { name } }` | `set({ user: { ...s.user, name } })` — manageable | Optional |
| Nested 2+ levels or arrays of objects | Spread hell, error-prone | Recommended |

### Combining Middleware

```tsx
export const useStore = create<State>()(
  devtools(
    persist(
      immer((set) => ({
        // ...state and actions
      })),
      { name: "store-key", partialize: (s) => ({ /* fields */ }) },
    ),
    { name: "StoreName", enabled: process.env.NODE_ENV === "development" },
  ),
);
```

Nesting order (outside to inside): `devtools` > `persist` > `immer` > store definition.

The `()()` double-call on `create` is required for TypeScript inference when using middleware.

---

## Slice Pattern (Large Stores)

Split a large store into slices for maintainability.

### Defining Slices

```tsx
// stores/slices/auth.ts
import { type StateCreator } from "zustand";
import { type UISlice } from "./ui";

export interface AuthSlice {
  user: User | null;
  token: string | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

// Generic params: <BoundStore, Middleware[], Middleware[], ThisSlice>
export const createAuthSlice: StateCreator<
  AuthSlice & UISlice, // full store type for cross-slice get()
  [],
  [],
  AuthSlice // this slice's type
> = (set, get) => ({
  user: null,
  token: null,
  setUser: (user) => set({ user }),
  logout: () => {
    set({ user: null, token: null });
    // Cross-slice action: also close sidebar on logout
    get().closeSidebar();
  },
});
```

### Composing Slices

```tsx
// stores/app.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { createAuthSlice, type AuthSlice } from "./slices/auth";
import { createUISlice, type UISlice } from "./slices/ui";

type AppStore = AuthSlice & UISlice;

export const useAppStore = create<AppStore>()(
  devtools(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createUISlice(...args),
    }),
    { name: "AppStore" },
  ),
);
```

### Slice Rules

- Each slice file exports: interface (`XxxSlice`) + creator (`createXxxSlice`).
- Use `StateCreator` generic with full store type to enable cross-slice `get()` access.
- Split when a single store file exceeds ~100 lines.
- Avoid circular dependencies between slices — if A.logout calls B.closeSidebar, that is fine. If A and B mutually call each other, restructure.

---

## Transient Updates (No Re-render)

For high-frequency updates (scroll position, mouse coordinates, animation state), avoid re-renders entirely:

```tsx
interface ScrollState {
  scrollY: number;
  setScrollY: (y: number) => void;
}

export const useScrollStore = create<ScrollState>((set) => ({
  scrollY: 0,
  setScrollY: (y) => set({ scrollY: y }),
}));

// Subscribe without re-rendering
useEffect(() => {
  const handleScroll = () => {
    useScrollStore.setState({ scrollY: window.scrollY });
  };
  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
}, []);

// Read without subscribing (snapshot only when needed)
function ScrollToTop() {
  return (
    <button
      onClick={() => {
        const y = useScrollStore.getState().scrollY;
        if (y > 500) window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      Top
    </button>
  );
}
```

---

## Store Reset

```tsx
const initialState = {
  user: null,
  token: null,
  preferences: defaultPreferences,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,
  // actions...
  reset: () => set(initialState),
}));

// Reset all stores on logout
function handleLogout() {
  useAuthStore.getState().reset();
  useCartStore.getState().reset();
  useSettingsStore.getState().reset();
}
```

Rules:
- Extract `initialState` as a separate const — reuse for reset and tests.
- Never put action functions in `initialState`.
- Consider clearing persisted storage on reset: `useSettingsStore.persist.clearStorage()`.

---

## Client-Only Constraint

Zustand stores hold mutable JavaScript state and MUST NOT be created or accessed in React Server Components (RSC).

```tsx
// Bad — store in a Server Component
// app/dashboard/page.tsx (Server Component by default in Next.js App Router)
import { useAppStore } from "@/stores/app"; // FORBIDDEN

// Good — use in Client Components only
'use client';
import { useAppStore } from "@/stores/app";
```

Place store files under `stores/` or `store/` and mark consuming components `'use client'`.

---

## File Organization

```
stores/
  app.ts              # UI state (sidebar, theme, modals)
  auth.ts             # auth state (user, token, session)
  auth.selectors.ts   # reusable selectors for auth store
  cart.ts             # cart state (items, totals)
  slices/             # slice creators for large stores
    auth.ts
    ui.ts
    cart.ts
```

Rules:
- One file per store domain.
- Slice files go under `slices/` when a store grows beyond ~100 lines.
- Selector files (`*.selectors.ts`) for reusable selectors shared across multiple components.
- Export the hook (`useXxxStore`) as the default consumer API.
- Do not export the raw store object unless needed for testing or external subscriptions.
- Naming convention: `use<Domain>Store` — `useAuthStore`, `useCartStore`, `useAppStore`.

---

## Testing

### Resetting Store Between Tests

```tsx
import { beforeEach } from "vitest";
import { useAuthStore } from "@/stores/auth";

const initialStoreState = useAuthStore.getState();

beforeEach(() => {
  useAuthStore.setState(initialStoreState, true); // true = replace entire state
});
```

### Testing Actions

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { useCartStore } from "@/stores/cart";

describe("CartStore", () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], error: null }, true);
  });

  it("should add item to cart", () => {
    const item = { id: "1", name: "Widget", price: 10, quantity: 1 };

    useCartStore.getState().addItem(item);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]).toEqual(item);
  });

  it("should increase quantity for duplicate item", () => {
    const item = { id: "1", name: "Widget", price: 10, quantity: 1 };

    useCartStore.getState().addItem(item);
    useCartStore.getState().addItem(item);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });
});
```

### Testing Components That Use Stores

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "@/stores/app";
import { SidebarToggle } from "./SidebarToggle";

beforeEach(() => {
  useAppStore.setState({ sidebarOpen: false }, true);
});

it("should toggle sidebar", async () => {
  render(<SidebarToggle />);

  expect(screen.getByText("Open")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button"));

  expect(screen.getByText("Close")).toBeInTheDocument();
  expect(useAppStore.getState().sidebarOpen).toBe(true);
});
```

### Testing Rules

- Always reset store state in `beforeEach` with `setState(initial, true)`.
- Test actions via `getState().action()` — no need to render components for pure action tests.
- Test selectors as pure functions: `expect(selectIsLoggedIn({ user: null })).toBe(false)`.
- Do not mock zustand internals. Test through the public API (`getState`, `setState`, hooks).

---

## Anti-Patterns

```tsx
// Bad: god-store with unrelated domains
const useStore = create((set) => ({
  user: null, cart: [], theme: "light", notifications: [],
  todos: [], searchQuery: "", isModalOpen: false,
}));

// Bad: no selector — subscribes to everything
function UserName() {
  const store = useAppStore();
  return <span>{store.user?.name}</span>;
}

// Bad: deriving state in component instead of selector
function CartTotal() {
  const items = useCartStore((s) => s.items);
  const total = items.reduce((sum, i) => sum + i.price, 0); // recalculates on any items ref change
  return <span>{total}</span>;
}
// Good: derive in selector
function CartTotal() {
  const total = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.price, 0),
  );
  return <span>{total}</span>;
}

// Bad: fetching server data in zustand — this is TanStack Query's job
const useTodoStore = create((set) => ({
  todos: [],
  isLoading: false,
  fetchTodos: async () => {
    set({ isLoading: true });
    const res = await fetch("/api/todos");
    set({ todos: await res.json(), isLoading: false });
  },
}));
// Good: use TanStack Query for server data, zustand for client state only

// Bad: mutating state outside set()
const useStore = create((set, get) => ({
  items: [],
  addItem: (item) => {
    get().items.push(item); // WRONG — direct mutation, no re-render
  },
}));

// Bad: creating store inside a component
function MyComponent() {
  const useStore = create(() => ({ count: 0 })); // new store every render
}
```

---

## Forbidden Alternatives

| Library | Reason |
|---------|--------|
| redux / @reduxjs/toolkit | Forbidden for new adoption |
| recoil | Forbidden for new adoption; unmaintained |
| jotai | Forbidden for new adoption |
| `@tanstack/react-store` | Forbidden for new adoption; insufficient middleware ecosystem |
