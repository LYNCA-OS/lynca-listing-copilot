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
- Same-call canonical/exhaustive model output already contains 299 omitted
  tokens and 114 omitted phrases exactly. This is availability evidence only.
- The development banks contain 127 Product, 26 Set, and 13 slab expressions.
- Mean writer-title token recall proxy is 0.7432; precision proxy is 0.8050.
- Independent typed-gold coverage is 0/255. Factual precision, factual errors,
  critical errors, required-missing, and wrong-role metrics are all `null`.

## Label-blind executable bound

The candidate selector was frozen before the held-out writer title was scored.
It required support from other folds, an exact phrase in this card's model
output, a strict extension of an existing field, no title-token displacement,
and the 80-character limit.

| Bank | Exact addressable cards | Already present | Strict safe extension | Executable |
|---|---:|---:|---:|---:|
| Product | 10 | 0 | 0 | 0 |
| Set | 2 | 2 | 0 | 0 |
| Slab | 1 | 1 | 0 | 0 |

Product is the ex-ante Pareto leader by apparent addressable volume, but no
held-out card survives the complete source and displacement guards. Set and
slab candidates are already represented in their canonical fields.

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
identities. Reproduce with:

```bash
node scripts/distill-writer-title-evidence-v1.mjs \
  --label-aware-development-only
node scripts/run-writer-title-product-phrase-pareto-v1.mjs \
  --label-aware-development-only
npm run test:accuracy
```
