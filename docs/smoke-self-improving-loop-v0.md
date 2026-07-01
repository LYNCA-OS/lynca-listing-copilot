# Smoke Self-Improving Loop v0

This phase turns verified writer titles into a training-asset factory without changing the production prompt, renderer, provider, resolver, or gate.

## Truth Levels

- `VERIFIED_CANONICAL_TITLE`: writer-reviewed corrected title. This is title-level truth.
- `AUTO_PARSED_FROM_VERIFIED_TITLE`: deterministic parser output from a verified title. This is not field-level reviewed ground truth.
- `REVIEWED_INTERNAL`: field-level human-reviewed data only.

Parser output must not be promoted to `REVIEWED_INTERNAL` automatically.

## Smoke Modes

### recapture_smoke

Allows the query card's verified title to enter the catalog candidate pool.

Purpose:

- test whether the system can use the correct candidate when it exists
- estimate oracle / recapture upper bound
- debug renderer, merge, and candidate application

This score must not be called blind or commercial accuracy.

### holdout_smoke

Excludes the query card's own corrected title, source feedback id, and obvious self identity candidates.

Purpose:

- test generalization from nearby catalog knowledge
- detect answer leakage
- measure whether the candidate layer helps without direct self answers

### cold_start_smoke

Excludes correct catalog identities.

Purpose:

- test usable draft behavior when no correct candidate exists
- check whether the system creates catalog-gap work instead of forcing a wrong identity

## Outputs

`npm run export:smoke-loop` writes:

- smoke dashboard
- decision traces
- field diff report
- hard negative records
- opportunity report

Default output directory:

```text
data/eval/smoke-self-improving-loop/
```

This directory is ignored by Git because it may contain internal reviewed titles and eval traces.

## Command

```bash
npm run export:smoke-loop -- \
  --mode recapture_smoke \
  --input data/eval/concurrency-sweep/2026-07-01-c2.json
```

Use `--mode holdout_smoke` or `--mode cold_start_smoke` to recalculate the same saved report under leakage-safe or open-set assumptions.

## Guardrails

- Do not change prompt.
- Do not change renderer.
- Do not change gate.
- Do not train a model from this step alone.
- Do not auto-promote parser fields to reviewed internal fields.
- Do not use recapture score as commercial blind accuracy.
- Do not copy reference serial numerator, grade, or cert into current physical-instance fields.
