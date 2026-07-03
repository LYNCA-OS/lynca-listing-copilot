import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCatalogSeed, buildWriterTitleCatalogSeed } from "./import-writer-title-catalog-seed.mjs";
import { correctedTitleRecordToCatalogStaging } from "../lib/listing/catalog/internal-corrected-title-catalog.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { planRetrievalQueries } from "../lib/listing/retrieval/query-planner.mjs";
import { retrievalProviderIds } from "../lib/listing/retrieval/retrieval-contract.mjs";
import adminCatalogSmokeHandler from "../api/admin-catalog-candidate-smoke.js";
import adminImportHandler from "../api/admin-import-writer-title-catalog-seed.js";

const mtgTitle = "Final Fantasy MTG JPN Prompto Argentum #U 0532 FFXV Surge Foil Borderless";
const parsedMtg = parseReviewedTitleFields(mtgTitle);
assert.equal(parsedMtg.year, null);
assert.equal(parsedMtg.category, "tcg");
assert.equal(parsedMtg.manufacturer, "Wizards of the Coast");
assert.equal(parsedMtg.brand, "Magic: The Gathering");
assert.equal(parsedMtg.product, "Magic: The Gathering Final Fantasy");
assert.equal(parsedMtg.language, "JPN");
assert.equal(parsedMtg.card_name, "Prompto Argentum");
assert.equal(parsedMtg.character, "Prompto Argentum");
assert.equal(parsedMtg.rarity, "U");
assert.equal(parsedMtg.collector_number, "0532");

const parsedMtgLot = parseReviewedTitleFields("Final Fantasy MTG EN Prompto Argentum #U 0532 0387 FFXV Surge Foil lotx2");
assert.equal(parsedMtgLot.card_name, "Prompto Argentum");
assert.equal(parsedMtgLot.character, "Prompto Argentum");

const parsedEncased = parseReviewedTitleFields("2018-19 Panini Encased Jaren Jackson Jr. RC Jersey Auto #/99 Grizzlies BGS 9.5/9");
assert.equal(parsedEncased.product, "Panini Encased");
assert.deepEqual(parsedEncased.players, ["Jaren Jackson Jr"]);
assert.equal(parsedEncased.team, "Grizzlies");
assert.equal(parsedEncased.serial_number, null);
assert.equal(parsedEncased.serial_denominator, "99");
assert.equal(parsedEncased.grade_company, "BGS");
assert.equal(parsedEncased.card_grade, "9.5");
assert.equal(parsedEncased.auto_grade, "9");

const parsedStatus = parseReviewedTitleFields("2018-19 Panini Status Trae Young New Breed Rookie RC Auto #NB-TYG Hawks");
assert.equal(parsedStatus.product, "Panini Status");
assert.deepEqual(parsedStatus.players, ["Trae Young"]);
assert.equal(parsedStatus.official_card_type, "New Breed");
assert.equal(parsedStatus.collector_number, "NB-TYG");
assert.equal(parsedStatus.team, "Hawks");

const parsedPrizmWorldCup = parseReviewedTitleFields("2022-23 Panini Prizm World Cup Pele Signatures Breakaway Gold Auto #/2 PSA 9");
assert.equal(parsedPrizmWorldCup.category, "soccer");
assert.equal(parsedPrizmWorldCup.product, "Panini Prizm FIFA World Cup");
assert.deepEqual(parsedPrizmWorldCup.players, ["Pele"]);
assert.equal(parsedPrizmWorldCup.official_card_type, "Signatures Breakaway");
assert.equal(parsedPrizmWorldCup.serial_denominator, "2");

const parsedBowmanSpotlight = parseReviewedTitleFields("2025 Bowman Jesus Made Spotlights Chrome Red Refractor #/5 Brewers");
assert.equal(parsedBowmanSpotlight.manufacturer, "Topps");
assert.equal(parsedBowmanSpotlight.brand, "Bowman");
assert.equal(parsedBowmanSpotlight.product, "Bowman Chrome");
assert.deepEqual(parsedBowmanSpotlight.players, ["Jesus Made"]);
assert.equal(parsedBowmanSpotlight.official_card_type, "Spotlights Chrome");
assert.equal(parsedBowmanSpotlight.surface_color, "Red");
assert.equal(parsedBowmanSpotlight.serial_denominator, "5");

