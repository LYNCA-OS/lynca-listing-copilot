# Decision Learning Foundation v1

This phase adds offline decision-learning instrumentation only. It does not change the production prompt, provider, renderer, resolver, or gate.

## What Was Added

- Candidate reranker dataset export:
  - one row per query card and candidate
  - title-level proxy labels from reviewed/corrected title when field GT is unavailable
  - identity-aware positives that reject direct identity conflicts
  - oracle candidate bucket per query
  - candidate source breakdown
- Hard negative store export:
  - top-1 wrong with correct candidate in top-k
  - high-similarity vector candidate with direct conflict
  - correct catalog candidate not selected
  - safe assist recovery and near-conflict events
- Shadow decision graph:
  - deterministic shadow score
  - shadow selected candidate
  - none-of-the-above risk
  - would-change-title flag
  - reason trace
- Field accuracy dashboard:
  - field accuracy
  - auto accept and review rates
  - false accept and false reject counts
  - grouped by provider mode, catalog assist, vector lazy skip, retrieval title assist, known catalog, and cold start

## Current Diagnostic Snapshot

Using the saved c2 eval report as a local smoke export:

- Query count: 10
- Candidate rows: 79
- Candidate Recall@1/3/5/10: 6/10, 8/10, 8/10, 8/10
- Oracle upper bound: 8/10
- Current selected accuracy: 6/7
- Positive candidate count: 21
- Hard negative count: 44
- Hard negative store records: 16
- Missing correct candidate count: 2

The immediate failure shape is not only visual recognition. The system has a measurable oracle gap: some correct candidates exist but are not selected, while some query cards still have no correct candidate in the candidate set.

## Candidate Classes Most Likely To Fail

- Catalog near-neighbors that share year, product, or subject but conflict on identity fields.
- Candidates with strong title overlap but direct conflicts such as subject, denominator, or surface color.
- Correct catalog candidates that are available but not selected by the current system.
- Similar vector candidates that should stay supporting evidence rather than become identity truth.

## Fields Worth Training First

- `subject` and `subject_count`
- `serial_denominator`
- `surface_color`
- `product_or_set`
- `year`

The field dashboard intentionally separates `serial_number` from `serial_denominator`. Current marketplace titles normally keep numerical rarity such as `/199`, not the full serial numerator.

## Expected Reranker Leverage

A learned reranker should first target the oracle gap:

```text
recoverable decisions = oracle correct candidate present - current selected correct
```

On the c2 smoke export, that gap is currently 2 query decisions. The next milestone is to prove that the reranker recovers these decisions in shadow mode without increasing regression on a held-out report.

## Commands

```bash
npm run export:candidate-reranker -- \
  --input data/eval/concurrency-sweep/2026-07-01-c2.json \
  --rows-out data/eval/decision-learning/c2-reranker-rows.jsonl \
  --csv-out data/eval/decision-learning/c2-reranker-rows.csv \
  --metrics-out data/eval/decision-learning/c2-reranker-metrics.json \
  --hard-negatives-out data/eval/decision-learning/c2-hard-negatives.jsonl \
  --shadow-out data/eval/decision-learning/c2-shadow-decisions.json \
  --report-out data/eval/decision-learning/c2-foundation-report.md

npm run export:field-accuracy-dashboard -- \
  --input data/eval/concurrency-sweep/2026-07-01-c2.json \
  --out data/eval/decision-learning/c2-field-dashboard.json \
  --markdown-out data/eval/decision-learning/c2-field-dashboard.md
```

## Graduation Rule

Do not train or deploy a learned reranker until:

- positives and hard negatives are stable on held-out reports
- candidate recall is measured separately from selection accuracy
- shadow recovery exceeds shadow regression
- high-risk shadow changes are calibrated before production use
