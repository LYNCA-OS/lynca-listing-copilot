# Launch Engineering Loop

LYNCA Listing Copilot is in the Launch Optimization phase. A change is release
relevant only when it measurably improves at least one launch dimension without
breaking another:

| Dimension | Authoritative metric | Launch threshold |
|---|---|---:|
| Accuracy | Golden holdout SEM Card-Exact Accuracy | >= 0.87 |
| Throughput | Correctly completed cards per minute at 100, 500, and 1000 cards | >= 6 at every level |
| Reliability | Technical availability in a 1000-card multi-tenant soak | >= 0.999 |

`PASS` requires all three dimensions to pass. Missing or weak evidence produces
`INCONCLUSIVE`, never a successful zero or an inferred pass.

## Fixed benchmark sets

### A. Golden SEM accuracy

The source is the existing Supabase writer-reviewed inventory. A corrected
title is title-level ground truth and a parser input, but parser output is only
a review suggestion. It does not become field-level ground truth until a human
reviewer confirms each SEM field and records evidence.

The frozen split is deterministic by card identity group:

- development: 70%, training and iteration allowed;
- validation: 15%, model or policy selection only;
- holdout: 15%, release measurement only.

Holdout rows, identities, query images, and derived labels must never enter
training, prompt tuning, catalog promotion, approved memory, reference-image
indexing, embedding fitting, or threshold calibration. The holdout must contain
at least 45 reviewed cards for the launch gate.

SEM Card-Exact means every applicable confirmed SEM field is exact. `UNKNOWN`
and `NOT_APPLICABLE` are excluded from the corresponding denominator. Subject
is a normalized exact set match. Numerical rarity preserves the full visible
value, so `2/3` is not equal to `#/3`.

### B. Throughput benchmark

Run the same cloud deployment, model, dataset policy, and production
concurrency at 100, 500, and 1000 cards. Each level records queue wait, worker
time, provider latency, completion rate, retries, tokens, and cards completed
per minute. A smaller smoke cannot stand in for a missing level.

### C. Reliability soak

Run 1000 cards across at least three tenants. The queue must drain and the
report must prove:

- at least 99.9% technical availability;
- no duplicate job or duplicate asset result;
- no lost or successful-but-nonterminal job;
- no cross-tenant result;
- tenant isolation measured for every attempted card.

## Commands

Build the review packet from an exported Supabase feedback dataset:

```bash
npm run launch:golden-review-packet -- \
  --input data/eval/private/supabase-feedback.json
```

After field review, freeze the identity-group split:

```bash
npm run launch:freeze-sem -- \
  --input data/eval/launch-benchmark/golden-sem-review-packet-v1.json
```

Evaluate frozen predictions:

```bash
npm run launch:evaluate-sem -- \
  --dataset data/eval/launch-benchmark/frozen-v1/core-holdout.json \
  --predictions data/eval/launch-benchmark/predictions.json
```

Run throughput and reliability manually from an authorized cloud runner:

```bash
npm run launch:throughput -- \
  --dataset "$V4_EBAY_SMOKE_DATASET" \
  --sealed-labels "$V4_EBAY_SMOKE_SEALED_LABELS" \
  --levels 100,500,1000 --concurrency 2 --tenant-count 5

npm run launch:reliability -- \
  --dataset "$V4_EBAY_SMOKE_DATASET" \
  --limit 1000 --concurrency 2 --tenant-count 5
```

Combine the reports into the only authoritative launch verdict:

```bash
npm run launch:gate -- \
  --accuracy data/eval/launch-benchmark/sem-accuracy.json \
  --throughput data/eval/launch-benchmark/throughput-100.json \
  --throughput data/eval/launch-benchmark/throughput-500.json \
  --throughput data/eval/launch-benchmark/throughput-1000.json \
  --reliability data/eval/launch-benchmark/reliability-1000.json
```

The paid cloud benchmarks are manual by design. CI validates contracts and
tests only; it must not silently spend provider budget.

## Change admission

Every launch-phase change records:

1. target dimension and bottleneck;
2. falsifiable hypothesis and expected delta;
3. fixed dataset and control configuration;
4. complexity added and old logic removed;
5. result in all three dimensions;
6. rollback condition.

Changes without a target launch metric are deferred. A local gain may be kept
as a shadow experiment when it advances a sound long-term architecture, but it
cannot become the release default until the fixed benchmark proves net benefit.

## Sprint order

1. finish native V4 ownership convergence;
2. complete and freeze Golden SEM review;
3. run the accuracy sprint against the fixed holdout;
4. run the throughput sprint at all three levels;
5. run the 1000-card reliability sprint;
6. cut a release candidate only when the combined gate reports `PASS`.
