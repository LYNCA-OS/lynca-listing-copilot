# Production cloud CSM latency probe — 2026-08-02

## Scope

This is a hosted-path diagnostic, not a capacity claim. It uses the real
production login, four existing asset IDs, one paid Luna call per successful
card, and the deployed `CSM_THIN_DIRECT` route. Cloud Run, vector retrieval,
and OCR are not part of this path.

The durable probe commands live in:

- `scripts/probe-production-csm-latency.mjs` (one explicit card);
- `scripts/probe-production-csm-latency-batch.mjs` (1–8 explicit cards, capped
  concurrency).

Both scripts require explicit asset IDs and write only bounded JSON receipts;
they never print credentials or provider response bodies.

## Production gate that had to be fixed first

The first authenticated requests reached Vercel but failed before a usable
provider sample: the function ran in `hkg1` and Luna returned HTTP 403,
`Country, region, or territory not supported`. A matching local image request
returned HTTP 200. This was a deployment-region rejection, not a model,
image-detail, or latency result. Production was moved to `iad1` in deployment
`dpl_BfSiSsq9WbLZDWqjp2ZGfdFf4Dqx`; subsequent requests were HTTP 200.

## Supported-region proof

After the region change and the authority-stage telemetry deployment
(`dpl_BMXZnAEyNjY8PBg2PjsBH6JLYb2N`), one authenticated `high` request for
`asset_262a8960-3841-43bc-bb21-8f510fbd55a9` completed as:

| Check | Result |
| --- | --- |
| HTTP / route / trace | `200` / `CSM_THIN_DIRECT` / `PERSISTED` |
| Title length | 76 characters |
| Request total | 7,512 ms (server receipt) |
| Provider | 3,134 ms |
| Authority claim | 657 ms |
| Authority settle | 279 ms |
| Authority dispatch | 5,649 ms |
| CSM persistence | 298 ms |
| Cloud Run / vector | `0` / `0` |
| Attempt / retry | `1` / `0` |

The same stage map was read back from the newest
`v4_recognition_sessions.csm_owner_versions` row, so this is not merely a
client-side response claim.

## Small concurrency diagnostic (pre-stage-split build)

The four-card samples below were collected before `authority_claim_ms` and
`authority_settle_ms` were deployed. They are useful for direction only:

| Explicit cards | Concurrency | Success | Request p50 | Request p95/max |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 1 | 4/4 | 5,114 ms | 7,363 ms |
| 4 | 4 | 4/4 | 5,630 ms | 8,601 ms |

At concurrency 4, provider time was about 2.5–4.6 seconds and authority
dispatch about 4.6–6.3 seconds. At concurrency 1, provider time was about
2.5–3.1 seconds and authority dispatch about 4.1–5.1 seconds. The client-side
wall grew across concurrent requests, but it does not match the server stage
receipts and is not a safe attribution of route latency.

This n=4 screen is not enough to select a production sweet spot. It does,
however, reject the claim that the current 120-slot global authority is by
itself proof of low per-request latency. The next comparison must use the new
claim/settle fields over a larger, stable hosted sample before changing
`claimPollMs`, signing/session order, or the tenant pool.

## Post-telemetry repeat

The same four production assets were run again after the stage split, with
separate windows and no failures:

| Explicit cards | Concurrency | Success | Request p50 | Request p95/max | Claim range | Settle range |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 1 | 4/4 | 5,937 ms | 6,973 ms | 234–650 ms | 273–458 ms |
| 4 | 4 | 4/4 | 5,183 ms | 6,861 ms | 230–233 ms | 258–274 ms |

The apparent c4 server improvement is smaller than this four-card sample's
provider variance: provider time was 2.6–3.7 seconds at c4 and 2.9–4.7
seconds at c1. Claim and settle were bounded and mostly stable, so the present
evidence does not justify changing the 1,000 ms claim poll or declaring c4 a
production sweet spot. The client's wall still accumulated across concurrent
requests and remains a separate transport/measurement question.

## Decision

Keep the current production scheduling and CSM/SEM contract unchanged. The
regional fix is a positive production prerequisite; the authority-stage fields
are additive diagnostic telemetry. No concurrency or accuracy promotion is
justified by this probe alone.

## Eight-card concurrency screen after enqueue telemetry

To bound the next decision without spending a full 150-card run, the same
production tenant was screened with eight explicit assets. The table reports
successful cards only for stage percentiles; a non-retryable 400 is not a
latency observation and is listed separately.

| Requested concurrency | Success | Request p50 | Request p95/max | Provider p50/p95 | Enqueue p50/p95 | Dispatch p50/p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 7/8 | 5,710 ms | 12,337 ms | 3,104 / 8,831 ms | 241 / 678 ms | 4,576 / 11,345 ms |
| 4 | 8/8 | 5,418 ms | 11,292 ms | 3,214 / 9,140 ms | 239 / 688 ms | 4,677 / 10,356 ms |
| 6 | 7/8 | 5,737 ms | **6,592 ms** | 3,362 / 4,448 ms | 232 / 652 ms | 4,901 / 6,077 ms |
| 8 | 7/8 | **5,320 ms** | 8,396 ms | 3,170 / 4,919 ms | 242 / 698 ms | 4,767 / 7,000 ms |

The prior four-card post-telemetry samples were 4/4 at c1 (p50 5,937 ms,
p95 6,973 ms) and c4 (p50 5,183 ms, p95 6,861 ms). Across the new eight-card
screen, c6 has the smallest observed p95 and the most stable provider tail;
c8 has a slightly lower p50 but a materially worse p95. This supports keeping
the already deployed local concurrency of 6 as the provisional production
sweet point. It is not a formal SLO claim: the run is one wave per setting,
provider variance remains visible, and the c2/c4 outliers are provider-bound.

Three cards returned HTTP 400 `canonical_path_provider_failed` once across
the c2/c6/c8 waves. They produced no stage receipt and were excluded from the
percentiles; the same asset can succeed in another wave, so this is a
separate intermittent asset/provider failure to investigate, not evidence
that c2, c6, or c8 is saturated. No scheduler or claim-poll setting was
changed from this screen.

## High versus original detail spot check

The same production asset was run once at each supported image detail. Both
requests produced the identical persisted title and completed through the same
CSM route:

| Detail | HTTP / trace | Provider | Dispatch | Internal total | Client wall | Title |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| high | 200 / PERSISTED | 3,249 ms | 4,920 ms | 6,583 ms | 8,402 ms | `2025-26 Panini Donruss Tyran Stokes Elite Signatures Rainbow Foil 65/75 Auto` |
| original | 200 / PERSISTED | 3,307 ms | 5,390 ms | 7,244 ms | 8,415 ms | same |

This is only a one-card paired diagnostic, not an accuracy comparison. It
shows no latency or title benefit from `original` on this asset; keep
production at `high` until a paired, label-backed image-detail cohort exists.

## Accuracy-screen boundary

An eight-card hosted accuracy screen was intentionally stopped after all
eight requests returned HTTP 503 `invalid_durable_listing_asset_id` before the
provider stage. The supplied IDs were the sealed evaluation labels
`reviewed_blind_*`, not production `listing_assets.id` values (`asset_*`).
Therefore this is neither a model loss nor a production-chain latency sample,
and no paid accuracy result was recorded from it.

The cloud 150-card accuracy gate remains pending until the same 150-card
references are provisioned as production durable assets and an immutable
asset-to-reference manifest is available. Replacing the IDs or inventing a
reference mapping would make the accuracy measurement invalid.
