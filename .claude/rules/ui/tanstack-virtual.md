---
paths:
  - "**/Virtual*.{ts,tsx}"
  - "**/virtual-*.{ts,tsx}"
  - "**/Chat*.{ts,tsx}"
  - "**/List*.{ts,tsx}"
---

# TanStack Virtual Rules

> **Required version**: @tanstack/react-virtual >= 3.0.0

Covers: v3 `useVirtualizer` pattern, item count thresholds, parent container requirements,
dynamic size measurement.

See `ui/tanstack.md` for the full TanStack Quick Reference.

---

## Required

- [HARD] Lists with 100+ items MUST use TanStack Virtual v3 `useVirtualizer`.
- Lists with 50–99 items: strongly recommended.
- [HARD] Parent container MUST have a fixed height and `overflow: auto` (or `overflow-y: auto`).
- [HARD] Use `getScrollElement: () => parentRef.current` — NOT the deprecated v2 `parentRef` prop.

---

## v3 useVirtualizer Pattern

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export function VirtualList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current, // v3: callback, not ref prop
    estimateSize: () => 48,
    overscan: 5,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflowY: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <ItemCard item={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## v2 API — Deprecated (Forbidden)

`useVirtual({ parentRef })` from v2 is deprecated — do not use.
v3 equivalent: `useVirtualizer({ count, getScrollElement: () => parentRef.current, estimateSize })`.

---

## Item Count Thresholds

| Item count | Virtualization |
|------------|---------------|
| < 50 | Optional |
| 50–99 | Strongly recommended |
| 100+ | **Required (HARD)** |

When count can grow at runtime (infinite scroll, real-time chat), apply virtualization from the start.

---

## Parent Container Requirements

The parent container MUST have:

1. A **fixed height** — `px`, `vh`, or `flex-1` inside a fixed-height flex ancestor.
2. `overflow: auto` or `overflow-y: auto` — the container is the scroll element, not the window.

`overflow: hidden` or no overflow causes scroll detection to fail.

---

## Dynamic Size Measurement

For variable-height items (chat messages, expandable rows), use `measureElement`:

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 60,
  overscan: 3,
});

<div ref={virtualizer.measureElement} data-index={virtualItem.index}>
  <DynamicItem item={items[virtualItem.index]} />
</div>
```

`estimateSize` sets the initial layout estimate; `measureElement` corrects it after DOM render.
