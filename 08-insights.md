# Insights & design-philosophy distillations

## The four load-bearing decisions

1. **YAML over Ruby for every policy.** Languages, heuristics, vendored paths, documentation paths, popular list, generated markers, generic extensions, language_id assignments. ~12,000 lines of YAML drive ~3,900 lines of Ruby. The Ruby is "load YAML, build indexes, dispatch." Every policy that GitHub contributors argue about is in a YAML file. The cost: parsing YAML at startup. The benefit: any GitHub employee can submit a one-line PR to fix a misclassification.

2. **Strategy chain with candidate passing.** Not a vote, not a softmax, not a winner-takes-all tournament. A *cascade* where each step narrows the candidate set and any single-candidate result terminates. This encodes the asymmetric cost of wrong-commitment vs no-commitment. The classifier is the only strategy that gets to commit a positive answer from a fresh start.

3. **C extension for tokenization, Ruby everywhere else.** The hot path of the hot path is a 176-line flex/lex file. Everything else is Ruby. The boundary is drawn at "what's called millions of times per repo scan" vs "what's called once per repo." Tokenization is the only thing in the first category.

4. **Content-hash the cache, store the hash in the cache.** `SHA256.hexdigest(db)` of the trained classifier. The hash changes when any sample changes; the cache key includes the hash; old caches invalidate themselves. 38 lines of Ruby, and `samples_data.rb` is a self-describing artifact.

## What this project teaches, generically

- **For any domain-specific classifier:** the policy is data, the mechanism is code. If your config is bigger than your code, you're doing it right. Linguist's 3:1 data-to-code ratio is the model.

- **For any "decide what to do with this thing" pipeline:** the cascade-with-candidate-passing pattern is broadly applicable. Routing decisions, log-level classification, content moderation, image category detection — all of them work better as "narrow the candidate set, then commit when confident" than as "score every option, pick the best." The first model is explainable per-step; the second is a black box.

- **For any project with a hot path:** the cost of writing a C extension is bounded, and the benefit scales linearly with call count. Tokenization is hot because every file goes through it. The 5-10x speedup from C over Ruby is permanent — every commit to every repo, forever.

- **For any library with a public override system:** the override is the most important feature. Linguist's `.gitattributes` overrides turn "this is a misclassification bug" into "I added a line to my repo and it's fixed." Self-service beats support tickets every time.

- **For any project mid-migration from OOP to FP:** the deprecation comment in the source code (not the changelog) is the right way to signal it. `BlobHelper` says "DEPRECATED Avoid mixing into Blob classes. Prefer functional interfaces like `Linguist.detect`." A reader of the code sees it immediately; a reader of the changelog does not.

## Critique of the design

1. **`generated.rb` should be data-driven.** 70+ method definitions, each a one-liner regex or path test, all OR'd into a single function. This is the kind of code that grows by accretion and eventually has 200 methods. The `vendor.yml` and `documentation.yml` approach (a YAML list of regex strings, one match test) is the right model.

2. **The "naive Bayesian" label is wrong and has been wrong for years.** The code does TF-ICF + nearest centroid, not Naive Bayes. This is a small piece of institutional misinformation that costs nothing to fix.

3. **The strategy pipeline has no measurement of confidence.** The classifier knows the cosine similarity, but it's discarded. A caller who wants to render "Likely Ruby (82%)" vs "Guessing Ruby (42%)" has to re-implement the similarity computation. The instrumentation hook records which strategy matched, but not how confident that strategy was.

4. **The override system is great but is *not* versioned.** If a user changes their `.gitattributes`, the change takes effect immediately, but if the user wants to know what *would* have been detected without the override, they have to manually remove the override and re-run. A `Linguist.detect_without_overrides(blob)` would be a small but useful addition.

5. **The `MAX_TREE_SIZE = 100_000` cap is a sharp edge.** Repos above 100k files (large monorepos, Linux kernel) get no language stats at all. The cap is documented, but it's a "silent zero" rather than a "we tried but failed" — there's no way to tell from the API whether the repo was 99k files (analyzed) or 200k files (capped).

## What I would build differently, given a fresh start

If I were writing Linguist in 2026, I would:

- Keep the strategy chain (it's perfect).
- Keep YAML for all policies (the data-driven approach is correct).
- Replace `generated.rb` with `generated.yml` and a small dispatcher.
- Replace the centroid classifier with a small neural net *only* for the no-extension case. For the extension case, the strategy chain is already 95% accurate and fully explainable; the ML should fill the gap, not replace the cheap path.
- Add a `confidence` return value to every strategy. The pipeline becomes "first strategy that returns confidence ≥ threshold wins."
- Add a public API for "given a blob, what would each strategy say?" so users can debug misclassifications without forking the library.
- Keep the C extension for tokenization, but add a `--explain` mode that dumps the token stream for a given file, so users can see what the classifier actually sees.

## If you only read three files

1. **`lib/linguist.rb`** (105 lines) — the strategy chain. The whole design in 100 lines.
2. **`lib/linguist/classifier.rb`** (413 lines) — the "Bayesian" classifier. The most subtle code in the project.
3. **`docs/overrides.md`** — the user-facing override system. The single biggest leverage point for user satisfaction.
