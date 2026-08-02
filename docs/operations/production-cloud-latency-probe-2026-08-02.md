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

## Decision

Keep the current production scheduling and CSM/SEM contract unchanged. The
regional fix is a positive production prerequisite; the authority-stage fields
are additive diagnostic telemetry. No concurrency or accuracy promotion is
justified by this probe alone.

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