const parsedEminence = parseReviewedTitleFields("2024 Eminence Patrick Mahomes Luxury Platinum Bar #1/1 Chiefs");
assert.equal(parsedEminence.product, "Panini Eminence");
assert.deepEqual(parsedEminence.players, ["Patrick Mahomes"]);
assert.equal(parsedEminence.official_card_type, "Luxury Platinum Bar");
assert.equal(parsedEminence.serial_number, "1/1");

const statusCatalog = correctedTitleRecordToCatalogStaging({
  id: "writer-row-status",
  corrected_title: "2018-19 Panini Status Trae Young New Breed Rookie RC Auto #NB-TYG Hawks"
});
assert.equal(statusCatalog.staging.identity_fields.product, "Panini Status");
assert.equal(statusCatalog.staging.identity_fields.card_name, "New Breed");
assert.equal(statusCatalog.staging.identity_fields.set_or_insert, "New Breed");
assert.deepEqual(statusCatalog.staging.identity_fields.players, ["Trae Young"]);

const parsedPaniniDonruss = parseReviewedTitleFields("2024-25 Panini Donruss Brad Friedel The Beautiful Game Green Dragon auto 16/99");
assert.equal(parsedPaniniDonruss.category, "soccer");
assert.equal(parsedPaniniDonruss.product, "Panini Donruss");
assert.deepEqual(parsedPaniniDonruss.players, ["Brad Friedel"]);
assert.equal(parsedPaniniDonruss.official_card_type, "The Beautiful Game");

const parsedGreenLava = parseReviewedTitleFields("2025 Topps Chrome Jordan James RC Auto Green Lava Refractor");
assert.deepEqual(parsedGreenLava.players, ["Jordan James"]);

const parsedLotPlayers = parseReviewedTitleFields("2025 Topps Chrome Riley Leonard Jordan James Pearce Jr RC Refractor Lotx16");
assert.equal(parsedLotPlayers.players.some((player) => /lotx/i.test(player)), false);

const parsedSpAuthentic = parseReviewedTitleFields("2024-25 Upper Deck SP Authentic Future Watch Frank Nazar /999 RC Auto PSA 8");
assert.equal(parsedSpAuthentic.category, "hockey");
assert.equal(parsedSpAuthentic.product, "Upper Deck SP Authentic");
assert.deepEqual(parsedSpAuthentic.players, ["Frank Nazar"]);
assert.equal(parsedSpAuthentic.official_card_type, "Future Watch");

const parsedTcgNoTeam = parseReviewedTitleFields("Final Fantasy MTG EN Starting Town #R 0289 FFI Foil");
assert.equal(parsedTcgNoTeam.product, "Magic: The Gathering Final Fantasy");
assert.equal(parsedTcgNoTeam.card_name, "Starting Town");
assert.equal(parsedTcgNoTeam.team, null);

const parsedKakawow = parseReviewedTitleFields("2025 Kakawow Cosmos Disney Die-cut Prince Charming Refractor /20");
assert.equal(parsedKakawow.product, "Kakawow Disney Cosmos");
assert.deepEqual(parsedKakawow.players, ["Prince Charming"]);
assert.equal(parsedKakawow.official_card_type, "Die-cut");

const mtgCatalog = correctedTitleRecordToCatalogStaging({
  id: "writer-row-1",
  corrected_title: mtgTitle
});
assert.equal(mtgCatalog.staging.identity_fields.sport, "tcg");
assert.equal(mtgCatalog.staging.identity_fields.category, "tcg");
assert.deepEqual(mtgCatalog.staging.identity_fields.players, ["Prompto Argentum"]);
assert.equal(mtgCatalog.staging.identity_fields.collector_number, "0532");
assert.equal(mtgCatalog.staging.identity_fields.card_number, "0532");
assert.equal(mtgCatalog.staging.identity_fields.rarity, "U");
assert.equal(mtgCatalog.staging.physical_instance_fields.serial_number, null);

