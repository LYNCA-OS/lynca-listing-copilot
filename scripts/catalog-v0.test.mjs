import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { componentBooleansFromObservableComponents } from "../lib/listing/card-type-policy.mjs";
import {
  correctedTitleRecordToCatalogStaging
} from "../lib/listing/catalog/internal-corrected-title-catalog.mjs";
import { normalizeResolvedFields } from "../lib/listing/evidence/evidence-schema.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import {
  catalogFieldStatuses,
  catalogImportStatuses,
  catalogSourceTypes,
  isOfficialReleaseCatalogSourceType
} from "../lib/listing/catalog/catalog-contract.mjs";
import {
  buildOfficialChecklistImport,
  buildToppsBasketballChecklistImport,
  extractOfficialChecklistPayload,
  extractOfficialChecklistLinks,
  extractToppsBasketballChecklistLinks,
  extractXlsxText,
  isAllowedToppsBasketballChecklistLink,
  officialChecklistParserVersion,
  parseOfficialChecklistText,
  parseToppsBasketballChecklistText
} from "../lib/listing/catalog/topps-basketball-checklist-importer.mjs";
import { pdfTextLinesFromItems } from "../lib/listing/catalog/pdf-text-extractor.mjs";
import {
  createOfficialCatalogSourceAdapter,
  discoverOfficialCatalogSource,
  officialCatalogSourceProfile
} from "../lib/listing/catalog/official-catalog-source-adapter.mjs";
import { renderResolvedTitle } from "../lib/listing/renderer/listing-renderer.mjs";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { planRetrievalQueries } from "../lib/listing/retrieval/query-planner.mjs";
import { importToppsBasketballChecklists } from "./import-topps-basketball-checklists.mjs";
import { validateOfficialSourceManifestReport } from "./import-official-source-manifest.mjs";
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
assert.equal(parsedCatalog.source.source_metadata.import_source, "corrected_title_catalog_v0");
assert.equal(parsedCatalog.source.source_metadata.prompt_safe_internal_writer_title, true);
assert.equal(parsedCatalog.source.source_metadata.title_derived_fields_are_ground_truth, false);
assert.equal(parsedCatalog.staging.identity_fields.surface_color, "Gold");
assert.equal(parsedCatalog.staging.identity_fields.serial_denominator, "50");
assert.equal(parsedCatalog.staging.identity_fields.serial_number, undefined);
assert.equal(parsedCatalog.staging.physical_instance_fields.serial_number, "17/50");
assert.equal(parsedCatalog.staging.physical_instance_fields.serial_numerator, "17");
assert.equal(parsedCatalog.staging.physical_instance_fields.grade_company, "PSA");
assert.equal(parsedCatalog.staging.identity_fields.grade_company, undefined);
assert.ok(parsedCatalog.staging.identity_fields.observable_components.includes("auto"));
assert.ok(parsedCatalog.staging.identity_fields.observable_components.includes("rc"));
assert.equal(parsedCatalog.staging.identity_fields.auto, true);
assert.equal(parsedCatalog.staging.identity_fields.rc, true);

const toppsNbaHoops = parseReviewedTitleFields("2025-26 Topps NBA Hoops Kevin Durant Hoopers Pixel Burst Red 1/5 SSP");
assert.equal(toppsNbaHoops.manufacturer, "Topps");
assert.equal(toppsNbaHoops.product, "Topps NBA Hoops");
assert.deepEqual(toppsNbaHoops.players, ["Kevin Durant"]);
assert.equal(toppsNbaHoops.official_card_type, "Hoopers Pixel Burst");
assert.equal(toppsNbaHoops.ssp, true);

const bowmanChromeSapphire = parseReviewedTitleFields(
  "2026 Bowman Chrome Sapphire Carson Benge New York Mets Yellow Sapphire 50/75"
);
assert.equal(bowmanChromeSapphire.product, "Bowman Chrome Sapphire");
assert.equal(bowmanChromeSapphire.surface_color, "Yellow");
assert.equal(bowmanChromeSapphire.team, "New York Mets");
assert.equal(bowmanChromeSapphire.serial_number, "50/75");
assert.equal(toppsNbaHoops.rarity, "SSP");

const bowmanUniversity = parseReviewedTitleFields("2025 Topps Bowman University Chrome Sienna Betts UCLA Anime SSP");
assert.equal(bowmanUniversity.manufacturer, "Topps");
assert.equal(bowmanUniversity.brand, "Bowman");
assert.equal(bowmanUniversity.product, "Bowman University Chrome");
assert.equal(bowmanUniversity.team, "UCLA");
assert.deepEqual(bowmanUniversity.players, ["Sienna Betts"]);
assert.equal(bowmanUniversity.official_card_type, "Anime");
assert.equal(bowmanUniversity.ssp, true);

