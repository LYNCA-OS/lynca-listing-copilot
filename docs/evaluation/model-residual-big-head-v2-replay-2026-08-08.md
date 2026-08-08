# Model residual big-head v2 — zero-call replay (2026-08-08)

## Decision

The opposing result comes first: **do not promote the residual candidate lane**. The existing label-blind safe bundle clears utility Gate 0, but the current typed candidate lane does not capture enough safely resolvable evidence. Rewriting the old resolver would add duplication, not recall.

Provider calls: **0**. Runtime changes: **none**. Decision: **STOP_CAPTURE_GATE**.

## Separate utility from capture

| Gate | Cards | Delta | W/L/T | Ref-loss | Unbacked | >80 | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Source-only safe-bundle utility | 150 | 0.0060804745 | 11/0/139 | 0 | 0 | 0 | PASS |
| Current candidate capture + resolver | 105 | 0.0029180037 | 4/0/101 | 2 | 0 | 0 | **FAIL** |

Current post-Luna context is baseline 0.7811418979 with 254/109/63 pre-schema/schema/downstream occurrences. The existing generalizable Composer lane is 0.0023589744; these quantities are not additive.

The 150 utility row directly replays the existing v3 safe bundle from canonical, free-expression, and exhaustive source outputs. Scoring labels are read only after resolution. This proves utility, not that the Production-low residual schema captures its required inputs.

The 105 candidate lane emitted 25 rows. Its fixed phrase-aware Product routing, same-value serial formatting, and typed Composer recovery yield only 4 wins and displace reviewed-title tokens on 2 cards. The remaining rows are checklist codes, compressed slab shorthand, boilerplate, or facts already represented in canonical fields. Getting to 8 wins would require new candidate capture or unsafe abbreviation/role inference; the present 25 rows cannot support it under the source-only rules. No 35x3 paid preregistration and no runtime admission are justified.

## Boundary

The v2 resolver consumes canonical fields plus candidate text/role/region/basis only. It has no scoring-label parameter, asset-id rule, provider call, persistence path, or Production import. Metadata is excluded from source backing. Abbreviations such as GEO/REF are not expanded into facts.

## Reproduce

```bash
node scripts/replay-model-residual-big-head-v2.mjs
node scripts/replay-model-residual-big-head-v2.test.mjs
```
