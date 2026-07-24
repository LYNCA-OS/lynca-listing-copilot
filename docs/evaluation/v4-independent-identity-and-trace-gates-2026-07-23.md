# V4 Independent Identity and Trace Gates — 2026-07-23

## Decision

The independent identity gate passes with 122 Development and 30 Validation identities. The normalized seven-stage Trace/source-contract gate now also passes on all 152 independently evaluable cards. Accuracy diagnosis may proceed, but the full-information Evidence gate remains open because historical replays did not explicitly request detail OCR crops.

This change affects evaluation contracts and offline trace adaptation only. It does not change production title behavior, frontend, assets, queue, OCR, GPT prompt, SEM, Resolver, Renderer, database, or deployment.

## Independent identity truth gate

The review packet covers all 173 Development and 37 Validation cards. Holdout is excluded. Every confirmed label must include:

- canonical identity ID;
- year or season, manufacturer, product, set or insert, subject, card/checklist code, and print finish field keys;
- source ID, source type, source version, and explicit independence from the system under test;
- reviewer and review timestamp.

`canonical_identity_id` is a deterministic hash of normalized identity fields. `source_candidate_id` separately identifies the catalog evidence row. A source row ID is never allowed to masquerade as the canonical identity.

An empty optional field remains explicit rather than disappearing from the contract. A confirmed identity must still contain year, product, and either subject or card number.

The validator rejects same-feedback candidate self-corroboration, unreviewed proposals, missing provenance, and unsealed writer truth. Candidate proposals are reviewer search aids only and can never enter the formal denominator automatically.

The truth owner is no longer required to be a retrieval catalog row. A sealed writer-reviewed title may own the canonical identity when its exact title spans provide year, product, subject or card number, and at least one print discriminator. This is necessary to measure `CATALOG_ROW_ABSENT`: requiring a catalog row to establish truth would select the Retrieval denominator by the system's own catalog coverage. Catalog candidate IDs remain retrieval evidence, not truth ownership.

Instance-only values remain excluded. The identity contract may use the serial denominator, but never the serial numerator, grade, certification number, condition, or current-card defects. Two Validation cards received independent original-image card-number attestations (`1976 Topps Walter Payton #148` and `1968 Topps Mets Rookie Stars #177`); these attestations are sealed from recognition and do not write back to the catalog.

### Current coverage

| Partition | Total | Confirmed | Minimum | Preferred target | Gap to preferred target |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 173 | 122 | 100 | 150 | 28 |
| Validation | 37 | 30 | 30 | 37 | 7 |

The indexed review builder completes in about 2 seconds on the current 26,584-row catalog, down from the rejected 20+ second Cartesian prototype.

The remaining 58 rows are not part of the Retrieval/Selection denominator: Development 51 and Validation 7. They lack a sufficiently exact print discriminator and are retained for later independent review rather than being promoted optimistically.

All 210 Development/Validation cards and 419 original images are now materialized in a deterministic local cache. Replays reuse the content-addressed files and no longer repeat signed URL creation or download unless an object is missing. The original workbook dry-run independently recovered 15,069 unique writer catalog seeds from 16,550 rows; the workbook was not modified.

## Stage Trace gate

The strict contract covers Observation, Evidence, Retrieval, Selection, Application, Resolver, and Renderer. Every stage records:

- terminal status;
- owner;
- input/implementation version;
- whether output was produced;
- whether it was persisted into the Oracle trace artifact;
- reason code for skip, failure, or empty output;
- field-level drop reasons;
- final decision owner at Renderer.

On the latest recorded ten-card V20 replay, legacy stage signals existed for 70/70 slots, but the old normalized contract existed for 0/70. Rebuilding the trace from the already-recorded native V4 pipeline contract produces 70/70 valid contract slots, zero UNKNOWN reasons, and 100% strict coverage.

Trace completeness is not the same as experiment eligibility. Five historical `UNVERSIONED_OR_MUTATED_CANDIDATE_HEURISTIC` errors were caused by an Oracle heuristic version that existed in the selector but was not registered in the pipeline contract. The version is now an explicit shared constant and its contract test passes without changing selection weights. Two historical `RETRIEVAL_SOURCE_DEGRADED` warnings remain legitimate recorded source failures and are not hidden. Therefore:

- Stage Trace Coverage Gate: PASS on the recorded ten-card replay;
- Experiment Eligibility Gate: FAIL;
- 210-card Development/Validation Trace Gate: not yet measured and therefore not passed.

## Frozen next gate

No Retrieval or Selection weight changes are allowed until all are true:

