import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCommercialAcceptanceRow } from "./measure-agnes-commercial-acceptance-proxy.mjs";
import { renderedResult } from "./measure-agnes-rendered-commercial-acceptance.mjs";

const schemaVersion = "agnes-auto-95-gap-plan-v1";
const defaultAgnesPath = "data/eval/agnes-supabase-feedback-latest.json";
const defaultPacketPath = "data/recognition/review/supabase-commercial-review-packet.json";
const defaultOutPath = "data/eval/agnes-auto-95-gap-plan-latest.json";
const defaultCsvOutPath = "data/recognition/review/agnes-auto-95-gap-plan.csv";
const defaultTargetAccuracy = 0.95;
const defaultMaxManualRate = 0.05;
const defaultTitleMode = "rendered";
const defaultMaxTitleLength = 80;

const fieldLayers = Object.freeze({
  T0_IDENTITY_CORE: ["year", "product", "players", "player", "subject", "name"],
  T1_VALUE_CRITICAL: [
    "serial_number",
    "parallel",
    "color",
    "grade",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
    "collector_number",
    "checklist_code"
  ],
  T2_COMMERCIAL_ATTRIBUTES: [
    "auto",
    "rc",
    "first_bowman",
    "patch",
    "relic",
    "ssp",
    "case_hit",
    "one_of_one",
    "card_type",
    "insert",
    "attributes"
  ],
  T3_CONTEXT: ["manufacturer", "set", "variation"]
});

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const raw = argValue(argv, name, null);
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedCounts(map) {
  return Object.fromEntries([...map.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  }));
}

function fieldLayer(field) {
  for (const [layer, fields] of Object.entries(fieldLayers)) {
    if (fields.includes(field)) return layer;
  }
  return "T4_UNCLASSIFIED";
}

function fieldTrack(field) {
  const layer = fieldLayer(field);
  if (layer === "T0_IDENTITY_CORE") return "identity_core_probe";
  if (["serial_number", "collector_number", "checklist_code"].includes(field)) return "number_and_checklist_probe";
  if (["parallel", "color"].includes(field)) return "parallel_taxonomy_probe";
  if (["grade", "grade_company", "card_grade", "auto_grade", "grade_type"].includes(field)) return "slab_grade_probe";
  if (layer === "T2_COMMERCIAL_ATTRIBUTES") return "commercial_attribute_probe";
  if (layer === "T3_CONTEXT") return "product_context_probe";
  return "resolver_review";
}

function resultId(result = {}) {
  return normalizeText(result.source_feedback_id || result.candidate_id || result.asset_id);
}

function taskId(task = {}) {
  return normalizeText(task.source_feedback_id || task.asset_id || task.physical_card_id);
}

function tasksFromPacket(packet = {}) {
  if (Array.isArray(packet.tasks)) return packet.tasks;
  if (Array.isArray(packet.items)) return packet.items;
  return [];
}

function taskIndex(packet = {}) {
  return new Map(tasksFromPacket(packet).map((task) => [taskId(task), task]));
}

function fieldsForRow(row = {}) {
  const fields = [];
  for (const failure of row.principle_failures || []) {
    if (failure === "wrong_year") fields.push("year");
    if (failure === "wrong_serial") fields.push("serial_number");
    if (failure === "wrong_grade") fields.push("grade");
    if (failure === "unexpected_color") fields.push("parallel", "color");
    if (failure === "wrong_player") fields.push("players");
    if (failure === "wrong_product") fields.push("product");
  }
  for (const field of row.title_derived_field_mismatches || []) fields.push(field);
  if ((row.failure_reasons || []).includes("provider_error")) fields.push("provider_status");
  if ((row.failure_reasons || []).includes("invalid_candidate")) fields.push("candidate_validity");
  if ((row.failure_reasons || []).includes("not_evaluated")) fields.push("evaluation_status");
  if ((row.failure_reasons || []).includes("no_title_derived_reference_fields")) fields.push("reference_field_coverage");
  return unique(fields);
}

