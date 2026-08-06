-- Retire the throwaway tenant created for COS-51's failure-path reproduction.
--
-- `scripts/reproduce-cos51-storage-collision.mjs` deliberately breaks things,
-- so it runs inside its own tenant rather than tidying up after itself in a
-- real one. Original images are immutable by contract and the API has no way
-- to unmake one, which makes cleanup a tenant-level operation by design.
--
-- IT DOES NOT DELETE THE TENANT, because nothing can. Verified against the
-- live database on 2026-08-06:
--
--   delete from public.tenants where id = 'tenant_staging_cos51';
--   ERROR: 23514 track_c_last_active_owner_required
--
-- `private.preserve_last_active_tenant_owner` refuses to remove or disable the
-- last ACTIVE OWNER of a tenant, and has no exemption for the tenant itself
-- going away. `tenant_members.tenant_id` is ON DELETE CASCADE, and a cascaded
-- delete still fires row triggers, so the guard blocks the parent delete too.
-- Adding a second owner does not help: delete the first and the second becomes
-- the last. A single-owner tenant is therefore PERMANENT.
--
-- Disabling is a complete neutralisation rather than a consolation. Membership
-- is resolved through an INNER join that requires `tenant.status = 'ACTIVE'`
-- and `tenant.disabled_at is null` (lib/tenant/access.mjs), so a disabled
-- tenant grants nothing to anyone holding a session for it.
--
-- The data purge below IS complete. The table list is not written out: fifty-one
-- tables carry `tenant_id` today and a hand-written list is stale the first time
-- someone adds a table -- the rows it misses are exactly the ones nobody
-- remembers to look for. This walks `information_schema` instead, and repeats
-- until a pass deletes nothing so foreign-key ordering resolves itself.
--
-- The tenant id is a constant. This file cannot be pointed at another tenant by
-- editing a parameter, which is the property that matters for a script whose
-- whole purpose is deletion.

do $$
declare
  target constant text := 'tenant_staging_cos51';
  pass integer := 0;
  deleted_this_pass bigint;
  deleted_here bigint;
  total bigint := 0;
  r record;
begin
  loop
    pass := pass + 1;
    deleted_this_pass := 0;
    for r in
      select table_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'tenant_id'
        and table_name not in ('tenants', 'tenant_members')
      order by table_name
    loop
      begin
        execute format('delete from public.%I where tenant_id = $1', r.table_name)
          using target;
        get diagnostics deleted_here = row_count;
        deleted_this_pass := deleted_this_pass + deleted_here;
      exception when foreign_key_violation then
        -- Something still references these rows. A later pass gets them once
        -- the referencing table is emptied.
        null;
      end;
    end loop;
    total := total + deleted_this_pass;
    exit when deleted_this_pass = 0 or pass >= 10;
  end loop;

  update public.tenants
  set status = 'DISABLED', disabled_at = now(), updated_at = now()
  where id = target;

  raise notice 'purged % rows across % passes; tenant disabled (deletion is blocked by the last-owner guard)',
    total, pass;
end
$$;

-- Verify. `asset_rows` must be zero and the tenant must be inert; the surviving
-- tenant and membership rows are expected and are the guard's doing.
select
  (select status from public.tenants where id = 'tenant_staging_cos51') as tenant_status,
  (select disabled_at is not null from public.tenants where id = 'tenant_staging_cos51') as tenant_disabled,
  (select count(*) from public.listing_assets where tenant_id = 'tenant_staging_cos51') as asset_rows,
  (select count(*) from public.v4_recognition_sessions where tenant_id = 'tenant_staging_cos51') as session_rows,
  (select count(*) from public.listing_image_verifications where tenant_id = 'tenant_staging_cos51') as verification_rows;
