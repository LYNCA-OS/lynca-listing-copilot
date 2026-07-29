# Task A paired-20 decision — 2026-07-29

Scope: frozen development cohorts only; 10 familiar and 10 unseen cards, current-production and read-only arms interleaved per card. Both arms used the same production SHA, cold-algorithm profile, one Provider call per arm, cache bypass, and one authenticated session reused across all 40 arms.

## First legal live gate

- Production SHA: `f699b483829c2408a1aa00601eb6a130eb12dc57`
- Actions run: `30433139493`
- Decision: `TASK_A_NO_GO`

| Cohort | Current recall | Read-only recall | Delta | Current Provider p50 | Read-only Provider p50 | Read-only output p50 / max |
|---|---:|---:|---:|---:|---:|---:|
| Familiar | 0.779495 | 0.701591 | -0.077904 | 9,652 ms | 4,699.5 ms | 203 / 314 |
| Unseen | 0.460714 | 0.376984 | -0.083730 | 6,539.5 ms | 3,973 ms | 131 / 173 |

All 40 arms completed without technical failure. Latency passed the 5-second candidate p50 gate in both cohorts. Output and accuracy did not pass.

The largest relative READ losses between current production and read-only Provider observations were: `surface_color` absent 12 times, `manufacturer` absent 9, `set` absent 8, and `card_name` value mismatch 11. `product` was absent 17 times, but it is DERIVED and the constraint trace correctly returned UNKNOWN when coverage could not determine it.

## Measured recovery patch

The next revision is intentionally limited to the proven failure boundary:

- treat a manufacturer logo/wordmark on the physical card as observed manufacturer evidence;
- require one final omission scan for basic colour, slab grade, Auto/material, code, and limited numbering;
- make boolean transport values structurally true-only and single-card `card_count=1` structurally invalid;
- preserve decisive forward-enumeration VALUE evidence when Candidate Application rebuilds its packet; UNKNOWN remains trace-only and cannot reach Resolver;
- version the changed observation contract as `read_only_sparse_v4`.

Deterministic replay on all 20 complete live trace packets passed: 20/20 replayable, protected READ parity failures 0, effective Renderer parity failures 0, contract regressions 0. One decisive product VALUE produced a non-regressive recovery (`Paragon` to `Panini Phoenix Paragon`), raising replay token recall from 0.539287 to 0.546430.

World knowledge remains unexecuted. A new paid paired evaluation is permitted only after this revision is merged and deployed as an exact main SHA.
