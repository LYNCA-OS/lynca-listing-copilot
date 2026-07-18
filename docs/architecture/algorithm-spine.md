# Production Algorithm Spine

This document defines the online decision surface. Code outside this surface may
support imports, evaluation, or research, but it does not own production card
identity decisions.

## Online flow

```text
V4 request / queued job
  -> pre-ingestion evidence
  -> typed anchor extraction and classification
  -> route planning
  -> GPT-5 mini observation and targeted OCR evidence
  -> catalog/vector candidate retrieval
  -> candidate selection and field application
  -> identity resolution
  -> deterministic CSM renderer
  -> writer-visible title and persistence
```

## One owner per decision

| Decision | Owner |
| --- | --- |
| Anchor type and lookup eligibility | `lib/listing/v4/anchors/anchor-classifier.mjs` |
| Recognition route | `lib/listing/v4/route-planner/route-planner.mjs` |
| Candidate ranking and identity eligibility | `lib/listing/candidates/candidate-selection-pass.mjs` |
| Candidate field permissions | `lib/listing/candidates/candidate-application-policy.mjs` |
| Candidate field evidence application | `lib/listing/candidates/retrieval-application-layer.mjs` |
| Final identity state | `lib/identity-resolution/` |
| Title order, composition, and length | `lib/listing/renderer/` |

Callers may consume these decisions. They must not recreate them with local
regexes, alternate trust tables, or independent fuzzy correction rules.

## Not part of the online decision surface

- `lib/listing/evaluation/` and evaluation scripts
- catalog import, discovery, and staging scripts
- recognition dataset builders and offline review tools
- experimental external adapters that are not imported by a production API

These tools remain useful, but they must not be treated as a second production
algorithm during code review.

## Protected boundaries

- The active catalog and its import history are not slimming targets.
- `openai_legacy` remains the wire-compatible provider ID even though the model
  is GPT-5 mini.
- Provider input aliases may remain at the adapter boundary, but the V4 public
  result has one canonical `resolved_fields` representation.
- V4 calls `runNativeV4Recognition` from
  `lib/listing/v4/pipeline/native-recognition-core.mjs`; the retired V2 HTTP
  route owns no recognition implementation.

## Deletion rule

A module is safe to delete only when it is unreachable from production API
roots, has no durable-data compatibility responsibility, and has an active
replacement for any decision it once owned. Evaluation-only experiments may be
removed separately when their evidence is preserved in reports or history.
