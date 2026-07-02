alter table public.catalog_sources drop constraint if exists catalog_sources_source_type_check;
alter table public.catalog_sources add constraint catalog_sources_source_type_check
  check (source_type in (
    'INTERNAL_CORRECTED_TITLE',
    'TOPPS_OFFICIAL_CHECKLIST',
    'PANINI_OFFICIAL_CHECKLIST',
    'UPPER_DECK_OFFICIAL_CHECKLIST',
    'LEAF_OFFICIAL_CHECKLIST',
    'LEAF_OFFICIAL_RELEASE',
    'FUTERA_OFFICIAL_CHECKLIST',
    'OFFICIAL_RELEASE_PAGE',
    'OFFICIAL_DIGITAL_LIBRARY',
    'LICENSED_EXTERNAL_DIRECTORY',
    'MARKETPLACE_REFERENCE'
  ));

alter table public.catalog_sources drop constraint if exists catalog_sources_source_status_check;
alter table public.catalog_sources add constraint catalog_sources_source_status_check
  check (source_status in (
    'VERIFIED_CANONICAL_TITLE',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_SOURCE_DISCOVERED',
    'RAW_IMPORTED',
    'RAW_TEXT_EXTRACTED',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_CHECKLIST_CONFIRMED',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEWED_INTERNAL',
    'REVIEW_REQUIRED'
  ));

alter table public.catalog_import_staging drop constraint if exists catalog_import_staging_import_status_check;
alter table public.catalog_import_staging add constraint catalog_import_staging_import_status_check
  check (import_status in (
    'OFFICIAL_SOURCE_DISCOVERED',
    'RAW_IMPORTED',
    'RAW_TEXT_EXTRACTED',
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_CHECKLIST_CONFIRMED',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'READY_CANDIDATE',
    'REVIEWED_INTERNAL',
    'REJECTED'
  ));

alter table public.catalog_products drop constraint if exists catalog_products_source_status_check;
alter table public.catalog_products add constraint catalog_products_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_sets drop constraint if exists catalog_sets_source_status_check;
alter table public.catalog_sets add constraint catalog_sets_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_cards drop constraint if exists catalog_cards_source_status_check;
alter table public.catalog_cards add constraint catalog_cards_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

alter table public.catalog_parallels drop constraint if exists catalog_parallels_source_status_check;
alter table public.catalog_parallels add constraint catalog_parallels_source_status_check
  check (source_status in (
    'AUTO_PARSED_FROM_VERIFIED_TITLE',
    'AUTO_PARSED_FROM_OFFICIAL_CHECKLIST',
    'TOPPS_OFFICIAL_RAW',
    'OFFICIAL_CHECKLIST_RAW',
    'OFFICIAL_CHECKLIST_CANDIDATE',
    'OFFICIAL_RELEASE_SUPPORT',
    'OFFICIAL_RELEASE_METADATA',
    'OFFICIAL_PARSE_REVIEW_REQUIRED',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));
