# Listing Copilot Training Archive

This folder contains consolidated QA learnings and raw training evidence for Listing Copilot.

## How To Read This Folder

Start with:

1. `training-index-v1.md`
2. `registry-candidates-v1.md`
3. `qa-findings-2026-06.md`
4. `subsets/`

## Operating Documents

### `training-index-v1.md`

Consolidated operating summary of recurring learnings.

Use this before reading individual subset reports. It groups findings by theme so future work does not depend on scanning every raw report.

### `registry-candidates-v1.md`

Registry backlog for official card types, inserts, product families, parallels, and commercially meaningful terms.

Use this as a planning artifact for future registry infrastructure. It is not runtime data.

### `qa-findings-2026-06.md`

Monthly QA summary for the June 2026 training cycle.

Use this for a high-level view of what Subsets A-F taught.

## Raw Evidence Records

The files in `subsets/` are raw QA evidence records.

They preserve observed behavior, marketplace references, expected direction, and root-cause layers. They should remain mostly immutable after creation.

## Historical Notes

Older one-off training notes live in `../archive/training-legacy/`.

Those files are still useful for context, but they are not the current source of truth when they conflict with:

1. `../standards/sports-card-title-standard-v1.md`
2. `../architecture/architecture-decisions-v1.md`
3. `training-index-v1.md`
