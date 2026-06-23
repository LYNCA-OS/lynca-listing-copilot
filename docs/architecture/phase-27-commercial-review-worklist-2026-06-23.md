# Phase 27 Commercial Review Worklist

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Reduce commercial labeling cost and turnaround time without weakening the evidence gate.

The Supabase commercial packet now has 248 image-backed review tasks. The next operational problem is not model accuracy; it is review throughput. Operators should not label the queue in random order. The system should surface the cards most likely to reduce critical commercial errors first.

## What Changed

New module:

- `lib/listing/recognition/commercial-review-worklist.mjs`

New CLI:

- `scripts/build-commercial-review-worklist.mjs`
- `npm run recognition:commercial-review:worklist`

Generated files:

- `data/recognition/review/supabase-commercial-review-worklist.json`
- `data/recognition/review/supabase-commercial-review-worklist.csv`

Current materialized queue:

- total tasks: `248`
- P0: `23`
- P1: `97`
- P2: `108`
- P3: `20`

## Queue Policy

The worklist scores review priority from deterministic signals only:

- serial numbered cards
- 1/1 cards
- slab/grade hints
- autograph cards
- parallel/color hints
- rookie or first Bowman hints
- patch/relic hints
- SSP/case-hit hints
- front-only or missing-front image coverage
- generated/corrected title deltas
- missing product hint

This score is for operator queue order only. It is not identity confidence and is not model truth.

## Safety Contract

The worklist does not include:

- `reviewed_ground_truth`
- `ground_truth_sources`
- training labels
- approved-memory writes

It carries corrected-title suggestions only as operator hints. Readiness blocks the worklist if any task marks title hints as ground truth.

## Commercial Gate Impact

Readiness now reports:

- `commercial_review_packet`
- `commercial_review_worklist`
- `supabase_commercial_ground_truth`

The first two can pass while the commercial claim remains blocked. That is intentional:

- packet/worklist passing means the labeling workflow is ready;
- ground truth passing requires reviewed field labels and source evidence;
- 95% commercial exact-resolution remains unclaimed until the reviewed held-out dataset proves it.
