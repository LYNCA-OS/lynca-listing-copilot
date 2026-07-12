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
| 2026-07-10 paired queue gate | gpt-5-mini, hidden L1 + paired L2, global capacity control | **0.952381** | **3/3** | **8.279s** | Same fixed gate cards; all three finalized through the capacity-controlled exact-anchor path. |

## Production gate validations

| Date | Run | Commit | Cards | Policy-fair avg | Writer-ready p50 / p95 | Perceived p50 / p95 | Verdict |
|---|---|---|---|---|---|---|---|
| 2026-07-10 | `29070448525` | `f6bf5f1` | 2/3 | 0.629630 | 5.283s / incomplete | 0ms / incomplete | Failed: one GPT-5 mini HTTP 200 empty response remained unrecovered across two queue attempts. |
| 2026-07-10 | `29071181965` | `593529f` | **3/3** | **0.922078** | **5.636s / 24.353s** | **0ms / 19.350s** | Passed after provider-level empty-response retry/key-rotation hardening; 20,893 total tokens. |
| 2026-07-10 | `29074423252` | `f0352dd` | 2/3 | 0.541126 | 46.952s / 94.078s | 41.947s / 89.075s | Failed experiment: cache-only scout removed all 3 fast-lane hits; one GPT-5 semantic-empty result exhausted retries. This negative result was reverted. |
| 2026-07-10 | `29076513466` | `f9200c9` | **3/3** | **0.952381** | **13.284s / 16.613s** | **8.279s / 11.611s** | Passed with hidden L1 + paired L2 under the distributed provider-capacity queue; 3/3 exact-anchor finalizations, 15,487 total tokens, zero runtime errors. |

The passing run did not reproduce an empty response, so the live gate proves
no regression and full completion, while the key-rotation behavior itself is
locked by the provider-routing regression test. Compared with the prior same
three-card passing gate (`29067775787`), policy-fair accuracy is unchanged at
0.922078 while writer-ready p95 fell from 79.870s to 24.353s and perceived p95
fell from 74.864s to 19.350s.

The paired-queue gate `29076513466` supersedes the cache-only experiment. It
keeps direct browser prewarm cache-only, but runs paid hidden L1 inside the same
global capacity lease system as L2. Compared with `29071181965`, policy-fair
accuracy rose from 0.922078 to 0.952381, perceived p95 fell from 19.350s to
11.611s, and total tokens fell from 20,893 to 15,487. The new timing includes
the hidden L1 queue stage, so its p50 is a more honest upload-to-final measure
than the earlier gate that completed paid prewarm before the timer origin.

Rules: one theme per change; accuracy changes need an A/B or smoke; speed
changes need timing evidence; never claim uplift without a tracked row here.

## Production concurrency capacity (2026-07-11)

Objective: maximize correctly completed cards per minute while keeping technical
completion at 100%, retries at zero, queue/provider tails bounded, node ledgers
complete, and weak-label quality from regressing. Every stratum used fresh blind
eBay card images, the same production deployment and GPT-5 mini path, catalog +
vector + OCR enabled, and no seller title was exposed before predictions froze.
Seller-title policy recall is a weak guardrail, not reviewed identity GT.

| Run | Concurrency | Cards | Cards/min | Writer p50 / p95 | Queue p95 | Retries | Node errors / missing | Tokens/card | Weak policy pass@0.72 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `29156242983` | 1 | 4/4 | 1.956 | 25.7s / 36.2s | 1.16s | 0 | 0 / 0 | — | guardrail only |
| `29156242983` | 2 | 4/4 | 2.034 | 30.3s / 81.6s | 34.15s | 0 | 0 / 0 | — | guardrail only |
| `29156242983` | 3 | 4/4 | **3.473** | 37.3s / 41.7s | 0.47s | 0 | 0 / 0 | — | guardrail only |
| `29156242983` | 4 | 4/4 | 2.969 | 38.9s / 78.2s | 41.60s | 0 | 0 / 0 | — | guardrail only |
| `29158872635` | 2 | 6/6 | 1.962 | 34.4s / 106.9s | 1.49s | 1 | 0 / 1* | 10,115.50 | 4/6 |
| `29158872635` | 3 | 6/6 | **3.130** | 49.4s / 64.3s | 1.51s | **0** | **0 / 0** | **9,759.83** | **5/6** |
| `29185731437` | 1 | 6/6 | 2.593 | 19.9s / 23.8s | 1.75s | 0 | 0 / 0 | 10,444.83 | 5/6 |
| `29185731437` | **2** | **6/6** | **4.176** | 26.1s / 28.4s | **1.52s** | **0** | **0 / 0** | **10,073.17** | 5/6 |
| `29185731437` | 3 | 5/6 | 3.802 | 15.5s / 34.1s | 1.80s | 0 | 1 / 1 | — | 2/6 |

The first run exposed a lost post-enqueue wakeup when several browser requests
collapsed into one short queue-kick lease. The follow-up wakeup fix reduced the
2/3-concurrency queue p95 to approximately 1.5 seconds in the confirmation run.
The remaining 2-concurrency tail was one completion-row write rejected by
Postgres because provider text contained a NUL byte; recognition itself had
already succeeded. The centralized Postgres JSON sanitizer now prevents that
write fault and records `completion_payload_sanitized_nul_count`. Retry causes
are retained in smoke reports. `*` The missing catalog node was the same retry
dropping timing while retaining a complete catalog funnel; trace-backed
execution is now reported as completed rather than falsely missing.

The 2026-07-12 sweep supersedes the earlier concurrency-3 decision. It ran on a
new production commit with fresh, disjoint blind samples and full node-level
instrumentation. Concurrency 2 increased correct technical throughput by 61.0%
over concurrency 1 while remaining 6/6 complete. Concurrency 3 fell below the
concurrency-2 throughput and produced one unrecovered structured-response
failure. OpenAI request and token headroom remained above 99.8%, so the knee is
an application/provider-tail stability limit, not an account rate-limit ceiling.

**Current decision:** production global/UI/worker concurrency is **2**. Multiple
API keys are a resilience and rotation pool; key count must not silently multiply
global concurrency. The weak seller-title scores above are unpaired guardrails
only and cannot be attributed causally to concurrency. A fresh 10-card
concurrency-2 confirmation is required before the decision becomes final.
