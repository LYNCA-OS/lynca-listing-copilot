# Gated projection cross-run replay — 2026-08-02

This is a zero-provider-cost stability check. The same 150 reviewed cards have
an older paired canonical/free response checkpoint and a later fresh paired
response checkpoint. The replay applies only the five free-expression overlays
that do not need an exhaustive observation arm. Serial formatting is excluded
and remains a separate, source-anchored mechanism.

This is not an independent-card confirmation: the card IDs are the
development population. It tests whether a rule survives a different model
response for the same card, rather than proving generalization to new cards.

## Older paired response run

Source: `artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl`, 150 paired cards.

| Mechanism | Changed | Wins | Losses | Ties | Delta macro F1 | Reference loss | Over 80 | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Finish family + colour | 0 | 0 | 0 | 150 | 0 | 0 | 0 | No change |
| SAR only | 1 | 1 | 0 | 149 | +0.000265 | 0 | 0 | Replay candidate |
| Trainer Gallery | 0 | 0 | 0 | 150 | 0 | 0 | 0 | No change |
| 1st Bowman | 1 | 1 | 0 | 149 | +0.000395 | 0 | 0 | Replay candidate |
| Known-manufacturer product extension | 5 | 5 | 0 | 145 | +0.002846 | 0 | 0 | Replay candidate |
| Five-mechanism bundle | 7 | 7 | 0 | 143 | +0.003506 | 0 | 0 | Replay candidate |

The machine-readable ledger is
`artifacts/canonical-v3/gated-projections-cross-run-150.json`.

## Interpretation

The product extension is the most repeatable signal: it recovers five cards in
the older response run without a reference-token loss or an over-budget title,
and it was also positive on the later mixed response cohort. SAR and 1st
Bowman are smaller but likewise had no safety loss. The finish and Trainer
Gallery rules did not trigger on this older response, so their absence is not a
negative result.

This strengthens the candidate bundle as a learning asset, but does not change
the promotion boundary. The rules were selected from the same reviewed-card
population, and the repository still has only 105 cards outside the 150-card
development set. Production remains on the canonical thin path until a fresh,
label-blind 150-card card cohort clears the same zero-loss and under-80 gates.

No model, Cloud Run, vector, OCR, persistence, or second-call path was used.
