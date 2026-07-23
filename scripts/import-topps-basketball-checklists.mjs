import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildToppsBasketballChecklistImport,
  defaultOfficialChecklistIndexUrls,
  sourceTypeFromOfficialChecklistProvider
} from "../lib/listing/catalog/topps-basketball-checklist-importer.mjs";
import { extractPdfText } from "../lib/listing/catalog/pdf-text-extractor.mjs";
import {
  buildOfficialCatalogImportReport,
  officialCatalogSourceProfile
} from "../lib/listing/catalog/official-catalog-source-adapter.mjs";
import {
  catalogImportStatuses,
  isOfficialCatalogSourceType
} from "../lib/listing/catalog/catalog-contract.mjs";

const defaultEnvFilePath = ".env.local";
const officialChecklistRawStatus = "OFFICIAL_CHECKLIST_RAW";

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnvFromFiles(argv = process.argv, env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFilePath = argValue(argv, "--env-file", env.CATALOG_IMPORT_ENV_FILE || defaultEnvFilePath);
  const fileEnv = await readEnvFile(envFilePath);
  return { ...fileEnv, ...env };
}

export function officialCatalogSupabaseConfig(env = process.env) {
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
  const config = officialCatalogSupabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) {
    throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }
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

async function writeJson(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.some(valuePresent);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && normalizeText(value) !== "" && value !== "UNKNOWN";
}

function compact(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, fieldValue]) => valuePresent(fieldValue)));
}

async function insertReturning({ env, table, row, fetchImpl } = {}) {
  const data = await supabaseRequest({
    env,
    path: `/rest/v1/${table}`,
    method: "POST",
    body: row,
    prefer: "return=representation",
    fetchImpl
  });
  return Array.isArray(data) ? data[0] : data;
}

async function insertStaging({ env, row, fetchImpl } = {}) {
  return supabaseRequest({
    env,
    path: "/rest/v1/catalog_import_staging?on_conflict=source_id,source_row_key",
    method: "POST",
    body: row,
    prefer: "resolution=ignore-duplicates,return=representation",
    fetchImpl
  });
}

async function insertRows({
  env,
  table,
  rows,
  fetchImpl,
  prefer = "return=minimal",
  pathSuffix = ""
} = {}) {
  if (!rows.length) return null;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))].sort();
  const alignedRows = rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null])));
  return supabaseRequest({
    env,
    path: `/rest/v1/${table}${pathSuffix}`,
    method: "POST",
    body: alignedRows,
    prefer,
    fetchImpl
  });
}

