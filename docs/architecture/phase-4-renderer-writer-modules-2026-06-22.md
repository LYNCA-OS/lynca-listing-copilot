# Phase 4 Renderer And Writer Modules

Status: deterministic title renderer, writer module editing, and title override UI boundary implemented; review persistence is pending
Date: 2026-06-22

## What Changed

This phase moves the final title path away from model-authored full-title output and onto resolved fields:

- `lib/listing/renderer/title-cleanup.mjs`
- `lib/listing/renderer/title-length-policy.mjs`
- `lib/listing/renderer/module-renderer.mjs`
- `lib/listing/renderer/sports-title-renderer.mjs`
- `lib/listing/renderer/pokemon-title-renderer.mjs`
- `lib/listing/renderer/generic-title-renderer.mjs`
- `lib/listing/renderer/listing-renderer.mjs`
- `lib/listing/writer/module-edit.mjs`
- `api/listing-render-title.js`
- `scripts/renderer.test.mjs`
- `scripts/writer-module-edit.test.mjs`

`api/listing-copilot-title.js` now returns:

- `modules`
- `module_order`
- `rendered_title`
- `final_title`
- `title_override`
- `title_render_source`
- `renderer`
- `renderer_version`
- `title_length_policy`

Legacy compatibility remains:

- `title` is mapped to `final_title`
- `fields` is still returned from resolved fields
- `model_title_suggestion` is preserved as model reference only
- `confidence`, `reason`, and `unresolved` remain available

## Renderer Boundary

The renderer only consumes resolved fields and evidence status. It does not:

- call a model
- call search
- choose a provider
- resolve conflicts
- infer missing facts from the model title
- write feedback or publishing records

The old model full-title output remains visible through `model_title_suggestion`, but it is no longer the primary final-title source when resolved fields are renderable.

## Title Rules Implemented

Sports title order follows the commercial target:

```text
Year -> Manufacturer/Product -> Player(s) -> Card Type/Insert -> Parallel/Variation -> Serial -> Attributes -> Grade
```

Implemented constraints:

- 80-character max policy with low-priority field removal before any compacting
- serial numbers are required when resolved
- grade is required when resolved and is moved to the end
- RC and 1st Bowman markers are deduped and preserved
- checklist codes are not included in default sports titles
- multi-player titles preserve all resolved player names unless length pressure requires compacting
- `Dual Signatures` remains official card-type wording and is not generalized to `Dual Auto`
- `Auto` is not duplicated against signature/autograph insert wording or grading text
- `Panini Immaculate Collection` displays as `Panini Immaculate`

Pokemon rendering keeps collector numbers in the default title because they are commercially meaningful for that category.

## Writer Modules

The API now returns six fixed writer modules:

- `product_identity`
- `subject`
- `card_variant`
- `numbering`
- `attributes`
- `grading`

Each module contains:

- `label`
- `text`
- `status`
- `requires_review`
- `fields`
- `evidence_summary`

The frontend displays these modules in a compact editable grid next to the generated title. It does not show raw JSON to writers.

Module text controls are now editable. On change, the browser posts the current resolved/evidence snapshot plus the explicit module edit to `/api/listing-render-title`. The server updates corrected resolved fields, marks changed fields as operator evidence, computes `field_changes`, rerenders modules, and returns the new deterministic title.

Implemented module edit behavior:

- numbering edits parse serial, collector number, and checklist code
- subject edits update `players[]` or `character`
- attributes edits update boolean tags such as RC, Auto, Patch, Relic, SSP, Case Hit, Redemption, and 1/1
- grading edits update `grade_company`, `card_grade`, `auto_grade`, and `grade_type`
- product identity and card variant edits provide conservative text-to-field updates for the current compatibility UI

Manual final-title edits are tracked as `title_override` in browser state. A title override does not modify `resolved` fields. If a module is edited while an override exists, the UI keeps the human title and offers a "use module title" action to replace the override with the newly rendered deterministic title.

## Resolver Compatibility Added

The grade resolver now supports legacy title-context parsing for auto grades when the structured field has the card grade but the previous model title carried the auto grade wording:

- `PSA 9 Auto 10` -> `card_grade=9`, `auto_grade=10`
- `PSA 10 MINT 9` -> `card_grade=10`, `auto_grade=9`

This compatibility path only fills grade semantics. It does not let the model title backfill unrelated card facts.

## Current Limits

Implemented:

- deterministic renderer modules
- sports, Pokemon, and generic renderer selection
- title length policy with trace output
- editable writer modules in the browser
- module edit endpoint for server-side rerendering
- corrected resolved/evidence snapshots for module edits
- field changes for module edits
- title override UI boundary that does not mutate resolved fields
- final title mapped to deterministic renderer output
- mock tests for renderer requirements
- mock tests for module edit and title override boundaries
- updated legacy audit tests for field-driven serial recovery and renderer ordering

Still pending:

- durable persistence for corrected resolved/evidence snapshots
- durable persistence for `title_override`
- full field-level review endpoint and Supabase writes
- save of `ACCEPTED_UNCHANGED`
- Supabase analysis/review tables
- route resolver
- subject/product/card-type/parallel conflict resolvers
- retrieval candidate evidence in module summaries

## Validation

Current validation commands:

```text
npm run check
npm test
node scripts/renderer.test.mjs
node scripts/writer-module-edit.test.mjs
node scripts/listing-confidence-audit.test.mjs
```

These tests prove the deterministic renderer behavior and legacy API compatibility. They do not prove commercial 95% accuracy, full Writer UI editing, or field-level feedback persistence.
