# Exact parallel color compaction — Production runtime 150 replay

## Decision evidence

This is a zero-call paired replay through `finishCanonicalTitle`, the same parser and Composer entrypoint used by Production. The reference label is used only after both titles exist, for scoring. Canonical field bytes are compared between the two runtime arms.

- Population: 150
- Input SHA-256: `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5`
- Provider calls: 0
- Macro F1: 0.780305 -> 0.780613 (+0.000308)
- Wins / losses / ties: 1 / 0 / 149
- Changed cards: 1

## Safety

| Field-byte changes | New drop cards | Truncated | Over 80 | Lost reference token | Unbacked new token | Numeric mutation |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Changed cards

| Asset | Outcome | Delta F1 | Baseline | Candidate |
|---|---|---:|---|---|
| `reviewed_blind_70559ba85193165a2f95` | WIN | 0.046154 | 2018 Topps Silver Pack Shohei Ohtani 1983 Chrome Promo 018/150 RC PSA 10 | 2018 Topps Silver Pack Shohei Ohtani 1983 Chrome Promo Blue 018/150 RC PSA 10 |
