# Provider contract + forward enumeration gate — 2026-07-28

## Decision

`READ_ONLY_PROVIDER_CONTRACT`: **WITHHELD**  
`FORWARD_ENUMERATION`: **SHADOW ONLY**  
`PAIRED LIVE A/B`: **NOT STARTED**

The deterministic replay gate is not clean because the historical export does
not contain the inputs required to replay a provider-contract change. This is a
telemetry limitation, not proof of an algorithm regression. The live A/B gate
therefore remains closed.

## What is now structurally complete

- Evaluation Decision Trace Packet v3 persists a bounded replay snapshot:
  provider fields/evidence, normalized evidence, resolved fields, renderer
  fields/title/options, decision-owner versions, pipeline fingerprint, and
  derivation provenance.
- Each snapshot is explicitly `COMPLETE` or `PARTIAL`, with missing component
  reason codes. Replay tooling reports packet coverage instead of silently
  treating missing history as algorithm output.
- Forward enumeration preserves the three distinct outcomes `VALUE`, `EMPTY`,
  and `UNKNOWN`. `UNKNOWN` retains alternatives and can never cross the CSM
  canonical candidate boundary.
- Every enumerated fact carries source, trust, version, rule id, and source-card
  count. Candidates are evidence, never truth; only Identity Resolver can
  select a canonical field.
- The constraint model is a 604,618-byte content-addressed compressed asset.
  Both compressed and uncompressed SHA-256 values are verified before use.
- Recognition Core loads and runs it only for
  `benchmark_profile=cold_algorithm` + `trace_level=evaluation`, in shadow.
  Production titles and production Provider behavior remain unchanged.

## Measured replay gate

Input: `/tmp/provider-contract-replay-input-20260728.json`

| Metric | Result |
|---|---:|
| rows | 6,375 |
| complete replay snapshots | 0 |
| partial replay snapshots | 0 |
| absent replay snapshots | 6,375 |
| replay contract gate | FAIL |
| recorded policy fair recall | 1.000000 |
| legacy reconstruction policy fair recall | 0.965446 |
| legacy reconstruction title decreases | 1,588 |

The `0.965446` number is not an admissible estimate of the new contract. The
old export lacks raw provider observations and versioned derivation provenance,
so renderer reconstruction is confounded with missing evidence.

## Shadow addressability diagnostic

This diagnostic uses persisted post-resolver fields only to ask whether the
constraint snapshot can answer a query. It is **not** an accuracy score and is
not used for tuning.

| Field | VALUE | EMPTY | UNKNOWN |
|---|---:|---:|---:|
| team | 3,003 | 0 | 3,372 |
| product | 611 | 0 | 5,764 |

Runtime over the same 6,375 rows after the snapshot is loaded:

| Metric | Result |
|---|---:|
| snapshot cold load | 69.872 ms |
| enumeration p50 | 0.002500 ms |
| enumeration p95 | 0.011625 ms |
| enumeration max | 0.819875 ms |

This proves that lookup cost is negligible after loading; it does not prove
that a `VALUE` is correct for a held-out card.

## Verification

- Full `npm test`: PASS.
- V4 spine: PASS.
- Provider output contract tests: PASS.
- Evaluation decision trace tests: PASS.
- 1,000-job deterministic scheduler/state-machine model: PASS, zero external
  Provider calls.
- Dedicated Postgres queue pressure test: skipped because
  `TRACK_C_TEST_DATABASE_URL` is not configured and pressure testing remains
  outside this task.

## Next admissible action

Collect one new cold-algorithm evaluation cohort with Trace v3 and the current
full provider contract. Re-run deterministic contract replay. Only when every
row is `COMPLETE` and contract-induced title regressions are zero may the paired,
interleaved familiar/unseen live A/B start. Task B world knowledge starts only
after that Task A gate.
