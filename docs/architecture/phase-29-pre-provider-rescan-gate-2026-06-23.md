# Phase 29 Pre-Provider Rescan Gate

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Avoid spending recognition-worker or legacy vision provider calls on images that are already known to have identity-critical regions occluded.

This is a low-cost and low-loss guardrail. It does not improve model accuracy directly; it prevents bad captures from producing expensive or misleading identity attempts.

## What Changed

New module:

- `lib/listing/image-quality/pre-provider-rescan-gate.mjs`

API behavior:

- `api/listing-copilot-title.js` now checks the pre-provider rescan gate after approved-memory/cache lookup and before recognition-worker or vision-provider calls.
- If identity-critical regions are occluded, the API returns `TARGETED_RESCAN_REQUIRED` with `identity_resolution_status=ABSTAIN`.
- Provider, recognition-worker, and retrieval calls remain `0` for this route.

New test:

- `scripts/pre-provider-rescan-gate.test.mjs`

## Blocking Policy

The gate blocks only conservative identity-critical regions:

- `subject_name`
- `year_product`
- `card_type`
- `grade_label` only when the capture surface is slab-like

It does not block on serial, collector-number, or checklist fixed-region occlusion by itself because those regions may be irrelevant for many cards before evidence is available.

## Safety Contract

The route must return:

- no final title
- `ABSTAIN`
- explicit `TARGETED_RESCAN_REQUIRED`
- trace entry explaining which region blocked the request
- zero provider, retrieval, and recognition-worker calls

The gate is controlled by:

- `LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED`

Default is enabled. Requests without capture-quality metadata continue normally.

