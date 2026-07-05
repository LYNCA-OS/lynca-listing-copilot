drop index if exists public.catalog_import_staging_review_fields_gin_idx;
drop index if exists public.catalog_import_staging_source_type_status_idx;
drop index if exists public.catalog_sources_raw_checksum_idx;

alter table public.catalog_sources drop constraint if exists catalog_sources_source_type_check;
alter table public.catalog_sources add constraint catalog_sources_source_type_check
  check (source_type in (
    'INTERNAL_CORRECTED_TITLE',
    'TOPPS_OFFICIAL_CHECKLIST',
    'PANINI_OFFICIAL_CHECKLIST',
    'UPPER_DECK_OFFICIAL_CHECKLIST',
    'LEAF_OFFICIAL_CHECKLIST'
  ));

alter table public.catalog_sources drop constraint if exists catalog_sources_source_status_check;
alter table public.catalog_sources add constraint catalog_sources_source_status_check
  check (source_status in (
    'VERIFIED_CANONICAL_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'REVIEWED_INTERNAL',
    'REVIEW_REQUIRED'
  ));

alter table public.catalog_import_staging drop constraint if exists catalog_import_staging_import_status_check;
alter table public.catalog_import_staging add constraint catalog_import_staging_import_status_check
  check (import_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'REVIEW_REQUIRED',
    'READY_CANDIDATE',
    'REVIEWED_INTERNAL',
    'REJECTED'
  ));

alter table public.catalog_products drop constraint if exists catalog_products_source_status_check;
alter table public.catalog_products add constraint catalog_products_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_sets drop constraint if exists catalog_sets_source_status_check;
alter table public.catalog_sets add constraint catalog_sets_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_cards drop constraint if exists catalog_cards_source_status_check;
alter table public.catalog_cards add constraint catalog_cards_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_parallels drop constraint if exists catalog_parallels_source_status_check;
alter table public.catalog_parallels add constraint catalog_parallels_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_import_staging
  drop column if exists source_title,
  drop column if exists source_url,
  drop column if exists raw_checksum,
  drop column if exists source_trust,
  drop column if exists source_type,
  drop column if exists review_required_fields,
  drop column if exists field_status_by_name,
  drop column if exists parsed_fields,
  drop column if exists raw_text;

alter table public.catalog_sources
  drop column if exists parser_version,
  drop column if exists source_scope,
  drop column if exists source_trust,
  drop column if exists raw_checksum;