function chunks(values = [], size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function existingOfficialSource({ env, sourceUrl, sourceType = "TOPPS_OFFICIAL_CHECKLIST", fetchImpl } = {}) {
  if (!sourceUrl) return null;
  const rows = await supabaseRequest({
    env,
    path: `/rest/v1/catalog_sources?select=id,source_url,source_status,source_metadata,raw_checksum,parser_version&source_type=eq.${encodeURIComponent(sourceType)}&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`,
    fetchImpl
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function supabaseExactCount({ env, table, filters = [], fetchImpl } = {}) {
  const config = officialCatalogSupabaseConfig(env);
  if (!config.url || !config.serviceRoleKey) {
    throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
  }
  const query = [`select=id`, ...filters].join("&");
  const response = await fetchImpl(`${config.url}/rest/v1/${table}?${query}`, {
    method: "HEAD",
    headers: {
      ...supabaseHeaders(config.serviceRoleKey, "count=exact"),
      range: "0-0"
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase count failed ${table}: HTTP ${response.status}`);
  }
  const contentRange = response.headers?.get?.("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) throw new Error(`Supabase count missing content-range for ${table}`);
  return Number(match[1]);
}

async function sourceCatalogState({ env, sourceId, fetchImpl } = {}) {
  if (!sourceId) return { card_count: 0, staging_count: 0, reviewed_row_count: 0 };
  const sourceFilter = `source_id=eq.${encodeURIComponent(sourceId)}`;
  const [cardCount, stagingCount, ...reviewedCounts] = await Promise.all([
    supabaseExactCount({ env, table: "catalog_cards", filters: [sourceFilter], fetchImpl }),
    supabaseExactCount({ env, table: "catalog_import_staging", filters: [sourceFilter], fetchImpl }),
    ...["catalog_products", "catalog_sets", "catalog_cards", "catalog_parallels"].map((table) => (
      supabaseExactCount({
        env,
        table,
        filters: [sourceFilter, "review_status=eq.REVIEWED_INTERNAL"],
        fetchImpl
      })
    ))
  ]);
  return {
    card_count: cardCount,
    staging_count: stagingCount,
    reviewed_row_count: reviewedCounts.reduce((sum, count) => sum + count, 0)
  };
}

function decisionEligibleOfficialRow(row = {}) {
  return [
    catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE,
    catalogImportStatuses.OFFICIAL_CHECKLIST_CONFIRMED,
    catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT,
    catalogImportStatuses.REVIEWED_INTERNAL
  ].includes(row.import_status);
}

async function clearReplaceableSourceRows({ env, sourceId, fetchImpl } = {}) {
  if (!sourceId) return;
  const suffix = `?source_id=eq.${encodeURIComponent(sourceId)}`;
  for (const table of [
    "catalog_parallels",
    "catalog_cards",
    "catalog_sets",
    "catalog_products",
    "catalog_import_staging"
  ]) {
    await supabaseRequest({
      env,
      path: `/rest/v1/${table}${suffix}`,
      method: "DELETE",
      prefer: "return=minimal",
      fetchImpl
    });
  }
}

async function refreshOfficialSource({ env, sourceId, source, fetchImpl } = {}) {
  return supabaseRequest({
    env,
    path: `/rest/v1/catalog_sources?id=eq.${encodeURIComponent(sourceId)}`,
    method: "PATCH",
    body: {
      source_status: source.source_status,
      source_name: source.source_name,
      source_metadata: source.source_metadata || {},
      raw_text: source.raw_text || null,
      raw_checksum: source.raw_checksum || null,
      parser_version: source.parser_version || null,
      source_trust: source.source_trust || "OFFICIAL_CHECKLIST_CANDIDATE",
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    prefer: "return=minimal",
    fetchImpl
  });
}

function productRow(sourceId, fields = {}, { importSource = "official_checklist" } = {}) {
  return compact({
    sport: fields.sport || fields.category || "other",
    league: fields.league,
    season_year: fields.season_year,
    manufacturer: fields.manufacturer,
    brand: fields.brand || fields.manufacturer,
    product: fields.product,
    source_id: sourceId,
    source_status: officialChecklistRawStatus,
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: importSource
    }
  });
}

function setRow(sourceId, productId, fields = {}, { importSource = "official_checklist" } = {}) {
  if (!fields.set_or_insert && !fields.subset && !fields.official_card_type) return null;
  return compact({
    product_id: productId,
    set_or_insert: fields.set_or_insert,
    subset: fields.subset,
    official_card_type: fields.official_card_type,
    source_id: sourceId,
    source_status: officialChecklistRawStatus,
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: importSource
    }
  });
}

function cardRow(sourceId, productId, setId, fields = {}, title = "", { importSource = "official_checklist" } = {}) {
  return {
    product_id: productId,
    set_id: setId,
    sport: fields.sport || fields.category || "other",
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
    source_status: officialChecklistRawStatus,
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: importSource,
      physical_instance_fields_intentionally_empty: true,
      catalog_fields: compact({
        game: fields.game,
        language: fields.language,
        subject: fields.subject,
        card_name: fields.card_name,
        collector_number: fields.collector_number,
        rarity: fields.rarity,
        parallel_name: fields.parallel_name,
        parallel_exact: fields.parallel_exact,
        image_url: fields.image_url,
        image_urls: fields.image_urls,
        external_id: fields.external_id
      })
    }
  };
}

function productKey(fields = {}) {
  return [
    fields.sport || fields.category || "other",
    fields.league || "",
    fields.season_year || "",
    fields.manufacturer || "",
    fields.brand || fields.manufacturer || "",
    fields.product || ""
  ].join("\u001f");
}

function setKey(productId, fields = {}) {
  if (!fields.set_or_insert && !fields.subset && !fields.official_card_type) return "";
  return [
    productId,
    fields.set_or_insert || "",
    fields.subset || "",
    fields.official_card_type || ""
  ].join("\u001f");
}

export function sourceUrlsFromArgs(argv = [], env = process.env, provider = "topps", sourceType = "") {
  const explicit = argValues(argv, "--source-url");
  const providerKey = normalizeText(provider).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const providerUrls = [
    env.OFFICIAL_CHECKLIST_URLS,
    env[`${providerKey}_CHECKLIST_URLS`],
    providerKey === "TOPPS" ? env.TOPPS_BASKETBALL_CHECKLIST_URLS : ""
  ];
  const envUrls = providerUrls.flatMap((value) => normalizeText(value)
    .split(/[,\n]/)
    .map(normalizeText)
    .filter(Boolean));
  const name = argValue(argv, "--source-name", "");
  return [...explicit, ...envUrls].map((href, index) => ({
    href,
    text: index === 0 ? name : "",
    source_type: sourceType || undefined
  }));
}

export async function buildProviderCatalogImport({
  provider = "topps",
  sourceType = "",
  category = "",
  sourceUrls = [],
  indexUrl = "",
  fetchImpl = globalThis.fetch,
  preferBasketballTopps = false
} = {}) {
  const resolvedIndexUrl = indexUrl || officialCatalogSourceProfile(provider).default_index_url;
  const importOptions = {
    fetchImpl,
    sourceUrls,
    indexUrl: resolvedIndexUrl,
    provider,
    sourceType,
    category,
    pdfExtractor: extractPdfText
  };
  if (provider === "topps" && category === "basketball" && preferBasketballTopps) {
    return buildToppsBasketballChecklistImport(importOptions);
  }
  const adapterReport = await buildOfficialCatalogImportReport(importOptions);
  return adapterReport.raw;
}

export async function importToppsBasketballChecklists({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const runtimeEnv = await runtimeEnvFromFiles(["node", "script", ...argv], env);
  const provider = normalizeText(argValue(argv, "--provider", runtimeEnv.OFFICIAL_CHECKLIST_PROVIDER || "topps")).toLowerCase().replace(/[\s-]+/g, "_");
  const sourceType = normalizeText(argValue(argv, "--source-type", runtimeEnv.OFFICIAL_CHECKLIST_SOURCE_TYPE || sourceTypeFromOfficialChecklistProvider(provider)));
  const allTopps = hasFlag(argv, "--all-topps");
  const category = normalizeText(argValue(argv, "--category", runtimeEnv.OFFICIAL_CHECKLIST_CATEGORY || (allTopps ? "all" : "basketball")));
  const importSource = `${provider}_official_checklist`;
  const sourceUrls = sourceUrlsFromArgs(argv, runtimeEnv, provider, sourceType);
  const defaultIndexUrl = defaultOfficialChecklistIndexUrls[provider] || defaultOfficialChecklistIndexUrls.topps;
  const indexUrl = argValue(argv, "--index-url", runtimeEnv.OFFICIAL_CHECKLIST_INDEX_URL || runtimeEnv.TOPPS_CHECKLIST_INDEX_URL || defaultIndexUrl);
  const apply = hasFlag(argv, "--apply");
  const outPath = argValue(argv, "--out", "");

  if (sourceType && !isOfficialCatalogSourceType(sourceType)) {
    throw new Error(`catalog_source_type_not_official:${provider}:${sourceType}`);
  }
  const importReport = await buildProviderCatalogImport({
    fetchImpl,
    sourceUrls,
    indexUrl,
    provider,
    sourceType,
    category: category === "all" ? "" : category,
    preferBasketballTopps: provider === "topps" && category === "basketball" && !allTopps
  });

  const summary = {
    schema_version: "official-checklist-import-report",
    generated_at: new Date().toISOString(),
    dry_run: !apply,
    provider,
    source_type: sourceType,
    category,
    requested_source_url_count: sourceUrls.length,
    source_count: importReport.sources.length,
    parsed_staging_count: importReport.staging.length,
    inserted_source_count: 0,
    existing_source_count: 0,
    inserted_staging_count: 0,
    inserted_product_count: 0,
    inserted_set_count: 0,
    inserted_card_count: 0,
    skipped_existing_card_source_count: 0,
    verified_existing_source_count: 0,
    refreshed_source_count: 0,
    recovered_partial_source_count: 0,
    skipped_missing_product_count: 0,
    skipped_review_required_count: 0,
    metrics: importReport.metrics
  };

  const sourceIdByUrl = new Map();
  const existingSourceById = new Map();
  const sourceById = new Map();
  for (const source of importReport.sources) {
    if (!apply) {
      summary.inserted_source_count += 1;
      sourceIdByUrl.set(source.source_url, `dry-run-source-${summary.inserted_source_count}`);
      continue;
    }

    const existing = await existingOfficialSource({ env: runtimeEnv, sourceUrl: source.source_url, sourceType: source.source_type, fetchImpl });
    if (existing?.id) {
      summary.existing_source_count += 1;
      sourceIdByUrl.set(source.source_url, existing.id);
      existingSourceById.set(existing.id, existing);
      sourceById.set(existing.id, source);
      continue;
    }

    const inserted = await insertReturning({
      env: runtimeEnv,
      table: "catalog_sources",
      row: {
        ...source,
        raw_checksum: source.raw_checksum || null,
        source_trust: source.source_trust || "OFFICIAL_CHECKLIST_CANDIDATE",
        fetched_at: new Date().toISOString()
      },
      fetchImpl
    });
    if (inserted?.id) {
      summary.inserted_source_count += 1;
      sourceIdByUrl.set(source.source_url, inserted.id);
      sourceById.set(inserted.id, source);
    }
  }

  const rowsBySource = new Map();
  for (const item of importReport.staging) {
    const sourceId = sourceIdByUrl.get(item.source.source_url);
    if (!sourceId) continue;
    if (!rowsBySource.has(sourceId)) rowsBySource.set(sourceId, []);
    rowsBySource.get(sourceId).push(item.staging);
  }

  for (const [sourceId, rows] of rowsBySource.entries()) {
    const decisionRows = rows.filter(decisionEligibleOfficialRow);
    summary.skipped_review_required_count += rows.length - decisionRows.length;
    if (apply && existingSourceById.has(sourceId)) {
      const existing = existingSourceById.get(sourceId);
      const incoming = sourceById.get(sourceId);
      const state = await sourceCatalogState({ env: runtimeEnv, sourceId, fetchImpl });
      const checksumMatches = Boolean(existing.raw_checksum)
        && existing.raw_checksum === incoming?.raw_checksum;
      const parserMatches = Boolean(existing.parser_version)
        && existing.parser_version === incoming?.parser_version;
      if (checksumMatches
        && parserMatches
        && state.card_count === decisionRows.length
        && state.staging_count === rows.length) {
        summary.verified_existing_source_count += 1;
        summary.skipped_existing_card_source_count += decisionRows.length;
        continue;
      }
      if (existing.source_status === "REVIEWED_INTERNAL" || state.reviewed_row_count > 0) {
        throw new Error(`official_source_refresh_blocked_reviewed_rows:${sourceId}`);
      }
      await clearReplaceableSourceRows({ env: runtimeEnv, sourceId, fetchImpl });
      await refreshOfficialSource({ env: runtimeEnv, sourceId, source: incoming, fetchImpl });
      summary.refreshed_source_count += 1;
      if ((state.card_count > 0 && state.card_count !== decisionRows.length)
        || (state.staging_count > 0 && state.staging_count !== rows.length)) {
        summary.recovered_partial_source_count += 1;
      }
    }

    if (!apply) {
      const dryRunProducts = new Set();
      const dryRunSets = new Set();
      for (const row of rows) summary.inserted_staging_count += 1;
      for (const row of decisionRows) {
        const identityFields = row.identity_fields || {};
        if (!identityFields.product) {
          summary.skipped_missing_product_count += 1;
          continue;
        }
        dryRunProducts.add(productKey(identityFields));
        const dryRunSetKey = setKey(productKey(identityFields), identityFields);
        if (dryRunSetKey) dryRunSets.add(dryRunSetKey);
        summary.inserted_card_count += 1;
      }
      summary.inserted_product_count += dryRunProducts.size;
      summary.inserted_set_count += dryRunSets.size;
      continue;
    }

    const stagingRows = rows.map((row) => ({
      ...row,
      raw_text: row.raw_text || null,
      parsed_fields: row.identity_fields || {},
      field_status_by_name: row.field_statuses || {},
      review_required_fields: Object.entries(row.field_statuses || {})
        .filter(([, status]) => /REVIEW_REQUIRED/i.test(status))
        .map(([field]) => field),
      source_type: importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.source_type || sourceType,
      source_trust: importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.source_trust || "OFFICIAL_CHECKLIST_CANDIDATE",
      raw_checksum: importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.raw_checksum || null,
      source_url: importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.source_url || null,
      source_title: importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.source_name
        || importReport.sources.find((source) => sourceIdByUrl.get(source.source_url) === sourceId)?.source_title
        || null,
      source_id: sourceId
    }));
    for (const batch of chunks(stagingRows)) {
      await insertRows({
        env: runtimeEnv,
        table: "catalog_import_staging",
        rows: batch,
        pathSuffix: "?on_conflict=source_id,source_row_key",
        prefer: "resolution=ignore-duplicates,return=minimal",
        fetchImpl
      });
    }
    summary.inserted_staging_count += stagingRows.length;

    const productIds = new Map();
    const productFields = new Map();
    for (const row of decisionRows) {
      const identityFields = row.identity_fields || {};
      if (!identityFields.product) {
        summary.skipped_missing_product_count += 1;
        continue;
      }
      const key = productKey(identityFields);
      if (!productFields.has(key)) productFields.set(key, identityFields);
    }

    for (const [key, identityFields] of productFields.entries()) {
      const product = await insertReturning({
        env: runtimeEnv,
        table: "catalog_products",
        row: productRow(sourceId, identityFields, { importSource }),
        fetchImpl
      });
      if (!product?.id) {
        summary.skipped_missing_product_count += 1;
        continue;
      }
      summary.inserted_product_count += 1;
      productIds.set(key, product.id);
    }

    const setIds = new Map();
    const setFields = new Map();
    for (const row of decisionRows) {
      const identityFields = row.identity_fields || {};
      const productId = productIds.get(productKey(identityFields));
      if (!productId) continue;
      const key = setKey(productId, identityFields);
      if (key && !setFields.has(key)) setFields.set(key, { productId, identityFields });
    }

    for (const [key, { productId, identityFields }] of setFields.entries()) {
      const preparedSet = setRow(sourceId, productId, identityFields, { importSource });
      const insertedSet = preparedSet
        ? await insertReturning({
          env: runtimeEnv,
          table: "catalog_sets",
          row: preparedSet,
          fetchImpl
        })
        : null;
      if (insertedSet?.id) {
        summary.inserted_set_count += 1;
        setIds.set(key, insertedSet.id);
      }
    }

    const cards = decisionRows
      .map((row) => {
        const identityFields = row.identity_fields || {};
        const productId = productIds.get(productKey(identityFields));
        if (!productId) return null;
        const key = setKey(productId, identityFields);
        return cardRow(sourceId, productId, key ? setIds.get(key) || null : null, identityFields, row.canonical_title, { importSource });
      })
      .filter(Boolean);
    for (const batch of chunks(cards)) {
      await insertRows({
        env: runtimeEnv,
        table: "catalog_cards",
        rows: batch,
        prefer: "return=minimal",
        fetchImpl
      });
    }
    summary.inserted_card_count += cards.length;
  }

  await writeJson(outPath, summary);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importToppsBasketballChecklists().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
