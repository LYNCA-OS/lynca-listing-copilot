-- Database-side canonical image-set finalization. The existing atomic enqueue
-- RPC remains the single transaction boundary; these guards independently
-- rebuild its image identity from durable verification rows and reject any
-- client/session/job projection that is not an exact match.

set lock_timeout = '5s';
set statement_timeout = '5min';

create or replace function public.canonical_listing_asset_image_set(
  p_tenant_id text,
  p_asset_id text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_asset public.listing_assets%rowtype;
  v_original_count integer;
  v_present_slots integer;
  v_references jsonb;
  v_hash_input text;
  v_hash text;
begin
  select assets.* into v_asset
  from public.listing_assets assets
  where assets.tenant_id = p_tenant_id
    and assets.id = p_asset_id;
  if not found
     or v_asset.image_generation_id is distinct from p_asset_id
     or v_asset.expected_original_count not in (1, 2)
     or v_asset.image_set_state in ('LEGACY_INELIGIBLE', 'RETIRED') then
    raise exception using errcode = '23514', message = 'verified_image_set_manifest_invalid';
  end if;

  select
    pg_catalog.count(*) filter (
      where verification.storage_role in (
        'image_1_original', 'front_original', 'image_2_original', 'back_original'
      )
    )::integer,
    pg_catalog.count(distinct case
      when verification.storage_role in ('image_1_original', 'front_original') then 1
      when verification.storage_role in ('image_2_original', 'back_original') then 2
      else null
    end)::integer
  into v_original_count, v_present_slots
  from public.listing_image_verifications verification
  where verification.tenant_id = p_tenant_id
    and verification.asset_id = p_asset_id
    and verification.image_generation_id = p_asset_id
    and verification.object_verified is true
    and verification.content_hash_verified is true
    and verification.canonical_eligible is true;

  if v_original_count is distinct from v_asset.expected_original_count
     or v_present_slots is distinct from v_asset.expected_original_count
     or (v_asset.expected_original_count = 1 and not exists (
       select 1 from public.listing_image_verifications verification
       where verification.tenant_id = p_tenant_id
         and verification.asset_id = p_asset_id
         and verification.image_generation_id = p_asset_id
         and verification.canonical_eligible is true
         and verification.storage_role in ('image_1_original', 'front_original')
     )) then
    raise exception using errcode = '23514', message = 'verified_image_set_incomplete';
  end if;

  with canonical as (
    select
      verification.image_id,
      case
        when verification.storage_role in ('image_1_original', 'front_original') then 'front_original'
        when verification.storage_role in ('image_2_original', 'back_original') then 'back_original'
        else verification.storage_role
      end as image_role,
      verification.bucket,
      verification.object_path,
      verification.content_sha256,
      verification.storage_role not in (
        'image_1_original', 'front_original', 'image_2_original', 'back_original'
      ) as derived,
      verification.crop_metadata ->> 'source_image_id' as source_image_id,
      verification.crop_metadata ->> 'source_region' as source_region,
      verification.crop_metadata,
      case
        when verification.storage_role in ('image_1_original', 'front_original') then 0
        when verification.storage_role in ('image_2_original', 'back_original') then 1
        else 2
      end as role_order
    from public.listing_image_verifications verification
    where verification.tenant_id = p_tenant_id
      and verification.asset_id = p_asset_id
      and verification.image_generation_id = p_asset_id
      and verification.object_verified is true
      and verification.content_hash_verified is true
      and verification.canonical_eligible is true
  )
  select
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'image_id', canonical.image_id,
        'image_role', canonical.image_role,
        'bucket', canonical.bucket,
        'object_path', canonical.object_path,
        'content_sha256', canonical.content_sha256,
        'derived', canonical.derived,
        'source_image_id', canonical.source_image_id,
        'source_region', canonical.source_region,
        'crop_metadata', canonical.crop_metadata
      ) order by canonical.role_order, canonical.image_id, canonical.object_path
    ), '[]'::jsonb),
    coalesce(pg_catalog.string_agg(
      pg_catalog.concat_ws(
        pg_catalog.chr(31),
        coalesce(canonical.image_role, ''),
        coalesce(canonical.image_id, ''),
        coalesce(canonical.bucket, ''),
        coalesce(canonical.object_path, ''),
        coalesce(canonical.content_sha256, ''),
        coalesce(canonical.source_image_id, ''),
        coalesce(canonical.source_region, '')
      ),
      pg_catalog.chr(30)
      order by canonical.role_order, canonical.image_id, canonical.object_path
    ), '')
  into v_references, v_hash_input
  from canonical;

  if pg_catalog.jsonb_array_length(v_references) < v_asset.expected_original_count then
    raise exception using errcode = '23514', message = 'verified_image_set_incomplete';
  end if;
  v_hash := pg_catalog.encode(extensions.digest(v_hash_input, 'sha256'), 'hex');
  return pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'asset_id', p_asset_id,
    'image_generation_id', p_asset_id,
    'expected_original_count', v_asset.expected_original_count,
    'image_set_sha256', v_hash,
    'image_references', v_references
  );
end;
$$;

create or replace function public.enforce_listing_asset_canonical_projection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_set jsonb;
  v_front jsonb;
  v_back jsonb;
  v_additional jsonb;
