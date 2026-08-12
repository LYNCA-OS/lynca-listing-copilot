-- Source-versioned external identity support for the 1996-97 Stadium Club
-- High Risers checklist. Additive and rollback-safe: the existing local-only
-- Registry release remains untouched for baseline/no-match runs.

insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_thin_external_identity_high_risers_v1',
  'thin-path-external-identity-high-risers-v1',
  'f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2',
  'linear-cos-10-23-v25',
  '{
    "mode":"post_observation_exact_external_identity",
    "external_catalog":true,
    "pack_id":"lynca.csm.external-identity",
    "pack_version":"2026-08-10",
    "pack_sha256":"f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
    "index_id":"basketball.1996-97-topps-stadium-club-high-risers",
    "index_sha256":"984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
    "resolution_contract_sha256":"e0b2e3463e8dc13f33d5ca2dbb3739b6e07c7b02f820901b4961ed83d0d945df",
    "provider_calls_added":0
  }'::jsonb,
  'migration:20260810120000',
  '2026-08-10T12:00:00Z'::timestamptz
)
on conflict (id) do nothing;
do $external_identity_registry_contract$
begin
  if not exists (
    select 1
    from public.csm_registry_releases
    where id = 'registry_thin_external_identity_high_risers_v1'
      and registry_version = 'thin-path-external-identity-high-risers-v1'
      and content_sha256 = 'f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2'
      and sem_standard_version = 'linear-cos-10-23-v25'
      and promoted_by = 'migration:20260810120000'
      and promoted_at = '2026-08-10T12:00:00Z'::timestamptz
      and registry_payload = '{
        "mode":"post_observation_exact_external_identity",
        "external_catalog":true,
        "pack_id":"lynca.csm.external-identity",
        "pack_version":"2026-08-10",
        "pack_sha256":"f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
        "index_id":"basketball.1996-97-topps-stadium-club-high-risers",
        "index_sha256":"984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
        "resolution_contract_sha256":"e0b2e3463e8dc13f33d5ca2dbb3739b6e07c7b02f820901b4961ed83d0d945df",
        "provider_calls_added":0
      }'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_external_identity_registry_contract_mismatch';
  end if;
end;
$external_identity_registry_contract$;