const tmp = await mkdtemp(join(tmpdir(), "lynca-writer-title-seed-"));
const input = join(tmp, "writer-seed.tsv");
await writeFile(input, [
  "序号\t标题",
  "（1）河马150标\t7月-7573-河马1",
  `1\t${mtgTitle}`,
  `2\t${mtgTitle}`,
  "3\t2025 Topps Chrome Baseball Shohei Ohtani Blue /150 #17",
  "4\t2025 Mystery Publisher Handmade Artist Card Blue #ABC"
].join("\n"));

const built = await buildWriterTitleCatalogSeed({
  inputPath: input,
  batchId: "writer-title-test"
});
assert.equal(built.report.row_counts.skipped_non_title_rows, 1);
assert.equal(built.report.row_counts.duplicate_title_rows, 1);
assert.equal(built.report.row_counts.unique_catalog_seed_rows, 3);
assert.equal(built.report.row_counts.vector_seed_rows, 3);
assert.equal(built.vectorSeeds[0].source_trust, "APPROVED_REFERENCE");
assert.equal(built.vectorSeeds[0].metadata.title_derived_fields_are_ground_truth, false);
assert.equal(built.vectorSeeds[0].metadata.copy_serial_grade_cert_to_query, false);
assert.match(built.vectorSeeds[0].search_text, /Prompto Argentum/);
assert.equal(built.stagedRows[0].source.source_metadata.writer_title_batch_id, "writer-title-test");
assert.equal(built.stagedRows[0].source.source_metadata.title_derived_fields_are_ground_truth, false);

let rpcBody = null;
const provider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true",
    CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT: "false"
  },
  fetchImpl: async (url, options) => {
    assert.equal(String(url), "https://supabase.test/rest/v1/rpc/search_catalog_candidates");
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify([
      {
        identity_id: "33333333-3333-3333-3333-333333333333",
        canonical_title: mtgTitle,
        identity_key: "tcg:mtg-final-fantasy:prompto-argentum:0532",
        fields: {
          category: "tcg",
          sport: "tcg",
          manufacturer: "Wizards of the Coast",
          product: "Magic: The Gathering Final Fantasy",
          players: ["Prompto Argentum"],
          card_name: "Prompto Argentum",
          language: "JPN",
          rarity: "U",
          collector_number: "0532"
        },
        retrieval_status: "candidate",
        category: "tcg",
        source_type: "INTERNAL_CORRECTED_TITLE",
        source_status: "VERIFIED_CANONICAL_TITLE",
        supporting_fields: ["collector_number", "players", "product"],
        raw_score: 0.78,
        normalized_score: 0.78,
        expected_serial_denominator: null
      }
    ]), { status: 200 });
  }
});
const providerResult = await provider.search({
  query: {
    search_text: "Prompto Argentum Final Fantasy MTG 0532",
    exact_card_number: "0532",
    exact_subject: "Prompto Argentum",
    exact_product: "Magic: The Gathering Final Fantasy"
  }
});
assert.equal(rpcBody.exact_card_number, "0532");
assert.equal(providerResult.candidates.length, 1);
assert.equal(providerResult.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(providerResult.candidates[0].reference_metadata.corrected_title_as_temporary_gt, false);
assert.equal(providerResult.candidates[0].reference_metadata.prompt_safe_internal_writer_title, true);
assert.equal(providerResult.candidates[0].field_derivation.title_derived_fields_are_ground_truth, false);

const legacyGenericProductProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async () => new Response(JSON.stringify([
    {
      identity_id: "44444444-4444-4444-4444-444444444444",
      canonical_title: "2018-19 Panini Status Shai Gilgeous-Alexander RC #106 Silver Holo",
      identity_key: "sports:2018-19:panini:status:shai:106",
      fields: {
        category: "basketball",
        manufacturer: "Panini",
        brand: "Panini",
        product: "Panini",
        players: ["Shai Gilgeous-Alexander"],
        collector_number: "106"
      },
      retrieval_status: "candidate",
      source_type: "INTERNAL_CORRECTED_TITLE",
      source_status: "VERIFIED_CANONICAL_TITLE",
      supporting_fields: ["year", "canonical_title"],
      raw_score: 0.3,
      normalized_score: 0.3,
      expected_serial_denominator: null
    }
  ]), { status: 200 })
});
const legacyGenericProductResult = await legacyGenericProductProvider.search({
  query: {
    exact_year: "2018-19",
    exact_product: "Panini Status",
    search_text: "2018-19 Panini Status"
  }
});
assert.equal(
  legacyGenericProductResult.candidates[0].fields.product,
  "Panini Status",
  "internal writer-title catalog rows should repair legacy generic product fields from the canonical title"
);

