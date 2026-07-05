# Phase 20 Recognition Preflight Identity Gate

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Move one more step away from per-request vision generation by trying cheap grounded evidence before legacy vision provider.

The production title route is now:

1. approved identity memory exact fingerprint hit
2. recognition worker OCR/slab preflight
3. identity resolution gate
4. legacy vision provider only when local grounded evidence cannot resolve identity
5. focused reread or retrieval only when the completion policy asks for it

## What Changed

`api/listing-copilot-title.js` now runs a recognition preflight when `ENABLE_RECOGNITION_WORKER=true` and the worker URL/token are configured.

The preflight:

- verifies Supabase storage references
- signs read-only image URLs
- sends primary card images to the recognition worker
- converts `ocr_evidence.items` into `EvidenceDocument`
- preserves candidate-level sources so field conflicts remain explicit
- sends the evidence through `applyIdentityResolutionGate`

If the identity gate returns `CONFIRMED` or `RESOLVED`, the API returns a deterministic English title without calling legacy vision provider or OpenAI.

If the gate returns `ABSTAIN`, the recognition evidence is merged into the normal provider path so OCR/slab evidence can still override legacy vision provider inference field by field.

## Evidence Contract

The new adapter accepts recognition items like:

- `field`
- `value`
- `confidence`
- `image_id`
- `role`
- `side`
- `observed_text`
- `parsed_fields`

It maps sources conservatively:

- `grade_label_crop`, grade fields, or PSA/BGS/CGC/SGC text -> `SLAB_LABEL`
- back image roles -> `CARD_BACK`
- front image roles -> `CARD_FRONT`
- unknown OCR -> `OCR`

`CARD_FRONT` and `CARD_BACK` are then normalized by the identity resolver into printed-text evidence sources.

## Cost Control

When recognition preflight resolves identity:

- legacy vision provider calls: `0`
- OpenAI calls: `0`
- retrieval calls: `0`
- writes: `0`

The only remote operations are storage verification reads, signed URL creation, and one recognition worker call.

## Loss Control

Recognition does not bypass identity resolution. It still returns:

- `identity_resolution`
- `field_states`
- `conflict_graph`
- `conflict_map`
- `confidence_report`
- deterministic renderer output

Provider fallback remains available, but legacy vision provider cannot silently overwrite printed OCR/slab evidence because both sources now enter the same field-level solver.

## Remaining Work

The worker currently has placeholder OCR adapters in local tests. The next step is to enable a real OCR backend behind the existing worker contract and evaluate it against the full Supabase image-backed dataset.
