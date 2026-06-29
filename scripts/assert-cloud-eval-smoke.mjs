import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function count(report = {}, key = "") {
  const value = Number(report[key]);
  return Number.isFinite(value) ? value : 0;
}

function resultCount(report = {}, key = "") {
  return (Array.isArray(report.results) ? report.results : [])
    .reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
}

function assertNonnegativeReportCount(report = {}, key = "", label = "") {
  assert.equal(Number.isFinite(Number(report[key])), true, `${label}.${key} must be numeric`);
  assert.equal(Number(report[key]) >= 0, true, `${label}.${key} must be nonnegative`);
}

function assertNoCloudCorrectedTitleHint(report = {}, label = "") {
  assert.equal(report.accuracy_policy?.corrected_title_hint_sent_to_cloud, false, `${label} must not send corrected title hint to cloud`);
  assert.equal(count(report.accuracy_policy, "corrected_title_hint_sent_to_cloud_count"), 0, `${label} corrected_title_hint_sent_to_cloud_count must be 0`);
  for (const item of report.results || []) {
    assert.equal(item.corrected_title_hint_sent_to_cloud, false, `${label} item ${item.candidate_id || ""} leaked corrected title hint`);
  }
}

function assertNoTechnicalFailures(report = {}, label = "") {
  assert.equal(count(report, "attempted_count") > 0, true, `${label} must attempt at least one card`);
  assert.equal(count(report, "technical_failure_count"), 0, `${label} technical failures must be 0`);
  assert.equal(count(report, "provider_success_count"), count(report, "attempted_count"), `${label} provider_success_count must equal attempted_count`);
}

function assertCountMatchesResults(report = {}, key = "", label = "") {
  assert.equal(count(report, key), resultCount(report, key), `${label}.${key} must equal the per-card sum`);
}

function assertAssistEligibility(eligibility = {}, label = "") {
  const promptCount = Number(eligibility.prompt_candidate_count || 0);
  if (promptCount <= 0) return;
  assert.equal(eligibility.reason, "approved_identity_candidate_available", `${label} prompt candidates must come from approved/eval-trusted references`);
  assert.equal(Number(eligibility.approved_candidate_count || 0) >= promptCount, true, `${label} approved_candidate_count must cover prompt candidates`);
  const ids = Array.isArray(eligibility.prompt_candidate_ids) ? eligibility.prompt_candidate_ids : [];
  assert.equal(ids.length, promptCount, `${label} prompt_candidate_ids must match prompt_candidate_count`);
}

function assertCatalogVectorSafety(report = {}, label = "") {
  assert.equal(count(report, "card_type_default_base_count"), 0, `${label} must not default card_type to Base`);
  assert.equal(count(report, "copied_serial_grade_cert_from_reference_count"), 0, `${label} must not copy serial/grade/cert from reference`);
  for (const item of report.results || []) {
    assert.equal(item.card_type_default_base, false, `${label} ${item.candidate_id || ""} defaulted card_type Base`);
    assert.equal(item.copied_serial_grade_cert_from_reference, false, `${label} ${item.candidate_id || ""} copied reference instance fields`);
  }
}

function assertAssistModeNoFastPath(report = {}, label = "") {
  assert.equal(count(report, "fast_path_used_count"), 0, `${label} must skip fast path when assist is enabled`);
  for (const item of report.results || []) {
    assert.equal(item.fast_path_used, false, `${label} ${item.candidate_id || ""} used fast path`);
  }
}

function assertA(report = {}) {
  const label = "A GPT-only";
  assertNoTechnicalFailures(report, label);
  assert.equal(report.provider, "openai_baseline", `${label} provider mismatch`);
  assert.equal(report.accuracy_policy?.corrected_title_as_temporary_gt, false, `${label} temporary GT must be false`);
  assertNoCloudCorrectedTitleHint(report, label);
  for (const key of [
    "catalog_candidate_count",
    "catalog_prompt_candidate_count",
    "catalog_prompt_assist_used_count",
    "vector_raw_candidate_count",
    "vector_prompt_candidate_count",
    "vector_prompt_assist_used_count",
    "visual_vector_used_count"
  ]) {
    assert.equal(count(report, key), 0, `${label}.${key} must be 0`);
  }
}

