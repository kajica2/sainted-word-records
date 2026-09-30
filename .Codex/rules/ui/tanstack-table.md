---
paths:
  - "**/columns.tsx"
  - "**/*-table.tsx"
  - "**/features/**/table.{ts,tsx}"
---

# TanStack Table Rules

> **Required version**: @tanstack/react-table >= 8.0.0

Covers: Headless principle, ColumnDef typing, server-side pagination + URL sync,
shadcn conditional combination, forbidden alternatives.

See `ui/tanstack.md` for the full TanStack Quick Reference.

---

## Required

- [HARD] Tables use TanStack Table v8 hooks. v7, MUI DataGrid, AG Grid new adoption forbidden.
- [HARD] Always type `ColumnDef<T>` with the row data generic — no `any` or untyped columns.
- [HARD] Server-side pagination state must sync to URL search params (not component state only).
- Headless principle: TanStack Table has no built-in UI. Render with plain HTML or a UI kit.

---

## Headless Principle

TanStack Table provides logic only. Render `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`
elements yourself using the table instance APIs.

```tsx
import { useReactTable, getCoreRowModel, flexRender, ColumnDef } from '@tanstack/react-table';

type User = { id: string; name: string; email: string };

const columns: ColumnDef<User>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
];

export function UserTable({ data }: { data: User[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
            {hg.headers.map(h => (
              <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => (
          <tr key={row.id}>
            {row.getVisibleCells().map(cell => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## shadcn/ui Conditional Combination

Apply shadcn Table primitives (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`,
`TableCell`) **only if** `apps/web/` has shadcn installed (i.e., `components/ui/table.tsx`
exists). Without shadcn, use plain HTML elements or Tailwind primitives.

Apply the shadcn combination pattern only after a confirmed shadcn ADR for the project.

---

## ColumnDef Generic Typing

Always provide the row data type generic. Never use `ColumnDef<any>`.

```tsx
// Good
const columns: ColumnDef<Product>[] = [
  { accessorKey: 'sku', header: 'SKU' },
  {
    id: 'actions',
    cell: ({ row }) => <Actions product={row.original} />,
  },
];

// Bad — forbidden
const columns: ColumnDef<any>[] = [...];
```

---

## Server-Side Pagination + URL Sync

Persist pagination state in URL search params so users can share/bookmark pages.

### Vite (react-router `useSearchParams`)

```tsx
import { useSearchParams } from 'react-router-dom';

const [searchParams, setSearchParams] = useSearchParams();
const page = Number(searchParams.get('page') ?? '0');
const pageSize = Number(searchParams.get('pageSize') ?? '10');

const table = useReactTable({
  data,
  columns,
  pageCount,
  state: { pagination: { pageIndex: page, pageSize } },
  onPaginationChange: (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex: page, pageSize }) : updater;
    setSearchParams({ page: String(next.pageIndex), pageSize: String(next.pageSize) });
  },
  manualPagination: true,
  getCoreRowModel: getCoreRowModel(),
});
```

### Next.js App Router (`useSearchParams` from `next/navigation`)

```tsx
'use client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

const searchParams = useSearchParams();
const router = useRouter();
const pathname = usePathname();
const page = Number(searchParams.get('page') ?? '0');

function updatePage(pageIndex: number) {
  const params = new URLSearchParams(searchParams.toString());
  params.set('page', String(pageIndex));
  router.push(`${pathname}?${params.toString()}`);
}
```

---

## Forbidden Libraries

| Library | Reason |
|---------|--------|
| react-table v7 | Superseded by v8; API incompatible |
| @mui/x-data-grid | Opinionated UI; conflicts with headless approach |
| ag-grid-react / ag-grid-community | License and bundle overhead; not project standard |