function autoFixTracks(row = {}, fields = []) {
  const tracks = [];
  for (const reason of row.failure_reasons || []) {
    if (reason === "provider_error") tracks.push("provider_retry_timeout_sharding");
    if (reason === "invalid_candidate" || reason === "not_evaluated") tracks.push("input_validation_and_queue_recovery");
    if (reason === "no_title_derived_reference_fields") tracks.push("reference_parser_coverage");
    if (reason === "principle_error") tracks.push("identity_resolution_hard_constraints");
    if (reason === "title_derived_field_mismatch") tracks.push("field_evidence_completion");
  }
  for (const field of fields) tracks.push(fieldTrack(field));
  for (const reason of row.diagnostic_reasons || []) {
    if (reason === "low_token_recall" || reason === "low_token_precision") {
      tracks.push("deterministic_renderer_coverage_guard");
    }
  }
  return unique(tracks);
}

function priorityScore(row = {}, fields = []) {
  if (row.accepted) return 0;
  let score = 10;
  const reasons = new Set(row.failure_reasons || []);
  if (reasons.has("principle_error")) score += 100;
  if (reasons.has("provider_error")) score += 90;
  if (reasons.has("title_derived_field_mismatch")) score += 70;
  if (reasons.has("no_title_derived_reference_fields")) score += 40;
  score += (row.principle_failures || []).length * 12;
  score += (row.title_derived_field_mismatches || []).length * 6;
  for (const field of fields) {
    const layer = fieldLayer(field);
    if (layer === "T0_IDENTITY_CORE") score += 25;
    if (layer === "T1_VALUE_CRITICAL") score += 20;
    if (layer === "T2_COMMERCIAL_ATTRIBUTES") score += 10;
  }
  score += (row.diagnostic_reasons || []).length * 3;
  return score;
}

function priorityBand(row = {}, fields = []) {
  if (row.accepted) return "P3_QC_ACCEPTED";
  const layers = new Set(fields.map(fieldLayer));
  const reasons = new Set(row.failure_reasons || []);
  if (
    reasons.has("principle_error")
    || reasons.has("provider_error")
    || layers.has("T0_IDENTITY_CORE")
    || layers.has("T1_VALUE_CRITICAL")
  ) {
    return "P0_MUST_AUTO_FIX";
  }
  if (layers.has("T2_COMMERCIAL_ATTRIBUTES")) return "P1_AUTO_FIX";
  return "P2_DIAGNOSTIC";
}

function createItem(result = {}, row = {}, task = null) {
  const fields = fieldsForRow(row);
  const layers = unique(fields.map(fieldLayer));
  return {
    source_feedback_id: resultId(result),
    asset_id: normalizeText(result.asset_id || task?.asset_id),
    provider_status: result.status || "not_evaluated",
    accepted_by_principle_safe_proxy: row.accepted,
    priority_band: priorityBand(row, fields),
    priority_score: priorityScore(row, fields),
    primary_failure_reason: row.primary_failure_reason || "",
    failure_reasons: row.failure_reasons || [],
    principle_failures: row.principle_failures || [],
    title_derived_field_mismatches: row.title_derived_field_mismatches || [],
    token_diagnostics: row.diagnostic_reasons || [],
    review_fields: fields,
    review_layers: layers,
    auto_fix_tracks: autoFixTracks(row, fields),
    suggested_fields_available: Boolean(task?.suggested_fields),
    corrected_title_hint_used_as_ground_truth: false
  };
}

function summarizeFieldLayers(items = []) {
  const layerCounts = new Map();
  const fieldCounts = new Map();
  const trackCounts = new Map();
  for (const item of items.filter((entry) => !entry.accepted_by_principle_safe_proxy)) {
    for (const layer of item.review_layers) increment(layerCounts, layer);
    for (const field of item.review_fields) increment(fieldCounts, field);
    for (const track of item.auto_fix_tracks) increment(trackCounts, track);
  }
  return {
    layers: sortedCounts(layerCounts),
    fields: sortedCounts(fieldCounts),
    auto_fix_tracks: sortedCounts(trackCounts)
  };
}

