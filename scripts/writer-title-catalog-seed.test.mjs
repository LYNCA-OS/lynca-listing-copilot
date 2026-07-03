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

const mtgCatalog = correctedTitleRecordToCatalogStaging({
  id: "writer-row-1",
  corrected_title: mtgTitle
});
assert.equal(mtgCatalog.staging.identity_fields.sport, "tcg");
assert.equal(mtgCatalog.staging.identity_fields.category, "tcg");
assert.deepEqual(mtgCatalog.staging.identity_fields.players, ["Prompto Argentum"]);
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
