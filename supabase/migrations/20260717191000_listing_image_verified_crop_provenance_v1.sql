-- Durable image-generation manifest and server-verified crop lineage.
-- Legacy four-segment records remain available for audit, but are explicitly
-- ineligible for canonical enqueue. New eligible rows must be six-segment,
-- fully content/dimension verified, and bound to one immutable asset generation.

set lock_timeout = '5s';
set statement_timeout = '5min';

alter table public.listing_assets
  add column if not exists image_generation_id text,
  add column if not exists expected_original_count smallint,
  add column if not exists image_set_state text not null default 'LEGACY_INELIGIBLE',
  add column if not exists image_set_sha256 text;

update public.listing_assets
set image_generation_id = id,
    image_set_state = case
      when image_set_state is null or image_set_state = '' then 'LEGACY_INELIGIBLE'
      else image_set_state
    end
where image_generation_id is null
   or image_set_state is null
   or image_set_state = '';

alter table public.listing_assets
  alter column image_generation_id set not null;

alter table public.listing_assets
  drop constraint if exists listing_assets_expected_original_count_check,
  add constraint listing_assets_expected_original_count_check
    check (expected_original_count is null or expected_original_count in (1, 2)) not valid,
  drop constraint if exists listing_assets_image_generation_identity_check,
  add constraint listing_assets_image_generation_identity_check
    check (image_generation_id = id) not valid,
  drop constraint if exists listing_assets_image_set_state_check,
  add constraint listing_assets_image_set_state_check
    check (image_set_state in ('LEGACY_INELIGIBLE', 'INCOMPLETE', 'FINALIZED', 'RETIRED')) not valid,
  drop constraint if exists listing_assets_image_set_sha256_check,
  add constraint listing_assets_image_set_sha256_check
    check (image_set_sha256 is null or image_set_sha256 ~ '^[0-9a-f]{64}$') not valid;

alter table public.listing_assets validate constraint listing_assets_expected_original_count_check;
alter table public.listing_assets validate constraint listing_assets_image_generation_identity_check;
alter table public.listing_assets validate constraint listing_assets_image_set_state_check;
alter table public.listing_assets validate constraint listing_assets_image_set_sha256_check;

create or replace function public.enforce_listing_asset_image_manifest_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.image_generation_id is distinct from new.image_generation_id then
    raise exception using errcode = '23514', message = 'listing_asset_generation_immutable';
  end if;
  if old.expected_original_count is not null
     and old.expected_original_count is distinct from new.expected_original_count then
    raise exception using errcode = '23514', message = 'listing_asset_expected_original_count_immutable';
  end if;
  if old.image_set_state = 'FINALIZED'
     and new.image_set_state not in ('FINALIZED', 'RETIRED') then
    raise exception using errcode = '23514', message = 'listing_asset_finalized_state_immutable';
  end if;
  if old.image_set_state = 'FINALIZED'
     and new.image_set_state = 'FINALIZED'
     and old.image_set_sha256 is distinct from new.image_set_sha256 then
    raise exception using errcode = '23514', message = 'listing_asset_image_set_hash_immutable';
  end if;
  if old.image_set_state = 'RETIRED'
     and (
       new.image_set_state is distinct from 'RETIRED'
       or old.image_set_sha256 is distinct from new.image_set_sha256
     ) then
    raise exception using errcode = '23514', message = 'listing_asset_retired_image_set_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists listing_assets_image_manifest_immutable on public.listing_assets;
create trigger listing_assets_image_manifest_immutable
before update of image_generation_id, expected_original_count, image_set_state, image_set_sha256
on public.listing_assets
for each row execute function public.enforce_listing_asset_image_manifest_immutable();

alter table public.listing_image_verifications
  add column if not exists image_generation_id text,
  add column if not exists crop_metadata jsonb,
  add column if not exists canonical_eligible boolean not null default false;

-- No legacy path may become eligible by migration inference. Keep this
-- convergence idempotent: a later valid six-segment canonical row must never
-- be downgraded if migration history is repaired or replayed.
update public.listing_image_verifications
set canonical_eligible = false
where canonical_eligible is null;

update public.listing_image_verifications
set image_generation_id = null,
    crop_metadata = null