function recoveryScenarios(items = [], acceptedCount, targetRows, targetAccuracy, maxManualCount) {
  const buckets = [
    {
      lever: "fix_title_derived_field_mismatch_with_evidence_completion",
      primary_failure_reasons: ["title_derived_field_mismatch"]
    },
    {
      lever: "eliminate_principle_errors_with_identity_resolution_constraints",
      primary_failure_reasons: ["principle_error"]
    },
    {
      lever: "recover_provider_errors_with_retry_and_parallel_probes",
      primary_failure_reasons: ["provider_error", "invalid_candidate", "not_evaluated"]
    },
    {
      lever: "expand_reference_parser_for_missing_title_fields",
      primary_failure_reasons: ["no_title_derived_reference_fields"]
    }
  ];
  let cumulative = 0;
  return buckets.map((bucket) => {
    const recoverable = items.filter((item) => (
      !item.accepted_by_principle_safe_proxy
      && bucket.primary_failure_reasons.includes(item.primary_failure_reason)
    )).length;
    cumulative += recoverable;
    const acceptedIfRecovered = Math.min(targetRows, acceptedCount + cumulative);
    const manualRemaining = Math.max(0, targetRows - acceptedIfRecovered);
    return {
      ...bucket,
      recoverable_count: recoverable,
      cumulative_recovered_count: cumulative,
      accepted_if_recovered_count: acceptedIfRecovered,
      accepted_if_recovered_rate: rate(acceptedIfRecovered, targetRows),
      manual_or_unresolved_remaining_count: manualRemaining,
      manual_or_unresolved_remaining_rate: rate(manualRemaining, targetRows),
      meets_target_accuracy: acceptedIfRecovered >= Math.ceil(targetAccuracy * targetRows),
      meets_manual_budget: manualRemaining <= maxManualCount
    };
  });
}

