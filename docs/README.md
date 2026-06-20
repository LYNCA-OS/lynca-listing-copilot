# Listing Copilot Documentation

This folder contains product specs, architecture decisions, roadmap notes, standards, and training records for Listing Copilot.

The documentation is organized so permanent source-of-truth docs are separate from raw training evidence and historical notes.

## Recommended Reading Order

1. `foundation/foundation-v1.md`
2. `standards/sports-card-title-standard-v1.md`
3. `architecture/architecture-decisions-v1.md`
4. `roadmap/listing-copilot-roadmap-v1.md`
5. `architecture/prompt-modernization-plan-v1.md`

## Foundation

### `foundation/foundation-v1.md`

Top-level map of Listing Copilot.

Use this as the first stop for future engineers and future Codex sessions.

### `foundation/spec-v1.md`

Original MVP product and workflow specification.

Use this for initial product context. Newer sports-card title behavior should defer to the standard, ADRs, and roadmap.

## Standards

### `standards/sports-card-title-standard-v1.md`

Source of truth for future sports card title generation rules, including:

- evidence layers
- evidence hierarchy
- canonical title grammar
- cleanup standards
- PSA/BGS grading semantics

## Architecture

### `architecture/architecture-decisions-v1.md`

Approved V1.x architecture decisions and future boundaries.

### `architecture/prompt-modernization-plan-v1.md`

Plan for reducing prompt complexity over time while preserving output quality.

## Roadmap

### `roadmap/listing-copilot-roadmap-v1.md`

Phased implementation roadmap from current production behavior toward Evidence, Resolver, Grammar Engine, and Knowledge Database architecture.

## Training

### `training/README.md`

Training archive guide.

### `training/training-index-v1.md`

Consolidated operating summary of recurring QA learnings.

### `training/registry-candidates-v1.md`

Registry backlog for official card types, inserts, product-family terms, parallels, and commercially meaningful terms.

### `training/qa-findings-2026-06.md`

Monthly QA summary for the June 2026 Subset A-F training cycle.

### `training/subsets/`

Raw subset reports. These are evidence records and should remain mostly immutable after creation.

## Archive

### `archive/training-legacy/`

Older one-off training notes, confidence calibration notes, and category-specific historical records.

These remain useful context, but they are not the current source of truth when they conflict with foundation, standards, architecture, roadmap, or the consolidated training index.
