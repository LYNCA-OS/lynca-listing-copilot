-- Versioned resolution policy for the source-versioned 1996-97 Stadium Club
-- High Risers Registry support. This release is additive; the v1 release
-- remains immutable for persisted replay receipts.

insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_thin_external_identity_high_risers_v2',
  'thin-path-external-identity-high-risers-v2',
  'f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2',
  'linear-cos-10-23-v25',
  '{
    "mode":"post_observation_exact_external_identity",
    "external_catalog":true,
    "pack_id":"lynca.csm.external-identity",
    "pack_version":"2026-08-10",
    "index_id":"basketball.1996-97-topps-stadium-club-high-risers",
    "pack_sha256":"f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
    "index_sha256":"984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
    "resolution_contract_sha256":"407f69668256c799b0beeae8bd9dbdbe3073f86b6f6367c8216417973d6b691f",
    "provider_calls_added":0
  }'::jsonb,
  'migration:20260810200000',
  '2026-08-09T19:40:00Z'::timestamptz
)
on conflict (id) do nothing;
do $external_identity_registry_v2_contract$
begin
  if not exists (
    select 1
    from public.csm_registry_releases
    where id = 'registry_thin_external_identity_high_risers_v2'
      and registry_version = 'thin-path-external-identity-high-risers-v2'
      and content_sha256 = 'f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2'
      and sem_standard_version = 'linear-cos-10-23-v25'
      and promoted_by = 'migration:20260810200000'
      and promoted_at = '2026-08-09T19:40:00Z'::timestamptz
      and registry_payload = '{
        "mode":"post_observation_exact_external_identity",
        "external_catalog":true,
        "pack_id":"lynca.csm.external-identity",
        "pack_version":"2026-08-10",
        "index_id":"basketball.1996-97-topps-stadium-club-high-risers",
        "pack_sha256":"f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
        "index_sha256":"984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
        "resolution_contract_sha256":"407f69668256c799b0beeae8bd9dbdbe3073f86b6f6367c8216417973d6b691f",
        "provider_calls_added":0
      }'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_external_identity_registry_v2_contract_mismatch';
  end if;
end;
$external_identity_registry_v2_contract$;
