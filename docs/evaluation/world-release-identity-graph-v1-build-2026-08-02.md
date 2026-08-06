# Source-versioned release identity graph v1 (2026-08-02)

## Status

`BUILT_ADVISORY_INSUFFICIENT_COVERAGE`.

The asset-build item is complete, but the graph is not an accuracy promotion
mechanism. It is positive-support-only; missing edges are `UNKNOWN`, and it
cannot create, mutate, or hard-reject a visible candidate.

## Build result

- 10 official manifest sources;
- 144 provenance-bearing edges;
- 105 product edges;
- 14 set/insert edges;
- 2 parallel edges;
- 23 rarity edges;
- every edge has `edge_id`, source SHA-256, source version, source URL when
  available, coverage contract, and advisory adjudication state.

The graph is far too sparse for the main finish/parallel loss head. The current
150-card audit still shows zero exact supported finish candidate corrections and
no evidence for safe hard rejection. Therefore it remains an offline asset and
does not enter CSM/SEM, Composer, persistence, or Production.

## Files

- Builder: [`build-source-versioned-release-identity-graph-v1.mjs`](../../scripts/build-source-versioned-release-identity-graph-v1.mjs)
- Local generated graph: [`world-release-identity-graph-v1-2026-08-02.json`](../../artifacts/world-release-identity-graph-v1-2026-08-02.json)
- Coverage audit: [`world-asset-coverage-audit-150-2026-08-02.md`](./world-asset-coverage-audit-150-2026-08-02.md)

