# Phase 26 Commercial Review English Title Suggestions

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Reduce operator labeling cost for the 248 image-backed Supabase commercial review tasks without weakening the commercial gate.

The production title language is English, so the review packet now parses English corrected-title hints into non-ground-truth field suggestions.

## What Changed

`lib/listing/recognition/commercial-review-packet.mjs` now adds:

- `suggested_fields`
- `suggestion_sources`
- `suggestion_policy`

The parser only extracts relatively deterministic English card-title signals:

- year or season
- manufacturer/product line hints from known title prefixes
- serial number, including leading-zero canonicalization such as `031/050` to `31/50`
- checklist-code-like tokens
- common parallel phrases
- RC, 1st Bowman, Auto, Patch, Relic, SSP, Case Hit, 1/1 flags
- grading company and card/auto grade patterns such as `PSA 9 Auto 10` or `BGS Auth Auto 10`

It intentionally does not infer `players` from the free-text title. Player/name errors are too expensive for the commercial target, so operators still need to verify subject identity from card image, slab, registry, or official checklist evidence.

## Safety Contract

Every suggestion source uses:

- `source_type`: `CORRECTED_TITLE_PARSE_HINT`
- `evidence_weight`: `0`
- `can_be_used_as_ground_truth`: `false`
- `requires_operator_evidence`: `true`

The importer still requires:

- `reviewed_ground_truth`
- `reviewed_by`
- `critical_fields`
- `ground_truth_sources`

Copying suggested fields without evidence is rejected. Suggestions do not enter recognition training, approved memory, or commercial accuracy reporting.

## Readiness Impact

The materialized packet now reports:

- `suggested_field_task_count`
- `suggested_field_counts`
- `suggested_fields_are_ground_truth`: `false`

This improves operator workflow visibility only. `supabase_commercial_ground_truth` remains blocked until reviewed field-level truth and sources are imported.
