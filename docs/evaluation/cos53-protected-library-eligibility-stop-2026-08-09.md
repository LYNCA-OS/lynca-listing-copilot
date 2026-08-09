# COS-53 protected-library eligibility STOP

Decision: **STOP_INELIGIBLE_POOL_ZERO_PROVIDER_CALLS**.

The opposite hypothesis was that the 255-card reviewed-title library might contain enough large originals to support the preregistered 48-card variance pilot plus 192-card confirmatory stage. Live, metadata-only aggregation disproved it before any image download: the largest per-card sum of original-object bytes is 863,837, while eligibility requires a strict `total_original_bytes > 3,200,000`.

Therefore the eligible-card upper bound is exactly zero. Dimensions and derived-image size cannot change that result. The design requires 240 disjoint eligible cards, so the shortfall is 240 and no paid experiment is authorized.

## Call boundary

- Live activity completed: read-only verification metadata aggregation.
- Storage signing calls: 0.
- Storage object GETs: 0.
- Live-object browser transforms: 0.
- Model/provider calls: 0.
- Production runtime changes authorized: no.

The 509 verification rows all report `object_verified=true` with valid size/MIME metadata, but none has historical content-hash authority: `content_hash_verified=true` is 0/509 and a pre-existing `content_sha256` is present for 0/509. That does not affect this byte-size STOP. It does mean the protected reviewed-title library cannot support historical byte-to-title authority without a new exact-path acquisition; no such acquisition is justified after the eligibility failure.

## Frozen facts

| Quantity | Value |
|---|---:|
| Protected cards | 255 |
| Protected objects | 509 |
| Metadata reads | 26 |
| Per-card original bytes, p00 / p25 | 199,437 / 461,905 |
| Per-card original bytes, p50 | 513,852 |
| Per-card original bytes, p75 / p90 | 579,965 / 625,783 |
| Per-card original bytes, p95 / p99 | 682,924 / 826,633 |
| Per-card original bytes, max | 863,837 |
| Strict eligibility threshold | > 3,200,000 |
| Eligible cards | 0 |
| Required cards | 240 |

The machine-readable receipt is [cos53-protected-library-eligibility-stop-2026-08-09.json](./cos53-protected-library-eligibility-stop-2026-08-09.json). It transcribes three external hashes reported by the root metadata preflight: metadata identities (`6a99f7…56ce5`), ordered card totals (`d1c4c8…fdaa5`), and aggregate artifact (`e657a1…95fac`). Their canonical preimages/raw rows are not present in this worktree, so the report does **not** claim those hashes are locally recomputable or cryptographically signed. The scalar upper-bound proof remains valid from the reported maximum; a rerun of the metadata preflight is required for independent reproduction. None of this is source-byte or Writer-title authority.

## Read-only next-pool inventory

A replacement pool must come from canonical Production lineage, not the reviewed-title feedback mapping:

1. Start from `public.listing_assets` rows whose image manifest is `FINALIZED`, whose `image_generation_id=id`, and whose expected original count is 1 or 2.
2. Join only `public.listing_image_verifications` rows for the same tenant, asset, and generation; require `canonical_eligible=true`, `object_verified=true`, original storage roles only, exact canonical object paths, valid dimensions/MIME/size, and a complete original-slot count.
3. Group by `(tenant_id, asset_id, image_generation_id, image_set_sha256)` and compute exact original-byte totals without reading Storage objects.
4. Count cards satisfying the frozen size and long-edge conditions. Exclude labels, model outcomes, crops, retired/incomplete generations, and duplicate image identities.
5. Remain STOP before Storage signing/download/provider execution unless at least 240 cards pass and the immutable asset/image lineage is closed. If fewer than 240 pass, report the count and do not lower the sample-size or eligibility gates.

This inventory is metadata-only. It is not a new evaluation cohort, does not expose Writer labels, and does not authorize image access or paid calls.

The repository-local, aggregate-only query is [inventory_cos53_canonical_large_original_pool.sql](../../supabase/queries/inventory_cos53_canonical_large_original_pool.sql). It begins a read-only transaction and rolls it back; it has not been run by this task.