const signatureClass = parseReviewedTitleFields("2025 Topps Signature Class George Kittle Round 5 Pick 2 Auto");
assert.equal(signatureClass.product, "Topps Signature Class");
assert.deepEqual(signatureClass.players, ["George Kittle"]);
assert.equal(signatureClass.official_card_type, "Round 5 Pick 2");

const leafSuperGold = parseReviewedTitleFields("2023 Leaf Metal Draft Xavier Hutchinson Portrait Auto Super Gold RC 1/1");
assert.equal(leafSuperGold.product, "Leaf Metal Draft");
assert.deepEqual(leafSuperGold.players, ["Xavier Hutchinson"]);
assert.equal(leafSuperGold.official_card_type, "Portrait Auto");
assert.equal(leafSuperGold.surface_color, "Gold");
assert.equal(leafSuperGold.parallel_family, null);
assert.equal(leafSuperGold.parallel_exact, "Super Gold");
assert.equal(leafSuperGold.rc, true);
assert.equal(leafSuperGold.auto, true);

const ufcRedBlue = parseReviewedTitleFields("2025 Topps Chrome UFC Reinier de Ridder RC Red & Blue Refractor Rookie");
assert.equal(ufcRedBlue.product, "Topps Chrome UFC");
assert.deepEqual(ufcRedBlue.players, ["Reinier De Ridder"]);
assert.equal(ufcRedBlue.surface_color, "Red");
assert.equal(ufcRedBlue.parallel_family, "Refractor");
assert.equal(ufcRedBlue.parallel_exact, "Red & Blue Refractor");
assert.equal(ufcRedBlue.rc, true);

const leafSuperGoldCatalog = correctedTitleRecordToCatalogStaging({
  id: "feedback-leaf-super-gold",
  corrected_title: "2023 Leaf Metal Draft Xavier Hutchinson Portrait Auto Super Gold RC 1/1"
});
assert.equal(leafSuperGoldCatalog.staging.identity_fields.parallel_exact, "Super Gold");
assert.equal(leafSuperGoldCatalog.staging.identity_fields.parallel, "Super Gold");
assert.equal(leafSuperGoldCatalog.staging.physical_instance_fields.serial_numerator, "1");

const messiCatalog = correctedTitleRecordToCatalogStaging({
  id: "feedback-soccer-1",
  corrected_title: "2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi 029/199 Auto #CL-LM"
});
assert.equal(messiCatalog.staging.identity_fields.sport, "soccer");
assert.equal(messiCatalog.staging.identity_fields.product, "Panini Prizm FIFA Soccer");
assert.equal(messiCatalog.staging.identity_fields.set_or_insert, null);
assert.equal(messiCatalog.staging.identity_fields.card_name, "Club Legends");
assert.deepEqual(messiCatalog.staging.identity_fields.players, ["Lionel Messi"]);
assert.equal(messiCatalog.staging.identity_fields.card_number, "CL-LM");
assert.equal(messiCatalog.staging.identity_fields.serial_denominator, "199");
assert.equal(messiCatalog.staging.physical_instance_fields.serial_numerator, "29");

const uccTeamCatalog = correctedTitleRecordToCatalogStaging({
  id: "feedback-soccer-2",
  corrected_title: "2024-25 Topps Chrome UCC FC Barcelona Lamine Yamal Rookie Refractor Gold 07/50 #150"
});
assert.equal(uccTeamCatalog.staging.identity_fields.product, "Topps Chrome UEFA Club Competitions");
assert.equal(uccTeamCatalog.staging.identity_fields.team, "FC Barcelona");
assert.deepEqual(uccTeamCatalog.staging.identity_fields.players, ["Lamine Yamal"]);
assert.equal(uccTeamCatalog.staging.identity_fields.official_card_type, "Rookie Refractor");
assert.equal(uccTeamCatalog.staging.identity_fields.surface_color, "Gold");
assert.equal(uccTeamCatalog.staging.identity_fields.serial_denominator, "50");

const blackProduct = parseReviewedTitleFields("2024 Panini Black Ricky Pearsall Metallic Marks Auto 10/25 #MM-RP");
assert.equal(blackProduct.product, "Panini Black");
assert.equal(blackProduct.surface_color, null);
assert.deepEqual(blackProduct.players, ["Ricky Pearsall"]);
assert.equal(blackProduct.official_card_type, "Metallic Marks");
assert.equal(blackProduct.serial_denominator, "25");

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

const allOfficialLinks = extractOfficialChecklistLinks(indexHtml, {
  baseUrl: "https://www.topps.com/pages/checklists",
  provider: "topps"
});
assert.equal(allOfficialLinks.length, 4);
assert.ok(allOfficialLinks.some((link) => link.category === "baseball"));
assert.ok(allOfficialLinks.some((link) => link.category === "entertainment"));

