#!/usr/bin/env node
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { correctedTitleRecordToCatalogStaging } from "../lib/listing/catalog/internal-corrected-title-catalog.mjs";
import { catalogImportStatuses, catalogFieldStatuses } from "../lib/listing/catalog/catalog-contract.mjs";
import { extractXlsxText } from "../lib/listing/catalog/topps-basketball-checklist-importer.mjs";

const defaultInput = "/Users/paidaxin/Desktop/卡片测试/Ebay上标(1).xlsx";
const defaultOut = "data/catalog/writer-title-seed/writer-title-catalog-seed-report.json";
const defaultStagingOut = "data/catalog/writer-title-seed/writer-title-catalog-staging.jsonl";
const defaultVectorOut = "data/catalog/writer-title-seed/writer-title-vector-seeds.jsonl";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1] || fallback;
  const prefix = `${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTitleKey(value = "") {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9#/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function unquoteEnvValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  return trimmed;
}

async function readEnvFile(path = "") {
  const resolved = resolve(path || "");
  if (!path || !existsSync(resolved)) return {};
  const text = await readFile(resolved, "utf8");
  const parsed = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnvFromFiles(argv = process.argv, env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFilePath = argValue(argv, "--env-file", env.CATALOG_IMPORT_ENV_FILE || ".env.vercel.production.local");
  const fileEnv = await readEnvFile(envFilePath);
  return { ...fileEnv, ...env };
}

function supabaseConfig(env = process.env) {
  return {
    url: normalizeText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, ""),
    serviceRoleKey: normalizeText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)
  };
}

function supabaseHeaders(serviceRoleKey, prefer = "") {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...(prefer ? { prefer } : {})
  };
}

async function supabaseRequest({
  env,
  path,
  method = "GET",
  body,
  prefer = "",
  fetchImpl = globalThis.fetch
} = {}) {
  const config = supabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const response = await fetchImpl(`${config.url}${path}`, {
    method,
    headers: supabaseHeaders(config.serviceRoleKey, prefer),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`Supabase request failed ${method} ${path}: HTTP ${response.status} ${String(text).slice(0, 240)}`);
  }
  return data;
}

async function writeText(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, value);
}

function parseDelimitedWorkbookText(rawText = "") {
  const rows = [];
  const lines = String(rawText || "").split(/\r?\n/);
  let currentSection = "";
  for (const [index, line] of lines.entries()) {
    const rowNumber = index + 1;
    const cells = line.split("\t").map(normalizeText);
    if (rowNumber === 1 && /序号|title|标题/i.test(cells.join(" "))) continue;
    const first = cells[0] || "";
    const second = cells[1] || "";
    if (second) {
      if (looksLikeSectionLabel(first)) currentSection = first;
      rows.push({ row_number: rowNumber, section_label: currentSection || first || "", title: second, raw_cells: cells });
      continue;
    }
    if (!first) continue;
    if (looksLikeSectionLabel(first)) {
      currentSection = first;
      rows.push({ row_number: rowNumber, section_label: currentSection, title: "", raw_cells: cells, marker: true });
      continue;
    }
    rows.push({ row_number: rowNumber, section_label: currentSection, title: first, raw_cells: cells });
  }
  return rows;
}

function looksLikeSectionLabel(value = "") {
  const text = normalizeText(value);
  if (!text) return false;
  if (/[\u4e00-\u9fff]/u.test(text) && /(?:标|议价|河马|龙龙|克里斯|大脚丫|萨米斯基|飞哥|张恩玮|PP)/i.test(text)) return true;
  return /^（?\d+）?[^A-Za-z]{0,8}(?:标|议价)$/u.test(text);
}

function nonTitleReason(title = "") {
  const text = normalizeText(title);
  if (!text) return "blank";
  if (looksLikeSectionLabel(text)) return "section_marker";
  if (/^\d{1,2}月-\d{2,}-[\u4e00-\u9fffA-Za-z0-9_-]+$/u.test(text)) return "batch_marker";
  if (text.length < 8) return "too_short";
  const latinLetters = (text.match(/[A-Za-z]/g) || []).length;
  if (latinLetters < 3) return "not_enough_latin_text";
  return "";
}

function readTitleRowsFromBuffer(buffer, inputPath = "") {
  const lower = String(inputPath || "").toLowerCase();
  const rawText = lower.endsWith(".xlsx") || buffer.slice(0, 4).toString("hex") === "504b0304"
    ? extractXlsxText(buffer)
    : buffer.toString("utf8");
  return parseDelimitedWorkbookText(rawText);
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && normalizeText(value) !== "" && value !== "UNKNOWN";
}

function compact(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, fieldValue]) => valuePresent(fieldValue)));
}

function reviewRequiredFields(fieldStatuses = {}) {
  return Object.entries(fieldStatuses || {})
    .filter(([, status]) => status === catalogFieldStatuses.REVIEW_REQUIRED)
    .map(([field]) => field);
}

function parsedFieldPayload(staging = {}) {
  return compact({
    ...(staging.identity_fields || {}),
    ...(staging.physical_instance_fields || {})
  });
}

function vectorSeedFromStaged({ source = {}, staging = {}, sourceRow = {}, batchId = "" } = {}) {
  const identityFields = staging.identity_fields || {};
  const instanceFields = staging.physical_instance_fields || {};
  const subject = Array.isArray(identityFields.players) ? identityFields.players.join(" / ") : "";
  const searchText = [
    staging.canonical_title,
    identityFields.season_year,
    identityFields.manufacturer,
    identityFields.product,
    identityFields.set_or_insert,
    subject,
    identityFields.card_name,
    identityFields.character,
    identityFields.card_number,
    identityFields.checklist_code,
    identityFields.surface_color,
    identityFields.serial_denominator ? `/${identityFields.serial_denominator}` : "",
    instanceFields.grade_company,
    instanceFields.card_grade
  ].filter(Boolean).join(" ");
  return {
    schema_version: "writer_title_vector_seed_v1",
    batch_id: batchId,
    source_row_key: staging.source_row_key,
    source_type: source.source_type,
    source_trust: "APPROVED_REFERENCE",
    title: staging.canonical_title,
    search_text: normalizeText(searchText),
    identity_fields: identityFields,
    physical_instance_fields: instanceFields,
    embedding_texts: {
      title: staging.canonical_title,
      identity_text: normalizeText([
        identityFields.season_year,
        identityFields.product,
        subject || identityFields.character || identityFields.card_name,
        identityFields.card_number || identityFields.checklist_code
      ].filter(Boolean).join(" ")),
      retrieval_text: normalizeText(searchText)
    },
    usage: [
      "catalog_candidate_generation",
      "postgres_text_search",
      "text_embedding_seed",
      "reranker_feature"
    ],
    metadata: {
      workbook_row: sourceRow.row_number,
      section_label: sourceRow.section_label || null,
      title_derived_fields_are_ground_truth: false,
      copy_serial_grade_cert_to_query: false
    }
  };
}

function enhanceStaged(staged, {
  inputPath = "",
  fileChecksum = "",
  sourceRow = {},
  batchId = "",
  titleChecksum = ""
} = {}) {
  const required = reviewRequiredFields(staged.staging.field_statuses || {});
  staged.source.source_name = "offline writer eBay uploaded title seed";
  staged.source.raw_checksum = titleChecksum;
  staged.source.source_metadata = {
    ...(staged.source.source_metadata || {}),
    writer_title_importer: "offline_writer_title_seed_v1",
    writer_title_batch_id: batchId,
    source_file_name: inputPath.split(/[\\/]/).pop() || inputPath,
    source_file_sha256: fileChecksum,
    workbook_row: sourceRow.row_number,
    section_label: sourceRow.section_label || null,
    marketplace_upload_target: "ebay",
    title_quality_note: "writer organized marketplace title; useful for catalog construction, not final LYNCA title style",
    corrected_title_is_ground_truth: true,
    corrected_title_is_reviewed_title_ground_truth: true,
    title_ground_truth_scope: "writer_reviewed_ebay_upload_title",
    title_derived_fields_are_ground_truth: false
  };
  staged.staging.raw_text = staged.staging.canonical_title;
  staged.staging.source_title = staged.staging.canonical_title;
  staged.staging.source_type = staged.source.source_type;
  staged.staging.source_trust = "INTERNAL_WRITER_REVIEWED_TITLE";
  staged.staging.raw_checksum = titleChecksum;
  staged.staging.parsed_fields = parsedFieldPayload(staged.staging);
  staged.staging.field_status_by_name = staged.staging.field_statuses || {};
  staged.staging.review_required_fields = required;
  staged.staging.source_url = null;
  staged.staging.parse_confidence = staged.staging.import_status === catalogImportStatuses.AUTO_PARSED_FROM_VERIFIED_TITLE
    ? Math.max(Number(staged.staging.parse_confidence || 0), 0.68)
    : Number(staged.staging.parse_confidence || 0.35);
  return staged;
}

export async function buildWriterTitleCatalogSeed({
  inputPath = defaultInput,
  batchId = "",
  limit = 0
} = {}) {
  const resolvedInput = resolve(inputPath);
  const buffer = await readFile(resolvedInput);
  const fileChecksum = sha256(buffer);
  const resolvedBatchId = batchId || `writer_title_seed_${fileChecksum.slice(0, 12)}`;
  const rows = readTitleRowsFromBuffer(buffer, resolvedInput);
  const seenTitles = new Map();
  const skipped = [];
  const duplicateRows = [];
  const stagedRows = [];
  const vectorSeeds = [];
  let markerRows = 0;

  for (const sourceRow of rows) {
    if (sourceRow.marker) {
      markerRows += 1;
      continue;
    }
    const title = normalizeText(sourceRow.title);
    const reason = nonTitleReason(title);
    if (reason) {
      skipped.push({ row_number: sourceRow.row_number, title, reason, section_label: sourceRow.section_label || null });
      continue;
    }
    const titleKey = normalizeTitleKey(title);
    if (seenTitles.has(titleKey)) {
      duplicateRows.push({ row_number: sourceRow.row_number, duplicate_of_row: seenTitles.get(titleKey), title });
      continue;
    }
    seenTitles.set(titleKey, sourceRow.row_number);
    const titleChecksum = sha256(`writer-title:${titleKey}`);
    const staged = correctedTitleRecordToCatalogStaging({
      id: `writer-title-row-${sourceRow.row_number}`,
      source_feedback_id: `writer-title:${resolvedBatchId}:${sourceRow.row_number}`,
      corrected_title: title
    });
    if (!staged) continue;
    enhanceStaged(staged, { inputPath: resolvedInput, fileChecksum, sourceRow, batchId: resolvedBatchId, titleChecksum });
    stagedRows.push({
      source_row: sourceRow,
      source: staged.source,
      staging: staged.staging
    });
    vectorSeeds.push(vectorSeedFromStaged({ ...staged, sourceRow, batchId: resolvedBatchId }));
    if (limit && stagedRows.length >= limit) break;
  }

  const report = buildReport({
    inputPath: resolvedInput,
    batchId: resolvedBatchId,
    fileChecksum,
    sourceRows: rows,
    markerRows,
    skipped,
    duplicateRows,
    stagedRows,
    vectorSeeds
  });
  return { report, stagedRows, vectorSeeds, skipped, duplicateRows };
}

function increment(map, key) {
  const normalized = normalizeText(key) || "UNKNOWN";
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function fieldCoverage(stagedRows = []) {
  const fields = [
    "category",
    "sport",
    "season_year",
    "manufacturer",
    "brand",
    "product",
    "set_or_insert",
    "players",
    "character",
    "card_name",
    "language",
    "rarity",
    "card_number",
    "checklist_code",
    "surface_color",
    "serial_denominator",
    "grade_company",
    "card_grade"
  ];
  return Object.fromEntries(fields.map((field) => [
    field,
    stagedRows.filter((row) => valuePresent((row.staging.identity_fields || {})[field] || (row.staging.physical_instance_fields || {})[field])).length
  ]));
}

function buildReport({
  inputPath = "",
  batchId = "",
  fileChecksum = "",
  sourceRows = [],
  markerRows = 0,
  skipped = [],
  duplicateRows = [],
  stagedRows = [],
  vectorSeeds = []
} = {}) {
  const categories = new Map();
  const products = new Map();
  const statuses = new Map();
  const sections = new Map();
  for (const row of stagedRows) {
    const fields = row.staging.identity_fields || {};
    increment(categories, fields.category || fields.sport);
    increment(products, fields.product);
    increment(statuses, row.staging.import_status);
    increment(sections, row.source_row.section_label || "unsectioned");
  }
  return {
    schema_version: "writer-title-catalog-seed-report-v1",
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    batch_id: batchId,
    file_sha256: fileChecksum,
    policy: {
      source_type: "INTERNAL_CORRECTED_TITLE",
      seller_or_marketplace_scraped_title: false,
      writer_reviewed_upload_title: true,
      enters_catalog_candidate_generation: true,
      enters_vector_seed_export: true,
      final_title_renderer_still_authoritative: true,
      title_derived_fields_are_ground_truth: false,
      serial_grade_cert_copy_forbidden: true
    },
    row_counts: {
      source_rows: sourceRows.length,
      marker_rows: markerRows,
      skipped_non_title_rows: skipped.length,
      duplicate_title_rows: duplicateRows.length,
      unique_catalog_seed_rows: stagedRows.length,
      vector_seed_rows: vectorSeeds.length
    },
    import_status_breakdown: topEntries(statuses, 20),
    category_breakdown: topEntries(categories, 30),
    top_products: topEntries(products, 40),
    top_sections: topEntries(sections, 30),
    field_coverage: fieldCoverage(stagedRows),
    review_required_count: stagedRows.filter((row) => row.staging.import_status === catalogImportStatuses.REVIEW_REQUIRED).length,
    sample_rows: stagedRows.slice(0, 20).map((row) => ({
      row_number: row.source_row.row_number,
      section_label: row.source_row.section_label || null,
      title: row.staging.canonical_title,
      import_status: row.staging.import_status,
      identity_fields: compact(row.staging.identity_fields),
      physical_instance_fields: compact(row.staging.physical_instance_fields)
    })),
    skipped_samples: skipped.slice(0, 20),
    duplicate_samples: duplicateRows.slice(0, 20)
  };
}

function productRow(sourceId, fields = {}, sourceRowKey = "") {
  return compact({
    sport: fields.sport || fields.category || "unknown",
    league: fields.league,
    season_year: fields.season_year,
    manufacturer: fields.manufacturer,
    brand: fields.brand || fields.manufacturer,
    product: fields.product,
    source_id: sourceId,
    source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "writer_title_catalog_seed_v1",
      source_row_key: sourceRowKey,
      category_candidates: fields.category_candidates || [],
      secondary_categories: fields.secondary_categories || [],
      title_derived_fields_are_ground_truth: false
    }
  });
}

function setRow(sourceId, productId, fields = {}, sourceRowKey = "") {
  if (!fields.set_or_insert && !fields.subset && !fields.official_card_type) return null;
  return compact({
    product_id: productId,
    set_or_insert: fields.set_or_insert,
    subset: fields.subset,
    official_card_type: fields.official_card_type,
    source_id: sourceId,
    source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "writer_title_catalog_seed_v1",
      source_row_key: sourceRowKey,
      category_candidates: fields.category_candidates || [],
      secondary_categories: fields.secondary_categories || [],
      title_derived_fields_are_ground_truth: false
    }
  });
}

function cardRow(sourceId, productId, setId, fields = {}, title = "", sourceRowKey = "") {
  return compact({
    product_id: productId,
    set_id: setId,
    sport: fields.sport || fields.category || "unknown",
    league: fields.league,
    season_year: fields.season_year,
    manufacturer: fields.manufacturer,
    brand: fields.brand || fields.manufacturer,
    product: fields.product,
    set_or_insert: fields.set_or_insert,
    subset: fields.subset,
    players: Array.isArray(fields.players) ? fields.players : [],
    team: fields.team,
    card_number: fields.card_number,
    checklist_code: fields.checklist_code,
    official_card_type: fields.official_card_type,
    observable_components: Array.isArray(fields.observable_components) ? fields.observable_components : [],
    surface_color: fields.surface_color,
    serial_denominator: fields.serial_denominator,
    canonical_title: title,
    source_id: sourceId,
    source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "writer_title_catalog_seed_v1",
      source_row_key: sourceRowKey,
      character: fields.character || null,
      card_name: fields.card_name || null,
      language: fields.language || null,
      rarity: fields.rarity || null,
      category_candidates: fields.category_candidates || [],
      secondary_categories: fields.secondary_categories || [],
      title_derived_fields_are_ground_truth: false,
      prompt_safe_internal_writer_title: true
    }
  });
}

async function fetchExistingSourceChecksums({ env, fetchImpl } = {}) {
  const checksums = new Set();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const rows = await supabaseRequest({
      env,
      path: `/rest/v1/catalog_sources?select=raw_checksum&source_type=eq.INTERNAL_CORRECTED_TITLE&raw_checksum=not.is.null&limit=${pageSize}&offset=${offset}`,
      fetchImpl
    });
    const list = Array.isArray(rows) ? rows : [];
    list.forEach((row) => {
      if (row.raw_checksum) checksums.add(row.raw_checksum);
    });
    if (list.length < pageSize) break;
    offset += pageSize;
  }
  return checksums;
}

function chunk(values = [], size = 250) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function insertMany({ env, table, rows, fetchImpl, prefer = "return=representation" } = {}) {
  if (!rows.length) return [];
  const inserted = await supabaseRequest({
    env,
    path: `/rest/v1/${table}`,
    method: "POST",
    body: rows,
    prefer,
    fetchImpl
  });
  return Array.isArray(inserted) ? inserted : [];
}

export async function applyCatalogSeed({ env, stagedRows = [], fetchImpl = globalThis.fetch, batchSize = 250 } = {}) {
  const existingChecksums = await fetchExistingSourceChecksums({ env, fetchImpl });
  const rows = stagedRows.filter((row) => row.source.raw_checksum && !existingChecksums.has(row.source.raw_checksum));
  const summary = {
    apply_attempted_rows: stagedRows.length,
    skipped_existing_source_count: stagedRows.length - rows.length,
    inserted_source_count: 0,
    inserted_staging_count: 0,
    inserted_product_count: 0,
    inserted_set_count: 0,
    inserted_card_count: 0,
    skipped_missing_product_count: 0
  };

  for (const rowsChunk of chunk(rows, batchSize)) {
    const sources = await insertMany({
      env,
      table: "catalog_sources",
      rows: rowsChunk.map((row) => row.source),
      fetchImpl
    });
    summary.inserted_source_count += sources.length;
    const sourceByChecksum = new Map(sources.map((source) => [source.raw_checksum, source.id]));
    const rowsWithSource = rowsChunk.map((row) => ({ ...row, source_id: sourceByChecksum.get(row.source.raw_checksum) })).filter((row) => row.source_id);

    const stagingRows = rowsWithSource.map((row) => ({
      ...row.staging,
      source_id: row.source_id
    }));
    const insertedStaging = await insertMany({
      env,
      table: "catalog_import_staging",
      rows: stagingRows,
      prefer: "return=minimal",
      fetchImpl
    });
    summary.inserted_staging_count += insertedStaging.length || stagingRows.length;

    const productInputs = rowsWithSource
      .filter((row) => valuePresent(row.staging.identity_fields?.product))
      .map((row) => productRow(row.source_id, row.staging.identity_fields, row.staging.source_row_key));
    const missingProductCount = rowsWithSource.length - productInputs.length;
    summary.skipped_missing_product_count += missingProductCount;
    const products = await insertMany({ env, table: "catalog_products", rows: productInputs, fetchImpl });
    summary.inserted_product_count += products.length;
    const productBySource = new Map(products.map((product) => [product.source_id, product]));

    const setInputs = rowsWithSource.flatMap((row) => {
      const product = productBySource.get(row.source_id);
      if (!product) return [];
      const prepared = setRow(row.source_id, product.id, row.staging.identity_fields, row.staging.source_row_key);
      return prepared ? [prepared] : [];
    });
    const sets = await insertMany({ env, table: "catalog_sets", rows: setInputs, fetchImpl });
    summary.inserted_set_count += sets.length;
    const setBySource = new Map(sets.map((set) => [set.source_id, set]));

    const cardInputs = rowsWithSource.flatMap((row) => {
      const product = productBySource.get(row.source_id);
      if (!product) return [];
      const set = setBySource.get(row.source_id);
      return [cardRow(
        row.source_id,
        product.id,
        set?.id || null,
        row.staging.identity_fields,
        row.staging.canonical_title,
        row.staging.source_row_key
      )];
    });
    const cards = await insertMany({ env, table: "catalog_cards", rows: cardInputs, fetchImpl });
    summary.inserted_card_count += cards.length;
  }

  return summary;
}

async function writeJsonl(path, rows = []) {
  await writeText(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

export async function importWriterTitleCatalogSeed({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const inputPath = argValue(argv, "--input", defaultInput);
  const outPath = argValue(argv, "--out", defaultOut);
  const stagingOut = argValue(argv, "--staging-out", defaultStagingOut);
  const vectorOut = argValue(argv, "--vector-out", defaultVectorOut);
  const batchId = argValue(argv, "--batch-id", "");
  const limit = numberArg(argv, "--limit", 0);
  const apply = hasFlag(argv, "--apply");
  const batchSize = numberArg(argv, "--batch-size", 250);

  const built = await buildWriterTitleCatalogSeed({ inputPath, batchId, limit });
  const runtimeEnv = await runtimeEnvFromFiles(["node", "script", ...argv], env);
  if (apply) {
    built.report.apply = await applyCatalogSeed({
      env: runtimeEnv,
      stagedRows: built.stagedRows,
      fetchImpl,
      batchSize
    });
  } else {
    built.report.apply = { skipped: true, reason: "dry_run_without_apply_flag" };
  }

  await writeText(outPath, `${JSON.stringify(built.report, null, 2)}\n`);
  await writeJsonl(stagingOut, built.stagedRows);
  await writeJsonl(vectorOut, built.vectorSeeds);
  return built.report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importWriterTitleCatalogSeed().then((report) => {
    process.stdout.write(`${JSON.stringify({
      status: "OK",
      input_path: report.input_path,
      batch_id: report.batch_id,
      row_counts: report.row_counts,
      apply: report.apply,
      out: argValue(process.argv.slice(2), "--out", defaultOut),
      staging_out: argValue(process.argv.slice(2), "--staging-out", defaultStagingOut),
      vector_out: argValue(process.argv.slice(2), "--vector-out", defaultVectorOut)
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
