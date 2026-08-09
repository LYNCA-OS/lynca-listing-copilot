# Writer-title evidence Pareto — protected 255

Date: 2026-08-09
Authority: label-aware development proxy only
Runtime changes: none
Network/provider calls: 0 / 0

## Question

Before buying another model experiment or asking for manual typed-gold review,
can the 255 protected, image-backed writer titles safely recover Product, Set,
or slab phrases that the current canonical result omitted?

Writer titles are weak marketplace supervision. They are not exhaustive
physical-card truth, so every factual and critical-error metric remains `null`.
They may rank development opportunities, but they cannot authorize Production.

## Distillation

- 255 cards; 233 contain at least one writer-title token missing from the
  canonical title.
- 705 omitted token occurrences and 415 contiguous omitted phrase occurrences.
- Historical canonical fields plus separate exhaustive-observation runs contain
  299 omitted tokens and 114 omitted phrases exactly. Of those, 159 tokens and
  79 phrases appear only in the exhaustive arm, so they are not evidence that
  the current Production call already exposes the phrase.
- The development banks contain 127 Product, 26 Set, and 13 slab expressions.
- Mean writer-title token recall proxy is 0.7432; precision proxy is 0.8050.
- Independent typed-gold coverage is 0/255. Factual precision, factual errors,
  critical errors, required-missing, and wrong-role metrics are all `null`.

## Per-card cross-fold executable bound

Product was selected with development-wide writer-label proxy statistics; that
arm choice is not held-out blind. Within the selected arm, each card's phrase
bank excludes that card's writer title, and the candidate is frozen before the
held-out title is scored. It requires support from other folds, an exact phrase
in this card's model output, a strict extension of an existing field, no
title-token displacement, and the 80-character limit.

| Bank | Exact addressable cards | Already present | Strict safe extension | Executable |
|---|---:|---:|---:|---:|
| Product | 10 | 0 | 0 | 0 |
| Set | 2 | 2 | 0 | 0 |
| Slab | 1 | 1 | 0 | 0 |

Product is the development-selected Pareto leader by apparent addressable
volume, but no card survives the complete per-card cross-fold source and
displacement guards. Set and slab candidates are already represented in their
canonical fields.

## Decision

`STOP_PHRASE_BANK_EXPANSION_UNDER_CURRENT_EVIDENCE`

Do not relax cross-fold, source-role, strict-extension, or Composer guards to
manufacture coverage. The 255 titles have been exhausted for this mechanism.
The next accuracy work should test the model input/output boundary directly,
with self-jitter controls, rather than add another deterministic post-rule.

## Receipts

- Distillation report SHA-256:
  `9475f3d68dfdec707a5e7d0c025167f067bcb55e29e1efad19cbfdd4bf744287`
- Pareto report SHA-256:
  `cdba08b7acf116ec7631825427914bb7d790ec1522b9655c568a32765267bb7b`
- Protected 255 dataset SHA-256:
  `5aebd6a4bb08665d6601801258e39a5954ec82b7187f71f577f18c71bd27adca`
- Sealed writer-title labels SHA-256:
  `59669f166180aab0bef24b5133b3cc92b06366f955eae54af0c43f7247436646`

The detailed reports remain ignored/private because they contain row-level
identities. A clean public checkout intentionally lacks these inputs. A holder
of the private evaluation root and the four receipt-pinned historical artifacts
can reproduce with:

```bash
EVAL_ROOT=/absolute/path/to/lynca-eval-root
ARTIFACT_ROOT=/absolute/path/to/lynca-thin-path

node scripts/distill-writer-title-evidence-v1.mjs \
  --dataset "$EVAL_ROOT/data/eval/reviewed-title-blind/reviewed-title-image-only.json" \
  --sealed-labels "$EVAL_ROOT/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl" \
  --prediction "$ARTIFACT_ROOT/artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl::thin_canonical_high" \
  --prediction "$ARTIFACT_ROOT/artifacts/targeted-105/thin-path-gpt-5.6-luna.jsonl::thin_canonical_high_effort_low" \
  --source-observation "$ARTIFACT_ROOT/artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl::exhaustive_observation_high" \
  --source-observation "$ARTIFACT_ROOT/artifacts/accuracy-expression-independent-105-2026-08-02/exhaustive/thin-path-gpt-5.6-luna.jsonl::exhaustive_observation_high" \
  --out "$ARTIFACT_ROOT/artifacts/writer-title-evidence-distillation-v1-2026-08-09/report.json" \
  --label-aware-development-only

node scripts/run-writer-title-product-phrase-pareto-v1.mjs \
  --dataset "$EVAL_ROOT/data/eval/reviewed-title-blind/reviewed-title-image-only.json" \
  --sealed-labels "$EVAL_ROOT/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl" \
  --prediction "$ARTIFACT_ROOT/artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl::thin_canonical_high" \
  --prediction "$ARTIFACT_ROOT/artifacts/targeted-105/thin-path-gpt-5.6-luna.jsonl::thin_canonical_high_effort_low" \
  --source-observation "$ARTIFACT_ROOT/artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl::exhaustive_observation_high" \
  --source-observation "$ARTIFACT_ROOT/artifacts/accuracy-expression-independent-105-2026-08-02/exhaustive/thin-path-gpt-5.6-luna.jsonl::exhaustive_observation_high" \
  --out "$ARTIFACT_ROOT/artifacts/writer-title-product-phrase-pareto-v1-2026-08-09/report.json" \
  --label-aware-development-only

npm run test:accuracy
```