begin
  v_set := public.canonical_listing_asset_image_set(new.tenant_id, new.id);
  select reference into v_front
  from pg_catalog.jsonb_array_elements(v_set -> 'image_references') reference
  where reference ->> 'image_role' = 'front_original'
  limit 1;
  select reference into v_back
  from pg_catalog.jsonb_array_elements(v_set -> 'image_references') reference
  where reference ->> 'image_role' = 'back_original'
  limit 1;
  select coalesce(pg_catalog.jsonb_agg(reference order by reference ->> 'object_path'), '[]'::jsonb)
  into v_additional
  from pg_catalog.jsonb_array_elements(v_set -> 'image_references') reference
  where reference ->> 'image_role' not in ('front_original', 'back_original');

  if new.front_object_path is distinct from nullif(v_front ->> 'object_path', '')
     or new.back_object_path is distinct from nullif(v_back ->> 'object_path', '')
     or coalesce(new.additional_image_paths, '[]'::jsonb) is distinct from v_additional then
    raise exception using errcode = '23505', message = 'root_listing_asset_image_set_conflict';
  end if;
  new.front_content_sha256 := nullif(v_front ->> 'content_sha256', '');
  new.back_content_sha256 := nullif(v_back ->> 'content_sha256', '');
  new.image_set_sha256 := v_set ->> 'image_set_sha256';
  new.image_set_state := 'FINALIZED';
  return new;
end;
$$;

drop trigger if exists listing_assets_canonical_projection_guard on public.listing_assets;
create trigger listing_assets_canonical_projection_guard
before update of front_object_path, back_object_path, additional_image_paths
on public.listing_assets
for each row execute function public.enforce_listing_asset_canonical_projection();

create or replace function public.enforce_v4_session_canonical_image_set()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_set jsonb;
begin
  v_set := public.canonical_listing_asset_image_set(new.tenant_id, new.asset_id);
  if pg_catalog.jsonb_typeof(new.identity_snapshot) <> 'object'
     or new.identity_snapshot -> 'image_references' is distinct from v_set -> 'image_references'
     or nullif(new.identity_snapshot ->> 'image_generation_id', '') is distinct from v_set ->> 'image_generation_id'
     or nullif(new.identity_snapshot ->> 'image_set_sha256', '') is distinct from v_set ->> 'image_set_sha256'
     or nullif(new.identity_snapshot ->> 'expected_original_count', '')::integer
        is distinct from (v_set ->> 'expected_original_count')::integer then
    raise exception using errcode = '23505', message = 'session_verified_image_set_conflict';
  end if;
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '23505', message = 'session_verified_image_set_conflict';
end;
$$;

drop trigger if exists v4_recognition_sessions_canonical_image_set_guard on public.v4_recognition_sessions;
drop trigger if exists v4_recognition_sessions_canonical_image_set_guard_insert on public.v4_recognition_sessions;
drop trigger if exists v4_recognition_sessions_canonical_image_set_guard_update on public.v4_recognition_sessions;
create trigger v4_recognition_sessions_canonical_image_set_guard_insert
before insert
on public.v4_recognition_sessions
for each row execute function public.enforce_v4_session_canonical_image_set();
create trigger v4_recognition_sessions_canonical_image_set_guard_update
before update of tenant_id, asset_id, identity_snapshot
on public.v4_recognition_sessions
for each row execute function public.enforce_v4_session_canonical_image_set();

create or replace function public.enforce_v4_job_canonical_image_set()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_set jsonb;
begin
  v_set := public.canonical_listing_asset_image_set(new.tenant_id, new.asset_id);
  if pg_catalog.jsonb_typeof(new.payload) <> 'object'
     or new.payload -> 'image_references' is distinct from v_set -> 'image_references'
     or nullif(new.payload ->> 'image_generation_id', '') is distinct from v_set ->> 'image_generation_id'
     or nullif(new.payload ->> 'image_set_sha256', '') is distinct from v_set ->> 'image_set_sha256'
     or nullif(new.payload ->> 'expected_original_count', '')::integer
        is distinct from (v_set ->> 'expected_original_count')::integer then
    raise exception using errcode = '23505', message = 'job_verified_image_set_conflict';
  end if;
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '23505', message = 'job_verified_image_set_conflict';
end;
$$;

drop trigger if exists v4_recognition_jobs_canonical_image_set_guard on public.v4_recognition_jobs;
drop trigger if exists v4_recognition_jobs_canonical_image_set_guard_insert on public.v4_recognition_jobs;
drop trigger if exists v4_recognition_jobs_canonical_image_set_guard_update on public.v4_recognition_jobs;
create trigger v4_recognition_jobs_canonical_image_set_guard_insert
before insert
on public.v4_recognition_jobs
for each row execute function public.enforce_v4_job_canonical_image_set();
create trigger v4_recognition_jobs_canonical_image_set_guard_update
before update of tenant_id, asset_id, payload
on public.v4_recognition_jobs
for each row execute function public.enforce_v4_job_canonical_image_set();

revoke all on function public.canonical_listing_asset_image_set(text, text)
  from public, anon, authenticated;
grant execute on function public.canonical_listing_asset_image_set(text, text)
  to service_role;
revoke all on function public.enforce_listing_asset_canonical_projection()
  from public, anon, authenticated;
revoke all on function public.enforce_v4_session_canonical_image_set()
  from public, anon, authenticated;
revoke all on function public.enforce_v4_job_canonical_image_set()
  from public, anon, authenticated;
