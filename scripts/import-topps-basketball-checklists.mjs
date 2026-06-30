import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildToppsBasketballChecklistImport } from "../lib/listing/catalog/topps-basketball-checklist-importer.mjs";

const defaultEnvFilePath = ".env.local";

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

function supabaseConfig(env = process.env) {
  return {
    url: normalizeText(env.SUPABASE_URL).replace(/\/+$/, ""),
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
  if (!config.url || !config.serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.");
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

async function existingOfficialSource({ env, sourceUrl, fetchImpl } = {}) {
  if (!sourceUrl) return null;
  const rows = await supabaseRequest({
    env,
    path: `/rest/v1/catalog_sources?select=id,source_url&source_type=eq.TOPPS_OFFICIAL_CHECKLIST&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`,
    fetchImpl
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function sourceHasCatalogCards({ env, sourceId, fetchImpl } = {}) {
  if (!sourceId) return false;
  const rows = await supabaseRequest({
    env,
    path: `/rest/v1/catalog_cards?select=id&source_id=eq.${encodeURIComponent(sourceId)}&limit=1`,
    fetchImpl
  });
  return Array.isArray(rows) && rows.length > 0;
}

function productRow(sourceId, fields = {}) {
  return compact({
    sport: fields.sport || fields.category || "basketball",
    league: fields.league,
    season_year: fields.season_year,
    manufacturer: fields.manufacturer,
    brand: fields.brand || fields.manufacturer,
    product: fields.product,
    source_id: sourceId,
    source_status: "TOPPS_OFFICIAL_RAW",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "topps_official_basketball_checklist"
    }
  });
}

function setRow(sourceId, productId, fields = {}) {
  if (!fields.set_or_insert && !fields.subset && !fields.official_card_type) return null;
  return compact({
    product_id: productId,
    set_or_insert: fields.set_or_insert,
    subset: fields.subset,
    official_card_type: fields.official_card_type,
    source_id: sourceId,
    source_status: "TOPPS_OFFICIAL_RAW",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "topps_official_basketball_checklist"
    }
  });
}

function cardRow(sourceId, productId, setId, fields = {}, title = "") {
  return {
    product_id: productId,
    set_id: setId,
    sport: fields.sport || fields.category || "basketball",
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
    source_status: "TOPPS_OFFICIAL_RAW",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "topps_official_basketball_checklist",
      physical_instance_fields_intentionally_empty: true
    }
  };
}

function productKey(fields = {}) {
  return [
    fields.sport || fields.category || "basketball",
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

export function sourceUrlsFromArgs(argv = [], env = process.env) {
  const explicit = argValues(argv, "--source-url");
  const envUrls = normalizeText(env.TOPPS_BASKETBALL_CHECKLIST_URLS)
    .split(/[,\n]/)
    .map(normalizeText)
    .filter(Boolean);
  const name = argValue(argv, "--source-name", "");
  return [...explicit, ...envUrls].map((href, index) => ({
    href,
    text: index === 0 ? name : ""
  }));
}

export async function importToppsBasketballChecklists({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const runtimeEnv = await runtimeEnvFromFiles(["node", "script", ...argv], env);
  const sourceUrls = sourceUrlsFromArgs(argv, runtimeEnv);
  const indexUrl = argValue(argv, "--index-url", runtimeEnv.TOPPS_CHECKLIST_INDEX_URL || undefined);
  const apply = hasFlag(argv, "--apply");
  const outPath = argValue(argv, "--out", "");

  const importOptions = {
    fetchImpl,
    sourceUrls
  };
  if (indexUrl) importOptions.indexUrl = indexUrl;
  const importReport = await buildToppsBasketballChecklistImport(importOptions);

  const summary = {
    schema_version: "topps-official-basketball-checklist-import-report",
    generated_at: new Date().toISOString(),
    dry_run: !apply,
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
    skipped_missing_product_count: 0,
    metrics: importReport.metrics
  };

  const sourceIdByUrl = new Map();
  for (const source of importReport.sources) {
    if (!apply) {
      summary.inserted_source_count += 1;
      sourceIdByUrl.set(source.source_url, `dry-run-source-${summary.inserted_source_count}`);
      continue;
    }

    const existing = await existingOfficialSource({ env: runtimeEnv, sourceUrl: source.source_url, fetchImpl });
    if (existing?.id) {
      summary.existing_source_count += 1;
      sourceIdByUrl.set(source.source_url, existing.id);
      continue;
    }

    const inserted = await insertReturning({
      env: runtimeEnv,
      table: "catalog_sources",
      row: {
        ...source,
        fetched_at: new Date().toISOString()
      },
      fetchImpl
    });
    if (inserted?.id) {
      summary.inserted_source_count += 1;
      sourceIdByUrl.set(source.source_url, inserted.id);
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
    if (apply && await sourceHasCatalogCards({ env: runtimeEnv, sourceId, fetchImpl })) {
      summary.skipped_existing_card_source_count += rows.length;
      continue;
    }

    if (!apply) {
      const dryRunProducts = new Set();
      const dryRunSets = new Set();
      for (const row of rows) {
        const identityFields = row.identity_fields || {};
        summary.inserted_staging_count += 1;
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
    for (const row of rows) {
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
        row: productRow(sourceId, identityFields),
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
    for (const row of rows) {
      const identityFields = row.identity_fields || {};
      const productId = productIds.get(productKey(identityFields));
      if (!productId) continue;
      const key = setKey(productId, identityFields);
      if (key && !setFields.has(key)) setFields.set(key, { productId, identityFields });
    }

    for (const [key, { productId, identityFields }] of setFields.entries()) {
      const preparedSet = setRow(sourceId, productId, identityFields);
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

    const cards = rows
      .map((row) => {
        const identityFields = row.identity_fields || {};
        const productId = productIds.get(productKey(identityFields));
        if (!productId) return null;
        const key = setKey(productId, identityFields);
        return cardRow(sourceId, productId, key ? setIds.get(key) || null : null, identityFields, row.canonical_title);
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
