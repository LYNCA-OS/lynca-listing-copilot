# Eval Registry

Single source of truth for evaluation datasets, ground-truth policy, and
tracked baselines. Update this file whenever a smoke establishes a new
baseline or a dataset version changes.

## Ground-truth policy

- **Writer-corrected titles** (351 feedback records) are internal GT.
- **Sealed seller labels** are local-eval-only reference: never sent to the
  model (`blind_policy` in every smoke report asserts this), not ground truth
  for identity — a human-written title used for fair token-recall scoring and
  as the human half of dual-agreement catalog promotion.
- Scoring: `policy_fair_token_recall` (raw recall + synonym/diacritic/noise
  forgiveness + policy-invariant handling of serial style). Pass thresholds
  tracked at 0.72 and 0.80.

## Datasets

| Dataset | Path | Cards | Notes |
|---|---|---|---|
| C100 eBay blind | `data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json` | 100 | image-only; sealed labels in sibling `.jsonl` |
| C50 eBay blind (legacy) | `data/eval/ebay-reference/ebay-c50-*-20260702.json` | 50 | superseded by C100 |

`data/eval/` is gitignored; canonical copies live in the team storage and the
Documents clone. If a file is missing locally, copy it from
`~/Documents/lynca-listing-copilot.v2_pai/data/eval/`.

## Smoke harness

`scripts/v4-ebay-smoke.mjs` — production-path smoke. Canonical invocation:

```
node scripts/v4-ebay-smoke.mjs --limit 10 --queue --speculative \
  --use-preingestion --prewarm --think-ms 6000 --l2-wait-ms 120000
```

Credentials come from `METAVERSE_USERNAME` / `METAVERSE_PASSWORD` env (no
defaults in code; local values in `.secrets/local.env`, gitignored).
`--model X` overrides the production default per request.

## Tracked baselines (C100 first-10 slice, policy-fair)

| Date | Config | avg | pass@0.72 | perceived p50 | Notes |
|---|---|---|---|---|---|
| 2026-07-08 | gpt-5-mini, pre-fix | 0.807 | 7/10 | ~30s+ | reasoning burn + out-of-spec caps |
| 2026-07-09 take1 | gpt-4.1-mini (accidental control) | 0.847* | — | 30.7s | *3 completed cards only |
| 2026-07-09 take5 | gpt-5-mini, all fixes, speculative | **0.851** | **9/10** | **305ms** | fast-lane 4/10 hits at 0ms |

Rules: one theme per change; accuracy changes need an A/B or smoke; speed
changes need timing evidence; never claim uplift without a tracked row here.
