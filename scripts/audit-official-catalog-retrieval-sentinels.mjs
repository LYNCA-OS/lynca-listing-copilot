import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { loadOfficialCatalogManifestEntries } from "./audit-official-catalog-manifest-parity.mjs";

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedText(value = "") {
  return cleanText(value).toLowerCase();
}

function textCompatible(actual = "", expected = "") {
  const left = normalizedText(actual);
  const right = normalizedText(expected);
  return !right || (left && (left.includes(right) || right.includes(left)));
}

function candidateValues(candidate = {}, keys = []) {
  const fields = candidate.fields || {};
  return keys.flatMap((key) => {
    const value = fields[key];
    return Array.isArray(value) ? value : [value];
  }).map(cleanText).filter(Boolean);
}

function preferredRequiredRecord(records = []) {
  return records.find((record) => (
    !/REVIEW_REQUIRED/i.test(record.expected_import_status || "")
    && (record.card_number || record.checklist_code)
  )) || records.find((record) => record.card_number || record.checklist_code) || null;
}

export function buildOfficialCatalogRetrievalSentinelPlan(manifestEntries = []) {
  return manifestEntries.flatMap(({ file, manifest }) => (manifest.sources || []).map((source) => {
    const record = preferredRequiredRecord(source.required_records || []);
    return {
      file,
      provider: manifest.provider,
      source_name: source.source_name,
      source_url: source.source_url,
      source_type: source.source_type,
      category: source.category,
      record,
      plan_error: record ? null : "official_retrieval_sentinel_query_anchor_missing"
    };
  }));
}

export function officialCatalogCandidateMatchesSentinel(candidate = {}, sentinel = {}) {
  const record = sentinel.record || {};
  const referenceSourceType = cleanText(candidate.reference_metadata?.source_type).toUpperCase();
  if (referenceSourceType !== cleanText(sentinel.source_type).toUpperCase()) return false;

  const expectedCodes = [record.card_number, record.checklist_code].map(normalizedText).filter(Boolean);
  const candidateCodes = candidateValues(candidate, ["card_number", "collector_number", "checklist_code"])
    .map(normalizedText);
  if (!expectedCodes.some((code) => candidateCodes.includes(code))) return false;

  const expectedSubject = cleanText(record.subject || record.card_name);
  const candidateSubjects = candidateValues(candidate, ["subject", "card_name", "players", "character"]);
  if (expectedSubject && !candidateSubjects.some((value) => textCompatible(value, expectedSubject))) return false;

  if (record.product && !textCompatible(candidate.fields?.product, record.product)) return false;
  if (record.set_or_insert && !textCompatible(candidate.fields?.set, record.set_or_insert)) return false;
  return true;
}

export async function auditOfficialCatalogRetrievalSentinels({
  manifestEntries,
  provider = catalogProvider()
} = {}) {
  const entries = manifestEntries || await loadOfficialCatalogManifestEntries();
  const plan = buildOfficialCatalogRetrievalSentinelPlan(entries);
  const results = [];
  for (const sentinel of plan) {
    if (sentinel.plan_error) {
      results.push({ ...sentinel, ok: false, reason: sentinel.plan_error, candidate_count: 0, match_count: 0 });
      continue;
    }
    const record = sentinel.record;
    const subject = cleanText(record.subject || record.card_name);
    const product = cleanText(record.product);
    const response = await provider.search({
      query: {
        exact_card_number: cleanText(record.card_number),
        exact_checklist_code: cleanText(record.checklist_code),
        exact_subject: subject,
        exact_product: product,
        match_count: 20
      },
      resolved: {
        category: sentinel.category,
        product,
        players: subject ? [subject] : [],
        collector_number: cleanText(record.card_number),
        checklist_code: cleanText(record.checklist_code)
      }
    });
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    const matches = candidates.filter((candidate) => officialCatalogCandidateMatchesSentinel(candidate, sentinel));
    results.push({
      file: sentinel.file,
      provider: sentinel.provider,
      source_name: sentinel.source_name,
      source_url: sentinel.source_url,
      source_type: sentinel.source_type,
      query: {
        card_number: cleanText(record.card_number) || null,
        checklist_code: cleanText(record.checklist_code) || null,
        subject: subject || null,
        product: product || null,
        set_or_insert: cleanText(record.set_or_insert) || null
      },
      ok: matches.length > 0,
      reason: matches.length > 0 ? null : response?.reason || "official_retrieval_sentinel_not_found",
      candidate_count: candidates.length,
      match_count: matches.length,
      matched_candidate_id: matches[0]?.candidate_id || null,
      matched_title: matches[0]?.title || null,
      matched_score: matches[0]?.normalized_score ?? matches[0]?.score ?? null
    });
  }
  const failed = results.filter((result) => !result.ok);
  return {
    schema_version: "official-catalog-retrieval-sentinel-audit-v1",
    valid: failed.length === 0,
    total_source_count: results.length,
    passed_source_count: results.length - failed.length,
    failed_source_count: failed.length,
    results
  };
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function writeJson(path, value) {
  if (!path) return;
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  auditOfficialCatalogRetrievalSentinels().then(async (report) => {
    await writeJson(argValue(process.argv.slice(2), "--out", ""), report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.valid) process.exitCode = 1;
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
