# Pull Request

## What this PR does

(1-3 sentences, present tense; e.g. "Adds Layers.addText for user-typed
text layers. Click keyboard shortcuts 1-9 now apply look-filter slots
without touching any layer.")

## Why

(Link the issue this fixes or the surface it touches. Or describe
the user value in one line.)

## How to verify

```bash
# Tests that should pass before merge
npm run check:full
node scripts/check-<surface>.mjs   # if a new module was added
```

Manual:
1. Open `/engine`
2. Click / press X — observe Y
3. Refresh — observe Z

## Checklist

- [ ] `npm run check` is green
- [ ] `npm run check:full` is green (pre-PR gate)
- [ ] New unit test added (`scripts/check-*.mjs`) if a module changed
- [ ] `CHANGELOG.md` "Unreleased" updated under the right scope (feat /
  fix / refactor / docs / chore)
- [ ] `.env.example` updated if a new env var was added
- [ ] `site-map.json` and `vercel.json` regenerated if a page was added
  (`node scripts/generate-vercel-rewrites.mjs`)
- [ ] No new chunks / no debug logs (run `npm run check:build-idempotent`)

## Type

(use conventional commits prefixes)

- [ ] feat:
- [ ] fix:
- [ ] refactor:
- [ ] docs:
- [ ] test:
- [ ] chore:

## Surface touched

- [ ] engine
- [ ] api
- [ ] library
- [ ] UI panel
- [ ] docs
- [ ] build / deploy
- [ ] nothing user-visible