function zipEntry(name, content, offset) {
  const source = Buffer.from(content);
  const compressed = deflateRawSync(source);
  const nameBuffer = Buffer.from(name);
  const crc = 0;
  const local = Buffer.alloc(30 + nameBuffer.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt32LE(offset, 42);
  nameBuffer.copy(central, 46);
  return { local: Buffer.concat([local, compressed]), central };
}

function makeMiniXlsx() {
  const sharedStrings = `<?xml version="1.0"?><sst><si><t>Base Set Checklist</t></si><si><t>1 Jayson Tatum, Boston Celtics</t></si><si><t>Flagship Real Ones Autographs</t></si><si><t>TFRA-SC Stephen Curry, Golden State Warriors</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c></row><row r="4"><c r="A4" t="s"><v>3</v></c></row></sheetData></worksheet>`;
  const entries = [];
  let offset = 0;
  for (const [name, content] of [
    ["xl/sharedStrings.xml", sharedStrings],
    ["xl/worksheets/sheet1.xml", sheet]
  ]) {
    const entry = zipEntry(name, content, offset);
    entries.push(entry);
    offset += entry.local.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(entries.map((entry) => entry.central));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...entries.map((entry) => entry.local), central, end]);
}

const xlsxText = extractXlsxText(makeMiniXlsx());
assert.match(xlsxText, /1 Jayson Tatum, Boston Celtics/);
assert.match(xlsxText, /TFRA-SC Stephen Curry, Golden State Warriors/);

const leafRows = parseOfficialChecklistText([
  "Set\tSubset\tName\tChecklist\tFoil\tSilver\tRed\tBlue\tPink\tPurple\tGreen\tZebra\tTiger\tOil Spill\tGold\tClown Fish\tCity",
  "2024 Leaf Eclectic Football\tExotic\tOllie Gordon II\tE-OG1\t4-Kaleidoscope\t4\t3\t10\t9\t8\t7\t6\t5\t2\t1\t\tStillwater"
].join("\n"), {
  sourceName: "2024 Leaf Eclectic Football Checklist",
  sourceUrl: "https://leaf.example/2024-leaf-eclectic-football.xlsx",
  provider: "leaf",
  sourceType: catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST,
  category: "football"
});
assert.equal(leafRows.length, 1);
assert.equal(leafRows[0].identity_fields.product, "Leaf Eclectic Football");
assert.equal(leafRows[0].identity_fields.set_or_insert, "Exotic");
assert.deepEqual(leafRows[0].identity_fields.players, ["Ollie Gordon II"]);
assert.equal(leafRows[0].identity_fields.checklist_code, "E-OG1");
assert.equal(leafRows[0].identity_fields.parallel_name, "Kaleidoscope");
assert.equal(leafRows[0].identity_fields.parallel_exact, null);
assert.equal(leafRows[0].identity_fields.serial_denominator, null);
assert.equal(leafRows[0].physical_instance_fields.serial_number, undefined);

const pdfLines = pdfTextLinesFromItems([
  { str: "MIRRORED", transform: [1, 0, 0, 1, 53, 700] },
  { str: "Diana Shnaider", transform: [1, 0, 0, 1, 132, 680] },
  { str: "MR-25", transform: [1, 0, 0, 1, 53, 680] }
]);
assert.deepEqual(pdfLines, ["MIRRORED", "MR-25\tDiana Shnaider"]);
const pdfLayoutRows = parseOfficialChecklistText(pdfLines.join("\n"), {
  sourceName: "2026 Topps Graphite Tennis Checklist",
  sourceUrl: "https://cdn.shopify.com/2026-topps-graphite-tennis.pdf",
  provider: "topps"
});
assert.equal(pdfLayoutRows.length, 1);
assert.equal(pdfLayoutRows[0].identity_fields.checklist_code, "MR-25");
assert.deepEqual(pdfLayoutRows[0].identity_fields.players, ["Diana Shnaider"]);
assert.equal(pdfLayoutRows[0].identity_fields.set_or_insert, "MIRRORED");
await assert.rejects(
  () => extractOfficialChecklistPayload(Buffer.from("not-a-pdf"), { contentType: "application/pdf" }),
  /official_pdf_magic_invalid/
);