let productVocabularyRpcBody = null;
const productVocabularyProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async (url, options) => {
    productVocabularyRpcBody = JSON.parse(options.body);
    return new Response("[]", { status: 200 });
  }
});
await productVocabularyProvider.search({
  query: {
    lookup_scope: "product_vocabulary",
    exact_year: "2018-19",
    exact_product: "Panini Status",
    search_text: "2018-19 Panini Status New Breed"
  },
  resolved: {
    players: ["Trae Young"],
    collector_number: "NB-TYG",
    serial_number: "20/99"
  }
});
assert.equal(productVocabularyRpcBody.exact_subject, "", "product vocabulary lookup must not inherit subject fallback");
assert.equal(productVocabularyRpcBody.exact_card_number, "", "product vocabulary lookup must not inherit collector-number fallback");
assert.equal(productVocabularyRpcBody.exact_serial_denominator, "", "product vocabulary lookup must not inherit serial-denominator fallback");

const mixedCategory = parseReviewedTitleFields("2025 Topps Chrome Pokemon Pikachu #25 Gold");
assert.equal(mixedCategory.category, "tcg");
assert.ok(mixedCategory.category_candidates.includes("tcg"));
assert.ok(mixedCategory.category_candidates.includes("sports_card"));
const mixedQueries = planRetrievalQueries({
  resolved: {
    ...mixedCategory,
    year: "2025",
    product: "Topps Chrome",
    collector_number: "25"
  },
  includeExternal: true,
  includeHybrid: true
});
const catalogQueryWithCategories = mixedQueries.find((query) => query.provider_id === retrievalProviderIds.CATALOG && Array.isArray(query.category_candidates));
assert.ok(catalogQueryWithCategories);
assert.ok(catalogQueryWithCategories.category_candidates.includes("tcg"));
assert.ok(catalogQueryWithCategories.category_candidates.includes("sports_card"));

const cardNumberOnlyQueries = planRetrievalQueries({
  resolved: {
    product: "Magic: The Gathering Final Fantasy",
    players: ["Prompto Argentum"],
    card_number: "0532"
  },
  includeExternal: false
});
const exactCardNumberQuery = cardNumberOnlyQueries.find((query) => query.family === "SEARCH_CATALOG_EXACT_CODE");
assert.ok(exactCardNumberQuery, "card_number-only records must still generate a catalog exact-code query");
assert.equal(exactCardNumberQuery.exact_card_number, "0532");

const seasonYearDenominatorQueries = planRetrievalQueries({
  resolved: {
    season_year: "2025",
    product: "Topps Chrome",
    players: ["Jordan James"],
    serial_denominator: "99"
  },
  includeExternal: false
});
assert.ok(
  seasonYearDenominatorQueries.some((query) => query.family === "SEARCH_CATALOG_YEAR_PRODUCT_SUBJECT"),
  "season_year should normalize to year for catalog lookup"
);
const denominatorQuery = seasonYearDenominatorQueries.find((query) => query.family === "SEARCH_CATALOG_PRODUCT_SERIAL_DENOMINATOR");
assert.ok(denominatorQuery, "serial_denominator should normalize to expected_serial_denominator for catalog lookup");
assert.equal(denominatorQuery.exact_serial_denominator, "99");

