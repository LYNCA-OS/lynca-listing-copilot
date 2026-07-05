# Phase 21 Worker OCR Text Fusion

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Make the Recognition Worker able to turn OCR text lines into structured field evidence instead of returning only placeholders.

This does not add image downloading or a heavy OCR model yet. It adds the deterministic fusion layer that sits immediately after OCR.

## What Changed

The worker now has:

- normalized OCR item construction in `ocr_pipeline.py`
- OCR text fusion in `evidence_fusion.py`
- parsed `field_candidates`
- top `resolved_fields`
- explicit OCR conflicts
- trace metadata for replay

Supported deterministic field parsing:

- `serial_number`
- `collector_number`
- `checklist_code`
- `year`
- `grade_company`
- `card_grade`
- `auto_grade`
- `grade_type`

The parser intentionally does not infer player, product, set, or parallel from style. Those still require stronger evidence such as OCR text, registry/checklist match, visual candidate verification, or legacy vision provider as semantic evidence.

## Safety Rules

- A plain serial line like `31/50` is not parsed as a grade.
- Grade parsing only runs on grade-label/slab-like text or lines containing a grading company such as PSA/BGS/CGC/SGC/TAG.
- Checklist parsing avoids long natural-language phrases and accepts only compact hyphenated codes or short uppercase code-number forms.
- Multiple normalized values for one field produce `OCR_VALUE_CONFLICT`.

## Runtime Impact

When OCR is unavailable, the worker still returns:

- `ocr_evidence.status = UNAVAILABLE`
- `evidence_fusion.status = NO_EVIDENCE`

When a future OCR adapter returns text lines, the worker can immediately emit structured evidence without another API change.

## Remaining Work

Next steps:

1. Add safe signed-image byte loading inside the worker.
2. Enable an OCR adapter behind the existing `ocr_evidence_from_items` contract.
3. Add registry/checklist candidate verification for product/player/parallel.
4. Evaluate the full Supabase image-backed dataset, including all failures and ABSTAIN routes.
