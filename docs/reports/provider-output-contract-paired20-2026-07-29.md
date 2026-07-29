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

## Recovery hypothesis (disproved)

The next revision is intentionally limited to the proven failure boundary:

- treat a manufacturer logo/wordmark on the physical card as observed manufacturer evidence;
- require one final omission scan for basic colour, slab grade, Auto/material, code, and limited numbering;
- make boolean transport values structurally true-only and single-card `card_count=1` structurally invalid;
- preserve decisive forward-enumeration VALUE evidence when Candidate Application rebuilds its packet; UNKNOWN remains trace-only and cannot reach Resolver;
- version the changed observation contract as `read_only_sparse_v4`.

The preflight deterministic replay over the then-available 20 complete trace packets passed: 20/20 replayable, protected READ parity failures 0, effective Renderer parity failures 0, contract regressions 0. One decisive product VALUE produced a non-regressive recovery (`Paragon` to `Panini Phoenix Paragon`), raising replay token recall from 0.539287 to 0.546430.

The live recovery evaluation (Actions run `30435699978`, production SHA `008c0e53958d92ce44376c479f02ac6065156e80`) was another legal `TASK_A_NO_GO`:

| Cohort | Current recall | Recovery recall | Delta | Recovery Provider p50 | Recovery output p50 / max |
|---|---:|---:|---:|---:|---:|
| Familiar | 0.801238 | 0.752222 | -0.049015 | 3,816.5 ms | 201 / 349 |
| Unseen | 0.497222 | 0.348413 | -0.148810 | 3,122 ms | 97 / 161 |

The extra natural-language scan instructions worsened the unseen cohort and were removed. The structured true-only / multi-card-count schema and typed forward VALUE wiring were retained because they enforce ownership without adding prompt text.

## Final minimal-contract gate

Before the final gate, Actions run `30437295166` exposed a separate production transport defect: a baseline response repeated `card_name`, causing four identical schema retries and a 208-second terminal failure. PR #148 made only byte-identical repeated rows idempotent; conflicting duplicate values remain fail-closed.

- Production SHA: `5e6dac61f1ed716d40ccf4e01b97dcc4c570338a`
- Deployment run: `30438324951`
- Paired evaluation run: `30438634081`
- Decision: `TASK_A_NO_GO`

| Cohort | Current recall | Minimal-contract recall | Delta | Current Provider p50 | Minimal Provider p50 | Minimal output p50 / max |
|---|---:|---:|---:|---:|---:|---:|
| Familiar | 0.787071 | 0.717980 | -0.069091 | 8,847.5 ms | 4,265 ms | 177.5 / 674 |
| Unseen | 0.482937 | 0.405556 | -0.077381 | 5,908.5 ms | 3,648.5 ms | 161.5 / 201 |

All 40 arms completed with zero technical failures. Candidate p50 latency passed in both cohorts. Accuracy regressed in both cohorts, and the hard `visible_output_tokens_max <= 150` gate failed in both cohorts.

Fresh-trace deterministic replay after the paid run was 19/20. The single failure preserved the final title byte-for-byte but did not reproduce `official_card_type=ROOKIE CARD` at the Resolver projection. This is a replay-contract gap, not permission to waive the gate.

## Frozen decision

Task A's current hypothesis is disproved: removing DERIVED fields from the Provider call and recovering them only from the current constraint snapshot materially improves latency but cannot preserve familiar or unseen accuracy, and it does not reliably meet the 150-token hard maximum. The `read_only_sparse_v4` candidate remains opt-in evaluation-only and must not become the production default.

Do not retry this prompt family. Reopening requires a materially different source of deterministic coverage plus a fresh replay-complete contract; wording changes are not sufficient. World knowledge was not executed as part of Task A, so the two variables remain isolated.
