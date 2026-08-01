# Candidate expression v4 vocabulary replay — candidate, not production

## Decision

Keep this mechanism in the evaluation lane. It is a promising **learning
asset**: a candidate fact is only admitted when the canonical slot is empty,
the fact is printed (`exact_text` or `stamped_text`), and the local catalog
attests the target vocabulary. It is not yet a runtime asset because this
result is a development subset and the candidate response was captured on the
same cards used to discover the rule.

No provider call was made by this replay. The resolver is not imported by the
production CSM/SEM route and returns `authority: evaluation_only` and
`production_promoted: false`.

| Metric | Result |
|---|---:|
| Matched cards | 102 |
| Changed cards | 4 |
| Wins / losses / ties | **4 / 0 / 98** |
| Baseline macro F1 | 0.761042 |
| Replay macro F1 | 0.764324 |
| Delta | **+0.003282** |
| New model calls | 0 |

This is a deterministic replay of `canonical-v3` against the stored v4
candidate facts. It is not an independent 150-card estimate and must not be
described as a production accuracy gain.

## What was admitted

The rule has three deliberately narrow channels:

1. `identity` + printed basis + an empty `card_name` + an attested `insert`
   vocabulary term;
2. `finish` + printed basis + an empty `parallel_exact` + an attested,
   multi-word `print_finish` term;
3. `attribute` + printed basis + an empty `descriptive_rarity` + one of the
   literal printed markers `SSP`, `SP`, `1ST BOWMAN`, or `1ST EDITION`.

It does not admit logo-only facts, affiliations, model-knowledge hypotheses,
unattested finish wording, or any overwrite of a canonical value. The
catalog is used as a vocabulary gate, not as row-level retrieval or a world
model.

## Four-card ledger

| Card | Field | Baseline → replay | ΔF1 | Evidence and gate |
|---|---|---|---:|---|
| Jalen Brunson | `parallel_exact` | `…Brunson 13/25 RC PSA 9` → `…Brunson MOJO PRIZM 13/25 RC PSA 9` | +0.052381 | stamped `MOJO PRIZM`; verified-title vocabulary, count 9 |
| Diana Shnaider | `card_name` | `…Mirror Diana Shnaider` → `…Mirror Diana Shnaider MIRRORED` | +0.115385 | exact `MIRRORED`; official insert vocabulary, count 25 |
| Jayden Daniels | `parallel_exact` | `…Daniels 9/10 RC PSA 10` → `…Daniels GOLD SHIMMER 9/10 RC PSA 10` | +0.107660 | stamped `GOLD SHIMMER`; verified-title vocabulary, count 12 |
| Caleb Wilson | `descriptive_rarity` | `…Prospect Auto 1/1` → `…Prospect Auto 1/1 1ST BOWMAN` | +0.059289 | exact `1st Bowman`; strict printed-rarity literal |

All four changes are additive fills into previously empty slots. There were no
loss cards, but the zero losses are not sufficient for promotion: the rule was
selected and measured on the same development response pool.

The other 98 cards were not silently ignored. Their slot-level outcomes were:

| Slot | Admitted | Occupied already | Candidate present but not attested |
|---|---:|---:|---:|
| `card_name` | 1 | 48 | 53 |
| `parallel_exact` | 2 | 0 | 100 |
| `descriptive_rarity` | 1 | 7 | 94 |

“Not attested” means the fact was absent, used a non-printed basis, failed the
local vocabulary threshold, or was rejected by the strict literal gate. It is
not evidence that the model did not see the content; it is evidence that this
resolver correctly refused to grant it canonical authority.

## Stop conditions and next gate

The broad identity overlay was stopped separately after 4 wins / 12 losses /
86 ties and ΔF1 −0.004188. This vocabulary rule must not be widened back into
generic identity or logo admission. Its next test is a pre-registered paid
screen on fresh cards; only if it survives that screen should it enter the
paired independent 150-card confirmation. Until then, production remains on
the deployed canonical route.

Replay command:

```text
node scripts/analyze-candidate-expression-v4-vocabulary-replay-v1.mjs
```

The full per-card ledger is stored at
`artifacts/candidate-expression-v4/development-150/vocabulary-replay-v1.json`.
