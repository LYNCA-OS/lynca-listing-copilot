# V4 Independent Identity and Trace Gates — 2026-07-23

## Decision

The independent identity gate now passes with 122 Development and 30 Validation identities. Retrieval, Reranker, Selection, and Evidence tuning remain blocked until a fresh run also passes the Trace/source-contract gate.

Identity labeling and Trace hardening should proceed in parallel after their contracts are frozen. Accuracy experiments may start only when both gates pass. Fact Engine remains NO-GO.

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

Afterward, Evidence Recovery may begin on Development/Validation only. Application remains field-family-by-field-family with 100% precision, positive recall, and zero critical entity regressions. Holdout stays sealed until the final Oracle run.
