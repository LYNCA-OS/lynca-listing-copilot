-- Behavior-neutral forward-reader release for the source-versioned 1996-97
-- Stadium Club High Risers Registry support. Active writes remain on v2;
-- v1/v2 stay immutable and v3 becomes readable before activation.

insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_thin_external_identity_high_risers_v3',
  'thin-path-external-identity-high-risers-v3',
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
    "resolution_contract_sha256":"14a0c6dee064019e21840b19c419495e40cbdd4b6e8a97a57fdc7ba66c25e09e",
    "provider_calls_added":0
  }'::jsonb,
  'migration:20260813221955',
  '2026-08-13T22:19:55Z'::timestamptz
)
on conflict (id) do nothing;
do $external_identity_registry_v3_contract$
begin
  if not exists (
    select 1
    from public.csm_registry_releases
    where id = 'registry_thin_external_identity_high_risers_v3'
      and registry_version = 'thin-path-external-identity-high-risers-v3'
      and content_sha256 = 'f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2'
      and sem_standard_version = 'linear-cos-10-23-v25'
      and promoted_by = 'migration:20260813221955'
      and promoted_at = '2026-08-13T22:19:55Z'::timestamptz
      and registry_payload = '{
        "mode":"post_observation_exact_external_identity",
        "external_catalog":true,
        "pack_id":"lynca.csm.external-identity",
        "pack_version":"2026-08-10",
        "index_id":"basketball.1996-97-topps-stadium-club-high-risers",
        "pack_sha256":"f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
        "index_sha256":"984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
        "resolution_contract_sha256":"14a0c6dee064019e21840b19c419495e40cbdd4b6e8a97a57fdc7ba66c25e09e",
        "provider_calls_added":0
      }'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_external_identity_registry_v3_contract_mismatch';
  end if;
end;
$external_identity_registry_v3_contract$;
