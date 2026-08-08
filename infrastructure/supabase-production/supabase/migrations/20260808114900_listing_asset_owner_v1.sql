-- Immutable owner for the durable asset root. Recognition sessions are not a
-- sufficient authority: integrated ingest deliberately defers its session
-- until after Storage, so a provider failure can leave a durable asset with no
-- session. The authenticated creator is therefore recorded at asset creation.

alter table public.listing_assets
  add column if not exists owner_user_id text;

-- Historical compatibility is evidence-only. Backfill solely where every
-- persisted session for the tenant/asset names one and the same non-empty user.
-- Ambiguous or sessionless assets remain NULL and fail closed for assigned-
-- scope roles; tenant Owners retain their explicit tenant-wide permission.
with session_owner_evidence as (
  select
    tenant_id,
    asset_id,
    coalesce(
      nullif(btrim(user_id), ''),
      nullif(btrim(operator_id), ''),
      nullif(btrim(created_by_user_id), '')
    ) as owner_user_id
  from public.v4_recognition_sessions
  where nullif(btrim(tenant_id), '') is not null
    and nullif(btrim(asset_id), '') is not null
),
unambiguous_owner as (
  select tenant_id, asset_id, min(owner_user_id) as owner_user_id
  from session_owner_evidence
  group by tenant_id, asset_id
  -- Missing identity on even one persisted session is not positive ownership
  -- evidence. Do not discard that row and accidentally turn partial evidence
  -- into an authoritative assignment.
  having count(*) = count(owner_user_id)
     and count(distinct owner_user_id) = 1
)
update public.listing_assets asset
set owner_user_id = owner.owner_user_id
from unambiguous_owner owner
where asset.owner_user_id is null
  and asset.tenant_id = owner.tenant_id
  and asset.id = owner.asset_id;

alter table public.listing_assets
  drop constraint if exists listing_assets_owner_user_id_nonempty,
  add constraint listing_assets_owner_user_id_nonempty
    check (owner_user_id is null or nullif(btrim(owner_user_id), '') is not null)
    not valid;
alter table public.listing_assets
  validate constraint listing_assets_owner_user_id_nonempty;

create index if not exists listing_assets_tenant_owner_idx
  on public.listing_assets (tenant_id, owner_user_id, id)
  where owner_user_id is not null;

create or replace function public.guard_listing_asset_owner_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.owner_user_id is not null
     and new.owner_user_id is distinct from old.owner_user_id then
    raise exception using errcode = '23514', message = 'listing_asset_owner_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_listing_asset_owner_immutable_v1() from public, anon, authenticated;

drop trigger if exists listing_assets_owner_immutable_v1 on public.listing_assets;
create trigger listing_assets_owner_immutable_v1
before update of owner_user_id on public.listing_assets
for each row execute function public.guard_listing_asset_owner_immutable_v1();

comment on column public.listing_assets.owner_user_id is
  'Authenticated creator and assigned-scope authority for this durable asset. Immutable once set; NULL only for unresolved legacy ownership.';
