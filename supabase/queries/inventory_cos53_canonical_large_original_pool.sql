-- Read-only feasibility inventory for a future COS-53 large-original pool.
--
-- This query returns aggregate metadata only. It does not expose labels,
-- tenants, asset ids, object paths, or hashes; it does not read Storage bytes.
-- Run only against the canonical Singapore Production project after reviewing
-- the current schema/changelog boundary.

begin transaction read only;
set local statement_timeout = '30s';

with canonical_originals as (
  select
    verification.tenant_id,
    verification.asset_id,
    verification.image_generation_id,
    case
      when verification.storage_role in ('image_1_original', 'front_original') then 1
      when verification.storage_role in ('image_2_original', 'back_original') then 2
      else null
    end as original_slot,
    verification.size,
    greatest(verification.width, verification.height) as long_edge_px
  from public.listing_image_verifications as verification
  where verification.canonical_eligible is true
    and verification.object_verified is true
    and verification.content_hash_verified is true
    and verification.dimension_source = 'object_bytes'
    and verification.bucket = 'listing-card-images'
    and verification.image_generation_id = verification.asset_id
    and verification.storage_role in (
      'image_1_original', 'front_original', 'image_2_original', 'back_original'
    )
    and verification.content_type in ('image/jpeg', 'image/png', 'image/webp')
    and verification.size > 0
    and verification.size <= 26214400
    and verification.width > 0
    and verification.height > 0
    and verification.content_sha256 ~ '^[0-9a-f]{64}$'
    and array_length(string_to_array(verification.object_path, '/'), 1) = 6
    and split_part(verification.object_path, '/', 1) = 'tenants'
    and split_part(verification.object_path, '/', 2) = verification.tenant_id
    and split_part(verification.object_path, '/', 3) = 'listing-assets'
    and split_part(verification.object_path, '/', 4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and split_part(verification.object_path, '/', 5) = verification.asset_id
    and nullif(split_part(verification.object_path, '/', 6), '') is not null
),
closed_assets as (
  select
    asset.tenant_id,
    asset.id as asset_id,
    asset.image_generation_id,
    sum(original.size)::bigint as total_original_bytes,
    min(original.long_edge_px)::integer as min_original_long_edge_px
  from public.listing_assets as asset
  join canonical_originals as original
    on original.tenant_id = asset.tenant_id
   and original.asset_id = asset.id
   and original.image_generation_id = asset.image_generation_id
  where asset.image_set_state = 'FINALIZED'
    and asset.image_generation_id = asset.id
    and asset.expected_original_count in (1, 2)
    and asset.image_set_sha256 ~ '^[0-9a-f]{64}$'
  group by
    asset.tenant_id,
    asset.id,
    asset.image_generation_id,
    asset.expected_original_count,
    asset.image_set_sha256
  having count(*) = asset.expected_original_count
     and count(distinct original.original_slot) = asset.expected_original_count
     and bool_and(original.original_slot is not null)
     and (asset.expected_original_count = 2 or bool_or(original.original_slot = 1))
),
summary as (
  select
    count(*)::integer as closed_canonical_cards,
    count(*) filter (
      where total_original_bytes > 3200000
        and min_original_long_edge_px > 1600
    )::integer as frozen_gate_eligible_cards,
    min(total_original_bytes)::bigint as total_original_bytes_min,
    percentile_disc(0.50) within group (order by total_original_bytes)::bigint
      as total_original_bytes_p50,
    percentile_disc(0.95) within group (order by total_original_bytes)::bigint
      as total_original_bytes_p95,
    max(total_original_bytes)::bigint as total_original_bytes_max
  from closed_assets
)
select
  'cos53-canonical-large-original-pool-inventory-v1'::text as schema_version,
  3200000::bigint as frozen_total_original_bytes_exclusive_min,
  1600::integer as frozen_each_original_long_edge_px_exclusive_min,
  240::integer as required_eligible_cards,
  closed_canonical_cards,
  frozen_gate_eligible_cards,
  total_original_bytes_min,
  total_original_bytes_p50,
  total_original_bytes_p95,
  total_original_bytes_max,
  (frozen_gate_eligible_cards >= 240) as sample_size_feasible,
  0::integer as storage_sign_calls,
  0::integer as storage_object_gets,
  0::integer as provider_calls
from summary;

rollback;
