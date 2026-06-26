import assert from "node:assert/strict";
import { componentBooleansFromObservableComponents } from "../lib/listing/card-type-policy.mjs";
import {
  correctedTitleRecordToCatalogStaging
} from "../lib/listing/catalog/internal-corrected-title-catalog.mjs";
import { normalizeResolvedFields } from "../lib/listing/evidence/evidence-schema.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import {
  buildToppsBasketballChecklistImport,
  extractToppsBasketballChecklistLinks,
  isAllowedToppsBasketballChecklistLink,
  parseToppsBasketballChecklistText
} from "../lib/listing/catalog/topps-basketball-checklist-importer.mjs";
import { renderResolvedTitle } from "../lib/listing/renderer/listing-renderer.mjs";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { planRetrievalQueries } from "../lib/listing/retrieval/query-planner.mjs";
import {
  retrievalProviderIds,
  retrievalQueryFamilies
} from "../lib/listing/retrieval/retrieval-contract.mjs";

assert.deepEqual(componentBooleansFromObservableComponents(["Auto", "Jersey", "RC"]), {
  auto: true,
  patch: false,
  relic: false,
  jersey: true,
  rc: true,
  sketch: false,
  redemption: false
});

const parsedCatalog = correctedTitleRecordToCatalogStaging({
  id: "feedback-1",
  asset_id: "asset-1",
  corrected_title: "2025 Topps Chrome Basketball Cooper Flagg Gold Refractor Auto RC 17/50 PSA 10 #136"
});
assert.equal(parsedCatalog.source.source_type, "INTERNAL_CORRECTED_TITLE");
assert.equal(parsedCatalog.source.source_status, "VERIFIED_CANONICAL_TITLE");
assert.equal(parsedCatalog.staging.identity_fields.surface_color, "Gold");
assert.equal(parsedCatalog.staging.identity_fields.serial_denominator, "50");
assert.equal(parsedCatalog.staging.identity_fields.serial_number, undefined);
assert.equal(parsedCatalog.staging.physical_instance_fields.serial_number, "17/50");
assert.equal(parsedCatalog.staging.physical_instance_fields.serial_numerator, "17");
assert.equal(parsedCatalog.staging.physical_instance_fields.grade_company, "PSA");
assert.equal(parsedCatalog.staging.identity_fields.grade_company, undefined);
assert.ok(parsedCatalog.staging.identity_fields.observable_components.includes("auto"));
assert.ok(parsedCatalog.staging.identity_fields.observable_components.includes("rc"));

const messiCatalog = correctedTitleRecordToCatalogStaging({
  id: "feedback-soccer-1",
  corrected_title: "2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi 029/199 Auto #CL-LM"
});
assert.equal(messiCatalog.staging.identity_fields.sport, "soccer");
assert.equal(messiCatalog.staging.identity_fields.product, "Panini Prizm FIFA Soccer");
assert.equal(messiCatalog.staging.identity_fields.set_or_insert, "Club Legends");
assert.deepEqual(messiCatalog.staging.identity_fields.players, ["Lionel Messi"]);
assert.equal(messiCatalog.staging.identity_fields.card_number, "CL-LM");
assert.equal(messiCatalog.staging.identity_fields.serial_denominator, "199");
assert.equal(messiCatalog.staging.physical_instance_fields.serial_numerator, "29");

const blackProduct = parseReviewedTitleFields("2024 Panini Black Ricky Pearsall Metallic Marks Auto 10/25 #MM-RP");
assert.equal(blackProduct.product, "Panini Black");
assert.equal(blackProduct.surface_color, null);
assert.deepEqual(blackProduct.players, ["Ricky Pearsall"]);
assert.equal(blackProduct.official_card_type, "Metallic Marks");

const starWarsGold = parseReviewedTitleFields("2025 Topps Star Wars Chrome Black Smugglers Outpost Han Solo Gold 5/50 #SO-HS");
assert.equal(starWarsGold.product, "Topps Star Wars Chrome Black");
assert.equal(starWarsGold.surface_color, "Gold");
assert.deepEqual(starWarsGold.players, ["Han Solo"]);

const normalizedBase = normalizeResolvedFields({
  card_type: "Base",
  official_card_type: null,
  observable_components: ["auto"]
});
assert.equal(normalizedBase.card_type, null);
assert.equal(normalizedBase.auto, true);

const lowEvidenceBase = renderResolvedTitle({
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome Basketball",
  players: ["Cooper Flagg"],
  card_type: "Base",
  surface_color: "Gold",
  auto: true,
  observable_components: ["auto"]
});
assert.doesNotMatch(lowEvidenceBase.rendered_title, /\bBase\b/);
assert.match(lowEvidenceBase.rendered_title, /\bGold\b/);
assert.match(lowEvidenceBase.rendered_title, /\bAuto\b/);
assert.doesNotMatch(lowEvidenceBase.rendered_title, /Gold\s+Refractor/i);

const officialBase = renderResolvedTitle({
  year: "2025",
  manufacturer: "Topps",
  product: "Topps Chrome Basketball",
  players: ["Cooper Flagg"],
  official_card_type: "Base"
});
assert.match(officialBase.rendered_title, /\bBase\b/);

