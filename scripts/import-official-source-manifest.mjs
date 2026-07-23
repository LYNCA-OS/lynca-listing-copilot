import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildProviderCatalogImport,
  importToppsBasketballChecklists
} from "./import-topps-basketball-checklists.mjs";
import { isOfficialCatalogSourceType } from "../lib/listing/catalog/catalog-contract.mjs";

const defaultManifestPath = "data/catalog/official/topps-production-sources.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function valueMatches(actual, expected) {
  if (expected === undefined || expected === null || expected === "") return true;
  return normalize(actual) === normalize(expected);
}

function rowMatchesRequiredRecord(row = {}, required = {}) {
  const fields = row.identity_fields || {};
  return valueMatches(fields.card_number || fields.collector_number, required.card_number)
    && valueMatches(row.import_status, required.expected_import_status)
    && valueMatches(fields.checklist_code, required.checklist_code)
    && valueMatches(fields.product, required.product)
    && valueMatches(fields.set_or_insert, required.set_or_insert)
    && valueMatches(fields.card_name, required.card_name)
    && valueMatches(fields.parallel_exact, required.parallel_exact)
    && valueMatches(fields.external_id, required.external_id)
    && valueMatches(fields.rarity, required.rarity)
    && valueMatches(fields.official_card_type, required.official_card_type)
    && (!required.subject || (fields.players || []).some((player) => valueMatches(player, required.subject)));
}

export function validateOfficialSourceManifestReport(manifest = {}, report = {}) {
  const errors = [];
  const validations = [];
  for (const source of manifest.sources || []) {
    const sourceRows = (report.staging || [])
      .filter((entry) => entry.source?.source_url === source.source_url)
      .map((entry) => entry.staging);
    const promotionCandidateCount = sourceRows.filter((row) => !/REVIEW_REQUIRED/i.test(row.import_status || "")).length;
    const reviewRequiredCount = sourceRows.length - promotionCandidateCount;
    const extractedSource = (report.sources || []).find((entry) => entry.source_url === source.source_url);
    const expectedSourceType = String(source.source_type || "").trim().toUpperCase();
    const actualSourceType = String(extractedSource?.source_type || "").trim().toUpperCase();
    const sourceTypeMatches = !expectedSourceType || expectedSourceType === actualSourceType;
    const recordChecks = (source.required_records || []).map((required) => ({
      required,
      matched: sourceRows.some((row) => rowMatchesRequiredRecord(row, required))
    }));
    const validation = {
      source_name: source.source_name,
      source_url: source.source_url,
      extraction_method: extractedSource?.source_metadata?.extraction_method || null,
      expected_source_type: expectedSourceType || null,
      actual_source_type: actualSourceType || null,
      source_type_matches: sourceTypeMatches,
      parsed_card_count: sourceRows.length,
      minimum_card_count: Number(source.minimum_card_count || 1),
      promotion_candidate_count: promotionCandidateCount,
      minimum_promotion_candidate_count: Number(source.minimum_promotion_candidate_count ?? source.minimum_card_count ?? 1),
      review_required_count: reviewRequiredCount,
      maximum_review_required_count: Number(source.maximum_review_required_count ?? 0),
      record_checks: recordChecks,
      valid: Boolean(extractedSource)
        && sourceTypeMatches
        && sourceRows.length >= Number(source.minimum_card_count || 1)
        && promotionCandidateCount >= Number(source.minimum_promotion_candidate_count ?? source.minimum_card_count ?? 1)
        && reviewRequiredCount <= Number(source.maximum_review_required_count ?? 0)
        && recordChecks.every((check) => check.matched)
    };
    if (!validation.valid) errors.push(`official_source_validation_failed:${source.source_name}`);
    validations.push(validation);
  }
  return { valid: errors.length === 0, errors, validations };
}

export function officialManifestImporterArgv({
  manifest = {},
  source = {},
  envFilePath = "",
  noEnvFile = false
} = {}) {
  return [
    "--all-topps",
    "--provider", manifest.provider || source.provider || "topps",
    "--source-type", source.source_type,
    "--category", source.category || "all",
    "--source-url", source.source_url,
    "--source-name", source.source_name,
    "--apply",
    ...(envFilePath ? ["--env-file", envFilePath] : noEnvFile ? ["--no-env-file"] : [])
  ];
}

async function writeJson(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function importOfficialSourceManifest({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const manifestPath = resolve(argValue(argv, "--manifest", defaultManifestPath));
  const outPath = argValue(argv, "--out", "");
  const apply = argv.includes("--apply");
  const envFilePath = argValue(argv, "--env-file", "");
  const noEnvFile = argv.includes("--no-env-file");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.provider) throw new Error("official_source_manifest_provider_required");
  if ((manifest.sources || []).some((source) => !isOfficialCatalogSourceType(source.source_type))) {
    throw new Error("official_source_manifest_non_official_source_type");
  }
  const sources = (manifest.sources || []).map((source) => ({
    href: source.source_url,
    text: source.source_name,
    category: source.category,
    provider: manifest.provider || source.provider || "topps",
    source_type: source.source_type
  }));
  if (!sources.length) throw new Error("official_source_manifest_empty");

  const dryRunReport = await buildProviderCatalogImport({
    fetchImpl,
    provider: manifest.provider || "topps",
    sourceUrls: sources,
    category: ""
  });
  const validation = validateOfficialSourceManifestReport(manifest, dryRunReport);
  if (!validation.valid) throw new Error(validation.errors.join(","));

  const applyReports = [];
  if (apply) {
    for (const source of manifest.sources) {
      applyReports.push(await importToppsBasketballChecklists({
        argv: officialManifestImporterArgv({ manifest, source, envFilePath, noEnvFile }),
        env,
        fetchImpl
      }));
    }
  }

  const summary = {
    schema_version: "official-source-manifest-import-report-v1",
    generated_at: new Date().toISOString(),
    manifest_path: manifestPath,
    apply,
    validation,
    dry_run_metrics: dryRunReport.metrics,
    apply_reports: applyReports
  };
  await writeJson(outPath, summary);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  importOfficialSourceManifest().then((summary) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
