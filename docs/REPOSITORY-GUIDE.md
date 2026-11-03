# Repository guide

Sainted Word Records is a visual instrument for independent musicians: bring a song and footage into a browser, then shape a composition that responds to the music.

## Choose a starting point

| Your task | Start here |
| --- | --- |
| Try the visual instrument | [Open the engine](https://sainted-word-records.vercel.app/engine/) |
| Understand the product and features | [README](../README.md) |
| Make a code change | [Contributing](../CONTRIBUTING.md) |
| Understand runtime boundaries and conventions | [Agent instructions](../AGENTS.md) |
| Inspect development and validation commands | [Package scripts](../package.json) |
| Review changes | [Changelog](../CHANGELOG.md) |
| Report a vulnerability | [Security policy](../SECURITY.md) |

## Where work belongs

| Location | Responsibility |
| --- | --- |
| `engine.html` | Main engine entry point |
| `lib/` | Engine primitives, persistence, audio, and shared plumbing |
| `client/` | Feature controllers and higher-level interaction stacks |
| `api/` | Server-side routes and their shared helpers |
| `versions/` | Alternative visual surfaces and their existing authoring tools |
| `variants/` | Per-variant automix and curator configuration |
| `scripts/` | Verification, generation, and build tools |
| `docs/` | Architecture, decisions, and developer references |
| `site-map.json` | Canonical site information architecture |

Trace the existing shared module before adding a feature implementation. A page, its route, its build inclusion, and its navigation entry form one change. Follow the site-map generation workflow in the agent instructions.

Before moving a runtime file, trace script URLs, globals, build-copy lists, route generation, service-worker references, and verification scripts. Migrate a single subsystem with its callers and prove the built routes still resolve.

## Product personality

**Tactile, direct, led by the music.** Introductions can evoke a performance; controls should say exactly what they do.

- Lead with the artist's action: load a song, add footage, shape the mix, record.
- Use tempo, motion, texture, and space when describing a visual choice.
- Keep technical details beside the controls they help explain.
- Describe local processing separately from opt-in server and cloud features.
- Describe export formats and paid capabilities according to the current implementation.
- Avoid competitor price comparisons or delivery promises that have not been checked.

Example introduction: “Bring your song. Add your footage. Shape the way they move together.”

Example empty state: “Add footage to start building your visual mix.”

The shared identity is **Kai Djuric — musician, inventor, creative technologist**. Sainted Word Records expresses the performance and visual-instrument side of that practice. Its shared design system is the source for visual decisions.

## Working agreement

Read the contribution and agent instructions. Run the relevant checks and the prescribed full pre-PR gate. Record actual outcomes rather than repeating historical suite counts. Use a branch and describe any remaining verification in the pull request.