function assertB(report = {}) {
  const label = "B Catalog-only";
  assertNoTechnicalFailures(report, label);
  assert.equal(report.provider, "openai_catalog", `${label} provider mismatch`);
  assert.equal(report.accuracy_policy?.corrected_title_as_temporary_gt, true, `${label} temporary GT must be true for local eval`);
  assertNoCloudCorrectedTitleHint(report, label);
  assertAssistModeNoFastPath(report, label);
  assertCatalogVectorSafety(report, label);
  assert.equal(count(report, "vector_raw_candidate_count"), 0, `${label} vector_raw_candidate_count must be 0`);
  assert.equal(count(report, "vector_prompt_candidate_count"), 0, `${label} vector_prompt_candidate_count must be 0`);
  assert.equal(count(report, "visual_vector_used_count"), 0, `${label} visual_vector_used_count must be 0`);
  assert.equal(count(report, "catalog_lookup_used_count") + count(report, "catalog_candidate_count") > 0, true, `${label} must show catalog lookup/candidate activity`);
  for (const key of ["catalog_candidate_count", "catalog_prompt_candidate_count"]) {
    assertNonnegativeReportCount(report, key, label);
    assertCountMatchesResults(report, key, label);
  }
  for (const item of report.results || []) {
    assertAssistEligibility(item.catalog_assist_eligibility || {}, `${label} ${item.candidate_id || ""}`);
  }
}

function assertC(report = {}) {
  const label = "C Catalog+Vector";
  assertNoTechnicalFailures(report, label);
  assert.equal(report.provider, "openai_vector", `${label} provider mismatch`);
  assert.equal(report.accuracy_policy?.corrected_title_as_temporary_gt, true, `${label} temporary GT must be true for local eval`);
  assertNoCloudCorrectedTitleHint(report, label);
  assertAssistModeNoFastPath(report, label);
  assertCatalogVectorSafety(report, label);
  assert.equal(count(report, "visual_vector_used_count") > 0, true, `${label} must use visual vector retrieval`);
  assert.equal(count(report, "vector_raw_candidate_count") > 0, true, `${label} must produce raw vector candidates`);
  assert.equal(count(report, "vector_prompt_candidate_count") <= count(report, "vector_approved_candidate_count"), true, `${label} vector prompt count cannot exceed approved count`);
  for (const key of [
    "catalog_candidate_count",
    "catalog_prompt_candidate_count",
    "vector_raw_candidate_count",
    "vector_prompt_candidate_count"
  ]) {
    assertNonnegativeReportCount(report, key, label);
    assertCountMatchesResults(report, key, label);
  }
  for (const item of report.results || []) {
    assertAssistEligibility(item.catalog_assist_eligibility || {}, `${label} catalog ${item.candidate_id || ""}`);
    assertAssistEligibility(item.vector_assist_eligibility || {}, `${label} vector ${item.candidate_id || ""}`);
  }
}

export async function assertCloudEvalSmoke({ gptOnlyPath, catalogOnlyPath, catalogVectorPath } = {}) {
  if (!gptOnlyPath || !catalogOnlyPath || !catalogVectorPath) {
    throw new Error("--gpt-only, --catalog-only, and --catalog-vector are required.");
  }
  const [gptOnly, catalogOnly, catalogVector] = await Promise.all([
    readJson(gptOnlyPath),
    readJson(catalogOnlyPath),
    readJson(catalogVectorPath)
  ]);
  assertA(gptOnly);
  assertB(catalogOnly);
  assertC(catalogVector);
  return {
    status: "passed",
    attempted_count: {
      gpt_only: gptOnly.attempted_count,
      catalog_only: catalogOnly.attempted_count,
      catalog_vector: catalogVector.attempted_count
    },
    catalog_candidate_count: catalogOnly.catalog_candidate_count,
    catalog_prompt_candidate_count: catalogOnly.catalog_prompt_candidate_count,
    vector_raw_candidate_count: catalogVector.vector_raw_candidate_count,
    vector_prompt_candidate_count: catalogVector.vector_prompt_candidate_count
  };
}

export async function main(argv = process.argv) {
  const result = await assertCloudEvalSmoke({
    gptOnlyPath: argValue(argv, "--gpt-only", ""),
    catalogOnlyPath: argValue(argv, "--catalog-only", ""),
    catalogVectorPath: argValue(argv, "--catalog-vector", argValue(argv, "--vector", ""))
  });
  process.stdout.write([
    `cloud eval smoke ${result.status}`,
    `attempted_count: ${JSON.stringify(result.attempted_count)}`,
    `catalog_candidate_count: ${result.catalog_candidate_count}`,
    `catalog_prompt_candidate_count: ${result.catalog_prompt_candidate_count}`,
    `vector_raw_candidate_count: ${result.vector_raw_candidate_count}`,
    `vector_prompt_candidate_count: ${result.vector_prompt_candidate_count}`
  ].join("\n") + "\n");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Cloud eval smoke assertion failed: ${error.message}`);
    process.exit(1);
  }
}
