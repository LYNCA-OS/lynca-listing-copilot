# V4 Oracle Bottleneck Audit — 2026-07-23

## Decision

The current 60.92% Evidence Oracle result is not a clean sensor ceiling. Of the 102 missed reviewed fields, 49 fields across 21 cards came from `client_fetch_timeout` before OCR crop evidence became observable. Accuracy work must not interpret those failures as Google Vision misses.

This report is diagnostic only. The frozen 45-card holdout remains read-only and is not used to tune weights, prompts, candidate policy, or field application rules.

## Evidence failure taxonomy

| Cause | Missing fields | Cards | Confidence / boundary |
| --- | ---: | ---: | --- |
| `TRACE_MISSING` | 51 | 22 | 49 fields are OCR rendezvous `client_fetch_timeout`; 2 lack crop planner observability |
| `VISION_OBSERVATION_MISSED` | 23 | 23 | Medium; all are print-finish misses and still require image-visibility review |
| `OCR_MISSED` | 18 | 13 | Medium; a relevant crop completed but truth tokens were absent from OCR |
| `NORMALIZATION_DROPPED` | 5 | 5 | High; all truth tokens existed in raw OCR but were not normalized into accepted evidence |
| `EVIDENCE_FILTER_BLOCKED` | 5 | 5 | High; a matching structured observation existed outside accepted field evidence |

`NOT_VISIBLE_IN_IMAGE` and `CROP_NOT_SCHEDULED` have no confirmed cases because this run does not contain a human visibility label. A zero here means “not proven,” not “none exist.” The 23 finish misses and 18 OCR misses must retain `NOT_VISIBLE_IN_IMAGE` as an alternative until image review is complete.

## Retrieval source recall

| Source | Recall@1 | Recall@5 | Recall@20 |
| --- | ---: | ---: | ---: |
| Official catalog | 1/45 (2.22%) | 3/45 (6.67%) | 3/45 (6.67%) |
| Internal reviewed history | 0/45 | 0/45 | 0/45 |
| Community / structured catalog | 4/45 (8.89%) | 10/45 (22.22%) | 10/45 (22.22%) |
| Visual vector | 0/45 | 0/45 | 0/45 |
| External retrieval | 0/45 | 0/45 | 0/45 |
| Hybrid | 5/45 (11.11%) | 13/45 (28.89%) | 13/45 (28.89%) |

The equality of Recall@5 and Recall@20 confirms that increasing Top-K cannot help this sample. The correct identity is either in the first five or absent. Community catalog supplies 10 of the 13 retrieved identities; the current vector lane supplies none.

The holdout has no confirmed card-number cohort and no explicit TCG category. Relevant observed cohorts are:

- Sports raw: 3/18 Recall@5 (16.67%).
- Sports graded: 0/6 Recall@5.
- Other raw: 9/19 Recall@5 (47.37%).
- Other graded: 1/2 Recall@5.
- Strong anchor: 6/16 Recall@5 (37.50%).
- Cold start: 7/29 Recall@5 (24.14%).

## Selection diagnosis

Selection given Recall remains 3/13 (23.08%). The ten misses divide into:

- 7 correct candidates blocked from decision eligibility. Product conflicts appear in four of these seven cases; identity/collector/serial/set/surface conflicts make up the rest.
- 2 identity-duplicate ties with indistinguishable score components.
- 1 wrong candidate where embedding similarity outweighed the correct candidate despite no exact-anchor advantage.

This does not justify changing global weights on holdout. Development data should first test conflict normalization, identity deduplication before margin calculation, and an exact-anchor dominance constraint.

## Safe application diagnosis

Safe Application remains 0/10. After resolving field aliases and selected-candidate groups, the blockers are:

- 5 `unsafe_replacement_blocked`.
- 5 `field_not_in_safe_application_plan`.

There is no missing application trace after alias normalization. The layer is connected, but its current policy admits no reviewed opportunity in this sample. A development-only experiment should permit missing-field fills for `product`, `card_name`, `set`, and `print_finish`, keep entity-instance fields prohibited, and require 100% application precision before widening policy.

## Next gates

1. Engineering track: eliminate OCR rendezvous `client_fetch_timeout`, then rerun the unchanged frozen audit. This is reliability work, not an OCR-model change.
2. Accuracy development track: fix the five normalization losses and five evidence-gate losses first because they are high-confidence and do not require additional model calls.
3. Review image visibility for the 23 finish misses and 18 OCR misses before changing crop planning, Google Vision, or the observation prompt.
4. On development/validation only, test retrieval query coverage and catalog alias normalization; do not increase Top-K.
5. On development/validation only, test selection conflict normalization and identity deduplication.
6. Re-open the frozen holdout only for a release decision after development and validation pass.
