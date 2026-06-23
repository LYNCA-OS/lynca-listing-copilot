# Phase 25 Materialized Commercial Review Packet

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Move the Supabase commercial sample from a generatable review workflow to an actual committed review packet that operators can label.

## Packet Generated

Generated file:

- `data/recognition/review/supabase-commercial-review-packet.json`

Source file:

- `data/recognition/manifests/supabase-feedback-candidates.json`

Current packet summary:

- `task_count`: 248
- `corrected_title_hint_count`: 248
- `corrected_title_used_as_ground_truth`: `false`
- required critical fields: `year`, `product`, `players`

## Safety Position

The packet intentionally keeps:

- `reviewed_ground_truth` empty
- `ground_truth_sources` empty
- `review_status` as `NEEDS_REVIEW`

This means the packet is ready for operator labeling, but it is not yet commercial accuracy evidence.

## Readiness Impact

`scripts/commercial-readiness-audit.mjs` now reports:

- `commercial_review_packet`: `passed`
- `supabase_commercial_ground_truth`: still `blocked`

That is the correct state. The system can now route the 248 image-backed rows to field review, while still refusing to claim 95% exact resolution until labels and evidence sources exist.

## Next Required Work

1. Fill `reviewed_ground_truth` for at least 100 image-backed held-out commercial items.
2. Add `ground_truth_sources` for every critical field.
3. Import reviewed labels with `npm run recognition:commercial-review:import`.
4. Run recognition evaluation against the imported field-level manifest.