const rows = parseToppsBasketballChecklistText("Base Set Checklist\n1 Pascal Siakam, Indiana Pacers\n201 Cooper Flagg, Dallas Mavericks RC\nFlagship Real Ones Autographs\nTCAR-CF Cooper Flagg #136\nTFRA-SC Stephen Curry, Golden State Warriors\nBAD ROW\nNS-CF Cooper Flagg", {
  sourceName: "2025 Topps Chrome Basketball Checklist",
  sourceUrl: "https://www.topps.com/checklists/2025-topps-chrome-basketball.pdf"
});
assert.equal(rows.length >= 5, true);
assert.equal(rows[0].identity_fields.sport, "basketball");
assert.equal(rows[0].identity_fields.manufacturer, "Topps");
assert.equal(rows[0].import_status, catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE);
assert.equal(rows[0].field_statuses.product, catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST);
assert.equal(rows[0].identity_fields.players[0], "Pascal Siakam");
assert.equal(rows[0].identity_fields.team, "Indiana Pacers");
assert.equal(rows[0].identity_fields.official_card_type, "Base");
assert.equal(rows[1].identity_fields.players[0], "Cooper Flagg");
assert.equal(rows[1].identity_fields.observable_components.includes("rc"), true);
const curryOfficialAuto = rows.find((row) => row.identity_fields.checklist_code === "TFRA-SC");
assert.equal(curryOfficialAuto.identity_fields.players[0], "Stephen Curry");
assert.equal(curryOfficialAuto.identity_fields.team, "Golden State Warriors");
assert.equal(curryOfficialAuto.identity_fields.official_card_type, "Autograph");
assert.equal(curryOfficialAuto.identity_fields.observable_components.includes("auto"), true);
assert.equal(rows.some((row) => row.identity_fields.card_number === "BAD"), false);

const baseballOfficialRows = parseOfficialChecklistText("Base Set Checklist\n17 Shohei Ohtani, Los Angeles Dodgers", {
  sourceName: "2025 Topps Chrome Baseball Checklist",
  provider: "topps"
});
assert.equal(baseballOfficialRows.length, 1);
assert.equal(baseballOfficialRows[0].identity_fields.sport, "baseball");
assert.equal(baseballOfficialRows[0].identity_fields.manufacturer, "Topps");
assert.deepEqual(baseballOfficialRows[0].identity_fields.players, ["Shohei Ohtani"]);
assert.equal(baseballOfficialRows[0].physical_instance_fields.serial_number, undefined);
assert.equal(baseballOfficialRows[0].physical_instance_fields.card_grade, undefined);

const paniniOfficialRows = parseOfficialChecklistText("Downtown\nDT-CC Caitlin Clark, Indiana Fever", {
  sourceName: "2024 Panini Prizm Basketball Checklist",
  provider: "panini"
});
assert.equal(paniniOfficialRows[0].identity_fields.sport, "basketball");
assert.equal(paniniOfficialRows[0].identity_fields.manufacturer, "Panini");
assert.equal(paniniOfficialRows[0].identity_fields.checklist_code, "DT-CC");
assert.deepEqual(paniniOfficialRows[0].identity_fields.players, ["Caitlin Clark"]);

const upperDeckOfficialRows = parseOfficialChecklistText("Base Set Checklist\n1\tConnor Bedard\tChicago Blackhawks", {
  sourceName: "2024-25 Upper Deck Hockey Series One Checklist",
  provider: "upper_deck"
});
assert.equal(upperDeckOfficialRows[0].identity_fields.sport, "hockey");
assert.equal(upperDeckOfficialRows[0].identity_fields.manufacturer, "Upper Deck");
assert.deepEqual(upperDeckOfficialRows[0].identity_fields.players, ["Connor Bedard"]);

const importReport = await buildToppsBasketballChecklistImport({
  indexUrl: "https://www.topps.com/pages/checklists",
  fetchImpl: async (url) => {
    if (String(url).endsWith("/pages/checklists")) return new Response(indexHtml, { status: 200 });
    return new Response(makeMiniXlsx(), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    });
  }
});
assert.equal(importReport.metrics.topps_basketball_link_count, 2);
assert.equal(importReport.metrics.topps_file_download_count, 2);
assert.equal(importReport.metrics.catalog_card_count, 4);

