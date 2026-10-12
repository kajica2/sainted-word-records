# Cross-validation notes

## Spot-checks against source

| Claim in report | Verified against | Status |
|-----------------|------------------|--------|
| 997 LOC in `generated.rb` | `wc -l lib/linguist/generated.rb` | ✅ |
| 105 LOC in `lib/linguist.rb` | `wc -l lib/linguist.rb` | ✅ |
| 13,728 stars | GitHub API `stargazers_count` | ✅ |
| `STRATEGIES` order | Read `lib/linguist.rb:63-72` | ✅ |
| `MAX_TREE_SIZE = 100_000` | Read `repository.rb:14` | ✅ |
| `MAX_SIZE = 128 * 1024` (LazyBlob) | Read `lazy_blob.rb:23` | ✅ |
| `CLASSIFIER_CONSIDER_BYTES = 50 * 1024` | Read `classifier.rb:10` | ✅ |
| `HEURISTICS_CONSIDER_BYTES = 50 * 1024` | Read `heuristics.rb:6` | ✅ |
| `MAX_TOKEN_LEN = 16` | Read `ext/linguist/tokenizer.l:5` | ✅ |
| `MIN_DOCUMENT_FREQUENCY = 2` | Read `classifier.rb:153` | ✅ |
| 6 indexes on `Language` | Read `language.rb:20-28` | ✅ |
| `BlobHelper` mixin DEPRECATED comment | Read `blob_helper.rb:8-12` | ✅ |
| `Regexp::TimeoutError` rescue | Read `heuristics.rb:33-34` | ✅ |
| F1 numbers from OctoLingua blog | Fetched and read full article | ✅ |
| 768 sample directories | `ls samples \| wc -l` | ✅ |
| 557 vendored grammars | `find vendor/grammars -maxdepth 1 -type d \| wc -l` | ✅ |
| 9,674 lines in languages.yml | `wc -l lib/linguist/languages.yml` | ✅ |
| 1,252 lines in heuristics.yml | `wc -l lib/linguist/heuristics.yml` | ✅ |
| Tokenizer C extension | Read `ext/linguist/tokenizer.l` and `linguist.c` | ✅ |
| `.gitattributes` invalidation in incremental scan | Read `repository.rb:148-154` | ✅ |
| `language.group` aggregation | Read `repository.rb:182` | ✅ |

## Cross-module consistency

- **Strategy pipeline consistency:** §4.1, §4.3, §4.4, §4.5, §4.10 all reference the same `STRATEGIES` constant and the same three-termination contract. No contradictions.
- **Tokenizer consistency:** §4.5 and §4.6 both treat the tokenizer as the C extension that strips comments/strings/numbers. §4.5 discusses the classifier's use of it; §4.6 discusses the `.l` rules.
- **Override / gitattributes consistency:** §3 (design philosophy), §4.8 (LazyBlob#language), §4.10 (public docs) all reference the same five `linguist-*` attributes. The instrumented "confirmed by .gitattributes" / "overridden by .gitattributes" behavior is described in §4.1 (instrumentation mention) and §4.8 (LazyBlob#language implementation). Consistent.
- **Generated/vendored/documentation consistency:** §3 (veto chain in main flowchart), §4.7 (deep dive), §4.8 (`include_in_language_stats?` final gate). All three correctly describe the same AND gate.

## Claims left soft

- **"Most files exit the pipeline within the first 3-4 strategies."** Plausible but not measured. The strategy chain is deterministic per-blob; whether extension always short-circuits depends on whether the file has a known extension. I left this as an observation, not a measurement. If a reader wants to verify, `script/cross-validation --test` will show per-file strategy hits.
- **"The `Source::Repository` abstraction is the plug-in point for non-Rugged VCS backends."** I claimed this as a design intent. There's only one implementation (`RuggedRepository`). The interface exists, but it's not clear from the code whether non-Rugged backends have ever been used in production. I left this as a "the door is open" claim.
- **The git history of `Classifier`.** I claimed "the doc was written when the algorithm was Naive Bayes" as one of two possibilities for the doc/code drift. I have not run `git log -p lib/linguist/classifier.rb` to verify. The other possibility (loose terminology) is equally plausible. Both are flagged as possibilities, not stated as fact.
