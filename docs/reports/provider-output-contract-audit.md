# Provider output contract audit

Source brief: `docs/brief-output-contract-and-world-knowledge.md` at commit
`f310a85a`.

## Verdict

The read-only provider contract is implemented behind the default-off
`ENABLE_V4_READ_ONLY_PROVIDER_CONTRACT` switch, but it is **not eligible for a
live A/B or production enablement yet**.

The brief assumes every removed `DERIVED` field is reconstructed after the
provider call. That assumption is false on current `main`: forward constraint
enumeration from `0aa353e5` is not present, and the current deterministic replay
does not preserve every recorded title. Enabling the shorter contract before
that boundary is repaired would knowingly trade accuracy for speed.

## Field ownership

The machine-readable source of truth is
`lib/listing/providers/provider-output-field-contract.mjs`.

| Class | Count | Meaning |
|---|---:|---|
| READ | 38 | Current card/slab image can establish the value |
| DERIVED | 10 | Normalizer, knowledge/retrieval, or Resolver must reconstruct it |
| DROP | 1 | Historical production value is always empty; no provider output needed |

`DERIVED` fields and post-Resolver production non-empty counts:

| Field | Non-empty / 6,375 final-title rows | Why it leaves the provider contract |
|---|---:|---|
| brand | 6,116 | manufacturer compatibility alias |
| product | 6,028 | product-line identity |
| team | 2,516 | world/identity fact |
| card_type | 236 | aggregate of literal components |
| parallel_family | 1,076 | normalized finish family |
| parallel_exact | 571 | proper vocabulary identity |
| parallel | 41 | legacy finish alias |
| numbered_to | 3,485 | print-run denominator alias |
| serial_number | 3,500 | print-run number alias |
| numerical_rarity | 3,320 | CSM projection of print-run fields |

The only `DROP` field is `attributes`: `0 / 6,375` final-title rows carried a
non-empty value. It still has runtime readers, so the canonical resolved schema
remains intact; only the provider is no longer asked to emit this duplicated
aggregate.

The complete per-field counts and runtime consumer-file lists are in
`provider-output-contract-audit.json`.

### Measurement boundary

The verified local export contains post-Resolver `resolved_fields`, not raw
provider observations. Therefore the counts above prove downstream value and
consumer risk; they do **not** claim that the provider itself supplied each
value. This distinction prevents Resolver/catalog contributions from being
mislabelled as vision recall.

## Deterministic replay gates

No GPT, Google Vision, production database, upload, or queue call was made.

### Full local telemetry preservation probe

- input: 6,375 exported sessions with final titles
- recorded policy recall: `1.000000`
- current-renderer replay policy recall: `0.965446`
- title regressions: `1,588`

This probe is diagnostic only. The exported session rows do not persist the
full normalized evidence and renderer provenance needed to recreate historical
titles, so it proves a trace/replay completeness gap, not a read-only contract
regression.

### Latest sealed fixed-20 replay

Input:
`lynca-catalog-vocab/artifacts/smoke/fixed20-final-late-binding-serial-v23-rescored.json`

- scored: `20 / 20`
- recorded policy recall: `0.796283`
- current-renderer replay policy recall: `0.785882`
- changed: `3 down / 1 up`

This is also not clean. The losses include product vocabulary, printed card
code, and finish/first-marker differences. They pre-exist the new contract,
which remains disabled.

## Safe next order

1. Make current evaluation packets replay-complete: persist normalized evidence,
   renderer inputs/version, and derived-field provenance.
2. Integrate forward world/constraint enumeration only as typed candidates with
   `VALUE / EMPTY / UNKNOWN`; Resolver remains the sole canonical owner.
3. Prove every omitted `DERIVED` field is reconstructed or explicitly UNKNOWN.
4. Rerun deterministic replay until there is no contract-induced title loss.
5. Only then run the brief's paired, interleaved familiar/unseen A/B and measure
   output tokens plus p50 latency.

The `p50 <= 5s` target remains a falsifiable experiment gate, not a production
promise. No pressure test or new fixed-20 provider run is authorized by this
change.
