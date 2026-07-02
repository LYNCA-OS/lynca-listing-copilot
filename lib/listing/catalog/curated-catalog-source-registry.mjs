import {
  catalogSourceTypes,
  isCommunityCatalogSourceType,
  isExternalDirectoryCatalogSourceType,
  isOfficialCatalogSourceType
} from "./catalog-contract.mjs";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function providerKey(value = "") {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

export const catalogSourceQualityTiers = Object.freeze({
  REVIEWED_INTERNAL: "REVIEWED_INTERNAL",
  OFFICIAL_DEFAULT: "OFFICIAL_DEFAULT",
  OFFICIAL_DISCOVERY: "OFFICIAL_DISCOVERY",
  COMMUNITY_STRUCTURED: "COMMUNITY_STRUCTURED",
  EXPERIMENTAL_OFFICIAL: "EXPERIMENTAL_OFFICIAL",
  REJECTED: "REJECTED"
});

export const catalogSourceImportModes = Object.freeze({
  REVIEWED_INTERNAL: "reviewed_internal",
  STAGING_IMPORT: "staging_import",
  DISCOVERY_ONLY: "discovery_only",
  MANUAL_CSV_FALLBACK: "manual_csv_fallback",
  DISABLED_EXPERIMENTAL: "disabled_experimental",
  REJECTED: "rejected"
});

const sharedAllowedUsage = Object.freeze([
  "candidate_generation",
  "legality_check",
  "field_support",
  "reranker_feature",
  "catalog_gap_discovery"
]);

const sharedForbiddenUsage = Object.freeze([
  "reviewed_internal_auto_promotion",
  "final_title_truth",
  "serial_numerator",
  "grade",
  "cert_number",
  "condition",
  "market_price_truth"
]);

function source({
  provider,
  label,
  source_type,
  segments = [],
  games = [],
  default_index_url = "",
  kind = "checklist_discovery",
  quality_tier = catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
  import_mode = catalogSourceImportModes.DISCOVERY_ONLY,
  default_enabled = false,
  prompt_eligible_by_default = false,
  manual_csv_fallback = true,
  parser_strategy = "generic_official_text",
  aliases = [],
  notes = "",
  allowed_usage = sharedAllowedUsage,
  forbidden_usage = sharedForbiddenUsage
}) {
  return Object.freeze({
    provider: providerKey(provider),
    label,
    source_type,
    segments: Object.freeze(segments),
    games: Object.freeze(games),
    default_index_url,
    kind,
    quality_tier,
    import_mode,
    default_enabled,
    prompt_eligible_by_default,
    manual_csv_fallback,
    parser_strategy,
    aliases: Object.freeze(aliases.map(providerKey)),
    allowed_usage: Object.freeze([...allowed_usage]),
    forbidden_usage: Object.freeze([...forbidden_usage]),
    staging_only: quality_tier !== catalogSourceQualityTiers.REVIEWED_INTERNAL,
    reviewed_internal_auto_promotion: false,
    external_title_final_title_allowed: false,
    physical_instance_fields_allowed: false,
    notes
  });
}

export const curatedCatalogSources = Object.freeze([
  source({
    provider: "internal_corrected_title",
    label: "Reviewed Internal Corrected Titles",
    source_type: catalogSourceTypes.INTERNAL_CORRECTED_TITLE,
    segments: ["sports", "tcg", "entertainment"],
    quality_tier: catalogSourceQualityTiers.REVIEWED_INTERNAL,
    import_mode: catalogSourceImportModes.REVIEWED_INTERNAL,
    default_enabled: true,
    prompt_eligible_by_default: true,
    manual_csv_fallback: false,
    parser_strategy: "reviewed_internal",
    allowed_usage: Object.freeze([
      "reviewed_ground_truth",
      "candidate_generation",
      "field_lock",
      "reranker_feature",
      "reference_promotion"
    ]),
    forbidden_usage: Object.freeze([
      "serial_numerator_from_identity",
      "grade_from_identity",
      "cert_number_from_identity",
      "condition_from_identity"
    ]),
    notes: "Only user-reviewed internal titles and approved references can become catalog truth."
  }),

  source({
    provider: "topps",
    label: "Topps / Fanatics Official Checklists",
    source_type: catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST,
    segments: ["sports", "entertainment"],
    games: ["baseball", "basketball", "football", "soccer", "wwe", "ufc", "star_wars", "marvel"],
    default_index_url: "https://www.topps.com/pages/checklists",
    kind: "checklist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    manual_csv_fallback: false,
    parser_strategy: "topps_checklist"
  }),
  source({
    provider: "panini",
    label: "Panini America Official Checklists",
    source_type: catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST,
    segments: ["sports"],
    games: ["basketball", "football", "soccer", "baseball", "racing"],
    default_index_url: "https://www.paniniamerica.net/checklist.html",
    kind: "checklist_discovery",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_checklist_discovery",
    aliases: ["panini_america"]
  }),
  source({
    provider: "upper_deck",
    label: "Upper Deck Product Checklists",
    source_type: catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST,
    segments: ["sports", "entertainment"],
    games: ["hockey", "golf", "entertainment"],
    default_index_url: "https://www.upperdeckepack.com/Checklists",
    kind: "checklist_discovery",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_checklist_discovery",
    aliases: ["upperdeck"]
  }),
  source({
    provider: "leaf",
    label: "Leaf Official Releases / Catalog",
    source_type: catalogSourceTypes.LEAF_OFFICIAL_RELEASE,
    segments: ["sports", "entertainment", "celebrity"],
    default_index_url: "https://leaftradingcards.com",
    kind: "release",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: false,
    parser_strategy: "official_release_metadata",
    aliases: ["leaf_trading_cards"]
  }),
  source({
    provider: "futera",
    label: "Futera Official Checklists",
    source_type: catalogSourceTypes.FUTERA_OFFICIAL_CHECKLIST,
    segments: ["sports"],
    games: ["soccer"],
    default_index_url: "https://www.futera.com",
    kind: "checklist_discovery",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true
  }),
  source({
    provider: "parkside",
    label: "Parkside Official Releases",
    source_type: catalogSourceTypes.PARKSIDE_OFFICIAL_RELEASE,
    segments: ["sports"],
    games: ["soccer", "womens_sports"],
    default_index_url: "https://www.parksidecards.com",
    kind: "release",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: false,
    parser_strategy: "official_release_metadata"
  }),
  source({
    provider: "onit",
    label: "ONIT Official Releases",
    source_type: catalogSourceTypes.ONIT_OFFICIAL_RELEASE,
    segments: ["sports"],
    games: ["college_athletics"],
    default_index_url: "https://onitathlete.com",
    kind: "release",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: false,
    parser_strategy: "official_release_metadata"
  }),

  source({
    provider: "one_piece",
    label: "Bandai One Piece Official Card List",
    source_type: catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["one_piece"],
    default_index_url: "https://en.onepiece-cardgame.com/cardlist/",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["bandai_one_piece"]
  }),
  source({
    provider: "digimon",
    label: "Bandai Digimon Official Card List",
    source_type: catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["digimon"],
    default_index_url: "https://world.digimoncard.com/cardlist/?search=true",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["bandai_digimon"]
  }),
  source({
    provider: "dragon_ball_fusion_world",
    label: "Dragon Ball Super Fusion World Official Card Database",
    source_type: catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["dragon_ball_super_fusion_world"],
    default_index_url: "https://www.dbs-cardgame.com/fw/en/cardlist/",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["dbfw", "dbs_fusion_world"]
  }),
  source({
    provider: "dragon_ball_masters",
    label: "Dragon Ball Super Masters Official Card Database",
    source_type: catalogSourceTypes.BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["dragon_ball_super_masters"],
    default_index_url: "https://www.dbs-cardgame.com/us-en/cardlist/",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["dbs_masters", "dragon_ball_super_masters"]
  }),
  source({
    provider: "union_arena",
    label: "Bandai Union Arena Official Card List",
    source_type: catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["union_arena"],
    default_index_url: "https://www.unionarena-tcg.com/na/cardlist/",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["bandai_union_arena"]
  }),
  source({
    provider: "battle_spirits",
    label: "Bandai Battle Spirits Official Card List",
    source_type: catalogSourceTypes.BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["battle_spirits"],
    default_index_url: "https://battlespirits-saga.com/cards/",
    kind: "bandai_cardlist",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "bandai_cardlist",
    aliases: ["battle_spirits_saga", "bandai_battle_spirits"]
  }),

  source({
    provider: "pokemon_official",
    label: "Pokemon Official Card Search",
    source_type: catalogSourceTypes.POKEMON_OFFICIAL_CARD_SEARCH,
    segments: ["tcg"],
    games: ["pokemon"],
    default_index_url: "https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery"
  }),
  source({
    provider: "pokemon_tcg_api",
    label: "Pokemon TCG Community API",
    source_type: catalogSourceTypes.POKEMON_TCG_COMMUNITY_API,
    segments: ["tcg"],
    games: ["pokemon"],
    default_index_url: "https://api.pokemontcg.io/v2/cards",
    kind: "pokemon_tcg_api",
    quality_tier: catalogSourceQualityTiers.COMMUNITY_STRUCTURED,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: false,
    manual_csv_fallback: false,
    parser_strategy: "pokemon_tcg_api",
    aliases: ["pokemon"]
  }),
  source({
    provider: "wotc_gatherer",
    label: "Wizards Gatherer Official Database",
    source_type: catalogSourceTypes.WOTC_GATHERER_OFFICIAL_DATABASE,
    segments: ["tcg"],
    games: ["magic_the_gathering"],
    default_index_url: "https://gatherer.wizards.com/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery",
    aliases: ["gatherer", "wotc"]
  }),
  source({
    provider: "scryfall",
    label: "Scryfall Community API",
    source_type: catalogSourceTypes.SCRYFALL_COMMUNITY_API,
    segments: ["tcg"],
    games: ["magic_the_gathering"],
    default_index_url: "https://api.scryfall.com/cards/search",
    kind: "scryfall_api",
    quality_tier: catalogSourceQualityTiers.COMMUNITY_STRUCTURED,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: false,
    manual_csv_fallback: false,
    parser_strategy: "scryfall_api",
    aliases: ["mtg", "magic"]
  }),
  source({
    provider: "konami_yugioh",
    label: "Konami Yu-Gi-Oh! Official Card Database",
    source_type: catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["yugioh"],
    default_index_url: "https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=1&request_locale=en",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery",
    aliases: ["konami"]
  }),
  source({
    provider: "ygoprodeck",
    label: "YGOPRODeck Community API",
    source_type: catalogSourceTypes.YGOPRODECK_COMMUNITY_API,
    segments: ["tcg"],
    games: ["yugioh"],
    default_index_url: "https://db.ygoprodeck.com/api/v7/cardinfo.php",
    kind: "ygoprodeck_api",
    quality_tier: catalogSourceQualityTiers.COMMUNITY_STRUCTURED,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: false,
    manual_csv_fallback: false,
    parser_strategy: "ygoprodeck_api",
    aliases: ["yugioh", "ygo"]
  }),
  source({
    provider: "lorcana_official",
    label: "Disney Lorcana Official Card Database",
    source_type: catalogSourceTypes.LORCANA_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["lorcana"],
    default_index_url: "https://www.disneylorcana.com/en-US/cards",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery",
    aliases: ["lorcana"]
  }),
  source({
    provider: "lorcast",
    label: "Lorcast Lorcana Community API",
    source_type: catalogSourceTypes.LORCANA_COMMUNITY_API,
    segments: ["tcg"],
    games: ["lorcana"],
    default_index_url: "https://api.lorcast.com/v0/cards",
    kind: "lorcana_api",
    quality_tier: catalogSourceQualityTiers.COMMUNITY_STRUCTURED,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: false,
    manual_csv_fallback: false,
    parser_strategy: "lorcana_api",
    aliases: ["lorcana_community", "lorcana_api"]
  }),
  source({
    provider: "star_wars_unlimited",
    label: "Star Wars Unlimited Official Card List",
    source_type: catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["star_wars_unlimited"],
    default_index_url: "https://starwarsunlimited.com/cards",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery",
    aliases: ["swu"]
  }),
  source({
    provider: "swu_db",
    label: "SWUDB Star Wars Unlimited Community API",
    source_type: catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK,
    segments: ["tcg"],
    games: ["star_wars_unlimited"],
    default_index_url: "https://api.swu-db.com/cards/search",
    kind: "swu_db_api",
    quality_tier: catalogSourceQualityTiers.COMMUNITY_STRUCTURED,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: false,
    manual_csv_fallback: false,
    parser_strategy: "swu_db_api",
    aliases: ["star_wars_unlimited_community", "swudb"]
  }),
  source({
    provider: "flesh_and_blood",
    label: "Flesh and Blood Official Card Database",
    source_type: catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["flesh_and_blood"],
    default_index_url: "https://cardvault.fabtcg.com/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery",
    aliases: ["fab", "fabtcg"]
  }),
  source({
    provider: "weiss_schwarz",
    label: "Weiss Schwarz Official Card List",
    source_type: catalogSourceTypes.BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["weiss_schwarz"],
    default_index_url: "https://en.ws-tcg.com/cardlist/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "generic_official_text",
    aliases: ["bushiroad_weiss_schwarz", "ws_tcg"]
  }),
  source({
    provider: "vanguard",
    label: "Cardfight!! Vanguard Official Card List",
    source_type: catalogSourceTypes.BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["vanguard"],
    default_index_url: "https://en.cf-vanguard.com/cardlist/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "generic_official_text",
    aliases: ["cardfight_vanguard", "bushiroad_vanguard"]
  }),
  source({
    provider: "shadowverse_evolve",
    label: "Shadowverse: Evolve Official Card List",
    source_type: catalogSourceTypes.BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST,
    segments: ["tcg"],
    games: ["shadowverse_evolve"],
    default_index_url: "https://en.shadowverse-evolve.com/cards/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "generic_official_text",
    aliases: ["bushiroad_shadowverse", "shadowverse"]
  }),
  source({
    provider: "grand_archive",
    label: "Grand Archive Official Card Database",
    source_type: catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["grand_archive"],
    default_index_url: "https://index.gatcg.com/",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DEFAULT,
    import_mode: catalogSourceImportModes.STAGING_IMPORT,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "generic_official_text",
    aliases: ["gatcg"]
  }),
  source({
    provider: "altered",
    label: "Altered Official Card Database",
    source_type: catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE,
    segments: ["tcg"],
    games: ["altered"],
    default_index_url: "https://www.altered.gg/cards",
    kind: "official_card_database",
    quality_tier: catalogSourceQualityTiers.OFFICIAL_DISCOVERY,
    import_mode: catalogSourceImportModes.MANUAL_CSV_FALLBACK,
    default_enabled: true,
    prompt_eligible_by_default: true,
    parser_strategy: "official_card_database_discovery"
  }),

  source({
    provider: "marketplace_reference",
    label: "Marketplace Reference Data",
    source_type: catalogSourceTypes.MARKETPLACE_REFERENCE,
    segments: ["sports", "tcg"],
    quality_tier: catalogSourceQualityTiers.REJECTED,
    import_mode: catalogSourceImportModes.REJECTED,
    default_enabled: false,
    prompt_eligible_by_default: false,
    parser_strategy: "rejected",
    notes: "Seller titles and marketplace metadata are blind-eval labels or weak references, never catalog truth."
  })
]);

const sourceByProvider = new Map();
const sourceByType = new Map();
for (const entry of curatedCatalogSources) {
  sourceByProvider.set(entry.provider, entry);
  sourceByType.set(entry.source_type, entry);
  for (const alias of entry.aliases || []) sourceByProvider.set(alias, entry);
}

export function curatedCatalogSource(providerOrSourceType = "") {
  const key = providerKey(providerOrSourceType);
  const type = normalizeText(providerOrSourceType).toUpperCase();
  return sourceByProvider.get(key) || sourceByType.get(type) || null;
}

export function catalogSourceCanAutoPromote(providerOrSourceType = "") {
  const entry = curatedCatalogSource(providerOrSourceType);
  return entry?.quality_tier === catalogSourceQualityTiers.REVIEWED_INTERNAL;
}

export function catalogSourceCanEnterPrompt(providerOrSourceType = "", {
  evalTrustOverride = false,
  noDirectConflict = true,
  approvedReference = false
} = {}) {
  const entry = curatedCatalogSource(providerOrSourceType);
  if (!entry || !noDirectConflict) return false;
  if (entry.quality_tier === catalogSourceQualityTiers.REVIEWED_INTERNAL) return true;
  if (approvedReference) return true;
  if (evalTrustOverride && entry.quality_tier !== catalogSourceQualityTiers.REJECTED) return true;
  return false;
}

export function catalogSourceImportPolicy(providerOrSourceType = "") {
  const entry = curatedCatalogSource(providerOrSourceType);
  if (!entry) {
    return Object.freeze({
      known_source: false,
      staging_only: true,
      reviewed_internal_auto_promotion: false,
      external_title_final_title_allowed: false,
      physical_instance_fields_allowed: false,
      import_mode: catalogSourceImportModes.DISABLED_EXPERIMENTAL,
      allowed_usage: sharedAllowedUsage,
      forbidden_usage: sharedForbiddenUsage
    });
  }
  return Object.freeze({
    known_source: true,
    source_type: entry.source_type,
    quality_tier: entry.quality_tier,
    import_mode: entry.import_mode,
    staging_only: entry.staging_only,
    reviewed_internal_auto_promotion: false,
    external_title_final_title_allowed: false,
    physical_instance_fields_allowed: false,
    prompt_eligible_by_default: entry.prompt_eligible_by_default,
    allowed_usage: entry.allowed_usage,
    forbidden_usage: entry.forbidden_usage,
    is_official: isOfficialCatalogSourceType(entry.source_type),
    is_community: isCommunityCatalogSourceType(entry.source_type),
    is_external_directory: isExternalDirectoryCatalogSourceType(entry.source_type)
  });
}

export function catalogSourcesForSegment(segment = "sports", {
  includeCommunity = true,
  includeExperimental = false,
  includeRejected = false
} = {}) {
  const normalizedSegment = providerKey(segment);
  return curatedCatalogSources.filter((entry) => {
    if (!includeRejected && entry.quality_tier === catalogSourceQualityTiers.REJECTED) return false;
    if (!includeExperimental && entry.quality_tier === catalogSourceQualityTiers.EXPERIMENTAL_OFFICIAL) return false;
    if (!includeCommunity && entry.quality_tier === catalogSourceQualityTiers.COMMUNITY_STRUCTURED) return false;
    return entry.segments.includes(normalizedSegment);
  });
}

export function catalogSourceImportPlan({
  segments = ["sports", "tcg"],
  includeCommunity = true,
  includeExperimental = false,
  includeRejected = false,
  defaultOnly = true
} = {}) {
  const seen = new Set();
  const selected = [];
  for (const segment of segments) {
    for (const entry of catalogSourcesForSegment(segment, {
      includeCommunity,
      includeExperimental,
      includeRejected
    })) {
      if (seen.has(entry.provider)) continue;
      if (defaultOnly && entry.default_enabled !== true) continue;
      seen.add(entry.provider);
      selected.push(entry);
    }
  }
  return Object.freeze({
    schema_version: "curated-catalog-source-import-plan-v1",
    segments: Object.freeze(segments.map(providerKey)),
    source_count: selected.length,
    sources: Object.freeze(selected),
    policy: Object.freeze({
      reviewed_internal_only_promotes_truth: true,
      official_sources_stage_candidates_only: true,
      community_sources_are_weak_candidates: true,
      marketplace_references_rejected_as_catalog_truth: true,
      no_external_serial_grade_cert_copy: true
    })
  });
}