1. Development independently confirmed identities are at least 100, with 150 preferred. **Passed: 122.**
2. Validation independently confirmed identities are at least 30. **Passed: 30.**
3. A fresh Development/Validation run has strict Stage Trace Coverage at least 99%.
4. Every skipped stage and dropped field has a reason code; UNKNOWN is zero or near zero.
5. Source pipeline contract violations are zero for the experiment packet.

## Mainline migration replay — 2026-07-24

The evaluation contracts were replayed from a clean branch based on the current production source. The independent identity denominator remains valid at 122 Development and 30 Validation identities, with zero invalid confirmed labels.

Existing result artifacts cover 124 of the 152 independently evaluable cards. Strict stage coverage is 868/1,064 slots (81.5789%), with 28 cards entirely missing a persisted seven-stage trace and zero UNKNOWN reasons. Fifteen traced cards contain recorded source-contract warnings. This is a failed experiment gate, not an accuracy result.

The 28 missing identities were replayed from verified asset generations. Fifteen source-contract warnings were then repaired by deterministic same-card replay selection; three stale ties required one final bounded replay. The resulting packet has:

- 152/152 complete cards;
- 1,064/1,064 valid stage slots;
- zero UNKNOWN reasons;
- zero source-contract violations;
- no repeated image upload for cached cards.

The first corrected Oracle adapter recovered 743 confirmed fields and measured Evidence Oracle Recall at 451/743 (60.70%). It also exposed two evaluation-boundary defects that invalidate a final whole-chain claim until repaired:

- 18 cards selected a catalog row originating from the same feedback record. These rows are now sealed out of Retrieval metrics and excluded from downstream Selection/Application denominators rather than being counted as successes.
- 83 cards lack field-level OCR crop observability. The older smoke runner requested preingestion but did not explicitly set `enqueue_ocr_detail`, so “full information” depended on a mutable environment default.

The smoke runner now has an explicit `--preingestion-ocr-detail` contract and records `preingestion_ocr_detail_enabled` in every report. A deterministic Evidence trace-gap builder selects only cards whose taxonomy is `TRACE_MISSING`; cached verified generations are reused. Until that bounded recovery completes, current no-leakage Retrieval Recall@5 (6/152) and downstream rates remain diagnostic lower bounds, not the final accuracy ceiling.

Application remains field-family-by-field-family with 100% precision, positive recall, and zero critical entity regressions. Holdout stays sealed until the final Oracle run.

## Frozen 20-card recovery gate (2026-07-24)

The first expansion gate is a deterministic 15 Development / 5 Validation sample. Its item-set SHA-256 is `63a09857328be4fd9cadaa2e08e32d4c72dc9bdba7b699a96bc9e808e7f91818`. Replayed cards are allowed; holdout remains sealed. Expansion is prohibited unless speed, accuracy, and stability all pass.

The first production run failed the joint gate:

- stability: 20/20 reached `L2_READY`, with zero technical failures;
- reviewed-title policy token recall: 0.762669, below the frozen 0.85 threshold;
- provider execution: p50 42,155 ms and p95 53,946 ms;
- scheduler queue wait: p50 889,364 ms and p95 1,146,184 ms;
- field Oracle: 55/97 (56.70%), with print finish 3/12, numerical rarity 7/15, and grade 0/6;
- preingestion detail: 16/20 cards ended as `DEFERRED_AFTER_PROVIDER`; 190 OCR jobs produced zero final evidence patches.

Two evaluation-runner defects were repaired without changing title strategy: multi-card resume now polls durable job IDs instead of a client batch token, and resume manifests are atomic and identity/order validated.

Automatic all-card detail OCR was then tested and rejected. A scoped candidate produced 32 evidence patches, but completed only 19/20 cards, reduced service throughput to 3.024 cards/minute, and scored 0.7353 on the 19 technically successful cards. The automatic detail wake was removed before production; ordinary anchor-only behavior remains unchanged. Any future OCR recovery must be a bounded, risk-triggered field wave and must beat this frozen 20-card baseline without consuming the writer-ready lane. No larger sample is permitted before speed, accuracy, and stability all pass.

The paired patch-utility audit makes the rejection reproducible. All 20 sample identities matched between control and candidate; 19 were jointly successful. Among 18 patch-exposed pairs, 4 scores improved, 5 regressed, and 9 were unchanged, for a mean policy-token-recall delta of -0.026147. The candidate also added a p95 scheduler-queue delta of 124,177 ms and one technical regression. These movements are associated with the candidate run, not treated as proven patch causality because GPT output is stochastic. The audit is implemented by `scripts/audit-ocr-patch-utility.mjs` and fail-closes expansion unless all three frozen gates pass.
