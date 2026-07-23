# V4 Independent Identity and Trace Gates — 2026-07-23

## Decision

Do not tune Retrieval, Reranker, or Selection yet. The active development/validation split contains only six independently confirmed Development identities and one Validation identity. The previous total of thirteen includes two sealed holdout identities and four image-less rows, so thirteen is not the usable tuning denominator.

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

The validator rejects same-feedback self-corroboration, ineligible sources, unreviewed proposals, missing provenance, and identities absent from the frozen catalog. Candidate proposals are reviewer search aids only and can never enter the formal denominator automatically.

### Current coverage

| Partition | Total | Confirmed | Minimum | Preferred target | Gap to preferred target |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 173 | 6 | 100 | 150 | 144 |
| Validation | 37 | 1 | 30 | 37 | 36 |

The indexed review builder completes in about 2 seconds on the current 26,584-row catalog, down from the rejected 20+ second Cartesian prototype.

The 203 unconfirmed rows are split into:

- 79 rows with one or more independent catalog candidates to verify: Development 63, Validation 16;
- 124 rows requiring external identity research: Development 104, Validation 20.

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

Trace completeness is not the same as experiment eligibility. The same ten reports contain seven source-contract violations: five `UNVERSIONED_OR_MUTATED_CANDIDATE_HEURISTIC` and two `RETRIEVAL_SOURCE_DEGRADED`. Therefore:

- Stage Trace Coverage Gate: PASS on the recorded ten-card replay;
- Experiment Eligibility Gate: FAIL;
- 210-card Development/Validation Trace Gate: not yet measured and therefore not passed.

## Frozen next gate

No Retrieval or Selection weight changes are allowed until all are true:

1. Development independently confirmed identities are at least 100, with 150 preferred.
2. Validation independently confirmed identities are at least 30.
3. A fresh Development/Validation run has strict Stage Trace Coverage at least 99%.
4. Every skipped stage and dropped field has a reason code; UNKNOWN is zero or near zero.
5. Source pipeline contract violations are zero for the experiment packet.

Afterward, Evidence Recovery may begin on Development/Validation only. Application remains field-family-by-field-family with 100% precision, positive recall, and zero critical entity regressions. Holdout stays sealed until the final Oracle run.