export function buildAgnesAuto95GapPlan({
  agnesReport,
  reviewPacket = null,
  targetAccuracy = defaultTargetAccuracy,
  maxManualRate = defaultMaxManualRate,
  titleMode = defaultTitleMode,
  maxTitleLength = defaultMaxTitleLength,
  now = () => new Date()
} = {}) {
  const results = Array.isArray(agnesReport?.results) ? agnesReport.results : [];
  const evaluationResults = titleMode === "provider"
    ? results
    : results.map((result) => renderedResult(result, { maxTitleLength }));
  const targetRows = agnesReport?.target_count ?? results.length;
  const maxManualCount = Math.floor(targetRows * maxManualRate);
  const requiredAutoCorrectCount = Math.ceil(targetRows * targetAccuracy);
  const index = taskIndex(reviewPacket || {});
  const items = results.map((result, resultIndex) => {
    const evaluationResult = evaluationResults[resultIndex] || result;
    const row = evaluateCommercialAcceptanceRow(evaluationResult, { enforceTokenGate: false });
    return createItem(result, row, index.get(resultId(result)) || null);
  });

  const acceptedItems = items.filter((item) => item.accepted_by_principle_safe_proxy);
  const rejectedItems = items
    .filter((item) => !item.accepted_by_principle_safe_proxy)
    .sort((left, right) => {
      if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
      return left.source_feedback_id.localeCompare(right.source_feedback_id);
    });

  rejectedItems.forEach((item, indexWithinRejected) => {
    item.manual_budget_rank = indexWithinRejected + 1;
    item.manual_budget_candidate = item.manual_budget_rank <= maxManualCount;
    item.must_auto_recover_for_95 = !item.manual_budget_candidate;
  });
  acceptedItems.forEach((item) => {
    item.manual_budget_rank = null;
    item.manual_budget_candidate = false;
    item.must_auto_recover_for_95 = false;
  });

  const orderedItems = [...rejectedItems, ...acceptedItems];
  const acceptedCount = acceptedItems.length;
  const currentManualCount = Math.max(0, targetRows - acceptedCount);
  const additionalAutoCorrectNeeded = Math.max(0, requiredAutoCorrectCount - acceptedCount);
  const currentManualOverBudget = Math.max(0, currentManualCount - maxManualCount);

  const primaryReasonCounts = new Map();
  const failureReasonCounts = new Map();
  const principleFailureCounts = new Map();
  const fieldMismatchCounts = new Map();
  const tokenDiagnosticCounts = new Map();
  for (const item of orderedItems) {
    if (!item.accepted_by_principle_safe_proxy) increment(primaryReasonCounts, item.primary_failure_reason || "unknown");
    for (const reason of item.failure_reasons) increment(failureReasonCounts, reason);
    for (const reason of item.principle_failures) increment(principleFailureCounts, reason);
    for (const field of item.title_derived_field_mismatches) increment(fieldMismatchCounts, field);
    for (const reason of item.token_diagnostics) increment(tokenDiagnosticCounts, reason);
  }

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    status: "completed",
    source: {
      provider: agnesReport?.provider || "agnes",
      agnes_schema_version: agnesReport?.schema_version || null,
      target_rows: targetRows,
      evaluated_rows: agnesReport?.evaluated_count ?? results.filter((result) => result.status === "evaluated").length,
      provider_error_count: agnesReport?.provider_error_count ?? results.filter((result) => result.status === "provider_error").length,
      review_packet_schema_version: reviewPacket?.schema_version || null,
      review_packet_task_count: tasksFromPacket(reviewPacket || {}).length,
      title_mode: titleMode === "provider" ? "provider" : "rendered",
      max_title_length: titleMode === "provider" ? null : maxTitleLength
    },
    scope: {
      metric_type: "principle_safe_commercial_acceptance_gap_to_95_auto",
      exact_title_match_required: false,
      word_order_required: false,
      token_similarity_is_diagnostic_only: true,
      final_title_content_required: true,
      deterministic_renderer_applied: titleMode !== "provider",
      corrected_title_hints_used_as_ground_truth: false,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      no_feedback_retention_side_effects: true,
      raw_titles_in_report: false
    },
    target: {
      target_automated_accuracy: targetAccuracy,
      max_manual_rate: maxManualRate,
      required_auto_correct_count: requiredAutoCorrectCount,
      max_manual_count: maxManualCount
    },
    current: {
      accepted_count: acceptedCount,
      rejected_or_abstain_count: currentManualCount,
      target_rows: targetRows,
      accepted_rate: rate(acceptedCount, targetRows),
      rejected_or_abstain_rate: rate(currentManualCount, targetRows),
      additional_auto_correct_needed_for_target: additionalAutoCorrectNeeded,
      current_manual_over_budget_count: currentManualOverBudget,
      max_remaining_auto_failures_or_abstains: maxManualCount
    },
    field_layers: fieldLayers,
    failure_summary: {
      primary_failure_reasons: sortedCounts(primaryReasonCounts),
      all_failure_reasons: sortedCounts(failureReasonCounts),
      principle_failures: sortedCounts(principleFailureCounts),
      title_derived_field_mismatches: sortedCounts(fieldMismatchCounts),
      token_diagnostics: sortedCounts(tokenDiagnosticCounts)
    },
    field_layer_summary: summarizeFieldLayers(orderedItems),
    auto_recovery_strategy: {
      framing: "To meet 95% automated accuracy with <=5% manual routing, only max_manual_count rejected rows can remain manual. All other currently rejected rows must be automatically recovered by evidence completion, constraints, or provider retry.",
      manual_budget_candidate_count: rejectedItems.filter((item) => item.manual_budget_candidate).length,
      must_auto_recover_count: rejectedItems.filter((item) => item.must_auto_recover_for_95).length,
      scenarios: recoveryScenarios(orderedItems, acceptedCount, targetRows, targetAccuracy, maxManualCount)
    },
    items: orderedItems
  };
}

