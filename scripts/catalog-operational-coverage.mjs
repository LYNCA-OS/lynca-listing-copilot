import { writeFile } from "node:fs/promises";
import { curatedCatalogSources } from "../lib/listing/catalog/curated-catalog-source-registry.mjs";
import { isOfficialCatalogSourceType } from "../lib/listing/catalog/catalog-contract.mjs";

const OFFICIAL_DECISION_STATUSES = new Set([
  "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST",
  "OFFICIAL_CHECKLIST_CANDIDATE",
  "OFFICIAL_CHECKLIST_CONFIRMED",
  "OFFICIAL_RELEASE_SUPPORT",
  "OFFICIAL_RELEASE_METADATA",
  "TOPPS_OFFICIAL_RAW",
  "OFFICIAL_CHECKLIST_RAW"
]);
const INTERNAL_DECISION_STATUSES = new Set([
  "VERIFIED_CANONICAL_TITLE",
  "AUTO_PARSED_FROM_VERIFIED_TITLE",
  "REVIEWED_INTERNAL"
]);

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedStatus(value = "") {
  return cleanText(value).toUpperCase();
}

function increment(object, key) {
  const normalized = cleanText(key) || "UNKNOWN";
  object[normalized] = Number(object[normalized] || 0) + 1;
}

function isRejected(row = {}) {
  return ["REJECTED", "BLOCKED", "DISABLED", "DEPRECATED"].includes(
    normalizedStatus(row.retrieval_status || row.reference_status || row.review_status)
  );
}

export function decisionActiveCatalogCard({ source = {}, card = {} } = {}) {
  if (isRejected(source) || isRejected(card)) return false;
  const sourceType = normalizedStatus(source.source_type);
  const sourceStatus = normalizedStatus(card.source_status || source.source_status);
  const retrievalStatus = normalizedStatus(card.retrieval_status || source.retrieval_status);
  if (sourceType === "INTERNAL_CORRECTED_TITLE") {
    return INTERNAL_DECISION_STATUSES.has(sourceStatus);
  }
  if (isOfficialCatalogSourceType(sourceType)) {
    return retrievalStatus === "REGISTRY" || OFFICIAL_DECISION_STATUSES.has(sourceStatus);
  }
  return false;
}

export function buildCatalogOperationalCoverage({
  registry = curatedCatalogSources,
  sources = [],
  cards = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const sourcesById = new Map();
  const sourceRowsByType = new Map();
  for (const source of sources) {
    const sourceId = cleanText(source.id);
    const sourceType = normalizedStatus(source.source_type);
    if (sourceId) sourcesById.set(sourceId, source);
    if (!sourceRowsByType.has(sourceType)) sourceRowsByType.set(sourceType, []);
    sourceRowsByType.get(sourceType).push(source);
  }

  const cardsByType = new Map();
  const unattributedCards = [];
  const brokenSourceReferenceCards = [];
  for (const card of cards) {
    const sourceId = cleanText(card.source_id);
    if (!sourceId) {
      unattributedCards.push(card);
      continue;
    }
    const source = sourcesById.get(sourceId);
    if (!source) {
      brokenSourceReferenceCards.push(card);
      continue;
    }
    const sourceType = normalizedStatus(source.source_type);
    if (!cardsByType.has(sourceType)) cardsByType.set(sourceType, []);
    cardsByType.get(sourceType).push({ source, card });
  }

  const rows = registry.map((entry) => {
    const sourceType = normalizedStatus(entry.source_type);
    const matchingSources = sourceRowsByType.get(sourceType) || [];
    const matchingCards = cardsByType.get(sourceType) || [];
    const sourceStatusBreakdown = {};
    const cardStatusBreakdown = {};
    for (const source of matchingSources) increment(sourceStatusBreakdown, source.source_status);
    for (const { card } of matchingCards) increment(cardStatusBreakdown, card.source_status);
    const decisionActiveCardCount = matchingCards.filter(decisionActiveCatalogCard).length;
    const operationalStage = decisionActiveCardCount > 0
      ? "DECISION_ACTIVE"
      : matchingCards.length > 0
        ? "INGESTED"
        : matchingSources.length > 0
          ? "DISCOVERED"
          : "REGISTERED_ONLY";
    return {
      provider: entry.provider,
      label: entry.label,
      source_type: sourceType,
      quality_tier: entry.quality_tier,
      import_mode: entry.import_mode,
      default_enabled: entry.default_enabled === true,
      operational_stage: operationalStage,
      source_count: matchingSources.length,
      card_count: matchingCards.length,
      decision_active_card_count: decisionActiveCardCount,
      source_status_breakdown: sourceStatusBreakdown,
      card_status_breakdown: cardStatusBreakdown
    };
  });

  const registryTypes = new Set(rows.map((row) => row.source_type));
  const unregisteredSourceTypes = [...sourceRowsByType.keys()]
    .filter((sourceType) => sourceType && !registryTypes.has(sourceType))
    .sort();
  const stageBreakdown = {};
  for (const row of rows) increment(stageBreakdown, row.operational_stage);

  return {
    schema_version: "catalog-operational-coverage-v1",
    generated_at: generatedAt,
    summary: {
      registered_source_type_count: rows.length,
      discovered_source_type_count: rows.filter((row) => row.source_count > 0).length,
      ingested_source_type_count: rows.filter((row) => row.card_count > 0).length,
      decision_active_source_type_count: rows.filter((row) => row.decision_active_card_count > 0).length,
      catalog_source_row_count: sources.length,
      catalog_card_row_count: cards.length,
      unattributed_catalog_card_count: unattributedCards.length,
      broken_source_reference_count: brokenSourceReferenceCards.length,
      orphan_catalog_card_count: unattributedCards.length + brokenSourceReferenceCards.length,
      unregistered_source_type_count: unregisteredSourceTypes.length,
      stage_breakdown: stageBreakdown
    },
    sources: rows,
    unregistered_source_types: unregisteredSourceTypes
  };
}

async function fetchAllRows({ baseUrl, serviceRoleKey, table, select, fetchImpl = globalThis.fetch, pageSize = 1000 }) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url, {
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} query failed (${response.status}): ${text.slice(0, 160)}`);
    const page = text ? JSON.parse(text) : [];
    if (!Array.isArray(page)) throw new Error(`${table} query returned a non-array response`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function auditCatalogOperationalCoverage({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = cleanText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  if (!baseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const [sources, cards] = await Promise.all([
    fetchAllRows({
      baseUrl,
      serviceRoleKey,
      table: "catalog_sources",
      select: "id,source_type,source_status"
    }),
    fetchAllRows({
      baseUrl,
      serviceRoleKey,
      table: "catalog_cards",
      select: "id,source_id,source_status,review_status"
    })
  ]);
  return buildCatalogOperationalCoverage({ sources, cards });
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  auditCatalogOperationalCoverage().then(async (report) => {
    const outputPath = argValue(process.argv.slice(2), "--out");
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, json);
    process.stdout.write(json);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
