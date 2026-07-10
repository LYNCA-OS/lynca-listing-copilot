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

## Operational quirk: post-deploy propagation window

For several minutes after `vercel deploy --prod` switches the alias, smoke
requests from Node fetch intermittently hang for the full client timeout
(observed repeatedly on 2026-07-09: first gate after deploy fails 0/N with
request_timeout at image verification; an identical rerun >=5-15 minutes
later passes, twice with the day's best scores). Direct curl probes during
and after the window are sub-second, and server logs show no failed
requests — the hangs die before reaching a function. Treat a first-run
all-timeout gate immediately after a deploy as suspect infrastructure, not
code: rerun once after ~10 minutes before investigating.

Final diagnosis (2026-07-10): the hangs are LOCAL-EGRESS network flake
on the dev machine's path to the Vercel edge — the same gate run from
GitHub Actions (`smoke-gate` workflow, workflow_dispatch) had zero
timeouts while local runs failed 0/3 twice in the same hour. The
Actions workflow is now the canonical gate; local smokes are for
iteration only.

## Infra weather: PostgREST transients (2026-07-10 ~02:00Z window)

Gate diagnostics (exact_anchor_finalize reason on pending L1) attributed a
run of fast-lane misses and first-card timeouts to transient PostgREST
unavailability — pg_stat_activity showed a healthy database (0 locks,
sub-second queries) during the same window. Mitigations landed: the finalize
RPC retries once in a widened race window (verified recovering a hit
mid-window), and the smoke-gate workflow warms the path before scoring.
During such windows, gate verdicts follow the rerun protocol; consider a
Supabase tier/pooler review if windows recur.

## Tracked baselines (C100 first-10 slice, policy-fair)

| Date | Config | avg | pass@0.72 | perceived p50 | Notes |
|---|---|---|---|---|---|
| 2026-07-08 | gpt-5-mini, pre-fix | 0.807 | 7/10 | ~30s+ | reasoning burn + out-of-spec caps |
| 2026-07-09 take1 | gpt-4.1-mini (accidental control) | 0.847* | — | 30.7s | *3 completed cards only |
| 2026-07-09 take5 | gpt-5-mini, all fixes, speculative | **0.851** | **9/10** | **305ms** | fast-lane 4/10 hits at 0ms |

Rules: one theme per change; accuracy changes need an A/B or smoke; speed
changes need timing evidence; never claim uplift without a tracked row here.
