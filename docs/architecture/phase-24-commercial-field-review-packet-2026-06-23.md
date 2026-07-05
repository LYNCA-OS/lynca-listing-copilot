# Phase 24 Commercial Field Review Packet

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Move the 351-row Supabase commercial sample from "inventory is visible" to "field-level review can produce valid held-out evidence".

The key rule remains unchanged:

- `corrected_title` is a review hint only
- `corrected_title` is never field-level ground truth
- commercial accuracy requires reviewed identity fields plus evidence sources

## What Changed

This phase adds:

- `lib/listing/recognition/commercial-review-packet.mjs`
- `scripts/build-commercial-review-packet.mjs`
- `scripts/import-commercial-review-labels.mjs`
- `scripts/commercial-review-packet.test.mjs`

The new flow is:

1. Build a review packet from `data/recognition/manifests/supabase-feedback-candidates.json`.
2. Operators fill `reviewed_ground_truth`, `critical_fields`, `ground_truth_sources`, `reviewed_by`, and `review_status`.
3. Import only reviewed tasks into a recognition dataset manifest.
4. Reject tasks with missing evidence sources or any attempt to mark `corrected_title` as ground truth.

## Commands

Build a packet:

```bash
npm run recognition:commercial-review:packet -- --input data/recognition/manifests/supabase-feedback-candidates.json --out data/recognition/review/supabase-commercial-review-packet.json
```

Import reviewed labels:

```bash
npm run recognition:commercial-review:import -- --input data/recognition/review/supabase-commercial-review-packet.json --out data/recognition/manifests/supabase-feedback-reviewed.json --report-output data/recognition/reports/supabase-feedback-reviewed-report.json
```

## Safety Rules

The importer requires:

- `review_status` of `SINGLE_REVIEWED`, `DOUBLE_REVIEWED`, or `ARBITRATED`
- at least one reviewer
- reviewed values for `year`, `product`, and `players`
- every critical field to have a matching `ground_truth_sources` entry
- no `corrected_title_used_as_ground_truth`

Rejected tasks are reported and are not imported unless `--allow-rejections` is explicitly used.

## Readiness Impact

Commercial readiness now also reports `commercial_review_packet`.

Expected current state before operator labeling:

- commercial inventory exists
- review packet may be generated
- field-level ground truth remains blocked until reviewed labels are imported

This is progress toward the 95% gate because it creates the missing evidence path, but it does not itself prove commercial accuracy.
