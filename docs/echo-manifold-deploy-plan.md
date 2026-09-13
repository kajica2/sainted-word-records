# ECHO Manifold — Standalone Deploy Plan

## TL;DR

The ECHO engine currently lives at `versions/echo-manifold.html` inside the
SWR repo. You're asking for a **standalone deployment**: separate GitHub repo,
separate Vercel project, public URL of its own. After the work, the engine
exists in **two places** — the SWR variant at `versions/echo-manifold.html`
(unchanged, for cross-discovery) and a standalone repo at
`kajica2/echo-manifold` deployed to Vercel with a public URL like
`https://echo-manifold.vercel.app`.

## What I will do

### Step 1 — Strip the SWR back-link from the standalone file
The `versions/echo-manifold.html` currently has a `<a class="back-link" href="/">← SWR</a>` chip in the header. In a standalone deploy that link goes to a 404. I'll keep **two** versions of the file:

- The SWR variant (in `versions/echo-manifold.html`) keeps the `← SWR` link unchanged.
- The standalone variant (in the new repo's root `index.html`) has the back-link replaced with a generic "Source" link pointing at the GitHub repo URL, OR stripped entirely.

**My default:** strip it entirely. The standalone app should feel like its own product, not a backdoor into SWR.

### Step 2 — Create the new repo
Local path: `~/projects/echo-manifold/` (a sibling to other personal projects — pick another if you prefer a different location). Init a fresh git repo, drop the engine file plus a minimal `package.json` + `vite.config.js` so the existing Vite build path still works for the standalone:

- `index.html` — the standalone version of `echo-manifold.html` (back-link stripped)
- `package.json` — name `echo-manifold`, scripts `dev` / `build` / `preview`, devDeps `vite`
- `vite.config.js` — minimal Vite config, no `copyStatic` (the standalone is a single HTML file, no library/audios/etc. to copy)
- `vercel.json` — clean-urls + the `cleanUrls` trap-avoidance, no rewrites needed for a root `index.html`
- `README.md` — short description, how to run dev / build, credits to the original Gemini Canvas
- `.gitignore` — `node_modules/`, `dist/`, `.vercel/`

**Why a fresh Vite config and not a no-build static site?** The engine is ~96KB of inline HTML+CSS+JS. A plain `static` deploy would work (Vercel serves `index.html` as-is), but the existing dev experience (HMR, dev server) is valuable for future edits to the engine. A minimal Vite config gives both: `npm run dev` for the dev loop, `vercel deploy` for production, and Vercel serves `dist/index.html` automatically because `vite build` emits it.

### Step 3 — Push to GitHub
- `gh repo create kajica2/echo-manifold --public --source=. --remote=origin --push --description "ECHO · Harmonic Manifold 5.0 — generative audio engine. Standalone WebAudio engine: 30 formulas across 9 sections, 5 generative modes. Verbatim port of the Gemini Canvas artifact."`

### Step 4 — Deploy to Vercel
- `vercel deploy --prod --yes` from the new repo root.
- Auto-creates `kai-djurics-projects/echo-manifold` Vercel project.
- Captures canonical alias (likely `echo-manifold.vercel.app` or `echo-manifold-<suffix>.vercel.app`).
- Smoke: `curl -sI https://<alias>/` returns 200 with the engine HTML.

### Step 5 — Wire GitHub ↔ Vercel auto-deploy
- `curl -X POST /v9/projects/<id>/link` with the GitHub repo reference.
- Verify `gitCredentialId` resolves.
- Push a test commit → confirm new deployment lands.

### Step 6 — Verify end-to-end
Run the Puppeteer verifier against the new live URL instead of localhost:
- `verify-echo-manifold.mjs` already exists in the SWR repo and works. I'll add a small variant `verify-echo-manifold-remote.mjs` (or extend the existing one with a `--url` flag) that points at the Vercel alias and runs the same 7 checks.
- Better: I'll just curl + headless-verify the deployed URL once and report the result inline.

### Step 7 — No commit to the SWR repo
The standalone deploy doesn't require any change to the SWR repo. The `versions/echo-manifold.html` file remains a faithful copy. If you want the SWR `versions.html` style-card to link to the new standalone URL instead of `/echo-manifold` (the SWR rewrite), I can do that as an optional follow-up — but it changes the SWR repo too, so it'd be a separate commit.

## What I will NOT do without explicit approval

- **No force-push** to either repo. If a push fails, I'll report and stop.
- **No DNS work.** The default Vercel domain is enough; custom domain attach is a separate task.
- **No removal of the SWR variant.** The SWR-side file stays. If you want it removed, say so.
- **No edits to the engine code itself.** The Math, audio graph, and visualizer branches are verbatim.
- **No change to the SWR `versions.html` style-card link.** The card still points at `/echo-manifold` (the SWR rewrite). Optional follow-up if you want it to point at the standalone URL instead.

## Reversibility

- Standalone repo is new — `gh repo delete kajica2/echo-manifold --yes` removes it.
- Vercel project is new — `vercel rm echo-manifold --yes` removes it.
- SWR repo: zero changes in this phase.

## What ships

| Item | Path / URL |
|---|---|
| Local repo | `~/projects/echo-manifold/` |
| GitHub repo | `github.com/kajica2/echo-manifold` |
| Vercel project | `kai-djurics-projects/echo-manifold` |
| Vercel canonical URL | `https://echo-manifold.vercel.app` (or with `-<suffix>` if name taken) |
| Files in repo | `index.html`, `package.json`, `vite.config.js`, `vercel.json`, `README.md`, `.gitignore` |

## Open questions for the approval gate

1. **Local repo path.** `~/projects/echo-manifold/` is my default. Want it somewhere else? (`~/Downloads/echo-manifold`, `~/code/echo-manifold`, a totally different spot?)
2. **Back-link handling.** Strip the `← SWR` link entirely, or replace with a "View source on GitHub" link pointing at `kajica2/echo-manifold`? (My default: strip.)
3. **Repo name.** `kajica2/echo-manifold` is my default. Want a different slug?
4. **SWR style-card link.** Leave as-is (points at SWR `/echo-manifold` rewrite), or update to point at the new standalone Vercel URL? (My default: leave as-is. The SWR card now serves as a sibling-discovery link to the standalone.)

## Step-by-step sequence (after approval)

```
1. mkdir -p ~/projects/echo-manifold && cd ~/projects/echo-manifold
2. git init -b main
3. Write index.html (copy of versions/echo-manifold.html with back-link stripped)
4. Write package.json, vite.config.js, vercel.json, .gitignore, README.md
5. git add . && git -c user.name="Kai Djuric" -c user.email="kai.djuric@gmail.com" commit -m "..."
6. gh repo create kajica2/echo-manifold --public --source=. --remote=origin --push --description "..."
7. vercel deploy --prod --yes    # from ~/projects/echo-manifold
8. Capture canonical URL
9. POST /v9/projects/<id>/link with the GitHub repo
10. Test webhook with empty commit
11. curl + verify the deployed page
12. Report the live URL + verifier output
```

## What can go wrong

- **`echo-manifold` is already taken on Vercel.** I'll get a suffix. Report and ask if you want a custom domain.
- **GitHub repo name collision.** Unlikely for `echo-manifold` but `gh` will tell us. Same recovery.
- **Vercel deployment hangs at UNKNOWN.** The skill has a 15-30 min self-heal path. I'll wait, then report.
- **Auth expired.** If `vercel whoami` fails partway through, I'll re-`vercel login` and resume.
- **The first deployment serves the page but the Vercel SSO gate traps the verifier.** `kai-djurics-projects` has SSO enabled. The canonical `*.vercel.app` URL bypasses SSO so curl works; only the per-deployment URL (`<project>-<hash>-<team>.vercel.app`) is SSO-gated. The verifier hits the canonical URL, so this is fine.
