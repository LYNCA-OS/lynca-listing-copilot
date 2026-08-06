# World product extension v1 — full-title fresh150 replay

Decision: **STOP_FINAL_TITLE_GATE**. Provider calls: 0. Production promoted: false.

This closes the old gap between a positive candidate-ranking result and the actual CSM/SEM Composer title. The ranker may only reorder Luna-emitted identity candidates with positive product-year support; the extension only lengthens a compatible existing Product from visible text.

| Metric | Result |
|---|---:|
| Macro F1 | 0.766927 -> 0.766771 (-0.000156) |
| Wins / losses / ties | 0 / 1 / 149 |
| Changed cards | 1 |
| Reference-loss cards | 0 |
| Numeric-loss cards | 0 |
| Titles over 80 | 0 |

## Changed-card ledger

| Asset | Product change | Delta F1 | Positive support edge |
|---|---|---:|---|
| `reviewed_blind_10f650102a783e83aff4` | Donruss Optic Football -> Optic O Donruss | -0.023333 | product_year:Donruss:2025 |

The snapshot still lacks row-level disjoint provenance. Passing this replay would only justify rebuilding the same support graph from source-addressed rows, not a paid or production promotion.
