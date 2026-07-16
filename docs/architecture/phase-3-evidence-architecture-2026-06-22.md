# Phase 3 Evidence Architecture

Status: first compatibility bridge plus number/grade resolver implemented; full resolver is pending
Date: 2026-06-22

## What Changed

This phase starts the Evidence First data layer without removing the legacy title endpoint:

- `lib/listing/schemas/evidence-field.schema.json`
- `lib/listing/schemas/provider-evidence-response.schema.json`
- `lib/listing/schemas/resolved-fields.schema.json`
- `lib/listing/evidence/evidence-schema.mjs`
- `lib/listing/evidence/provider-evidence-normalizer.mjs`
- `lib/listing/resolver/evidence-priority.mjs`
- `lib/listing/resolver/number-resolver.mjs`
- `lib/listing/resolver/grade-resolver.mjs`
- `lib/listing/resolver/resolve-card.mjs`
- `scripts/evidence-schema.test.mjs`
- `scripts/provider-response-normalizer.test.mjs`
- `scripts/resolver.test.mjs`

`api/listing-copilot-title.js` now returns legacy fields and the new compatibility fields:

- `evidence`
- `resolved`
- `model_title_suggestion`
- `evidence_schema_version`

The existing `title`, `fields`, `confidence`, `reason`, and `unresolved` fields remain for backward compatibility.

The resolver bridge now handles the two highest-risk legacy semantic fields:

- Number resolver separates `serial_number`, `collector_number`, and `checklist_code`.
- Grade resolver separates `card_grade`, `auto_grade`, and `grade_type`.

## EvidenceField Contract

The schema follows the commercial target:

- statuses: `CONFIRMED`, `REVIEW`, `MISSING`, `CONFLICT`, `MANUAL_CONFIRMED`, `NOT_APPLICABLE`
- source types: card images, OCR, vision model, internal history, registry, official sources, structured database, marketplace, open web, and operator
- confidence is constrained to `0..1`
- sources keep provenance fields such as `image_id`, `side`, `capture_role`, `region`, `observed_text`, `glare_occlusion`, `blur_score`, and `trust_tier`

The runtime validator checks enum membership, confidence ranges, source trust tiers, source types, candidate shape, and resolved-field shape.

Provider responses also pass a runtime schema gate before Resolver sees them. The provider response schema accepts the current legacy JSON path plus Evidence First fields, but rejects malformed top-level types, non-string unresolved entries, nested legacy field objects, invalid partial resolved fields, malformed full EvidenceField maps, malformed shorthand evidence, and non-object image-quality reports.

## Resolved Fields

The compatibility resolved model splits number fields:

- `serial_number`
- `collector_number`
- `checklist_code`

Legacy `card_number` is mapped conservatively:

- `31/50` -> `serial_number`
- `UV-16` -> `checklist_code`
- `#136` -> `collector_number`
- `257/208` -> `collector_number`

Legacy `player` is mapped to `players[]`.

Grade compatibility starts with:

- `grade_company`
- `card_grade`
- `auto_grade`
- `grade_type`

Examples:

- `PSA 9/10` -> card grade `9`, auto grade `10`, grade type `CARD_AND_AUTO`
- `BGS AUTO 10` -> auto grade `10`, grade type `AUTO_ONLY`
- `PSA Authentic` -> card grade `Auth`, grade type `AUTHENTIC`

## Current Limits

Implemented:

- JSON Schema files
- ProviderEvidenceResponse schema file
- runtime validation with no browser/server secret exposure
- provider response runtime validation before Resolver compatibility conversion
- provider payload to EvidenceField conversion
- legacy fields to resolved fields conversion
- resolved fields back to legacy response mapping
- API-level compatibility assertions in existing title audit tests
- number resolver for serial, collector, and checklist code splitting
- grade resolver for card grade, auto grade, and grade type
- resolver trace returned as `resolution_trace`

Still pending:

- Ajv package integration as the schema validator implementation
- field conflict resolution
- subject, product, card type, and parallel resolvers
- source priority rules
- full deterministic renderer integration beyond the current Phase 4 foundation
- editable writer modules and field-level editing UI
- Supabase analysis/review persistence for evidence/resolved snapshots

## Validation

Current validation commands:

```text
npm run check
npm test
node scripts/evidence-schema.test.mjs
node scripts/provider-response-normalizer.test.mjs
node scripts/resolver.test.mjs
```

These tests prove the schema bridge and runtime validator shape. They do not prove final Evidence First accuracy, resolver correctness, or commercial 95% metrics.