const productVocabularyQueries = planRetrievalQueries({
  resolved: {
    year: "2018-19",
    manufacturer: "Panini",
    product: "Panini Status",
    card_name: "New Breed",
    players: ["Trae Young"],
    collector_number: "NB-TYG"
  },
  includeExternal: false
});
const productVocabularyQuery = productVocabularyQueries.find((query) => query.family === "SEARCH_CATALOG_PRODUCT_VOCABULARY");
assert.ok(productVocabularyQuery, "catalog lookup should include product vocabulary support even before exact identity exists");
assert.equal(productVocabularyQuery.exact_product, "Panini Status");
assert.match(productVocabularyQuery.query, /New Breed/);
assert.doesNotMatch(
  productVocabularyQueries.find((query) => query.family === "SEARCH_INTERNAL_APPROVED_HISTORY")?.query || "",
  /Panini Panini Status/,
  "product hierarchy query should not duplicate the manufacturer when product already contains it"
);

const unknownFallback = correctedTitleRecordToCatalogStaging({
  id: "writer-row-unknown",
  corrected_title: "2025 Mystery Publisher Handmade Artist Card Blue #ABC"
});
assert.equal(unknownFallback.staging.identity_fields.category, "other_collectibles");
assert.equal(unknownFallback.staging.identity_fields.sport, "other_collectibles");
assert.equal(unknownFallback.staging.identity_fields.product, "Other Collectibles");

const migrationSql = await readFile("supabase/migrations/20260703034116_catalog_search_all_categories_v0.sql", "utf8");
assert.doesNotMatch(migrationSql, /where\s+c\.sport\s*=\s*'basketball'/i);
assert.match(migrationSql, /泛体育 \+ TCG/);

const importResponse = {
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  },
  end(value) {
    this.body = value;
  }
};
const previousImportToken = process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN;
process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN = "import-token";
await adminImportHandler({
  method: "POST",
  headers: { authorization: "Bearer import-token" },
  body: {
    input_path: input,
    batch_id: "writer-title-api-test",
    offset: 0,
    limit: 1,
    apply: false
  }
}, importResponse);
if (previousImportToken === undefined) {
  delete process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN;
} else {
  process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN = previousImportToken;
}
assert.equal(importResponse.statusCode, 200);
const importPayload = JSON.parse(importResponse.body);
assert.equal(importPayload.ok, true);
assert.equal(importPayload.mode, "dry_run");
assert.equal(importPayload.auth_mode, "internal_token");
assert.equal(importPayload.selected_chunk.count, 1);
assert.equal(importPayload.apply.reason, "dry_run_apply_false");

const inlineImportResponse = {
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  },
  end(value) {
    this.body = value;
  }
};
const previousInlineImportToken = process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN;
process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN = "import-token";
await adminImportHandler({
  method: "POST",
  headers: { authorization: "Bearer import-token" },
  body: {
    staged_rows: built.stagedRows.slice(0, 1),
    total_rows: built.stagedRows.length,
    batch_id: "writer-title-api-inline-test",
    offset: 0,
    limit: 1,
    apply: false
  }
}, inlineImportResponse);
if (previousInlineImportToken === undefined) {
  delete process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN;
} else {
  process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN = previousInlineImportToken;
}
assert.equal(inlineImportResponse.statusCode, 200);
const inlineImportPayload = JSON.parse(inlineImportResponse.body);
assert.equal(inlineImportPayload.ok, true);
assert.equal(inlineImportPayload.mode, "dry_run_inline");
assert.equal(inlineImportPayload.selected_chunk.count, 1);
assert.equal(inlineImportPayload.sample_rows[0].source_row_key, built.stagedRows[0].staging.source_row_key);

const smokeResponse = {
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  },
  end(value) {
    this.body = value;
  }
};
const previousSmokeEnv = {
  DATA_LOOP_INTERNAL_SIDECAR_TOKEN: process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};
