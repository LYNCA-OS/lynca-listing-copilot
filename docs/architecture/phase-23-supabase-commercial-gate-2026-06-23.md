# Phase 23 Supabase Commercial Gate

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Make the commercial readiness gate explicitly account for the real Supabase feedback inventory instead of only reporting that the golden held-out split is empty.

The current live snapshot shows:

- 351 feedback rows
- 248 image-backed rows
- 103 rows without images
- 351 corrected titles
- 248 local recognition candidates exported from storage-backed rows

## What Changed

`scripts/commercial-readiness-audit.mjs` now audits two separate Supabase commercial checks:

1. `supabase_commercial_inventory`
   - Verifies that the commercial feedback inventory exists.
   - Counts all rows.
   - Counts image-backed rows.
   - Counts no-image rows separately.

2. `supabase_commercial_ground_truth`
   - Blocks commercial accuracy claims until field-level reviewed ground truth exists.
   - Refuses to treat `corrected_title` as field-level truth.
   - Requires coverage for critical identity fields such as `year`, `product`, and `players`.

The delivery report now surfaces the same Supabase inventory and ground-truth status.

## Why This Matters

The system can now distinguish three states that were previously easy to blur:

1. Real commercial records exist.
2. Image-backed recognition candidates exist.
3. Field-level commercial truth is not ready yet.

This prevents a false 95% claim while still showing that the 351-row commercial sample is connected to the evaluation workflow.

## Current Status

The current expected readiness outcome is:

- `supabase_commercial_inventory`: `passed`
- `supabase_commercial_ground_truth`: `blocked`

The blocker is correct. The exported candidate report only has limited placeholder ground truth and marks the set as `NEEDS_REVIEW`.

## Next Required Work

1. Add an operator review/export path that converts approved commercial rows into field-level `ground_truth`.
2. Require at least 100 reviewed image-backed held-out assets before 95% commercial acceptance can be evaluated.
3. Keep the 103 no-image rows visible in reports instead of silently dropping them.
4. Continue using corrected titles as review hints only, not as direct field truth.
