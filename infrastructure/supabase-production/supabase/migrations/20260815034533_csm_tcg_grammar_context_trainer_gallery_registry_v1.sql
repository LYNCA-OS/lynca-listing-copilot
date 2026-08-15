-- Closed-set TCG Grammar context authority for Pokemon Trainer Gallery card
-- numbers TG1..TG30/TG30. Additive and rollback-safe: the existing local SEM
-- and external-identity Registry releases remain immutable.

insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_tcg_grammar_context_trainer_gallery_v1',
  'tcg-grammar-context-trainer-gallery-v1',
  'f883fbbb643e2b2b88d70b4bbde1dbe2657e37367a7fad6f0adaf68cb825de41',
  'linear-cos-10-23-v25',
  '{
    "mode":"grammar_context_closed_transition",
    "external_catalog":false,
    "registry_schema_version":"tcg-grammar-context-registry.v1",
    "registry_content_sha256":"f883fbbb643e2b2b88d70b4bbde1dbe2657e37367a7fad6f0adaf68cb825de41",
    "policy_version":"tcg-grammar-context-policy-v1",
    "normalization_version":"tcg-grammar-context-normalization-v1",
    "decision_document_sha256":"e3bdcbee1b37c17fda2446b1f877ee652b230b35e9e089290433c50410b63705",
    "resolution_contract_schema_version":"tcg-grammar-context-resolution-contract.v1",
    "resolution_contract_sha256":"8453fc8cb395da8708874baad69dd06924bee21a33f62b6e1926a0bd0f2cca06",
    "field_source_authority_receipt_schema_version":"tcg-field-source-authority-receipt.v1",
    "grammar_context_claim_receipt_schema_version":"tcg-grammar-context-claim-receipt.v1",
    "provider_calls_added":0
  }'::jsonb,
  'migration:20260815034533',
  '2026-08-15T03:45:33Z'::timestamptz
)
on conflict (id) do nothing;

do $tcg_grammar_context_registry_contract$
begin
  if not exists (
    select 1
    from public.csm_registry_releases
    where id = 'registry_tcg_grammar_context_trainer_gallery_v1'
      and registry_version = 'tcg-grammar-context-trainer-gallery-v1'
      and content_sha256 = 'f883fbbb643e2b2b88d70b4bbde1dbe2657e37367a7fad6f0adaf68cb825de41'
      and sem_standard_version = 'linear-cos-10-23-v25'
      and promoted_by = 'migration:20260815034533'
      and promoted_at = '2026-08-15T03:45:33Z'::timestamptz
      and registry_payload = '{
        "mode":"grammar_context_closed_transition",
        "external_catalog":false,
        "registry_schema_version":"tcg-grammar-context-registry.v1",
        "registry_content_sha256":"f883fbbb643e2b2b88d70b4bbde1dbe2657e37367a7fad6f0adaf68cb825de41",
        "policy_version":"tcg-grammar-context-policy-v1",
        "normalization_version":"tcg-grammar-context-normalization-v1",
        "decision_document_sha256":"e3bdcbee1b37c17fda2446b1f877ee652b230b35e9e089290433c50410b63705",
        "resolution_contract_schema_version":"tcg-grammar-context-resolution-contract.v1",
        "resolution_contract_sha256":"8453fc8cb395da8708874baad69dd06924bee21a33f62b6e1926a0bd0f2cca06",
        "field_source_authority_receipt_schema_version":"tcg-field-source-authority-receipt.v1",
        "grammar_context_claim_receipt_schema_version":"tcg-grammar-context-claim-receipt.v1",
        "provider_calls_added":0
      }'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_tcg_grammar_context_registry_contract_mismatch';
  end if;
end;
$tcg_grammar_context_registry_contract$;