const officialImportReport = await buildOfficialChecklistImport({
  indexUrl: "https://www.paniniamerica.net/checklists.html",
  provider: "panini",
  category: "basketball",
  sourceUrls: [
    {
      href: "https://www.paniniamerica.net/checklists/2024-prizm-basketball.txt",
      text: "2024 Panini Prizm Basketball Checklist"
    }
  ],
  fetchImpl: async () => new Response("Downtown\nDT-CC Caitlin Clark, Indiana Fever", {
    status: 200,
    headers: {
      "content-type": "text/plain"
    }
  })
});
assert.equal(officialImportReport.metrics.official_source_type, "PANINI_OFFICIAL_CHECKLIST");
assert.deepEqual(officialImportReport.metrics.official_source_types, ["PANINI_OFFICIAL_CHECKLIST"]);
assert.deepEqual(officialImportReport.metrics.official_source_type_counts, { PANINI_OFFICIAL_CHECKLIST: 1 });
assert.equal(officialImportReport.sources[0].source_type, "PANINI_OFFICIAL_CHECKLIST");
assert.equal(officialImportReport.sources[0].source_status, "OFFICIAL_CHECKLIST_RAW");
assert.equal(officialImportReport.sources[0].source_trust, "OFFICIAL_CHECKLIST_CANDIDATE");
assert.match(officialImportReport.sources[0].raw_checksum, /^[a-f0-9]{64}$/);
assert.equal(officialImportReport.staging.length, 1);
assert.equal(officialImportReport.staging[0].staging.identity_fields.manufacturer, "Panini");
assert.equal(officialImportReport.staging[0].staging.physical_instance_fields.serial_number, undefined);
assert.equal(officialImportReport.metrics.parsed_row_count, 1);
assert.equal(officialImportReport.metrics.promotion_candidate_count, 1);
const manifestValidation = validateOfficialSourceManifestReport({
  sources: [{
    source_name: "2024 Panini Prizm Basketball Checklist",
    source_url: "https://www.paniniamerica.net/checklists/2024-prizm-basketball.txt",
    minimum_card_count: 1,
    required_records: [{ checklist_code: "DT-CC", subject: "Caitlin Clark", product: "Panini Prizm Basketball" }]
  }]
}, officialImportReport);
assert.equal(manifestValidation.valid, true);
assert.equal(manifestValidation.validations[0].record_checks[0].matched, true);

const leafChecklistReport = await buildOfficialChecklistImport({
  provider: "leaf",
  sourceUrls: [{
    href: "https://leaf.example/2024-leaf-eclectic-football.txt",
    text: "2024 Leaf Eclectic Football Checklist",
    source_type: catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST,
    category: "football"
  }],
  fetchImpl: async () => new Response([
    "Set\tSubset\tName\tChecklist\tFoil",
    "2024 Leaf Eclectic Football\tExotic\tOllie Gordon II\tE-OG1\t4-Kaleidoscope"
  ].join("\n"), {
    status: 200,
    headers: { "content-type": "text/plain" }
  })
});
assert.equal(leafChecklistReport.metrics.official_source_type, catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST);
assert.deepEqual(leafChecklistReport.metrics.official_source_types, [catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST]);
const leafManifestValidation = validateOfficialSourceManifestReport({
  sources: [{
    source_name: "2024 Leaf Eclectic Football Checklist",
    source_url: "https://leaf.example/2024-leaf-eclectic-football.txt",
    source_type: catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST,
    minimum_card_count: 1,
    required_records: [{
      checklist_code: "E-OG1",
      subject: "Ollie Gordon II",
      product: "Leaf Eclectic Football",
      set_or_insert: "Exotic"
    }]
  }]
}, leafChecklistReport);
assert.equal(leafManifestValidation.valid, true);
assert.equal(leafManifestValidation.validations[0].source_type_matches, true);
assert.equal(leafManifestValidation.validations[0].actual_source_type, catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST);

const leafTypeMismatchValidation = validateOfficialSourceManifestReport({
  sources: [{
    source_name: "2024 Leaf Eclectic Football Checklist",
    source_url: "https://leaf.example/2024-leaf-eclectic-football.txt",
    source_type: catalogSourceTypes.LEAF_OFFICIAL_RELEASE,
    minimum_card_count: 1
  }]
}, leafChecklistReport);
assert.equal(leafTypeMismatchValidation.valid, false);
assert.equal(leafTypeMismatchValidation.validations[0].source_type_matches, false);

const productionToppsManifest = JSON.parse(await readFile(new URL(
  "../data/catalog/official/topps-production-sources.json",
  import.meta.url
), "utf8"));
const bowman2026Source = productionToppsManifest.sources.find((source) => (
  source.source_name === "2026 Bowman Baseball Checklist"
));
assert.ok(bowman2026Source, "production official-source manifest must include 2026 Bowman");
assert.ok(bowman2026Source.minimum_card_count >= 1000);
assert.deepEqual(bowman2026Source.required_records[0], {
  checklist_code: "BWC-19",
  subject: "Shohei Ohtani",
  product: "Bowman Baseball",
  set_or_insert: "CRYSTALLIZED"
});

const productionLeafManifest = JSON.parse(await readFile(new URL(
  "../data/catalog/official/leaf-production-sources.json",
  import.meta.url
), "utf8"));
const eclectic2024Source = productionLeafManifest.sources.find((source) => (
  source.source_name === "2024 Leaf Eclectic Football Checklist"
));
assert.ok(eclectic2024Source, "production official-source manifest must include 2024 Leaf Eclectic Football");
assert.equal(eclectic2024Source.source_type, catalogSourceTypes.LEAF_OFFICIAL_CHECKLIST);
assert.ok(eclectic2024Source.minimum_card_count >= 1000);
assert.deepEqual(eclectic2024Source.required_records[0], {
  checklist_code: "E-OG1",
  subject: "Ollie Gordon II",
  product: "Leaf Eclectic Football",
  set_or_insert: "Exotic"
});

