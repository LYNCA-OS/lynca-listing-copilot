# Native Recognition Core staged extraction

`native-recognition-core.mjs` remains the single runtime orchestrator. This
change does not duplicate Provider, Catalog, Resolver, Renderer, Queue, or
persistence ownership. It introduces a versioned immutable stage contract so
the monolith can be reduced one boundary at a time.

The five stable stage interfaces are:

1. `prepareEvidenceSnapshot()`
2. `tryExactIdentityReuseAndAnchorShadow()`
3. `runFullProviderObservation()`
4. `applyKnowledgeAndResolve()`
5. `commitWriterReadyResult()`

Each stage receives a cloned, deeply frozen input and returns a cloned, deeply
frozen output plus a structured trace containing stage ID, input version,
output version, terminal status, and reason codes. Stage IDs and versions live
in `native-recognition-stage-contract.mjs`; execution lives in
`native-recognition-stages.mjs`.

## Extraction status

`tryExactIdentityReuseAndAnchorShadow()` is the first integrated boundary. It owns the
pre-Provider choice among writer-final replay, approved identity memory,
version-matched identity result cache, pre-Provider rescan, and full Provider
fallthrough. It also
records the existing pre-L2 exact-anchor probe as Shadow evidence without
performing another Catalog lookup. A Shadow-eligible anchor never skips the
Provider in Cold or Exact Replay benchmarks. A matching
identity cache result returns completed L2 with zero Provider, Recognition
Worker, and Retrieval calls.

The remaining four interfaces are replayable contracts but do not yet replace
their existing code paths. They must be integrated incrementally, with behavior
preserving tests, instead of moving the entire core in one rewrite.

## Non-ownership

The stage runner does not decide candidate weights, evidence permissions,
identity resolution, SEM, or title rendering. Those owners remain unchanged.