const previousFetch = globalThis.fetch;
process.env.DATA_LOOP_INTERNAL_SIDECAR_TOKEN = "import-token";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
globalThis.fetch = async (url, options = {}) => {
  assert.match(String(url), /\/rest\/v1\/rpc\/search_catalog_candidates/);
  assert.equal(options.method, "POST");
  return new Response(JSON.stringify([{
    identity_id: "identity-mtg-prompto",
    identity_key: "identity-mtg-prompto",
    canonical_title: mtgTitle,
    fields: {
      product: "Magic: The Gathering Final Fantasy",
      players: ["Prompto Argentum"],
      card_number: "0532",
      rarity: "U"
    },
    retrieval_status: "reviewed",
    source_type: "INTERNAL_CORRECTED_TITLE",
    source_status: "VERIFIED_CANONICAL_TITLE",
    supporting_fields: ["collector_number", "players", "product"],
    raw_score: 0.98,
    normalized_score: 0.98
  }]), { status: 200 });
};
await adminCatalogSmokeHandler({
  method: "POST",
  headers: { authorization: "Bearer import-token" },
  body: {
    fields: {
      product: "Magic: The Gathering Final Fantasy",
      players: ["Prompto Argentum"],
      collector_number: "0532",
      rarity: "U"
    }
  }
}, smokeResponse);
globalThis.fetch = previousFetch;
for (const [key, value] of Object.entries(previousSmokeEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
assert.equal(smokeResponse.statusCode, 200);
const smokePayload = JSON.parse(smokeResponse.body);
assert.equal(smokePayload.ok, true);
assert.equal(smokePayload.raw_candidate_count, 1);
assert.equal(smokePayload.prompt_candidate_count, 1);
assert.equal(smokePayload.prompt_candidate_ids[0], "identity-mtg-prompto");
assert.equal(smokePayload.candidates[0].source_trust, "APPROVED_REFERENCE");

const insertedCardPayloads = [];
const applyFetch = async (url, options = {}) => {
  const urlText = String(url);
  if (options.method !== "POST") return new Response("[]", { status: 200 });
  const table = urlText.match(/\/rest\/v1\/([^?]+)/)?.[1] || "";
  const body = JSON.parse(options.body || "[]");
  if (table === "catalog_sources") {
    return new Response(JSON.stringify(body.map((row, index) => ({
      id: `00000000-0000-0000-0000-00000000000${index + 1}`,
      raw_checksum: row.raw_checksum
    }))), { status: 201 });
  }
  if (table === "catalog_products") {
    return new Response(JSON.stringify(body.map((row, index) => ({
      id: `10000000-0000-0000-0000-00000000000${index + 1}`,
      source_id: row.source_id
    }))), { status: 201 });
  }
  if (table === "catalog_sets") {
    return new Response(JSON.stringify(body.map((row, index) => ({
      id: `20000000-0000-0000-0000-00000000000${index + 1}`,
      source_id: row.source_id
    }))), { status: 201 });
  }
  if (table === "catalog_cards") {
    insertedCardPayloads.push(body);
    const keySig = body.map((row) => Object.keys(row).sort().join("|"));
    assert.equal(new Set(keySig).size, 1, "PostgREST insert rows must share identical keys");
    return new Response(JSON.stringify(body.map((row, index) => ({
      id: `30000000-0000-0000-0000-00000000000${index + 1}`,
      source_id: row.source_id
    }))), { status: 201 });
  }
  return new Response("[]", { status: 201 });
};
const applySummary = await applyCatalogSeed({
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "test-service-role" },
  stagedRows: built.stagedRows,
  fetchImpl: applyFetch,
  batchSize: 2
});
assert.equal(applySummary.inserted_card_count, 3);
assert.equal(insertedCardPayloads.length, 2);
assert.ok(insertedCardPayloads.flat().every((row) => Array.isArray(row.players)));
assert.ok(insertedCardPayloads.flat().every((row) => Array.isArray(row.observable_components)));

console.log("writer title catalog seed tests passed");