assert.equal(officialCatalogSourceProfile("leaf").source_type, catalogSourceTypes.LEAF_OFFICIAL_RELEASE);
assert.equal(isOfficialReleaseCatalogSourceType(catalogSourceTypes.LEAF_OFFICIAL_RELEASE), true);

const paniniDiscovery = await discoverOfficialCatalogSource({
  provider: "panini",
  indexUrl: "https://www.paniniamerica.net/checklist.html",
  category: "basketball",
  fetchImpl: async () => new Response(`
    <script>window.__api='/api/checklists?sport=Basketball'</script>
    <a href="/checklists/2024-prizm-basketball.txt">2024 Panini Prizm Basketball Checklist</a>
  `, { status: 200 })
});
assert.equal(paniniDiscovery.provider, "panini");
assert.equal(paniniDiscovery.source_type, catalogSourceTypes.PANINI_OFFICIAL_CHECKLIST);
assert.equal(paniniDiscovery.sources.length, 1);
assert.ok(paniniDiscovery.network_endpoint_hints.some((hint) => /api\/checklists/i.test(hint)));
assert.equal(paniniDiscovery.manual_csv_fallback.enabled, true);
assert.ok(paniniDiscovery.manual_csv_fallback.columns.includes("checklist_code"));

const leafAdapter = createOfficialCatalogSourceAdapter({
  provider: "leaf",
  fetchImpl: async () => new Response("2025 Leaf Metal Basketball Autographs release page", { status: 200 })
});
const leafReport = await leafAdapter.buildImportReport({
  sourceUrls: [{
    href: "https://leaftradingcards.com/releases/2025-leaf-metal-basketball",
    text: "2025 Leaf Metal Basketball"
  }]
});
assert.equal(leafReport.source_type, catalogSourceTypes.LEAF_OFFICIAL_RELEASE);
assert.equal(leafReport.metrics.source_count, 1);
assert.equal(leafReport.raw.staging[0].staging.import_status, catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT);
assert.equal(leafReport.raw.staging[0].staging.physical_instance_fields.serial_number, undefined);
assert.equal(leafReport.raw.staging[0].staging.identity_fields.manufacturer, "Leaf");

const officialImportDryRun = await importToppsBasketballChecklists({
  argv: [
    "--source-url",
    "https://cdn.shopify.com/s/files/1/0586/3119/2678/files/2025-26-Topps-Basketball-Checklist.xlsx",
    "--source-name",
    "2025-26 Topps Basketball Checklist"
  ],
  env: {},
  fetchImpl: async () => new Response(makeMiniXlsx(), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  })
});
assert.equal(officialImportDryRun.dry_run, true);
assert.equal(officialImportDryRun.source_count, 1);
assert.equal(officialImportDryRun.inserted_card_count, 2);
assert.equal(officialImportDryRun.inserted_staging_count, 2);

