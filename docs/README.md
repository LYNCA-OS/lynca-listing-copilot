# Listing Copilot Documentation

This folder contains product specs, architecture decisions, roadmap notes, and training/calibration records for Listing Copilot.

## Source-of-Truth Documents

Recommended reading order:

1. `foundation-v1.md`
2. `sports-card-title-standard-v1.md`
3. `architecture-decisions-v1.md`
4. `listing-copilot-roadmap-v1.md`
5. `prompt-modernization-plan-v1.md`

### `foundation-v1.md`

Top-level map of the Listing Copilot foundation.

Use this as the first stop for future engineers and future Codex sessions.

### `sports-card-title-standard-v1.md`

Defines the Sports Card Title Standard v1.

Use this as the source of truth for future sports card title generation rules, including:

- evidence layers
- evidence hierarchy
- canonical title grammar
- cleanup standards
- PSA/BGS grading semantics

### `architecture-decisions-v1.md`

Captures approved V1.x architecture decisions that complement the sports card standard.

Use this to understand current constraints and future boundaries, including:

- no V1.x schema migration
- evidence provenance deferred
- parallel vs card type vs variation definitions
- attributes classification
- grammar engine deferred
- cleanup responsibilities
- grading semantics direction

### `listing-copilot-roadmap-v1.md`

Converts the sports card standard and architecture decisions into an implementation roadmap.

Use this to understand:

- where the current production system stands
- why the future Evidence Engine matters
- what the Resolver Engine should own
- how a future Grammar Engine should render titles
- where a future cloud knowledge/database layer may fit

## Product Spec

### `spec-v1.md`

Original MVP product and workflow specification.

This is still useful for product context, but newer sports-card title behavior should defer to:

1. `sports-card-title-standard-v1.md`
2. `architecture-decisions-v1.md`
3. `listing-copilot-roadmap-v1.md`

## Training and Calibration Notes

The `training-*.md` files are historical learning records from card subsets, confidence calibration, and prompt refinements.

They are useful for understanding why certain rules exist, but they are not the current source of truth when they conflict with the standard, ADRs, or roadmap.

Current training notes include:

- `training-case-hit-insert-v1.md`
- `training-extraction-priority-serial-v1.md`
- `training-pokemon-illustrator-disambiguation-v1.md`
- `training-subset-a-v1.md`
- `training-subset-a-retest-confidence-v1.md`
- `training-subset-a-retest-confidence-philosophy-v1.md`
- `training-subset-a-administrative-summary-v1.md`
- `training-subset-b-follow-up-v1.md`
- `training-subset-c-case-summary-v1.md`
