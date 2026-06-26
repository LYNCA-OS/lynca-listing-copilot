import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { correctedTitleRecordToCatalogStaging } from "../lib/listing/catalog/internal-corrected-title-catalog.mjs";
import { fetchSupabaseFeedbackRows } from "../lib/listing/recognition/supabase-recognition-source.mjs";

const defaultEnvFilePath = ".env.local";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
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
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
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

function sourceFeedbackId(row = {}) {
  return normalizeText(row.source_feedback_id || row.id);
}

async function existingCatalogState({ env, fetchImpl } = {}) {
  const [sources, cards] = await Promise.all([
    supabaseRequest({
      env,
      path: "/rest/v1/catalog_sources?select=id,source_metadata&source_type=eq.INTERNAL_CORRECTED_TITLE&limit=10000",
      fetchImpl
    }),
    supabaseRequest({
      env,
      path: "/rest/v1/catalog_cards?select=id,source_id&limit=10000",
      fetchImpl
    })
  ]);
  const sourceByFeedbackId = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    const id = normalizeText(source?.source_metadata?.source_feedback_id);
    if (id) sourceByFeedbackId.set(id, source.id);
  }
  const cardSourceIds = new Set((Array.isArray(cards) ? cards : []).map((card) => normalizeText(card.source_id)).filter(Boolean));
  return { sourceByFeedbackId, cardSourceIds };
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

function productRow(sourceId, fields = {}) {
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
      import_source: "corrected_title_catalog_v0"
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
    source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
    review_status: "REVIEW_REQUIRED",
    metadata: {
      import_source: "corrected_title_catalog_v0"
    }
  });
}

function cardRow(sourceId, productId, setId, fields = {}, title = "") {
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
      import_source: "corrected_title_catalog_v0"
    }
  });
}

export async function importCorrectedTitleCatalogV0({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const runtimeEnv = await runtimeEnvFromFiles(["node", "script", ...argv], env);
  const table = argValue(argv, "--table", runtimeEnv.SUPABASE_RECOGNITION_FEEDBACK_TABLE || "listing_title_feedback");
  const limit = numberArg(argv, "--limit", Number(runtimeEnv.CATALOG_IMPORT_LIMIT || 1000));
  const offset = numberArg(argv, "--offset", 0);
  const dryRun = hasFlag(argv, "--dry-run");
  const outPath = argValue(argv, "--out", "");

  const feedback = await fetchSupabaseFeedbackRows({
    env: runtimeEnv,
    fetchImpl,
    table,
    limit,
    offset
  });
  if (!feedback.ok) {
    throw new Error(`Failed to fetch corrected-title feedback rows: ${feedback.reason}${feedback.message ? ` ${feedback.message}` : ""}`);
  }

  const rows = feedback.rows.filter((row) => normalizeText(row.corrected_title));
  const existing = dryRun
    ? { sourceByFeedbackId: new Map(), cardSourceIds: new Set() }
    : await existingCatalogState({ env: runtimeEnv, fetchImpl });

  const summary = {
    schema_version: "corrected-title-catalog-v0-import-report",
    generated_at: new Date().toISOString(),
    table,
    dry_run: dryRun,
    fetched_rows: feedback.rows.length,
    corrected_title_rows: rows.length,
    parsed_rows: 0,
    existing_source_count: 0,
    inserted_source_count: 0,
    inserted_staging_count: 0,
    inserted_product_count: 0,
    inserted_set_count: 0,
    inserted_card_count: 0,
    skipped_existing_card_count: 0,
    skipped_missing_product_count: 0
  };

  for (const row of rows) {
    const staged = correctedTitleRecordToCatalogStaging({
      ...row,
      source_feedback_id: row.id
    });
    if (!staged) continue;
    summary.parsed_rows += 1;
    const feedbackId = sourceFeedbackId(row);
    let sourceId = existing.sourceByFeedbackId.get(feedbackId);
    if (sourceId) {
      summary.existing_source_count += 1;
    } else if (!dryRun) {
      const insertedSource = await insertReturning({
        env: runtimeEnv,
        table: "catalog_sources",
        row: staged.source,
        fetchImpl
      });
      sourceId = insertedSource?.id;
      if (sourceId) {
        existing.sourceByFeedbackId.set(feedbackId, sourceId);
        summary.inserted_source_count += 1;
      }
    } else {
      summary.inserted_source_count += 1;
      sourceId = `dry-run-source-${feedbackId || summary.parsed_rows}`;
    }

    const identityFields = staged.staging.identity_fields || {};
    if (!dryRun && sourceId) {
      await insertStaging({
        env: runtimeEnv,
        row: {
          ...staged.staging,
          source_id: sourceId
        },
        fetchImpl
      });
    }
    summary.inserted_staging_count += sourceId ? 1 : 0;

    if (!identityFields.product) {
      summary.skipped_missing_product_count += 1;
      continue;
    }
    if (existing.cardSourceIds.has(sourceId)) {
      summary.skipped_existing_card_count += 1;
      continue;
    }

    if (dryRun) {
      summary.inserted_product_count += 1;
      if (identityFields.set_or_insert || identityFields.subset || identityFields.official_card_type) summary.inserted_set_count += 1;
      summary.inserted_card_count += 1;
      continue;
    }

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

    const preparedSet = setRow(sourceId, product.id, identityFields);
    const insertedSet = preparedSet
      ? await insertReturning({
        env: runtimeEnv,
        table: "catalog_sets",
        row: preparedSet,
        fetchImpl
      })
      : null;
    if (insertedSet?.id) summary.inserted_set_count += 1;

    const card = await insertReturning({
      env: runtimeEnv,
      table: "catalog_cards",
      row: cardRow(sourceId, product.id, insertedSet?.id || null, identityFields, staged.staging.canonical_title),
      fetchImpl
    });
    if (card?.id) {
      existing.cardSourceIds.add(sourceId);
      summary.inserted_card_count += 1;
    }
  }

  await writeJson(outPath, summary);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importCorrectedTitleCatalogV0().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
