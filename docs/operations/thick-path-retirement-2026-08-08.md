# Thick-path retirement — 2026-08-08

The production recognition boundary is now the direct Luna -> CSM/SEM ->
Composer path. Cloud Run recognition workers, generic OCR, vector retrieval,
the V4 queue, catalog import runtime, and their public/admin entrypoints were
removed from the deployable source tree.

## Protected assets

The internal writer library is larger than the 255-card blind evaluation set.
Cleanup must preserve both layers:

- 358 `listing_title_feedback` rows in Singapore Supabase;
- 255 `card_identities` and 509 `card_reference_images` rows;
- 3,449 objects in `listing-feedback-images`;
- 255 image-backed writer-source mappings in
  `data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json`;
- 255 image-only evaluation items and 255 sealed labels under
  `~/lynca-eval-root/data/eval/reviewed-title-blind/`;
- all active CSM thin sessions and verified production card images.

`scripts/check-protected-internal-library.mjs` verifies the local 255-item
projection and its repository/evaluation-root byte identity. The live cleanup
SQL in `scripts/sql/retire-thick-path-data.sql` aborts unless the larger
Supabase protection boundary is present.

## Live cleanup result

- Rebuildable catalog/vector/OCR/V4 queue tables were truncated without
  `CASCADE`; database size fell from about 907 MiB to about 407 MiB.
- 36 unverified and unreferenced Storage objects (about 9.2 MB) were removed
  through the Storage API. A post-clean query found zero safe orphans.
- The protected counts above were unchanged after cleanup.
- The 2.1 GB local Singapore migration export was moved to
  `/Volumes/musician/LYNCA-cleanup-hold/supabase-singapore-migration-2026-08-08`.
  It is not part of the production checkout.

Database truncation and Storage object deletion are not recoverable from this
checkout. The SQL file and this record are the audit trail; do not re-run the
cleanup script as routine maintenance.
