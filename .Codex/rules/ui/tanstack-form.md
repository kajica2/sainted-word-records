---
paths:
  - "**/*-form.tsx"
  - "**/forms/**/*.{ts,tsx}"
---

# TanStack Form Rules

> **Required version**: @tanstack/react-form >= 1.0.0 (v0.x RC API forbidden)

Covers: v1 GA API, Zod schema-first, useStore disambiguation, primitive adapter pattern.

See `ui/tanstack.md` for the full TanStack Quick Reference.

---

## Required

- [HARD] Forms use TanStack Form v1+ + Zod schema-first validation.
- [HARD] react-hook-form, formik, and `@hookform/resolvers` new imports forbidden.
- [HARD] Use v1 GA API: `useForm`, `<form.Field>`, `validators.onChange: schema`.
- [HARD] Do NOT use `import { useStore } from '@tanstack/react-form'` — named export does not exist. Use `form.useStore(selector)` instead.

---

## v1 GA API Pattern

```tsx
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  name: z.string().min(1, 'Name required'),
});

export function ContactForm() {
  const form = useForm({
    defaultValues: { email: '', name: '' },
    validators: {
      onChange: schema,
    },
    onSubmit: async ({ value }) => {
      await submitContact(value);
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <form.Field name="email">
        {(field) => (
          <div>
            <label htmlFor={field.name}>Email</label>
            <input
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors.map((e) => (
              <span key={String(e)}>{String(e)}</span>
            ))}
          </div>
        )}
      </form.Field>
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## Zod Schema-First

Define the Zod schema before the component. Share it for server-side validation when needed.

```ts
// schemas/contact.ts
import { z } from 'zod';

export const contactSchema = z.object({
  email: z.string().email(),
  message: z.string().min(10).max(500),
});

export type ContactInput = z.infer<typeof contactSchema>;
```

---

## useStore Disambiguation

TanStack has two distinct `useStore` APIs:

| Hook source | Purpose |
|-------------|---------|
| `import { useStore } from 'zustand'` | Global lightweight state (see `ui/zustand.md`) |
| `form.useStore(selector)` (form instance method — v1 GA) | This form's internal store (covered here). `import { useStore } from '@tanstack/react-form'` has no named export — **forbidden** |

Read form values reactively using `form.useStore` or `<form.Subscribe>`. Direct access via
`form.state.values.x` re-renders on every change — forbidden for performance-sensitive code.

```tsx
// Good: selective subscription
const email = form.useStore((state) => state.values.email);

// Good: Subscribe component
<form.Subscribe selector={(state) => state.canSubmit}>
  {(canSubmit) => <button disabled={!canSubmit}>Submit</button>}
</form.Subscribe>

// Bad: direct state access triggers re-render on all changes
const email = form.state.values.email;
```

---

## Primitive Adapter Pattern (shadcn optional)

When `apps/web/` has shadcn installed, combine shadcn primitive components (`Input`, `Label`,
`Button`) with `<form.Field>`. When shadcn is not installed, use plain HTML elements.

```tsx
{/* With shadcn primitives */}
<form.Field name="email">
  {(field) => (
    <div>
      <Label htmlFor={field.name}>Email</Label>
      <Input
        id={field.name}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
    </div>
  )}
</form.Field>

{/* Without shadcn — plain HTML */}
<form.Field name="email">
  {(field) => (
    <div>
      <input
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
    </div>
  )}
</form.Field>
```

Do NOT use shadcn `<Form>` / `<FormField>` / `<FormControl>` components — they are
react-hook-form based and incompatible with TanStack Form.

---

## Forbidden Libraries

| Library | Reason |
|---------|--------|
| react-hook-form | Forbidden for new code; TanStack Form v1 is the standard |
| formik | Deprecated approach; forbidden for new code |
| @hookform/resolvers | Only relevant for react-hook-form; forbidden |