function officialApplyFetch({ payload, existingCardCount, reviewedCounts = {}, checksum = "" } = {}) {
  const calls = [];
  let productSequence = 0;
  let setSequence = 0;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || "GET";
    calls.push({ href, method });
    if (href === "https://official.test/checklist.txt") {
      return new Response(payload, { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (href.includes("/rest/v1/catalog_sources?") && method === "GET") {
      return new Response(JSON.stringify([{
        id: "source-existing",
        source_url: "https://official.test/checklist.txt",
        source_status: "OFFICIAL_CHECKLIST_RAW",
        source_metadata: {},
        raw_checksum: checksum,
        parser_version: officialChecklistParserVersion
      }]), { status: 200 });
    }
    if (method === "HEAD") {
      const table = href.match(/\/rest\/v1\/([^?]+)/)?.[1] || "";
      const reviewed = href.includes("review_status=eq.REVIEWED_INTERNAL");
      const count = reviewed ? Number(reviewedCounts[table] || 0) : Number(existingCardCount || 0);
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${count}` } });
    }
    if (method === "DELETE" || method === "PATCH") return new Response(null, { status: 204 });
    if (href.includes("/rest/v1/catalog_products") && method === "POST") {
      productSequence += 1;
      return new Response(JSON.stringify([{ id: `product-${productSequence}` }]), { status: 201 });
    }
    if (href.includes("/rest/v1/catalog_sets") && method === "POST") {
      setSequence += 1;
      return new Response(JSON.stringify([{ id: `set-${setSequence}` }]), { status: 201 });
    }
    if (method === "POST") return new Response(JSON.stringify([]), { status: 201 });
    throw new Error(`unexpected official apply request: ${method} ${href}`);
  };
  return { fetchImpl, calls };
}

const resumablePayload = "Base Set Checklist\n1 Jayson Tatum, Boston Celtics\n2 Jaylen Brown, Boston Celtics";
const resumableChecksum = createHash("sha256").update(resumablePayload).digest("hex");
const completeOfficialApply = officialApplyFetch({
  payload: resumablePayload,
  existingCardCount: 2,
  checksum: resumableChecksum
});
const completeOfficialApplyReport = await importToppsBasketballChecklists({
  argv: [
    "--all-topps",
    "--source-url", "https://official.test/checklist.txt",
    "--source-name", "2025 Topps Basketball Checklist",
    "--apply",
    "--no-env-file"
  ],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "test-key" },
  fetchImpl: completeOfficialApply.fetchImpl
});
assert.equal(completeOfficialApplyReport.verified_existing_source_count, 1);
assert.equal(completeOfficialApplyReport.inserted_card_count, 0);
assert.equal(completeOfficialApply.calls.some((call) => call.method === "DELETE"), false);

const partialOfficialApply = officialApplyFetch({
  payload: resumablePayload,
  existingCardCount: 1,
  checksum: resumableChecksum
});
const partialOfficialApplyReport = await importToppsBasketballChecklists({
  argv: [
    "--all-topps",
    "--source-url", "https://official.test/checklist.txt",
    "--source-name", "2025 Topps Basketball Checklist",
    "--apply",
    "--no-env-file"
  ],
  env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "test-key" },
  fetchImpl: partialOfficialApply.fetchImpl
});
assert.equal(partialOfficialApplyReport.recovered_partial_source_count, 1);
assert.equal(partialOfficialApplyReport.refreshed_source_count, 1);
assert.equal(partialOfficialApplyReport.inserted_card_count, 2);
assert.equal(partialOfficialApply.calls.filter((call) => call.method === "DELETE").length, 5);
assert.equal(partialOfficialApply.calls.filter((call) => call.method === "PATCH").length, 1);

const reviewedOfficialApply = officialApplyFetch({
  payload: resumablePayload,
  existingCardCount: 1,
  reviewedCounts: { catalog_cards: 1 },
  checksum: resumableChecksum
});
await assert.rejects(
  () => importToppsBasketballChecklists({
    argv: [
      "--all-topps",
      "--source-url", "https://official.test/checklist.txt",
      "--source-name", "2025 Topps Basketball Checklist",
      "--apply",
      "--no-env-file"
    ],
    env: { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "test-key" },
    fetchImpl: reviewedOfficialApply.fetchImpl
  }),
  /official_source_refresh_blocked_reviewed_rows/
);
assert.equal(reviewedOfficialApply.calls.some((call) => call.method === "DELETE"), false);

let catalogRpcBody = null;
const provider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_BASKETBALL_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async (url, options) => {
    assert.equal(String(url), "https://supabase.test/rest/v1/rpc/search_catalog_candidates_with_source");
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
        source_feedback_id: "feedback-other-card",
        expected_serial_denominator: "50"
      },
      {
        identity_id: "33333333-3333-3333-3333-333333333333",
        canonical_title: "2025 Topps Chrome Basketball Cooper Flagg Gold #136",
        fields: {
          year: "2025",
          product: "Topps Chrome Basketball",
          players: ["Cooper Flagg"],
          collector_number: "136"
        },
        retrieval_status: "reviewed",
        source_type: "INTERNAL_CORRECTED_TITLE",
        source_status: "REVIEWED_INTERNAL",
        supporting_fields: ["collector_number", "players", "year", "product"],
        raw_score: 1,
        normalized_score: 1,
        source_feedback_id: "feedback-current-card"
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
    exact_serial_denominator: "/50",
    exclude_source_feedback_ids: ["feedback-current-card"]
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
assert.equal(providerResult.candidates[0].source_feedback_id, "feedback-other-card");
assert.equal(providerResult.candidates[0].reference_metadata.source_feedback_id, "feedback-other-card");
assert.equal(providerResult.candidates[0].fields.serial_number, "#/50");
assert.equal(providerResult.candidates[0].reference_metadata.expected_serial_denominator, "50");

const subjectPreservationProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_BASKETBALL_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async () => new Response(JSON.stringify([{
    identity_id: "44444444-4444-4444-4444-444444444444",
    canonical_title: "2026 Bowman Shohei Ohtani Electric Sluggers Refractor",
    fields: {
      year: "2026",
      product: "Bowman",
      players: ["Shohei Ohtani"]
    },
    retrieval_status: "reviewed",
    source_type: "INTERNAL_CORRECTED_TITLE",
    source_status: "REVIEWED_INTERNAL",
    raw_score: 1,
    normalized_score: 1
  }]), { status: 200 })
});
const subjectPreservationResult = await subjectPreservationProvider.search({
  query: { exact_subject: "Shohei Ohtani", exact_year: "2026" }
});
assert.deepEqual(
  subjectPreservationResult.candidates[0].fields.players,
  ["Shohei Ohtani"],
  "reviewed structured subjects must not absorb title-only insert/card-name suffixes"
);

const fallbackUrls = [];
const preMigrationProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async (url) => {
    fallbackUrls.push(String(url));
    if (String(url).endsWith("/search_catalog_candidates_with_source")) {
      return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }
});
const preMigrationResult = await preMigrationProvider.search({
  query: { exact_subject: "Cooper Flagg" }
});
assert.equal(preMigrationResult.unavailable, undefined);
assert.deepEqual(fallbackUrls, [
  "https://supabase.test/rest/v1/rpc/search_catalog_candidates_with_source",
  "https://supabase.test/rest/v1/rpc/search_catalog_candidates"
]);

const failClosedUrls = [];
const failClosedPreMigrationProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async (url) => {
    failClosedUrls.push(String(url));
    return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 });
  }
});
const failClosedPreMigrationResult = await failClosedPreMigrationProvider.search({
  query: {
    exact_subject: "Cooper Flagg",
    exclude_source_feedback_ids: ["feedback-current-card"]
  }
});
assert.equal(failClosedPreMigrationResult.unavailable, true);
assert.deepEqual(failClosedUrls, [
  "https://supabase.test/rest/v1/rpc/search_catalog_candidates_with_source"
]);

const officialProvider = catalogProvider({
  env: {
    SUPABASE_URL: "https://supabase.test/",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ENABLE_CATALOG_RETRIEVAL: "true"
  },
  fetchImpl: async () => new Response(JSON.stringify([
    {
      identity_id: "22222222-2222-2222-2222-222222222222",
      canonical_title: "2024 Panini Prizm Basketball Caitlin Clark Downtown #DT-CC",
      identity_key: "basketball:2024:Panini Prizm Basketball:Downtown:Caitlin Clark:DT-CC",
      fields: {
        category: "basketball",
        year: "2024",
        manufacturer: "Panini",
        product: "Panini Prizm Basketball",
        set: "Downtown",
        players: ["Caitlin Clark"],
        checklist_code: "DT-CC"
      },
      retrieval_status: "registry",
      category: "basketball",
      source_type: "PANINI_OFFICIAL_CHECKLIST",
      source_status: "OFFICIAL_CHECKLIST_RAW",
      supporting_fields: ["checklist_code", "players", "product"],
      raw_score: 0.88,
      normalized_score: 0.88,
      expected_serial_denominator: null
    }
  ]), { status: 200 })
});
const officialProviderResult = await officialProvider.search({
  query: {
    exact_checklist_code: "DT-CC",
    exact_subject: "Caitlin Clark",
    exact_product: "Panini Prizm Basketball"
  }
});
assert.equal(officialProviderResult.candidates[0].source_type, "OFFICIAL_CHECKLIST");
assert.equal(officialProviderResult.candidates[0].trust_tier, 2);
assert.equal(officialProviderResult.candidates[0].source_trust, "APPROVED_REFERENCE");
assert.equal(officialProviderResult.candidates[0].reference_metadata.source_type, "PANINI_OFFICIAL_CHECKLIST");
assert.equal(officialProviderResult.candidates[0].reference_metadata.official_catalog_prompt_safe, true);
assert.equal(officialProviderResult.candidates[0].field_derivation.official_catalog_prompt_safe, true);
assert.equal(officialProviderResult.candidates[0].field_derivation.reviewed_ground_truth_used, false);

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
  includeHybrid: true,
  excludeSourceFeedbackIds: ["feedback-current-card"]
});
const firstCatalogIndex = planned.findIndex((query) => query.provider_id === retrievalProviderIds.CATALOG);
const visualIndex = planned.findIndex((query) => query.family === retrievalQueryFamilies.VISUAL_VECTOR);
assert.ok(firstCatalogIndex >= 0);
assert.ok(visualIndex > firstCatalogIndex);
assert.equal(planned.some((query) => /paniniamerica\.net/i.test(query.query)), false);
assert.ok(
  planned.filter((query) => query.provider_id === retrievalProviderIds.CATALOG)
    .every((query) => query.exclude_source_feedback_ids?.[0] === "feedback-current-card" && query.cacheable === false),
  "formal evaluation must exclude only the current answer from catalog retrieval and bypass the shared cache"
);
assert.ok(
  planned.filter((query) => query.provider_id === retrievalProviderIds.VISUAL_VECTOR)
    .every((query) => query.exclude_source_feedback_ids?.[0] === "feedback-current-card" && query.cacheable === false),
  "visual-vector retrieval must still exclude the current source image"
);

console.log("catalog v0 tests passed");
