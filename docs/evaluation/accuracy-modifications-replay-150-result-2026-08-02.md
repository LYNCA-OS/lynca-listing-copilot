# Accuracy modification replay — 150-card extreme-observation cohort (2026-08-02)

## Decision

Keep only the serial-format replay as an evaluation candidate. Do not promote
the logo→Set or printed-Set projections. The language observation gate remains
implemented, but this cohort produced no exact `EN|JP|CN|KR` evidence, so it has
no measured gain. No production authority or persistence path was changed by
this experiment.

## Cohort and provenance

- Canonical arm: `thin_canonical` from
  `artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl`.
- Diagnostic arm: `exhaustive_observation_high` from
  `artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl`.
- Final paired cohort: 150 unique asset IDs on both sides; missing and extra
  IDs: zero.
- The diagnostic paid run had one transient `fetch failed`; the checkpoint
  resumed with only the missing card and finished 150/150. Successful rows
  were not re-called.
- Replay output:
  `artifacts/extreme-observation-2026-08-02/accuracy-modifications-150.json`.

Command:

```sh
node scripts/replay-accuracy-modifications-100.mjs \
  --canonical artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl \
  --canonical-arm thin_canonical \
  --exhaustive artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl \
  --exhaustive-arm exhaustive_observation_high \
  --limit 150 \
  --out artifacts/extreme-observation-2026-08-02/accuracy-modifications-150.json
```

The replay now fails closed when the selected canonical and diagnostic cohorts
do not match. This prevents the earlier class of false `0/50` results caused
by reading the canonical fields from the wrong arm/file.

## Paired results

Baseline macro F1 for this canonical 150: **0.7714935103**.

| Mechanism | Changed | Wins | Losses | Ties | Replay F1 | Δ macro F1 | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Logo observation → Set | 27 | 4 | 19 | 127 | 0.7668342265 | **−0.0046592838** | Reject |
| Printed Set observation | 6 | 1 | 2 | 147 | 0.7703893547 | **−0.0011041556** | Reject |
| Same-value serial formatting | 6 accepted (1 rejected) | 6 | 0 | 144 | 0.7752647532 | **+0.0037712429** | Retain with safety gate |
| Exact language observation | 0 | 0 | 0 | 150 | 0.7714935103 | 0 | No evidence; do not claim gain |

### Serial candidate detail

All accepted changes were formatting-only and preserved the same numerator and
denominator already present in canonical fields. The changed values were:

`027/150`, `082/100`, `02/25`, `018/150`, `09/10`, `05/20`.

There were no serial inferences from an empty canonical field, no unbacked
accepted additions, and no accepted title over 80 characters. One otherwise
valid same-value repair (`8/25` → `08/25`) was rejected because the extra
character would make Composer drop the reference-helpful `Panini` token. The
resolver accepts only a valid `n/d` observation whose numeric pair equals the
canonical pair; descriptive evidence such as “Japanese text” is not promoted
to a language field.

### Why the two tempting visual projections are rejected

The logo rule changed 27 cards and lost 19. Representative regressions include
`NFLPA`, `PTPA`, `MLB PLAYERS`, and `Sports Collectors Digest` being inserted as
Set-like text. These are not safe product identifiers. The printed-Set rule
also lost on the Star Wars and UEFA examples; its smaller change count does not
make the direction positive.

## Relation to existing Composer recovery

The current deterministic Composer recovery remains a separate positive
serialization asset measured previously on 150 canonical cards: 6 wins, 0
losses, 144 ties, Δ macro F1 **+0.00272813**, with zero over-budget, lost
reference-token, and unbacked-token cards. The new serial result is measured on
the current Composer baseline, so it is an incremental candidate rather than a
second claim that the same recovery was independently re-proven.

## Promotion gate

1. Keep the serial resolver evaluation-only until a real 150-card paired run
   confirms the gain and checks field-level correctness.
2. Do not enable logo or printed-Set projection from this evidence.
3. Do not call the language mechanism negative: the diagnostic arm simply did
   not emit an exact supported language label in this cohort.
4. The bundle replay is now complete; before promotion, run exactly 150 real
   cards and report per-card/per-field wins, losses, ties, safety, latency,
   tokens, and cost.