where canonical_eligible is false
  and (
    image_generation_id is distinct from asset_id
    or pg_catalog.array_length(pg_catalog.string_to_array(object_path, '/'), 1) <> 6
    or pg_catalog.split_part(object_path, '/', 1) <> 'tenants'
    or pg_catalog.split_part(object_path, '/', 2) is distinct from tenant_id
    or pg_catalog.split_part(object_path, '/', 3) <> 'listing-assets'
    or pg_catalog.split_part(object_path, '/', 5) is distinct from asset_id
  );

alter table public.listing_image_verifications
  alter column canonical_eligible set default false,
  alter column canonical_eligible set not null;

create or replace function public.listing_crop_metadata_is_valid(
  p_metadata jsonb,
  p_tenant_id text,
  p_asset_id text,
  p_generation_id text,
  p_image_id text,
  p_storage_role text,
  p_object_path text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bounds jsonb;
  v_x numeric;
  v_y numeric;
  v_width numeric;
  v_height numeric;
  v_expected_role text;
  v_source_path text;
begin
  if pg_catalog.jsonb_typeof(p_metadata) <> 'object' then return false; end if;
  v_expected_role := case p_metadata ->> 'source_region'
    when 'subject_name' then 'subject_crop'
    when 'subject_slot_1' then 'subject_crop'
    when 'subject_slot_2' then 'subject_crop'
    when 'subject_slot_3' then 'subject_crop'
    when 'serial_number' then 'serial_crop'
    when 'surface_color' then 'parallel_crop'
    when 'parallel_family' then 'parallel_crop'
    when 'parallel_exact' then 'parallel_crop'
    when 'parallel' then 'parallel_crop'
    when 'parallel_surface' then 'parallel_crop'
    when 'variation' then 'parallel_crop'
    when 'collector_number' then 'card_code_crop'
    when 'checklist_code' then 'card_code_crop'
    when 'grade_label' then 'grade_label_crop'
    when 'year_product' then 'year_product_crop'
    when 'card_type' then 'card_type_crop'
    when 'autograph' then 'autograph_crop'
    when 'patch_relic' then 'patch_relic_crop'
    else null
  end;
  if v_expected_role is distinct from p_storage_role
     or nullif(p_metadata ->> 'crop_id', '') is distinct from p_image_id
     or nullif(p_metadata ->> 'generation_id', '') is distinct from p_generation_id
     or nullif(p_metadata ->> 'asset_id', '') is distinct from p_asset_id
     or nullif(p_metadata ->> 'crop_role', '') is distinct from p_storage_role
     or nullif(p_metadata ->> 'derived_object_path', '') is distinct from p_object_path
     or nullif(p_metadata ->> 'source_image_id', '') is null
     or nullif(p_metadata ->> 'source_image_id', '') is not distinct from p_image_id
     or nullif(p_metadata ->> 'source_content_sha256', '') !~ '^[0-9a-f]{64}$'
     or nullif(p_metadata ->> 'source_side', '') not in ('front', 'back')
     or nullif(p_metadata ->> 'transform_version', '') is null then
    return false;
  end if;

  v_source_path := nullif(p_metadata ->> 'source_object_path', '');
  if v_source_path is null
     or pg_catalog.array_length(pg_catalog.string_to_array(v_source_path, '/'), 1) <> 6
     or pg_catalog.split_part(v_source_path, '/', 1) <> 'tenants'
     or pg_catalog.split_part(v_source_path, '/', 2) <> p_tenant_id
     or pg_catalog.split_part(v_source_path, '/', 3) <> 'listing-assets'
     or pg_catalog.split_part(v_source_path, '/', 4) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or pg_catalog.split_part(v_source_path, '/', 5) <> p_asset_id
     or nullif(pg_catalog.split_part(v_source_path, '/', 6), '') is null then
    return false;
  end if;

  if coalesce(p_metadata ->> 'source_width', '') !~ '^[0-9]+(?:\.[0-9]+)?$'
     or coalesce(p_metadata ->> 'source_height', '') !~ '^[0-9]+(?:\.[0-9]+)?$'
     or (p_metadata ->> 'source_width')::numeric <= 0
     or (p_metadata ->> 'source_height')::numeric <= 0 then
    return false;
  end if;

  v_bounds := p_metadata -> 'normalized_bounds';
  if pg_catalog.jsonb_typeof(v_bounds) <> 'object' then return false; end if;
  v_x := (v_bounds ->> 'x')::numeric;
  v_y := (v_bounds ->> 'y')::numeric;
  v_width := (v_bounds ->> 'width')::numeric;
  v_height := (v_bounds ->> 'height')::numeric;
  if v_x is null or v_y is null or v_width is null or v_height is null
     or v_x < 0 or v_y < 0 or v_x >= 1 or v_y >= 1
     or v_width <= 0 or v_height <= 0
     or v_x + v_width > 1.000001
     or v_y + v_height > 1.000001 then
    return false;
  end if;
  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

alter table public.listing_image_verifications
  drop constraint if exists listing_image_verifications_canonical_contract_check,
  add constraint listing_image_verifications_canonical_contract_check check (
    canonical_eligible is false
    or coalesce((
      object_verified is true
      and content_hash_verified is true
      and dimension_source = 'object_bytes'
      and bucket = 'listing-card-images'
      and size > 0
      and width > 0
      and height > 0
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and tenant_id is not null
      and asset_id is not null
      and image_id is not null
      and image_generation_id = asset_id
      and pg_catalog.array_length(pg_catalog.string_to_array(object_path, '/'), 1) = 6
      and pg_catalog.split_part(object_path, '/', 1) = 'tenants'
      and pg_catalog.split_part(object_path, '/', 2) = tenant_id
      and pg_catalog.split_part(object_path, '/', 3) = 'listing-assets'
      and pg_catalog.split_part(object_path, '/', 4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_catalog.split_part(object_path, '/', 5) = asset_id
      and nullif(pg_catalog.split_part(object_path, '/', 6), '') is not null
      and (
        (storage_role in ('image_1_original', 'front_original', 'image_2_original', 'back_original')
          and crop_metadata is null)
        or (
          storage_role in (
            'serial_crop', 'subject_crop', 'card_code_crop', 'grade_label_crop',
            'year_product_crop', 'card_type_crop', 'autograph_crop',
            'patch_relic_crop', 'parallel_crop'
          )
          and public.listing_crop_metadata_is_valid(
            crop_metadata, tenant_id, asset_id, image_generation_id,
            image_id, storage_role, object_path
          )
        )
      )
    ), false)
  ) not valid;

alter table public.listing_image_verifications
  validate constraint listing_image_verifications_canonical_contract_check;

create unique index if not exists listing_image_verifications_canonical_image_uidx
  on public.listing_image_verifications(tenant_id, asset_id, image_generation_id, image_id)
  where canonical_eligible is true;

create unique index if not exists listing_image_verifications_canonical_primary_slot_uidx
  on public.listing_image_verifications(
    tenant_id,
    asset_id,
    image_generation_id,
    (case
      when storage_role in ('image_1_original', 'front_original') then 1
      when storage_role in ('image_2_original', 'back_original') then 2
      else null
    end)
  )
  where canonical_eligible is true
    and storage_role in ('image_1_original', 'front_original', 'image_2_original', 'back_original');

create unique index if not exists listing_image_verifications_canonical_crop_region_uidx
  on public.listing_image_verifications(
    tenant_id,
    asset_id,
    image_generation_id,
    ((crop_metadata ->> 'source_image_id')),
    storage_role,
    ((crop_metadata ->> 'source_region'))
  )
  where canonical_eligible is true
    and crop_metadata is not null;

create or replace function public.enforce_listing_image_verification_generation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asset public.listing_assets%rowtype;
  v_source_count integer;
begin
  if tg_op = 'DELETE' then
    if old.canonical_eligible is true then
      raise exception using errcode = '23514', message = 'listing_canonical_image_delete_requires_invalidation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.canonical_eligible is true then
    if old.tenant_id is distinct from new.tenant_id
       or old.asset_id is distinct from new.asset_id
       or old.image_generation_id is distinct from new.image_generation_id
       or old.image_id is distinct from new.image_id
       or old.storage_role is distinct from new.storage_role
       or old.bucket is distinct from new.bucket
       or old.object_path is distinct from new.object_path
       or old.content_type is distinct from new.content_type
       or old.size is distinct from new.size
       or old.width is distinct from new.width
       or old.height is distinct from new.height
       or old.content_sha256 is distinct from new.content_sha256
       or old.content_hash_verified is distinct from new.content_hash_verified
       or old.dimension_source is distinct from new.dimension_source
       or old.crop_metadata is distinct from new.crop_metadata then
      raise exception using errcode = '23514', message = 'listing_canonical_image_identity_immutable';
    end if;
    if (
      old.canonical_eligible is distinct from new.canonical_eligible
      or old.object_verified is distinct from new.object_verified
    ) and not (
      new.canonical_eligible is false and new.object_verified is false
    ) then
      raise exception using errcode = '23514', message = 'listing_canonical_image_invalidation_incomplete';
    end if;
  end if;

  select assets.* into v_asset
  from public.listing_assets assets
  where assets.id = new.asset_id
    and assets.tenant_id = new.tenant_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'listing_image_parent_missing';
  end if;

  if tg_op = 'UPDATE'
     and old.canonical_eligible is true
     and new.canonical_eligible is false
     and new.object_verified is false then
    update public.listing_assets assets
    set image_set_state = 'RETIRED', image_set_sha256 = null
    where assets.id = old.asset_id
      and assets.tenant_id = old.tenant_id
      and assets.image_set_state = 'FINALIZED';
  elsif new.canonical_eligible is true and v_asset.image_set_state = 'FINALIZED' then
    if tg_op = 'INSERT'
       or old.canonical_eligible is distinct from new.canonical_eligible
       or old.image_generation_id is distinct from new.image_generation_id
       or old.image_id is distinct from new.image_id
       or old.storage_role is distinct from new.storage_role
       or old.object_path is distinct from new.object_path
       or old.content_sha256 is distinct from new.content_sha256
       or old.crop_metadata is distinct from new.crop_metadata then
      raise exception using errcode = '23514', message = 'listing_image_set_already_finalized';
    end if;
  end if;

  if new.canonical_eligible is true
     and new.storage_role not in ('image_1_original', 'front_original', 'image_2_original', 'back_original') then
    select pg_catalog.count(*)::integer into v_source_count
    from public.listing_image_verifications source
    where source.tenant_id = new.tenant_id
      and source.asset_id = new.asset_id
      and source.image_generation_id = new.image_generation_id
      and source.image_id = new.crop_metadata ->> 'source_image_id'
      and source.object_path = new.crop_metadata ->> 'source_object_path'
      and source.content_sha256 = new.crop_metadata ->> 'source_content_sha256'
      and source.width = (new.crop_metadata ->> 'source_width')::numeric
      and source.height = (new.crop_metadata ->> 'source_height')::numeric
      and source.storage_role in ('image_1_original', 'front_original', 'image_2_original', 'back_original')
      and (
        (new.crop_metadata ->> 'source_side' = 'front'
          and source.storage_role in ('image_1_original', 'front_original'))
        or (new.crop_metadata ->> 'source_side' = 'back'
          and source.storage_role in ('image_2_original', 'back_original'))
      )
      and source.object_verified is true
      and source.content_hash_verified is true
      and source.canonical_eligible is true;
    if v_source_count <> 1 then
      raise exception using errcode = '23503', message = 'listing_crop_source_not_verified';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists listing_image_verifications_generation_guard on public.listing_image_verifications;
drop trigger if exists listing_image_verifications_generation_guard_insert on public.listing_image_verifications;
drop trigger if exists listing_image_verifications_generation_guard_update on public.listing_image_verifications;
drop trigger if exists listing_image_verifications_generation_guard_delete on public.listing_image_verifications;
create trigger listing_image_verifications_generation_guard_insert
before insert
on public.listing_image_verifications
for each row execute function public.enforce_listing_image_verification_generation();
create trigger listing_image_verifications_generation_guard_update
before update
on public.listing_image_verifications
for each row execute function public.enforce_listing_image_verification_generation();
create trigger listing_image_verifications_generation_guard_delete
before delete
on public.listing_image_verifications
for each row execute function public.enforce_listing_image_verification_generation();

revoke all on function public.listing_crop_metadata_is_valid(jsonb, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.enforce_listing_asset_image_manifest_immutable()
  from public, anon, authenticated;
revoke all on function public.enforce_listing_image_verification_generation()
  from public, anon, authenticated;