const indexHtml = `
  <a href="/checklists/2025-topps-chrome-basketball.pdf">2025 Topps Chrome Basketball Checklist</a>
  <a href="/checklists/2025-topps-chrome-baseball.pdf">2025 Topps Chrome Baseball Checklist</a>
  <a href="/checklists/2025-topps-marvel.pdf">2025 Topps Marvel Checklist</a>
  <a href="/checklists/2025-topps-finest-basketball.csv">2025 Topps Finest Basketball Checklist</a>
`;
const links = extractToppsBasketballChecklistLinks(indexHtml, {
  baseUrl: "https://www.topps.com/pages/checklists"
});
assert.equal(links.length, 2);
assert.ok(links.every((link) => /Basketball/i.test(link.text)));
assert.equal(isAllowedToppsBasketballChecklistLink({ text: "2025 Topps Chrome Baseball Checklist" }), false);
assert.equal(isAllowedToppsBasketballChecklistLink({ text: "2025 Topps Chrome Basketball Checklist" }), true);

const rows = parseToppsBasketballChecklistText("TCAR-CF Cooper Flagg #136\nBAD ROW\nNS-CF Cooper Flagg", {
  sourceName: "2025 Topps Chrome Basketball Checklist",
  sourceUrl: "https://www.topps.com/checklists/2025-topps-chrome-basketball.pdf"
});
assert.equal(rows.length >= 2, true);
assert.equal(rows[0].identity_fields.sport, "basketball");
assert.equal(rows[0].identity_fields.manufacturer, "Topps");
assert.equal(rows[0].identity_fields.checklist_code, "TCAR-CF");

const importReport = await buildToppsBasketballChecklistImport({
  indexUrl: "https://www.topps.com/pages/checklists",
  fetchImpl: async (url) => {
    if (String(url).endsWith("/pages/checklists")) return new Response(indexHtml, { status: 200 });
    return new Response("TCAR-CF Cooper Flagg #136\n", { status: 200 });
  }
});
assert.equal(importReport.metrics.topps_basketball_link_count, 2);
assert.equal(importReport.metrics.topps_file_download_count, 2);

let catalogRpcBody = null;
const provider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_BASKETBALL_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async (url, options) => {
    assert.equal(String(url), "https://supabase.test/rest/v1/rpc/search_catalog_candidates");
    catalogRpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify([
      {
        identity_id: "11111111-1111-1111-1111-111111111111",
        canonical_title: "2025 Topps Chrome Basketball Cooper Flagg Gold #136",
        identity_key: "2025:Topps Chrome Basketball:Cooper Flagg:136",
        fields: {
          category: "basketball",
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome Basketball",
          players: ["Cooper Flagg"],
          collector_number: "136",
          surface_color: "Gold",
          official_card_type: "Base"
        },
        retrieval_status: "candidate",
        category: "basketball",
        source_type: "INTERNAL_CORRECTED_TITLE",
        source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
        supporting_fields: ["collector_number", "players", "year", "product"],
        raw_score: 0.84,
        normalized_score: 0.84,
        expected_serial_denominator: "50"
      }
    ]), { status: 200 });
  }
});
const providerResult = await provider.search({
  query: {
    exact_card_number: "136",
    exact_subject: "Cooper Flagg",
    exact_year: "2025",
    exact_product: "Topps Chrome Basketball",
    exact_serial_denominator: "/50"
  },
  resolved: {
    category: "basketball",
    year: "2025",
    product: "Topps Chrome Basketball",
    players: ["Cooper Flagg"],
    collector_number: "136",
    serial_number: "17/50"
  }
});
assert.equal(catalogRpcBody.exact_card_number, "136");
assert.equal(catalogRpcBody.exact_serial_denominator, "50");
assert.equal(providerResult.candidates.length, 1);
assert.equal(providerResult.candidates[0].provider_id, retrievalProviderIds.CATALOG);
assert.equal(providerResult.candidates[0].fields.serial_number, "/50");
assert.equal(providerResult.candidates[0].reference_metadata.expected_serial_denominator, "50");

const planned = planRetrievalQueries({
  resolved: {
    category: "basketball",
    year: "2025",
    product: "Topps Chrome Basketball",
    players: ["Cooper Flagg"],
    checklist_code: "TCAR-CF",
    collector_number: "136",
    serial_number: "17/50"
  },
  visualEmbeddings: [
    {
      image_id: "front",
      role: "front_original",
      embedding_role: "front_global",
      model_id: "google/siglip2-base-patch16-384",
      model_revision: "f775b65a79762255128c981547af89addcfe0f88",
      preprocessing_version: "card-rectification-v1",
      dimensions: 768,
      embedding: Array.from({ length: 768 }, (_, index) => index / 1000)
    }
  ],
  includeExternal: true,
  includeHybrid: true
});
const firstCatalogIndex = planned.findIndex((query) => query.provider_id === retrievalProviderIds.CATALOG);
const visualIndex = planned.findIndex((query) => query.family === retrievalQueryFamilies.VISUAL_VECTOR);
assert.ok(firstCatalogIndex >= 0);
assert.ok(visualIndex > firstCatalogIndex);
assert.equal(planned.some((query) => /paniniamerica\.net/i.test(query.query)), false);

console.log("catalog v0 tests passed");
