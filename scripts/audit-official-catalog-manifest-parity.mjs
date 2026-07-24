import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { isOfficialCatalogSourceType } from "../lib/listing/catalog/catalog-contract.mjs";
import {
  canonicalOfficialSourceUrl,
  validateOfficialCatalogManifestSet
} from "../lib/listing/catalog/official-manifest-contract.mjs";
import { officialCatalogSourceProfiles } from "../lib/listing/catalog/official-catalog-source-adapter.mjs";

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedText(value = "") {
  return cleanText(value).toLowerCase();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function countBy(values = [], keyOf = (value) => value) {
  const counts = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (!key) continue;
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return counts;
}

export async function loadOfficialCatalogManifestEntries({
  directory = "data/catalog/official"
} = {}) {
  const resolvedDirectory = resolve(directory);
  const files = (await readdir(resolvedDirectory))
    .filter((file) => file.endsWith("-production-sources.json"))
    .sort();
  return Promise.all(files.map(async (file) => ({
    file,
    manifest: JSON.parse(await readFile(resolve(resolvedDirectory, file), "utf8"))
  })));
}

export function buildOfficialCatalogManifestParity({
  manifestEntries = [],
  productionSources = [],
  catalogCards = []
} = {}) {
  const repository = validateOfficialCatalogManifestSet(manifestEntries, {
    providerProfiles: officialCatalogSourceProfiles
  });
  const manifestSources = manifestEntries.flatMap(({ file, manifest }) => (
    (manifest.sources || []).map((source) => ({ file, provider: manifest.provider, ...source }))
  ));
  const officialProductionSources = productionSources.filter((source) => isOfficialCatalogSourceType(source.source_type));
  const manifestByUrl = new Map(manifestSources.map((source) => [canonicalOfficialSourceUrl(source.source_url), source]));
  const productionByUrl = new Map(officialProductionSources.map((source) => [canonicalOfficialSourceUrl(source.source_url), source]));
  const productionUrlCounts = countBy(officialProductionSources, (source) => canonicalOfficialSourceUrl(source.source_url));
  const cardCounts = countBy(catalogCards, (card) => cleanText(card.source_id));

  const productionDuplicateUrls = [...productionUrlCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([source_url, count]) => ({ source_url, count }));
  const productionMissingManifest = officialProductionSources
    .filter((source) => !manifestByUrl.has(canonicalOfficialSourceUrl(source.source_url)))
    .map((source) => ({
      source_id: source.id,
      source_name: source.source_name,
      source_type: source.source_type,
      source_url: source.source_url
    }));
  const manifestMissingProduction = manifestSources
    .filter((source) => !productionByUrl.has(canonicalOfficialSourceUrl(source.source_url)))
    .map((source) => ({
      file: source.file,
      provider: source.provider,
      source_name: source.source_name,
      source_type: source.source_type,
      source_url: source.source_url
    }));
  const metadataMismatches = manifestSources.flatMap((manifestSource) => {
    const productionSource = productionByUrl.get(canonicalOfficialSourceUrl(manifestSource.source_url));
    if (!productionSource) return [];
    const differences = [];
    if (normalizedText(manifestSource.source_name) !== normalizedText(productionSource.source_name)) differences.push("source_name");
    if (cleanText(manifestSource.source_type).toUpperCase() !== cleanText(productionSource.source_type).toUpperCase()) differences.push("source_type");
    return differences.length ? [{
      file: manifestSource.file,
      source_url: manifestSource.source_url,
      differences,
      manifest_source_name: manifestSource.source_name,
      production_source_name: productionSource.source_name,
      manifest_source_type: manifestSource.source_type,
      production_source_type: productionSource.source_type
    }] : [];
  });
  const underfilledSources = manifestSources.flatMap((manifestSource) => {
    const productionSource = productionByUrl.get(canonicalOfficialSourceUrl(manifestSource.source_url));
    if (!productionSource) return [];
    const actual = Number(cardCounts.get(cleanText(productionSource.id)) || 0);
    // catalog_cards intentionally excludes review-only variants; compare the
    // decision-active denominator, not the raw parser row denominator.
    const minimum = Number(
      manifestSource.minimum_promotion_candidate_count
      ?? manifestSource.minimum_card_count
      ?? 1
    );
    return actual < minimum ? [{
      file: manifestSource.file,
      source_name: manifestSource.source_name,
      source_url: manifestSource.source_url,
      actual_card_count: actual,
      minimum_decision_card_count: minimum
    }] : [];
  });

  const issueCount = repository.error_count
    + productionDuplicateUrls.length
    + productionMissingManifest.length
    + manifestMissingProduction.length
    + metadataMismatches.length
    + underfilledSources.length;
  return {
    schema_version: "official-catalog-manifest-production-parity-v1",
    valid: issueCount === 0,
    issue_count: issueCount,
    repository,
    summary: {
      manifest_count: repository.manifest_count,
      manifest_source_count: manifestSources.length,
      production_official_source_count: officialProductionSources.length,
      production_duplicate_url_count: productionDuplicateUrls.length,
      production_missing_manifest_count: productionMissingManifest.length,
      manifest_missing_production_count: manifestMissingProduction.length,
      metadata_mismatch_count: metadataMismatches.length,
      underfilled_source_count: underfilledSources.length
    },
    issues: {
      production_duplicate_urls: productionDuplicateUrls,
      production_missing_manifest: productionMissingManifest,
      manifest_missing_production: manifestMissingProduction,
      metadata_mismatches: metadataMismatches,
      underfilled_sources: underfilledSources
    }
  };
}

async function fetchAllRows({ baseUrl, serviceRoleKey, table, select, fetchImpl = globalThis.fetch }) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url, {
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table}_query_failed:${response.status}:${text.slice(0, 120)}`);
    const page = text ? JSON.parse(text) : [];
    if (!Array.isArray(page)) throw new Error(`${table}_query_non_array`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

export async function auditOfficialCatalogManifestParity({
  env = process.env,
  directory = "data/catalog/official",
  repositoryOnly = false,
  fetchImpl = globalThis.fetch
} = {}) {
  const manifestEntries = await loadOfficialCatalogManifestEntries({ directory });
  if (repositoryOnly) {
    const repository = validateOfficialCatalogManifestSet(manifestEntries, {
      providerProfiles: officialCatalogSourceProfiles
    });
    return {
      schema_version: "official-catalog-manifest-repository-audit-v1",
      valid: repository.valid,
      issue_count: repository.error_count,
      repository
    };
  }
  const baseUrl = cleanText(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = cleanText(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY);
  if (!baseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const [productionSources, catalogCards] = await Promise.all([
    fetchAllRows({
      baseUrl,
      serviceRoleKey,
      table: "catalog_sources",
      select: "id,source_type,source_status,source_name,source_url,parser_version",
      fetchImpl
    }),
    fetchAllRows({
      baseUrl,
      serviceRoleKey,
      table: "catalog_cards",
      select: "id,source_id",
      fetchImpl
    })
  ]);
  return buildOfficialCatalogManifestParity({ manifestEntries, productionSources, catalogCards });
}

async function writeJson(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  auditOfficialCatalogManifestParity({
    directory: argValue(argv, "--directory", "data/catalog/official"),
    repositoryOnly: argv.includes("--repository-only")
  }).then(async (report) => {
    await writeJson(argValue(argv, "--out", ""), report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.valid) process.exitCode = 1;
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
