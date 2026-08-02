# Luna 5.6 bare-title evaluation — 150 cards — 2026-08-02

## Decision

The current bare model is not an `0.8x` F1 system on this cohort. Its listable-title F1 is
`0.711078`. The remembered `0.8x` result is a recall-family score: the same run records
policy-fair token recall `0.816012`. These metrics answer different questions and must not
both be called “accuracy”.

No production decision should use the old `0.8334` result as a direct baseline for this
150-card cohort. The current paired comparator is `thin_canonical_high`, whose F1 is
`0.767764` on exactly the same 150 asset IDs.

## Contract

- 150 reviewed cards, front and back images (`image_count=2`)
- model: `gpt-5.6-luna`
- reasoning effort: `none` requested and served
- image detail: `high`
- prompt: `Write the eBay listing title for this sports trading card. Reply with the title only -- no explanation, no quotes, no label.`
- no catalog, world knowledge, OCR, vector store, web lookup, CSM/SEM field schema, or second model call
- direct provider calls; concurrency `2`
- new output directory with no checkpoint reuse
- 150/150 completed, zero duplicate IDs, zero failed requests, zero retries

The raw-provider score below is the pure model-plus-prompt result. The listable score applies
only the existing deterministic string finisher (foreign-tail cleanup and marketplace
composition to the 80-character limit); it adds no knowledge.

## Results

| Output | F1 | Recall | Precision | Cards at F1 ≥ 0.80 |
|---|---:|---:|---:|---:|
| Raw model text | 0.664249 | 0.776167 | 0.588122 | 13/150 |
| Bare + deterministic 80-char finisher | 0.711078 | 0.775391 | 0.665866 | 33/150 |
| Same-card `thin_canonical_high` | 0.767764 | 0.744084 | 0.806318 | 74/150 |

The deterministic finisher improved 117 cards, hurt 11, and tied 22, for `+0.046828` mean
F1 (`p=1.58e-23`, exact paired sign test). Raw output exceeded 80 characters on 93/150 cards;
the median length fell from 83 to 76 characters.

Against canonical on the same IDs, bare won 46 cards, lost 92, and tied 12. Canonical's mean
advantage was `+0.056686` F1 (`p=1.12e-4`). This is not evidence that all constraints help:
canonical lost `0.031307` ordinary recall while gaining `0.140452` precision. Its benefit is
mainly selecting what to say, not seeing more.

The minimally budgeted string prompt (`thin_budgeted`) scored `0.714701`, only `+0.003623`
above bare on this cohort. The large gain is therefore not from adding the 80-character
instruction alone.

## Where bare loses

Most frequently missing reference tokens were `SSP` (12), `Gold` (11), `RC` (10), `Rookie`
(9), `Red` (8), `Autograph` (7), `Refractor` (7), and `1st`, `Hyper`, `Panini`, `Sapphire`
(6 each). These concentrate the next accuracy work in visible rarity/finish, rookie/attribute,
manufacturer, and exact parallel language rather than generic title constraints.

Precision is the larger immediate loss. Frequent words emitted when the reviewer did not use
them included `Mint` (25), `RC` (25), `Gem` (22), `Rookie` (17), `/25` (11), `/50` (11), and
`Refractor` (10). Some are unsupported assertions; others are valid observations that disagree
with the writer's title convention. Those two cases must be separated before changing the
model prompt or admission rules.

## Runtime

- p50 latency: 5.290 s
- p90: 7.200 s
- p95: 7.726 s
- p99: 9.470 s
- max: 11.149 s
- input tokens: 492,990 total
- output tokens: 4,029 total

Artifacts: `artifacts/bare-model-current-150-2026-08-02/`. Reusable analysis:
`scripts/analyze-bare-title-eval.mjs`.
