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
    'PARKSIDE_OFFICIAL_RELEASE',
    'ONIT_OFFICIAL_RELEASE',
    'SMALL_MANUFACTURER_OFFICIAL_RELEASE',
    'BANDAI_ONE_PIECE_OFFICIAL_CARDLIST',
    'BANDAI_DIGIMON_OFFICIAL_CARDLIST',
    'BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE',
    'BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE',
    'BANDAI_UNION_ARENA_OFFICIAL_CARDLIST',
    'BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST',
    'BANDAI_GENERIC_OFFICIAL_CARDLIST',
    'POKEMON_OFFICIAL_CARD_SEARCH',
    'POKEMON_TCG_COMMUNITY_API',
    'WOTC_GATHERER_OFFICIAL_DATABASE',
    'SCRYFALL_COMMUNITY_API',
    'KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE',
    'YGOPRODECK_COMMUNITY_API',
    'LORCANA_OFFICIAL_CARD_DATABASE',
    'LORCANA_COMMUNITY_API',
    'STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST',
    'FAB_OFFICIAL_CARD_DATABASE',
    'BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST',
    'BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST',
    'BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST',
    'GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE',
    'ALTERED_OFFICIAL_CARD_DATABASE',
    'OFFICIAL_RELEASE_PAGE',
    'OFFICIAL_DIGITAL_LIBRARY',
    'LICENSED_EXTERNAL_DIRECTORY',
    'EXTERNAL_DIRECTORY_WEAK',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
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
    'EXTERNAL_DIRECTORY_CANDIDATE',
    'COMMUNITY_API_CANDIDATE',
    'REVIEW_REQUIRED',
    'REVIEWED_INTERNAL'
  ));

comment on constraint catalog_sources_source_type_check on public.catalog_sources is
  'Multi-source catalog importer v0 source allowlist. All non-internal rows remain staging/candidate support until reviewed.';

comment on constraint catalog_import_staging_import_status_check on public.catalog_import_staging is
  'Import staging supports official, community, and weak external candidates. It does not promote to REVIEWED_INTERNAL automatically.';
