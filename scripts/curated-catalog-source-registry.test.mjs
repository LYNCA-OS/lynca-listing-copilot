import assert from "node:assert/strict";
import {
  catalogSourceTypes,
  isCommunityCatalogSourceType,
  isOfficialCatalogSourceType
} from "../lib/listing/catalog/catalog-contract.mjs";
import {
  catalogSourceCanAutoPromote,
  catalogSourceCanEnterPrompt,
  catalogSourceImportPlan,
  catalogSourceImportPolicy,
  catalogSourceImportModes,
  catalogSourceQualityTiers,
  catalogSourcesForSegment,
  curatedCatalogSource,
  curatedCatalogSources
} from "../lib/listing/catalog/curated-catalog-source-registry.mjs";

{
  assert.ok(curatedCatalogSources.length >= 25);
  const providers = new Set(curatedCatalogSources.map((source) => source.provider));
  [
    "topps",
    "panini",
    "upper_deck",
    "one_piece",
    "digimon",
    "dragon_ball_fusion_world",
    "dragon_ball_masters",
    "union_arena",
    "battle_spirits",
    "pokemon_tcg_api",
    "scryfall",
    "ygoprodeck",
    "lorcast",
    "star_wars_unlimited",
    "swu_db",
    "flesh_and_blood",
    "weiss_schwarz",
    "vanguard",
    "shadowverse_evolve",
    "grand_archive",
    "altered"
  ].forEach((provider) => assert.ok(providers.has(provider), `missing curated source ${provider}`));
}

{
  const sports = catalogSourcesForSegment("sports", { includeCommunity: true });
  const sourceTypes = new Set(sports.map((source) => source.source_type));
  assert.ok(sourceTypes.has(catalogSourceTypes.TOPPS_OFFICIAL_CHECKLIST));
  assert.ok(sourceTypes.has(catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST));
  assert.ok(sourceTypes.has(catalogSourceTypes.UPPER_DECK_OFFICIAL_CHECKLIST));
  assert.equal(sourceTypes.has(catalogSourceTypes.MARKETPLACE_REFERENCE), false);
}

{
  const tcgPlan = catalogSourceImportPlan({ segments: ["tcg"] });
  const sourceTypes = new Set(tcgPlan.sources.map((source) => source.source_type));
  [
    catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST,
    catalogSourceTypes.BANDAI_DIGIMON_OFFICIAL_CARDLIST,
    catalogSourceTypes.BANDAI_DBS_FUSION_WORLD_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.BANDAI_DBS_MASTERS_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.BANDAI_UNION_ARENA_OFFICIAL_CARDLIST,
    catalogSourceTypes.BANDAI_BATTLE_SPIRITS_OFFICIAL_CARDLIST,
    catalogSourceTypes.POKEMON_TCG_COMMUNITY_API,
    catalogSourceTypes.SCRYFALL_COMMUNITY_API,
    catalogSourceTypes.KONAMI_YUGIOH_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.YGOPRODECK_COMMUNITY_API,
    catalogSourceTypes.LORCANA_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.LORCANA_COMMUNITY_API,
    catalogSourceTypes.STAR_WARS_UNLIMITED_OFFICIAL_CARDLIST,
    catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK,
    catalogSourceTypes.FAB_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.BUSHIROAD_WEISS_SCHWARZ_OFFICIAL_CARDLIST,
    catalogSourceTypes.BUSHIROAD_VANGUARD_OFFICIAL_CARDLIST,
    catalogSourceTypes.BUSHIROAD_SHADOWVERSE_EVOLVE_OFFICIAL_CARDLIST,
    catalogSourceTypes.GRAND_ARCHIVE_OFFICIAL_CARD_DATABASE,
    catalogSourceTypes.ALTERED_OFFICIAL_CARD_DATABASE
  ].forEach((sourceType) => assert.ok(sourceTypes.has(sourceType), `missing tcg import plan source ${sourceType}`));
  assert.equal(tcgPlan.policy.marketplace_references_rejected_as_catalog_truth, true);
}

{
  const swuDb = curatedCatalogSource("swudb");
  assert.equal(swuDb.provider, "swu_db");
  assert.equal(swuDb.source_type, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);
  assert.equal(swuDb.quality_tier, catalogSourceQualityTiers.COMMUNITY_STRUCTURED);
  assert.equal(catalogSourceCanAutoPromote("swu_db"), false);
  assert.equal(catalogSourceCanEnterPrompt("swu_db", { noDirectConflict: true }), false);
  assert.equal(catalogSourceCanEnterPrompt("swu_db", { evalTrustOverride: true, noDirectConflict: true }), true);
}

{
  const pokemon = curatedCatalogSource("pokemon");
  assert.equal(pokemon.source_type, catalogSourceTypes.POKEMON_TCG_COMMUNITY_API);
  assert.equal(pokemon.quality_tier, catalogSourceQualityTiers.COMMUNITY_STRUCTURED);
  assert.equal(isCommunityCatalogSourceType(pokemon.source_type), true);
  assert.equal(catalogSourceCanAutoPromote("pokemon"), false);
  assert.equal(catalogSourceCanEnterPrompt("pokemon", { noDirectConflict: true }), false);
  assert.equal(catalogSourceCanEnterPrompt("pokemon", { evalTrustOverride: true, noDirectConflict: true }), true);
  assert.equal(catalogSourceCanEnterPrompt("pokemon", { evalTrustOverride: true, noDirectConflict: false }), false);
}

{
  const topps = curatedCatalogSource("topps");
  const policy = catalogSourceImportPolicy("topps");
  assert.equal(isOfficialCatalogSourceType(topps.source_type), true);
  assert.equal(policy.staging_only, true);
  assert.equal(policy.reviewed_internal_auto_promotion, false);
  assert.equal(policy.external_title_final_title_allowed, false);
  assert.equal(policy.physical_instance_fields_allowed, false);
  assert.equal(catalogSourceCanEnterPrompt("topps", { noDirectConflict: true }), false);
  assert.equal(catalogSourceCanEnterPrompt("topps", { approvedReference: true, noDirectConflict: true }), true);
  assert.ok(policy.forbidden_usage.includes("serial_numerator"));
  assert.ok(policy.forbidden_usage.includes("grade"));
  assert.ok(policy.forbidden_usage.includes("cert_number"));
}

{
  const marketplace = curatedCatalogSource("marketplace_reference");
  assert.equal(marketplace.quality_tier, catalogSourceQualityTiers.REJECTED);
  assert.equal(marketplace.import_mode, catalogSourceImportModes.REJECTED);
  assert.equal(catalogSourceCanEnterPrompt("marketplace_reference", { evalTrustOverride: true, noDirectConflict: true }), false);
}

console.log("curated catalog source registry tests passed");