export function formatAgnesAuto95GapPlanSummary(report = {}) {
  const current = report.current || {};
  const target = report.target || {};
  const source = report.source || {};
  return [
    `Agnes auto 95 gap plan ${report.schema_version || "unknown"}`,
    `title_mode: ${source.title_mode || "n/a"}`,
    `max_title_length: ${source.max_title_length ?? "n/a"}`,
    `target_rows: ${current.target_rows ?? "n/a"}`,
    `current_principle_safe_accepted: ${current.accepted_count ?? "n/a"}/${current.target_rows ?? "n/a"} (${current.accepted_rate ?? "n/a"})`,
    `current_rejected_or_abstain: ${current.rejected_or_abstain_count ?? "n/a"}/${current.target_rows ?? "n/a"} (${current.rejected_or_abstain_rate ?? "n/a"})`,
    `required_auto_correct: ${target.required_auto_correct_count ?? "n/a"}/${current.target_rows ?? "n/a"} (${target.target_automated_accuracy ?? "n/a"})`,
    `max_manual_count: ${target.max_manual_count ?? "n/a"}/${current.target_rows ?? "n/a"} (${target.max_manual_rate ?? "n/a"})`,
    `additional_auto_correct_needed_for_target: ${current.additional_auto_correct_needed_for_target ?? "n/a"}`,
    `current_manual_over_budget_count: ${current.current_manual_over_budget_count ?? "n/a"}`,
    `raw_titles_in_report: ${report.scope?.raw_titles_in_report === true}`
  ].join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function writeCsv(path, items = []) {
  const columns = [
    "source_feedback_id",
    "asset_id",
    "provider_status",
    "accepted_by_principle_safe_proxy",
    "priority_band",
    "priority_score",
    "manual_budget_rank",
    "manual_budget_candidate",
    "must_auto_recover_for_95",
    "primary_failure_reason",
    "failure_reasons",
    "principle_failures",
    "title_derived_field_mismatches",
    "review_fields",
    "review_layers",
    "auto_fix_tracks"
  ];
  const rows = [
    columns.join(","),
    ...items.map((item) => columns.map((column) => csvEscape(item[column])).join(","))
  ];
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${rows.join("\n")}\n`);
}

export async function main(argv = process.argv, env = process.env) {
  const agnesPath = argValue(argv, "--agnes", env.AGNES_AUTO_95_GAP_AGNES || defaultAgnesPath);
  const packetPath = argValue(argv, "--packet", env.AGNES_AUTO_95_GAP_PACKET || defaultPacketPath);
  const outPath = argValue(argv, "--out", env.AGNES_AUTO_95_GAP_OUT || defaultOutPath);
  const csvOutPath = argValue(argv, "--csv-out", env.AGNES_AUTO_95_GAP_CSV_OUT || defaultCsvOutPath);
  const targetAccuracy = numberArg(argv, "--target-accuracy", Number(env.AGNES_AUTO_95_TARGET_ACCURACY || defaultTargetAccuracy));
  const maxManualRate = numberArg(argv, "--max-manual-rate", Number(env.AGNES_AUTO_95_MAX_MANUAL_RATE || defaultMaxManualRate));
  const titleMode = argValue(argv, "--title-mode", env.AGNES_AUTO_95_TITLE_MODE || defaultTitleMode);
  const maxTitleLength = numberArg(argv, "--max-title-length", Number(env.AGNES_AUTO_95_MAX_TITLE_LENGTH || defaultMaxTitleLength));
  const noWrite = hasFlag(argv, "--no-write");
  const noCsv = hasFlag(argv, "--no-csv");
  const agnesReport = await readJson(agnesPath);
  const reviewPacket = packetPath && existsSync(resolve(packetPath)) ? await readJson(packetPath) : null;
  const report = buildAgnesAuto95GapPlan({
    agnesReport,
    reviewPacket,
    targetAccuracy,
    maxManualRate,
    titleMode,
    maxTitleLength
  });
  if (outPath && !noWrite) await writeJson(outPath, report);
  if (csvOutPath && !noWrite && !noCsv) await writeCsv(csvOutPath, report.items);
  process.stdout.write(`${formatAgnesAuto95GapPlanSummary(report)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes auto 95 gap plan failed: ${error.message}`);
    process.exit(1);
  }
}
