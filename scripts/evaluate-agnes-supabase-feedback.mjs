import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { createEvidenceField } from "../lib/listing/evidence/evidence-schema.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import { completeEvidence } from "../lib/listing/orchestration/evidence-completion-orchestrator.mjs";
import { createIdentityConvergenceRetriever } from "../lib/listing/orchestration/identity-convergence-retriever.mjs";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { openWorldEvaluationMetrics } from "../lib/identity-resolution/identity-layers.mjs";
import { createRetrievalProviderRegistry } from "../lib/listing/retrieval/retrieval-provider-registry.mjs";
import {
  annotateEvaluationRootCauses,
  componentQualityReport,
  rootCauseSummary
} from "../lib/listing/evaluation/component-quality.mjs";
import { analyzeCardImagesWithRecognitionWorker } from "../lib/listing/recognition/recognition-client.mjs";
import { recognitionRequestedFields } from "../lib/listing/recognition/recognition-contract.mjs";
import { safeRecognitionError } from "../lib/listing/recognition/recognition-errors.mjs";
import {
  hasRecognitionEvidence,
  recognitionResponseToEvidenceDocument
} from "../lib/listing/recognition/recognition-evidence-normalizer.mjs";
import {
  isSupabaseFeedbackConfigured,
  listApprovedHistoryRecords,
  listingApprovedMemoryEnabled
} from "../lib/supabase-feedback.mjs";

const schemaVersion = "agnes-supabase-feedback-eval-v1";
const defaultDatasetPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutPath = "data/eval/agnes-supabase-feedback-latest.json";
const evalProviders = Object.freeze({
  AGNES: "agnes",
  OPENAI: "openai_legacy",
  CASCADE_FAST: "cascade_fast"
});
const colorTokens = new Set([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

function normalizeEvalProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["cascade", "cascade_fast", "fast_cascade", "gpt-agnes", "gpt_agnes"].includes(raw)) return evalProviders.CASCADE_FAST;
  if (["openai", "gpt", "gpt-4.1-mini", "openai_legacy"].includes(raw)) return evalProviders.OPENAI;
  return evalProviders.AGNES;
}

function providerDisplayName(providerId) {
  if (providerId === evalProviders.CASCADE_FAST) return "GPT-4.1-mini → Agnes verifier";
  return providerId === evalProviders.OPENAI ? "GPT-4.1-mini" : "Agnes";
}

function providerEnvKeys(providerId) {
  if (providerId === evalProviders.CASCADE_FAST) return ["OPENAI_API_KEY", "AGNES_API_KEY"];
  return providerId === evalProviders.OPENAI ? ["OPENAI_API_KEY"] : ["AGNES_API_KEY"];
}

function analyzeImplForProvider(providerId) {
  return providerId === evalProviders.OPENAI || providerId === evalProviders.CASCADE_FAST
    ? analyzeCardEvidenceWithOpenAiEmergency
    : analyzeCardEvidenceWithAgnes;
}

function focusedAnalyzeImplForProvider(providerId) {
  return providerId === evalProviders.CASCADE_FAST
    ? analyzeCardEvidenceWithAgnes
    : analyzeImplForProvider(providerId);
}

function identityProviderIdForProvider(providerId) {
  return providerId === evalProviders.CASCADE_FAST
    ? "primary_fast_vision"
    : providerId;
}

function focusedProviderIdForProvider(providerId) {
  return providerId === evalProviders.CASCADE_FAST ? evalProviders.AGNES : providerId;
}

function openAiFastVisionEvalEnabled(env = process.env) {
  return booleanFromEnv(env, "OPENAI_EVAL_PRIMARY_FAST_VISION", false)
    || booleanFromEnv(env, "GPT_EVAL_PRIMARY_FAST_VISION", false);
}

function fastVisionPolicyForProvider(providerId, env = process.env) {
  if (providerId === evalProviders.CASCADE_FAST) {
    return {
      role: "PRIMARY_FAST_VISION",
      allow_single_source_publish: true,
      primary_provider_id: evalProviders.OPENAI,
      secondary_provider_id: evalProviders.AGNES,
      secondary_verification_enabled: true
    };
  }

  if (providerId === evalProviders.OPENAI && openAiFastVisionEvalEnabled(env)) {
    return {
      role: "PRIMARY_FAST_VISION",
      allow_single_source_publish: true,
      primary_provider_id: evalProviders.OPENAI,
      secondary_provider_id: null,
      secondary_verification_enabled: false
    };
  }

  return null;
}

function providerDefaultConcurrency(providerId, env = process.env) {
  if (providerId === evalProviders.CASCADE_FAST) {
    return Number(env.CASCADE_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || env.OPENAI_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || 4);
  }
  if (providerId === evalProviders.OPENAI) {
    return Number(env.OPENAI_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || env.GPT_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || 3);
  }
  return Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || 2);
}

function providerDefaultMaxConcurrency(providerId, env = process.env) {
  if (providerId === evalProviders.CASCADE_FAST) {
    return Number(env.CASCADE_SUPABASE_FEEDBACK_EVAL_MAX_CONCURRENCY || env.OPENAI_SUPABASE_FEEDBACK_EVAL_MAX_CONCURRENCY || 6);
  }
  if (providerId === evalProviders.OPENAI) {
    return Number(env.OPENAI_SUPABASE_FEEDBACK_EVAL_MAX_CONCURRENCY || env.GPT_SUPABASE_FEEDBACK_EVAL_MAX_CONCURRENCY || 4);
  }
  return Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_MAX_CONCURRENCY || 5);
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function booleanFromEnv(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function wait(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Operation aborted."));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, Number(ms) || 0));
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(signal.reason || new Error("Operation aborted."));
    };

    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nowMs() {
  return Date.now();
}

function emptyTiming() {
  return {
    signed_url_ms: 0,
    recognition_preflight_ms: 0,
    provider_total_ms: 0,
    evidence_completion_ms: 0,
    retrieval_ms: 0,
    focused_reread_ms: 0,
    resolver_ms: 0,
    total_ms: 0
  };
}

function addTiming(timing, key, elapsedMs) {
  if (!timing || !key) return;
  const value = Number(elapsedMs);
  if (!Number.isFinite(value) || value < 0) return;
  timing[key] = Math.round(Number(timing[key] || 0) + value);
}

async function timeStage(timing, key, work) {
  const startedAt = nowMs();
  try {
    return await work();
  } finally {
    addTiming(timing, key, nowMs() - startedAt);
  }
}

function finalizeTiming(timing, startedAtMs) {
  return {
    ...emptyTiming(),
    ...(timing || {}),
    total_ms: Math.max(0, Math.round(nowMs() - startedAtMs))
  };
}

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesAny(value, terms = []) {
  const text = canonicalText(value);
  return terms.some((term) => text.includes(canonicalText(term)));
}

function hasResolvedValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function cascadeSecondaryVerifierEnv(env = process.env, verificationFields = []) {
  return {
    ...env,
    AGNES_TIMEOUT_MS: env.AGNES_SECONDARY_TIMEOUT_MS || env.AGNES_FOCUSED_TIMEOUT_MS || "12000",
    AGNES_MAX_RETRIES: env.AGNES_SECONDARY_MAX_RETRIES || "0",
    ENABLE_PARALLEL_FOCUSED_REREADS: "1",
    ENABLE_PARALLEL_AGNES_FOCUSED_REREADS: "1",
    CASCADE_SECONDARY_VERIFICATION_FIELDS: verificationFields.join(","),
    MAX_PARALLEL_FOCUSED_REREADS: env.CASCADE_MAX_PARALLEL_FOCUSED_REREADS || "2",
    MAX_AGNES_CALLS_PER_ASSET: env.CASCADE_MAX_AGNES_CALLS_PER_ASSET || "2",
    MAX_RESOLUTION_TIME_MS: env.CASCADE_MAX_RESOLUTION_TIME_MS || "16000"
  };
}

function cascadeSecondaryVerificationFields(resolved = {}, unresolved = [], reason = "") {
  const unresolvedText = [reason, ...(Array.isArray(unresolved) ? unresolved : [])].filter(Boolean).join(" ");
  const fields = new Set();

  if (resolved.multi_card || Number(resolved.card_count || 0) > 1) return [];

  if (hasResolvedValue(resolved.serial_number, "serial_number")
    || textIncludesAny(unresolvedText, ["serial", "serial number", "numbered", "denominator"])) {
    fields.add("serial_number");
  }

  if (hasResolvedValue(resolved.parallel, "parallel")
    || hasResolvedValue(resolved.parallel_exact, "parallel_exact")
    || hasResolvedValue(resolved.parallel_family, "parallel_family")
    || hasResolvedValue(resolved.surface_color, "surface_color")
    || hasResolvedValue(resolved.variation, "variation")
    || textIncludesAny(unresolvedText, ["parallel", "color", "wave", "shimmer", "mojo", "sapphire", "geometric", "refractor"])) {
    fields.add("parallel");
  }

  if (!hasResolvedValue(resolved.year, "year")
    || !hasResolvedValue(resolved.product, "product")
    || textIncludesAny(unresolvedText, ["year", "season", "copyright", "product"])) {
    fields.add("year_product");
  }

  if (textIncludesAny(unresolvedText, ["grade", "slab", "label"])) {
    fields.add("grade_label");
  }

  if (textIncludesAny(unresolvedText, ["collector number", "checklist", "card number", "code"])) {
    fields.add("card_code");
  }

  return [...fields];
}

function cascadeVerificationUnresolvedNotes(fields = []) {
  const notesByField = {
    serial_number: "serial number requires secondary verifier focused reread",
    parallel: "parallel color requires secondary verifier focused reread",
    year_product: "year product requires secondary verifier focused reread",
    grade_label: "grade label requires secondary verifier focused reread",
    card_code: "card number checklist code requires secondary verifier focused reread"
  };

  return fields.map((field) => notesByField[field]).filter(Boolean);
}

function words(value) {
  return canonicalText(value).split(" ").filter(Boolean);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedId(value) {
  return normalizeText(value).toLowerCase();
}

function sourceIdsForItem(item = {}) {
  return unique([
    item.source_feedback_id,
    item.id,
    item.feedback_id,
    candidateId(item)
  ].map(normalizedId));
}

function sourceIdsForApprovedRecord(record = {}) {
  return unique([
    record.id,
    record.source_feedback_id,
    record.sourceFeedbackId,
    record.asset_id
  ].map(normalizedId));
}

function createSelfExcludingApprovedMemoryRegistry({
  env = process.env,
  excludeIds = []
} = {}) {
  const excluded = new Set((excludeIds || []).map(normalizedId).filter(Boolean));
  if (!excluded.size || !listingApprovedMemoryEnabled(env) || !isSupabaseFeedbackConfigured(env)) return null;

  return createRetrievalProviderRegistry({
    env,
    approvedRecordsLoader: async () => {
      const records = await listApprovedHistoryRecords({
        env,
        limit: env.INTERNAL_APPROVED_HISTORY_LIMIT
      });
      return records.filter((record) => {
        return !sourceIdsForApprovedRecord(record).some((id) => excluded.has(id));
      });
    }
  });
}

function candidateId(item = {}) {
  return normalizeText(item.source_feedback_id || item.asset_id || item.physical_card_id || item.candidate_id);
}

function correctedTitle(item = {}) {
  return normalizeText(item.source_titles?.corrected_title || item.corrected_title || item.reference_title);
}

function generatedTitle(item = {}) {
  return normalizeText(item.source_titles?.generated_title || item.generated_title);
}

function itemTimeoutError(ms) {
  const error = new Error(`Eval item timed out after ${ms}ms.`);
  error.code = "item_timeout";
  return error;
}

function imageInputs(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.object_path && image?.bucket)
    .map((image) => ({
      image_id: image.image_id || image.id || null,
      role: image.role || image.capture_angle || "card_image",
      bucket: image.bucket,
      object_path: image.object_path
    }));
}

function titleTokens(title) {
  return unique(words(title).filter((token) => token.length > 1));
}

function tokenRate(matches, denominator) {
  if (!denominator) return null;
  return Number((matches / denominator).toFixed(6));
}

function overlap(leftValues = [], rightValues = []) {
  const right = new Set(rightValues);
  return leftValues.filter((value) => right.has(value));
}

function yearsFromTitle(title) {
  return unique((canonicalText(title).match(/\b\d{4}(?:\s\d{2})?\b/g) || []).map((value) => value.replace(/\s/g, "-")));
}

function yearParts(value) {
  const match = String(value || "").match(/\b(\d{4})(?:-(\d{2}))?\b/);
  if (!match) return [];
  const start = Number(match[1]);
  if (!match[2]) return [String(start)];
  const suffix = Number(match[2]);
  const century = Math.floor(start / 100) * 100;
  let end = century + suffix;
  if (end < start) end += 100;
  return [String(start), String(end)];
}

function yearOverlap(leftValues = [], rightValues = []) {
  return leftValues.filter((leftValue) => {
    const leftParts = yearParts(leftValue);
    return rightValues.some((rightValue) => {
      if (leftValue === rightValue) return true;
      const rightParts = yearParts(rightValue);
      return leftParts.some((part) => rightParts.includes(part));
    });
  });
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialMatchIsGradePair(source, index) {
  const before = String(source || "").slice(Math.max(0, index - 18), index).toUpperCase();
  return /\b(?:PSA|BGS|SGC|CGC)\b[^/]{0,12}$/.test(before);
}

function serialsFromTitle(title) {
  const source = String(title || "");
  return unique([...source.matchAll(/\b\d+\s*\/\s*\d+\b/g)]
    .filter((match) => !serialMatchIsGradePair(source, match.index || 0))
    .map((match) => normalizeSerial(match[0])));
}

function gradesFromTitle(title) {
  const source = canonicalText(title).toUpperCase();
  return unique((source.match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?\d+(?:\.\d+)?\b/g) || [])
    .map((value) => value.replace(/\s+/g, " ").trim()));
}

function colorsFromTitle(title) {
  const tokenSet = new Set(words(title));
  return [...colorTokens].filter((token) => tokenSet.has(token));
}

export function titleComparison(referenceTitle, predictedTitle) {
  const referenceCanonical = canonicalText(referenceTitle);
  const predictedCanonical = canonicalText(predictedTitle);
  const referenceTokens = titleTokens(referenceTitle);
  const predictedTokens = titleTokens(predictedTitle);
  const recallMatches = overlap(referenceTokens, predictedTokens).length;
  const precisionMatches = overlap(predictedTokens, referenceTokens).length;
  const referenceYears = yearsFromTitle(referenceTitle);
  const predictedYears = yearsFromTitle(predictedTitle);
  const referenceSerials = serialsFromTitle(referenceTitle);
  const predictedSerials = serialsFromTitle(predictedTitle);
  const referenceGrades = gradesFromTitle(referenceTitle);
  const predictedGrades = gradesFromTitle(predictedTitle);
  const referenceColors = colorsFromTitle(referenceTitle);
  const predictedColors = colorsFromTitle(predictedTitle);
  const unexpectedColors = predictedColors.filter((token) => !referenceColors.includes(token));
  const matchedYears = yearOverlap(referenceYears, predictedYears);
  const serialOverlap = overlap(referenceSerials, predictedSerials);
  const gradeOverlap = overlap(referenceGrades, predictedGrades);

  const wrongYear = referenceYears.length > 0 && predictedYears.length > 0 && matchedYears.length === 0;
  const wrongSerial = referenceSerials.length > 0 && predictedSerials.length > 0 && serialOverlap.length === 0;
  const wrongGrade = referenceGrades.length > 0 && predictedGrades.length > 0 && gradeOverlap.length === 0;
  const unexpectedColor = unexpectedColors.length > 0;

  return {
    corrected_title_exact: Boolean(referenceCanonical && predictedCanonical && referenceCanonical === predictedCanonical),
    token_recall: tokenRate(recallMatches, referenceTokens.length),
    token_precision: tokenRate(precisionMatches, predictedTokens.length),
    reference_token_count: referenceTokens.length,
    predicted_token_count: predictedTokens.length,
    reference_years: referenceYears,
    predicted_years: predictedYears,
    year_overlap: matchedYears,
    reference_serials: referenceSerials,
    predicted_serials: predictedSerials,
    serial_overlap: serialOverlap,
    reference_grades: referenceGrades,
    predicted_grades: predictedGrades,
    grade_overlap: gradeOverlap,
    reference_colors: referenceColors,
    predicted_colors: predictedColors,
    unexpected_color_tokens: unexpectedColors,
    wrong_year: wrongYear,
    wrong_serial: wrongSerial,
    wrong_grade: wrongGrade,
    unexpected_color: unexpectedColor,
    critical_title_error: wrongYear || wrongSerial || wrongGrade || unexpectedColor
  };
}

function fieldsFromParsed(parsed = {}) {
  const fields = parsed.fields || {};
  const players = Array.isArray(fields.players)
    ? fields.players.map(normalizeText).filter(Boolean)
    : [fields.players, fields.player, parsed.player].map(normalizeText).filter(Boolean);

  return {
    year: normalizeText(fields.year || fields.season),
    manufacturer: normalizeText(fields.manufacturer || fields.brand),
    brand: normalizeText(fields.brand || fields.manufacturer),
    product: normalizeText(fields.product || fields.set),
    set: normalizeText(fields.set || fields.product),
    subset: normalizeText(fields.subset),
    players,
    card_type: normalizeText(fields.card_type),
    insert: normalizeText(fields.insert),
    parallel: normalizeText(fields.parallel),
    variation: normalizeText(fields.variation),
    serial_number: normalizeText(fields.serial_number),
    collector_number: normalizeText(fields.collector_number || fields.card_number || fields.number),
    checklist_code: normalizeText(fields.checklist_code),
    grade_company: normalizeText(fields.grade_company || fields.grading_company),
    card_grade: normalizeText(fields.card_grade || fields.grade),
    auto_grade: normalizeText(fields.auto_grade),
    grade_type: normalizeText(fields.grade_type),
    rc: fields.rc === true || /\b(rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie)\b/i.test(normalizeText(fields.rc)),
    first_bowman: fields.first_bowman === true || /\b(?:1st|first)\s+bowman\b/i.test(normalizeText(fields.first_bowman)),
    ssp: fields.ssp === true || /\bssp|super short print\b/i.test(normalizeText(fields.ssp)),
    case_hit: fields.case_hit === true || /\bcase hit\b/i.test(normalizeText(fields.case_hit)),
    auto: fields.auto === true || /\b(auto|autograph|signed)\b/i.test(normalizeText(fields.auto)),
    patch: fields.patch === true || /\bpatch\b/i.test(normalizeText(fields.patch)),
    relic: fields.relic === true || /\b(relic|memorabilia|swatch)\b/i.test(normalizeText(fields.relic))
  };
}

function fieldsFromResolved(resolved = {}) {
  return {
    year: normalizeText(resolved.year),
    manufacturer: normalizeText(resolved.manufacturer || resolved.brand),
    brand: normalizeText(resolved.brand || resolved.manufacturer),
    product: normalizeText(resolved.product),
    set: normalizeText(resolved.set),
    subset: normalizeText(resolved.subset),
    players: Array.isArray(resolved.players) ? resolved.players.map(normalizeText).filter(Boolean) : [],
    card_type: normalizeText(resolved.card_type),
    insert: normalizeText(resolved.insert),
    parallel: normalizeText(resolved.parallel || resolved.variation),
    variation: normalizeText(resolved.variation),
    serial_number: normalizeText(resolved.serial_number),
    collector_number: normalizeText(resolved.collector_number),
    checklist_code: normalizeText(resolved.checklist_code),
    grade_company: normalizeText(resolved.grade_company),
    card_grade: normalizeText(resolved.card_grade),
    auto_grade: normalizeText(resolved.auto_grade),
    grade_type: normalizeText(resolved.grade_type),
    multi_card: resolved.multi_card === true,
    card_count: resolved.card_count ?? null,
    lot_type: normalizeText(resolved.lot_type),
    rc: resolved.rc === true,
    first_bowman: resolved.first_bowman === true,
    ssp: resolved.ssp === true,
    case_hit: resolved.case_hit === true,
    auto: resolved.auto === true,
    patch: resolved.patch === true,
    relic: resolved.relic === true
  };
}

function predictionFromResult(result = {}) {
  const parsed = result.parsed || {};
  return {
    title: normalizeText(parsed.final_title || parsed.title || parsed.rendered_title || parsed.model_title_suggestion),
    fields: fieldsFromParsed(parsed),
    confidence: normalizeText(parsed.confidence),
    reason: normalizeText(parsed.reason),
    unresolved: Array.isArray(parsed.unresolved) ? parsed.unresolved.map(normalizeText).filter(Boolean) : [],
    parse_source: normalizeText(result.parse_source),
    model_id: normalizeText(result.model_id),
    finish_reason: normalizeText(result.finish_reason)
  };
}

function providerFormatMetadata(result = {}, {
  fallbackProviderId = null,
  fallbackReason = null,
  formatErrorType = null
} = {}) {
  return {
    provider_result: {
      provider: result.provider || null,
      model_id: result.model_id || null,
      response_id: result.response_id || null,
      finish_reason: result.finish_reason || null,
      parse_source: result.parse_source || null,
      recognition_status: result.recognition_status || result.parsed?.recognition_status || null,
      format_error_type: formatErrorType || result.format_error_type || null,
      format_repair_attempted: result.format_repair_attempted === true,
      native_schema_valid: result.native_schema_valid === true,
      local_json_repair_success: result.local_json_repair_success === true,
      text_repair_success: result.text_repair_success === true,
      fallback_provider_id: fallbackProviderId || result.fallback_provider_id || null,
      fallback_reason: fallbackReason || result.fallback_reason || null
    }
  };
}

function predictionFromResolvedResult(result = {}) {
  return {
    title: normalizeText(result.final_title || result.title || result.rendered_title || result.model_title_suggestion),
    fields: fieldsFromResolved(result.resolved || {}),
    confidence: normalizeText(result.confidence),
    reason: normalizeText(result.reason),
    unresolved: Array.isArray(result.unresolved) ? result.unresolved.map(normalizeText).filter(Boolean) : [],
    parse_source: normalizeText(result.provider_parse_source),
    model_id: normalizeText(result.model_id),
    finish_reason: normalizeText(result.provider_finish_reason),
    title_render_source: normalizeText(result.title_render_source),
    identity_resolution_status: normalizeText(result.identity_resolution_status),
    route: normalizeText(result.route),
    publication_gate: result.publication_gate || null,
    writer_required_fields: Array.isArray(result.writer_required_fields) ? result.writer_required_fields : []
  };
}

function identityResolutionSummary(result = {}) {
  const identityResolution = result.identity_resolution || {};
  const candidateIdentityReport = result.candidate_identity_report
    || identityResolution.candidate_identity_report
    || result.card_identity_candidates
    || identityResolution.card_identity_candidates
    || null;
  return {
    status: result.identity_resolution_status || identityResolution.status || "",
    ambiguity_status: result.ambiguity_status || identityResolution.ambiguity_status || "",
    abstain_reason_codes: result.abstain_reason_codes || identityResolution.abstain_reason_codes || [],
    catalog_card_identity: result.catalog_card_identity || identityResolution.catalog_card_identity || {},
    physical_asset_identity: result.physical_asset_identity || identityResolution.physical_asset_identity || {},
    candidate_identity_report: candidateIdentityReport
      ? {
          selected_candidate_id: candidateIdentityReport.selected_candidate_id || null,
          metrics: candidateIdentityReport.metrics || {},
          candidate_count: Array.isArray(candidateIdentityReport.candidates) ? candidateIdentityReport.candidates.length : null
        }
      : null,
    confidence_report: result.confidence_report || identityResolution.confidence_report || null,
    convergence_report: result.convergence_report || identityResolution.convergence_report || null,
    fields: (result.field_states || identityResolution.field_states || []).map((fieldState) => ({
      field: fieldState.field,
      resolved_value: fieldState.resolved_value,
      resolution_reason: fieldState.resolution_reason,
      decision_route: fieldState.decision_route,
      resolution_confidence: fieldState.resolution_confidence,
      ambiguity: fieldState.ambiguity,
      conflicts: fieldState.conflicts,
      conflict_items: (fieldState.conflict_items || []).map((conflict) => ({
        field: conflict.field,
        conflict_type: conflict.conflict_type,
        severity: conflict.severity,
        resolved: conflict.resolved === true,
        resolution: conflict.resolution || null
      })),
      source_summary: fieldState.source_summary || []
    })),
    conflict_map: (result.conflict_map || identityResolution.conflict_map || []).map((conflict) => ({
      field: conflict.field,
      conflict_type: conflict.conflict_type,
      severity: conflict.severity,
      resolved: conflict.resolved === true,
      resolution: conflict.resolution || null
    }))
  };
}

function evaluationPrompt(item = {}) {
  return [
    "You are the first-pass card evidence reader for LYNCA Listing Copilot evaluation.",
    "Use only the supplied front/back card or slab images. Do not use outside knowledge, marketplace wording, memory, or corrected-title hints.",
    "Return compact valid JSON only. Deterministic code will render the English title.",
    JSON.stringify({
      title: "",
      confidence: "LOW",
      route: "FAST_PATH_CANDIDATE | NEEDS_REVIEW | MULTI_CARD",
      fields: {
        multi_card: false,
        card_count: null,
        lot_type: "empty unless multiple cards or a lot are visible",
        year: "visible year or season",
        manufacturer: "visible manufacturer or brand",
        product: "visible product or set family",
        set: "visible set name",
        players: ["visible player or subject names"],
        card_type: "base/insert/auto/relic/etc if visible",
        insert: "visible insert name",
        parallel: "printed parallel, slab/checklist-backed parallel, or high-confidence focused visual card-design color/parallel",
        serial_number: "visible serial such as 31/50",
        collector_number: "visible card number",
        checklist_code: "visible checklist code",
        grade_company: "PSA/BGS/SGC/CGC/etc if slabbed",
        card_grade: "visible card grade",
        auto_grade: "visible autograph grade",
        grade_type: "CARD_ONLY/AUTO_ONLY/CARD_AND_AUTO/UNKNOWN",
        rc: false,
        first_bowman: false,
        ssp: false,
        case_hit: false,
        auto: false,
        patch: false,
        relic: false
      },
      unresolved: []
    }),
    "Rules: leave unreadable fields empty; serial requires every digit readable; multi-card/lot must set multi_card true and never merge identities; visual-only weak color/parallel stays empty; never invent grade, serial, player, year, product, autograph, patch, color, or parallel.",
    `Audit feedback id: ${candidateId(item) || "unknown"}.`
  ].join("\n");
}

function focusedEvaluationPrompt({
  action,
  focusFields = [],
  resolved = {}
} = {}) {
  return [
    "You are performing a focused reread for LYNCA Listing Copilot commercial evaluation.",
    "Use only the supplied card image. Do not use outside knowledge, marketplace wording, memory, or the corrected title.",
    "If the image contains multiple cards or a card lot, set multi_card true, include card_count when visible, and do not merge fields from different cards.",
    "For serial_number, every digit must be readable; if any digit is uncertain, leave serial_number empty and explain that digit uncertainty in unresolved.",
    "For year, prefer the printed card year or season range such as 2003-04; use copyright year only when no card year or season is visible.",
    "For RC, return true when a readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker is visible.",
    "For parallel and variation, return a value when printed card text, slab label, card code/checklist clue, or a high-confidence intentional card-design color/pattern is visible.",
    "When returning a visual card-design color/parallel, use concise marketplace-safe wording such as Gold Refractor, Purple, Blue Prizm, Green Wave, Silver Prizm, or Red Ice. Do not use background, sleeve, glare, lighting, or generic foil shine.",
    "If color or foil is only a weak visual impression, leave parallel/variation empty and add 'visual-only parallel requires operator review' to unresolved.",
    "Set confidence HIGH when every returned focus field is clear and readable; set LOW only when all requested focus fields are empty or uncertain.",
    "In reason, cite the visible source for every returned focus field, for example front printed serial, back printed card code, slab label grade, or printed parallel.",
    `Action: ${action || "focused_reread"}.`,
    `Focus fields: ${focusFields.join(", ") || "unresolved critical fields"}.`,
    "Return only valid JSON in this exact shape:",
    JSON.stringify({
      title: "",
      confidence: "HIGH",
      reason: "short visible printed evidence note",
      fields: {
        multi_card: false,
        card_count: null,
        lot_type: null,
        ...Object.fromEntries(focusFields.map((field) => [field, ""]))
      },
      unresolved: []
    }),
    "If a focus field is unreadable, leave it empty and explain that field in unresolved.",
    "Current resolved context for disambiguation only:",
    JSON.stringify(resolved || {})
  ].join("\n");
}

function signedImagesForProvider(signedImages = []) {
  return signedImages.map((image) => ({
    name: image.name,
    url: image.url
  }));
}

async function providerImagesForEval(signedImages = [], {
  providerId = evalProviders.AGNES
} = {}) {
  return signedImagesForProvider(signedImages);
}

function evidenceDocumentFromProviderResult(providerResult = {}, {
  images = []
} = {}) {
  const parsed = providerResult.parsed || {};
  return providerPayloadToEvidenceDocument({
    ...parsed,
    title: parsed.title || parsed.model_title_suggestion || "",
    confidence: parsed.confidence || "MEDIUM",
    fields: parsed.fields || {},
    unresolved: Array.isArray(parsed.unresolved) ? parsed.unresolved : []
  }, {
    images
  });
}

function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function evidenceCandidateKey(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item).toLowerCase()).filter(Boolean).sort().join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return normalizeText(value).toLowerCase();
}

function evidenceFieldCandidatesWithSources(field = {}) {
  const fieldSources = Array.isArray(field.sources) ? field.sources : [];
  if (Array.isArray(field.candidates) && field.candidates.length) {
    return field.candidates
      .filter((candidate) => hasEvidenceValue(candidate?.value))
      .map((candidate) => ({
        value: candidate.value,
        confidence: Number(candidate.confidence ?? field.confidence ?? 0.5),
        sources: Array.isArray(candidate.sources) && candidate.sources.length ? candidate.sources : fieldSources
      }));
  }

  return hasEvidenceValue(field.value)
    ? [{
        value: field.value,
        confidence: Number(field.confidence || 0.5),
        sources: fieldSources
      }]
    : [];
}

function mergeEvidenceField(fieldName, fields = []) {
  const candidateMap = new Map();
  const conflicts = [];

  fields.forEach((field) => {
    conflicts.push(...(Array.isArray(field?.conflicts) ? field.conflicts : []));
    evidenceFieldCandidatesWithSources(field).forEach((candidate) => {
      const key = evidenceCandidateKey(candidate.value);
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, {
          value: candidate.value,
          confidence: candidate.confidence,
          sources: [...candidate.sources]
        });
        return;
      }

      existing.confidence = Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0));
      existing.sources.push(...candidate.sources);
    });
  });

  const candidates = [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      sources: candidate.sources.filter(Boolean)
    }))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0));
  const top = candidates[0] || null;
  const distinctValueCount = new Set(candidates.map((candidate) => evidenceCandidateKey(candidate.value))).size;
  const mergedConflicts = [
    ...conflicts,
    ...(distinctValueCount > 1 ? [{
      field: fieldName,
      conflict_type: "MULTI_SOURCE_VALUE_CONFLICT",
      conflicting_values: candidates.map((candidate) => candidate.value),
      severity: "MEDIUM",
      reason: "Recognition worker and Agnes evidence produced competing values for this field."
    }] : [])
  ];

  return createEvidenceField({
    value: top?.value ?? null,
    normalizedValue: top?.value ?? null,
    status: mergedConflicts.length ? "CONFLICT" : Number(top?.confidence || 0) >= 0.86 ? "CONFIRMED" : "REVIEW",
    confidence: Number(top?.confidence || 0),
    candidates,
    sources: candidates.flatMap((candidate) => candidate.sources || []),
    conflicts: mergedConflicts
  });
}

function mergeEvidenceMaps(...maps) {
  const fieldNames = new Set();
  maps.forEach((map) => {
    Object.keys(map || {}).forEach((field) => fieldNames.add(field));
  });

  const evidence = {};
  fieldNames.forEach((field) => {
    const fields = maps.map((map) => map?.[field]).filter(Boolean);
    evidence[field] = fields.length === 1 ? fields[0] : mergeEvidenceField(field, fields);
  });
  return evidence;
}

function mergeResolvedFields(...resolvedDocuments) {
  const merged = {};
  resolvedDocuments.forEach((resolved) => {
    Object.entries(resolved || {}).forEach(([field, value]) => {
      if (!hasEvidenceValue(value)) return;
      merged[field] = value;
    });
  });
  return merged;
}

function mergeEvidenceDocuments(...documents) {
  const usableDocuments = documents.filter((document) => document && typeof document === "object");
  if (!usableDocuments.length) {
    return { evidence: {}, resolved: {}, unresolved: [], resolution_trace: [] };
  }

  return {
    evidence: mergeEvidenceMaps(...usableDocuments.map((document) => document.evidence || {})),
    resolved: mergeResolvedFields(...usableDocuments.map((document) => document.resolved || {})),
    unresolved: usableDocuments.flatMap((document) => Array.isArray(document.unresolved) ? document.unresolved : []).slice(0, 16),
    resolution_trace: usableDocuments.flatMap((document) => Array.isArray(document.resolution_trace) ? document.resolution_trace : []),
    schema_version: usableDocuments.map((document) => document.schema_version).filter(Boolean).join("+") || "merged-evidence-document"
  };
}

async function recognitionPreflightForItem(item, {
  signedImages = [],
  env = process.env,
  analyzeRecognitionImpl = analyzeCardImagesWithRecognitionWorker,
  maxTitleLength = 80
} = {}) {
  try {
    const response = await analyzeRecognitionImpl({
      assetId: item.asset_id || candidateId(item) || "supabase_feedback_item",
      captureProfileId: item.capture_profile_id || "supabase_feedback_eval",
      images: signedImages,
      requestedFields: [...recognitionRequestedFields],
      options: {
        run_ocr: true,
        run_visual_embeddings: false,
        run_candidate_verification: false
      },
      env
    });
    const evidenceDocument = recognitionResponseToEvidenceDocument(response, {
      images: signedImages
    });

    if (!hasRecognitionEvidence(evidenceDocument)) {
      return {
        status: response?.unavailable ? "unavailable" : "no_evidence",
        evidenceDocument,
        response,
        result: null,
        usage: {
          recognition_worker_calls: response?.unavailable ? 0 : 1,
          latency_ms: Number(response?.processing?.latency_ms || 0)
        }
      };
    }

    const gated = applyIdentityResolutionGate({
      title: "",
      final_title: "",
      rendered_title: "",
      model_title_suggestion: "",
      title_render_source: "recognition_worker_identity_preflight",
      confidence: "LOW",
      reason: "Recognition worker produced grounded OCR evidence before Agnes.",
      provider: "recognition_worker",
      source: "recognition_worker",
      resolved: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      unresolved: evidenceDocument.unresolved || [],
      resolution_trace: evidenceDocument.resolution_trace || [],
      usage: {
        provider_calls: 0,
        retrieval_calls: 0,
        recognition_worker_calls: response?.unavailable ? 0 : 1,
        latency_ms: Number(response?.processing?.latency_ms || 0),
        estimated_cost_usd: 0,
        resolution_rounds: 0
      }
    }, {
      maxLength: maxTitleLength,
      providerId: "recognition_worker"
    });

    return {
      status: gated.identity_resolution_status === "ABSTAIN" ? "abstain" : "resolved",
      evidenceDocument,
      response,
      result: gated.identity_resolution_status === "ABSTAIN" ? null : gated,
      gated,
      usage: gated.usage
    };
  } catch (error) {
    return {
      status: "error",
      evidenceDocument: null,
      response: null,
      result: null,
      error: safeRecognitionError(error),
      usage: {
        recognition_worker_calls: 1,
        latency_ms: 0
      }
    };
  }
}

function createFocusedEvaluationRunner({
  signedImages = [],
  analyzeImpl,
  env,
  providerId = evalProviders.AGNES,
  signal = null,
  timing = null
} = {}) {
  return async ({ action, focusFields = [], resolved = {} } = {}) => {
    const providerImages = await providerImagesForEval(signedImages, {
      providerId,
      env
    });
    const providerResult = await timeStage(timing, "focused_reread_ms", () => analyzeImpl({
      images: providerImages,
      prompt: focusedEvaluationPrompt({ action, focusFields, resolved }),
      env,
      signal
    }));
    const evidenceDocument = evidenceDocumentFromProviderResult(providerResult, {
      images: signedImages
    });

    return {
      provider_id: providerId,
      model_id: providerResult.model_id || "",
      response_id: providerResult.response_id || null,
      finish_reason: providerResult.finish_reason || null,
      parse_source: providerResult.parse_source || null,
      usage: providerResult.usage || null,
      evidence_document: evidenceDocument,
      resolved: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      unresolved: evidenceDocument.unresolved || []
    };
  };
}

function mergeEvalUsage(...usages) {
  return usages.reduce((acc, usage) => {
    const raw = usage && typeof usage === "object" ? usage : {};
    acc.provider_calls += Number(raw.provider_calls || 0);
    acc.estimated_cost_usd += Number(raw.estimated_cost_usd || 0);
    acc.image_count += Number(raw.image_count || 0);
    acc.latency_ms += Number(raw.latency_ms || 0);
    acc.retrieval_calls += Number(raw.retrieval_calls || 0);
    acc.resolution_rounds += Number(raw.resolution_rounds || 0);
    acc.recognition_worker_calls += Number(raw.recognition_worker_calls || 0);
    return acc;
  }, {
    provider_calls: 0,
    estimated_cost_usd: 0,
    image_count: 0,
    latency_ms: 0,
    retrieval_calls: 0,
    resolution_rounds: 0,
    recognition_worker_calls: 0
  });
}

function conflictSeverity(conflict = {}) {
  return String(conflict.severity || "").trim().toUpperCase();
}

function hasBlockingIdentityConflict(result = {}) {
  const conflicts = [
    ...(Array.isArray(result.conflict_map) ? result.conflict_map : []),
    ...(Array.isArray(result.identity_resolution?.conflict_map) ? result.identity_resolution.conflict_map : [])
  ];
  return conflicts.some((conflict) => {
    if (conflict.resolved === true) return false;
    return ["MEDIUM", "HIGH", "CRITICAL"].includes(conflictSeverity(conflict));
  });
}

function fastPathEligible(result = {}) {
  const fastVisionResolved = result.fast_vision_policy?.role === "PRIMARY_FAST_VISION"
    && result.fast_vision_policy?.allow_single_source_publish === true
    && result.identity_resolution_status === "RESOLVED";
  return (result.identity_resolution_status === "CONFIRMED" || fastVisionResolved)
    && Boolean(result.final_title || result.title)
    && !hasBlockingIdentityConflict(result);
}

function providerSignalFastPathEligible(parsed = {}, evidenceDocument = {}) {
  const confidence = normalizeText(parsed.confidence).toUpperCase();
  if (confidence !== "HIGH") return false;

  const unresolvedText = canonicalText([
    parsed.reason,
    ...(Array.isArray(parsed.unresolved) ? parsed.unresolved : []),
    ...(Array.isArray(evidenceDocument.unresolved) ? evidenceDocument.unresolved : [])
  ].join(" "));
  return ![
    "operator review",
    "requires review",
    "manual review",
    "needs review",
    "uncertain",
    "ambiguous",
    "unreadable",
    "not confirmed"
  ].some((term) => unresolvedText.includes(term));
}

async function resolvedPredictionFromProviderResult(providerResult = {}, {
  signedImages = [],
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  analyzeFocusedImpl = null,
  providerId = evalProviders.AGNES,
  identityProviderId = providerId,
  focusedAnalyzeImpl = analyzeImpl,
  focusedProviderId = providerId,
  fastVisionPolicy = null,
  signal = null,
  maxTitleLength = 80,
  excludeApprovedMemoryIds = [],
  recognitionEvidenceDocument = null,
  singleModelFastPath = false,
  timing = null
} = {}) {
  const providerEvidenceDocument = evidenceDocumentFromProviderResult(providerResult, {
    images: signedImages
  });
  const evidenceDocument = hasRecognitionEvidence(recognitionEvidenceDocument)
    ? mergeEvidenceDocuments(recognitionEvidenceDocument, providerEvidenceDocument)
    : providerEvidenceDocument;
  const secondaryFields = fastVisionPolicy?.role === "PRIMARY_FAST_VISION" && fastVisionPolicy.secondary_verification_enabled === true
    ? cascadeSecondaryVerificationFields(evidenceDocument.resolved, [
        ...(Array.isArray(providerResult.parsed?.unresolved) ? providerResult.parsed.unresolved : []),
        ...(Array.isArray(evidenceDocument.unresolved) ? evidenceDocument.unresolved : [])
      ], providerResult.parsed?.reason || "")
    : [];
  const unresolved = [
    ...(Array.isArray(providerResult.parsed?.unresolved) ? providerResult.parsed.unresolved : []),
    ...(Array.isArray(evidenceDocument.unresolved) ? evidenceDocument.unresolved : []),
    ...cascadeVerificationUnresolvedNotes(secondaryFields)
  ];
  const effectiveFastVisionPolicy = fastVisionPolicy
    ? {
        ...fastVisionPolicy,
        secondary_verification_required_fields: secondaryFields
      }
    : null;
  const fastPathCandidate = await timeStage(timing, "resolver_ms", () => applyIdentityResolutionGate({
    title: providerResult.parsed?.title || "",
    model_title_suggestion: providerResult.parsed?.title || "",
    confidence: providerResult.parsed?.confidence || "",
    provider: providerId,
    source: identityProviderId,
    fast_vision_policy: effectiveFastVisionPolicy,
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    unresolved,
    resolution_trace: evidenceDocument.resolution_trace || [],
    usage: providerResult.usage
  }, {
    maxLength: maxTitleLength,
    providerId: identityProviderId
  }));
  if (providerSignalFastPathEligible(providerResult.parsed, evidenceDocument) && fastPathEligible(fastPathCandidate)) {
    return {
      result: {
        ...fastPathCandidate,
        route: "FAST_PATH_PROVIDER_CONFIRMED",
        route_reason: "Initial provider evidence resolved the required card identity fields without blocking conflicts.",
        retrieval: {
          skipped: true,
          reason: "fast_path_provider_confirmed"
        },
        completion_trace: Array.isArray(fastPathCandidate.completion_trace)
          ? fastPathCandidate.completion_trace
          : Array.isArray(fastPathCandidate.resolution_trace)
            ? fastPathCandidate.resolution_trace
            : [],
        fast_path: {
          enabled: true,
          used: true,
          skipped_evidence_completion: true,
          skipped_focused_reread: true,
          skipped_retrieval: true
        }
      },
      completion: {
        resolved: evidenceDocument.resolved,
        evidence: evidenceDocument.evidence,
        unresolved: evidenceDocument.unresolved || [],
        resolution_trace: evidenceDocument.resolution_trace || [],
        usage: {
          provider_calls: 0,
          retrieval_calls: 0,
          recognition_worker_calls: 0,
          latency_ms: 0,
          estimated_cost_usd: 0,
          resolution_rounds: 0
        }
      },
      usage: providerResult.usage
    };
  }
  if (singleModelFastPath) {
    return {
      result: {
        ...fastPathCandidate,
        route: "SINGLE_MODEL_GATE",
        route_reason: "Single-model evaluation path skipped evidence completion, retrieval, and focused reread.",
        retrieval: {
          skipped: true,
          reason: "single_model_fast_path"
        },
        completion_trace: Array.isArray(fastPathCandidate.completion_trace)
          ? fastPathCandidate.completion_trace
          : Array.isArray(fastPathCandidate.resolution_trace)
            ? fastPathCandidate.resolution_trace
            : [],
        fast_path: {
          enabled: true,
          used: true,
          single_model_only: true,
          skipped_evidence_completion: true,
          skipped_focused_reread: true,
          skipped_retrieval: true
        }
      },
      completion: {
        resolved: evidenceDocument.resolved,
        evidence: evidenceDocument.evidence,
        unresolved: evidenceDocument.unresolved || [],
        resolution_trace: evidenceDocument.resolution_trace || [],
        usage: {
          provider_calls: 0,
          retrieval_calls: 0,
          recognition_worker_calls: 0,
          latency_ms: 0,
          estimated_cost_usd: 0,
          resolution_rounds: 0
        }
      },
      usage: providerResult.usage
    };
  }
  const providerRegistry = createSelfExcludingApprovedMemoryRegistry({
    env,
    excludeIds: excludeApprovedMemoryIds
  });
  const retrievalMode = env.RETRIEVAL_MODE;
  const completionEnv = fastVisionPolicy?.role === "PRIMARY_FAST_VISION" ? cascadeSecondaryVerifierEnv(env, secondaryFields) : env;
  const completion = await timeStage(timing, "evidence_completion_ms", () => completeEvidence({
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    unresolved,
    env: completionEnv,
    providerRegistry,
    retrievalMode,
    runFocusedVisionImpl: createFocusedEvaluationRunner({
      signedImages,
      analyzeImpl: focusedAnalyzeImpl,
      env: completionEnv,
      providerId: focusedProviderId,
      signal,
      timing
    })
  }));
  addTiming(timing, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const gated = await timeStage(timing, "resolver_ms", () => applyIdentityResolutionGateWithConvergence({
    title: providerResult.parsed?.title || "",
    model_title_suggestion: providerResult.parsed?.title || "",
    confidence: providerResult.parsed?.confidence || "",
    reason: providerResult.parsed?.reason || "",
    provider: providerId,
    source: identityProviderId,
    fast_vision_policy: effectiveFastVisionPolicy,
    resolved: completion.resolved,
    evidence: completion.evidence,
    unresolved,
    convergence_report: completion.convergence_report,
    resolution_trace: [
      ...(Array.isArray(evidenceDocument.resolution_trace) ? evidenceDocument.resolution_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    usage: mergeEvalUsage(providerResult.usage, completion.usage)
  }, {
    maxLength: maxTitleLength,
    providerId: identityProviderId,
    retrievalCandidates: completion.retrieval?.selected_candidate ? [completion.retrieval.selected_candidate] : [],
    retrieveEvidence: createIdentityConvergenceRetriever({
      env,
      retrievalMode,
      providerRegistry
    }),
    convergenceOptions: {
      maxIterations: 1
    }
  }));

  return {
    result: gated,
    completion,
    usage: mergeEvalUsage(providerResult.usage, completion.usage)
  };
}

async function signedAgnesImagesForItem(item, {
  env = process.env,
  createSignedReadUrlImpl = createListingImageSignedReadUrl
} = {}) {
  const images = imageInputs(item);
  const signed = [];

  for (const image of images) {
    const url = await createSignedReadUrlImpl({
      objectPath: image.object_path,
      bucket: image.bucket,
      env
    });
    signed.push({
      image_id: image.image_id || null,
      id: image.image_id || null,
      name: `${image.role || "card_image"}:${candidateId(item) || image.object_path}`,
      url,
      role: image.role,
      bucket: image.bucket,
      object_path: image.object_path
    });
  }

  return signed;
}

function baseFeedbackResult(item, {
  providerId = evalProviders.AGNES,
  identityResolution = false,
  excludeSelfApprovedMemory = true
} = {}) {
  return {
    candidate_id: candidateId(item),
    provider: providerId,
    provider_display_name: providerDisplayName(providerId),
    asset_id: item.asset_id || null,
    source_feedback_id: item.source_feedback_id || null,
    category: item.category || null,
    review_status: item.review_status || null,
    corrected_title_reference: correctedTitle(item),
    generated_title_reference: generatedTitle(item),
    corrected_title_reference_only: true,
    field_ground_truth_available: false,
    internal_memory_self_excluded: identityResolution && excludeSelfApprovedMemory,
    image_inputs: imageInputs(item).map((image) => ({
      role: image.role,
      bucket: image.bucket,
      object_path: image.object_path,
      persisted_url_safe: false
    }))
  };
}

function isItemTimeoutSignal(signal) {
  return signal?.aborted && signal.reason?.code === "item_timeout";
}

function providerErrorResultForItem(item, options = {}, error = {}) {
  const base = baseFeedbackResult(item, options);
  const timedOut = isItemTimeoutSignal(options.signal);
  const formatErrorType = error?.details?.format_error_type || error?.format_error_type || null;
  return {
    ...base,
    status: "provider_error",
    error_code: timedOut ? "item_timeout" : error.code || "error",
    error: timedOut ? options.signal.reason.message : safeProviderErrorMessage(error),
    format_error_type: formatErrorType,
    provider_result: {
      provider: error?.provider || error?.details?.provider || options.providerId || null,
      model_id: error?.details?.model_id || null,
      response_id: null,
      finish_reason: null,
      parse_source: null,
      recognition_status: null,
      format_error_type: formatErrorType,
      format_repair_attempted: error?.details?.format_repair_attempted === true,
      native_schema_valid: false,
      local_json_repair_success: error?.details?.local_json_repair_success === true,
      text_repair_success: error?.details?.text_repair_success === true,
      fallback_provider_id: null,
      fallback_reason: null
    },
    timing: options.timing || null
  };
}

async function evaluateOneFeedbackItem(item, {
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  analyzeFocusedImpl = null,
  providerId = evalProviders.AGNES,
  analyzeRecognitionImpl = analyzeCardImagesWithRecognitionWorker,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  identityResolution = false,
  maxTitleLength = 80,
  excludeSelfApprovedMemory = true,
  recognitionPreflight = false,
  singleModelFastPath = false,
  signal = null
} = {}) {
  const itemStartedAtMs = nowMs();
  const timing = emptyTiming();
  const id = candidateId(item);
  const referenceTitle = correctedTitle(item);
  const base = baseFeedbackResult(item, {
    providerId,
    identityResolution,
    excludeSelfApprovedMemory
  });

  if (!id || !referenceTitle || base.image_inputs.length < 1) {
    return {
      ...base,
      status: "invalid_candidate",
      error: "Candidate is missing id, corrected title reference, or storage image inputs.",
      timing: finalizeTiming(timing, itemStartedAtMs)
    };
  }

  try {
    const signedImages = await timeStage(timing, "signed_url_ms", () => signedAgnesImagesForItem(item, {
      env,
      createSignedReadUrlImpl
    }));
    const recognition = identityResolution && recognitionPreflight
      ? await timeStage(timing, "recognition_preflight_ms", () => recognitionPreflightForItem(item, {
        signedImages,
        env,
        analyzeRecognitionImpl,
        maxTitleLength
      }))
      : null;

    if (recognition?.result) {
      const prediction = predictionFromResolvedResult(recognition.result);
      const comparison = titleComparison(referenceTitle, prediction.title);

      return {
        ...base,
        status: "evaluated",
        prediction,
        corrected_title_comparison: comparison,
        identity_resolution_enabled: identityResolution,
        identity_resolution_status: recognition.result.identity_resolution_status || null,
        publication_gate: recognition.result.publication_gate || null,
        identity_resolution_summary: identityResolutionSummary(recognition.result),
        route: recognition.result.route || null,
        completion_trace: recognition.result.completion_trace || recognition.result.resolution_trace || [],
        recognition_preflight_enabled: true,
        recognition_preflight_status: recognition.status,
        recognition_preflight_identity_status: recognition.gated?.identity_resolution_status || recognition.result.identity_resolution_status || null,
        recognition_preflight_error: null,
        usage: mergeEvalUsage(recognition.usage),
        timing: finalizeTiming(timing, itemStartedAtMs)
      };
    }

    const providerImages = await providerImagesForEval(signedImages, {
      providerId,
      env
    });
    const prompt = evaluationPrompt(item);
    let providerMetaOptions = {};
    let result;
    result = await timeStage(timing, "provider_total_ms", () => analyzeImpl({
      images: providerImages,
      prompt,
      env,
      signal
    }));
    const initialFields = fieldsFromParsed(result.parsed || {});
    const resolved = identityResolution
      ? await resolvedPredictionFromProviderResult(result, {
        signedImages,
        env,
        analyzeImpl,
        providerId,
        identityProviderId: identityProviderIdForProvider(providerId),
        focusedAnalyzeImpl: analyzeFocusedImpl
          || (providerId === evalProviders.CASCADE_FAST
            ? focusedAnalyzeImplForProvider(providerId)
            : analyzeImpl),
        focusedProviderId: focusedProviderIdForProvider(providerId),
        fastVisionPolicy: fastVisionPolicyForProvider(providerId, env),
        signal,
        maxTitleLength,
        excludeApprovedMemoryIds: excludeSelfApprovedMemory ? sourceIdsForItem(item) : [],
        recognitionEvidenceDocument: recognition?.evidenceDocument || null,
        singleModelFastPath,
        timing
      })
      : null;
    const prediction = resolved ? predictionFromResolvedResult(resolved.result) : predictionFromResult(result);
    const comparison = titleComparison(referenceTitle, prediction.title);
    const secondaryEvents = resolved ? secondaryVerificationEvents({
      trace: resolved?.completion?.resolution_trace || [],
      initialFields,
      finalFields: prediction.fields || {},
      referenceTitle
    }) : [];

    return {
      ...base,
      status: "evaluated",
      prediction,
      corrected_title_comparison: comparison,
      identity_resolution_enabled: identityResolution,
      identity_resolution_status: resolved?.result?.identity_resolution_status || null,
      publication_gate: resolved?.result?.publication_gate || null,
      identity_resolution_summary: resolved ? identityResolutionSummary(resolved.result) : null,
      route: resolved?.result?.route || null,
      completion_trace: resolved?.completion?.resolution_trace || [],
      recognition_preflight_enabled: identityResolution && recognitionPreflight,
      recognition_preflight_status: recognition?.status || null,
      recognition_preflight_identity_status: recognition?.gated?.identity_resolution_status || null,
      recognition_preflight_error: recognition?.error || null,
      secondary_verification_events: secondaryEvents,
      ...providerFormatMetadata(result, providerMetaOptions),
      usage: mergeEvalUsage(resolved?.usage || result.usage, recognition?.usage),
      timing: finalizeTiming(timing, itemStartedAtMs)
    };
  } catch (error) {
    return providerErrorResultForItem(item, {
      providerId,
      identityResolution,
      excludeSelfApprovedMemory,
      signal,
      timing: finalizeTiming(timing, itemStartedAtMs)
    }, error);
  }
}

function isRateLimitProviderResult(result = {}) {
  return result?.status === "provider_error"
    && (
      result.error_code === "rate_limited"
      || /\b429\b|rate limit|free users|token plan/i.test(String(result.error || ""))
    );
}

function isTransientProviderResult(result = {}) {
  if (isRateLimitProviderResult(result)) return true;
  if (result?.status !== "provider_error") return false;
  const text = `${result.error_code || ""} ${result.error || ""}`.toLowerCase();
  return /\btimeout|timed out|network|econnreset|socket|5\d\d|temporarily unavailable|overloaded\b/.test(text);
}

async function evaluateOneFeedbackItemWithRateLimitRetry(item, {
  rateLimitRetries = 0,
  rateLimitPauseMs = 60000,
  onRateLimit = null,
  ...options
} = {}) {
  try {
    let attempt = 0;
    let result = await evaluateOneFeedbackItem(item, options);

    while (isTransientProviderResult(result) && attempt < rateLimitRetries) {
      attempt += 1;
      if (typeof onRateLimit === "function") {
        await onRateLimit({ item, attempt, result, pauseMs: rateLimitPauseMs });
      }
      await wait(rateLimitPauseMs, options.signal);
      result = await evaluateOneFeedbackItem(item, options);
    }

    if (attempt > 0) {
      return {
        ...result,
        rate_limit_retry_attempts: attempt,
        rate_limit_retry_exhausted: isRateLimitProviderResult(result)
          && attempt >= rateLimitRetries,
        transient_provider_retry_attempts: attempt,
        transient_provider_retry_exhausted: isTransientProviderResult(result)
          && attempt >= rateLimitRetries
      };
    }

    return result;
  } catch (error) {
    if (isItemTimeoutSignal(options.signal)) {
      return providerErrorResultForItem(item, options, error);
    }
    throw error;
  }
}

async function evaluateOneFeedbackItemWithOptionalTimeout(item, {
  itemTimeoutMs = 0,
  ...options
} = {}) {
  const timeoutMs = Math.max(0, Number(itemTimeoutMs) || 0);
  if (!timeoutMs) return evaluateOneFeedbackItemWithRateLimitRetry(item, options);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(itemTimeoutError(timeoutMs)), timeoutMs);
  try {
    return await evaluateOneFeedbackItemWithRateLimitRetry(item, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function average(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function perMinute(count, elapsedMs) {
  const value = Number(count);
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(value) || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  return Number((value / (elapsed / 60000)).toFixed(6));
}

function countBy(values = []) {
  return values.reduce((counts, value) => {
    if (!value) return counts;
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function isIdentityAbstain(item = {}) {
  return item.identity_resolution_status === "ABSTAIN"
    || item.prediction?.identity_resolution_status === "ABSTAIN";
}

function gateHasWorkflowSignal(gate = {}) {
  return Boolean(gate.status || gate.workflow_route || typeof gate.writer_review_ready === "boolean");
}

function gateAcceptsForWriter(item = {}) {
  if (item.status !== "evaluated") return false;
  const gate = publicationGate(item);
  if (!gateHasWorkflowSignal(gate)) return !isIdentityAbstain(item);
  const route = gate.workflow_route || gate.status;
  return gate.writer_review_ready === true
    || gate.writer_quick_approval_ready === true
    || [
      "LOW_TOUCH_REVIEW",
      "STANDARD_REVIEW",
      "DEEP_REVIEW",
      "WRITER_QUICK_APPROVAL_READY",
      "WRITER_REVIEW_READY"
    ].includes(route);
}

function isAllInCommercialSuccess(item = {}) {
  return item.status === "evaluated"
    && gateAcceptsForWriter(item)
    && item.corrected_title_comparison?.critical_title_error !== true;
}

function sumUsage(results = []) {
  return results.reduce((usage, item) => {
    const raw = item.usage || {};
    usage.provider_calls += Number(raw.provider_calls || 0);
    usage.estimated_cost_usd += Number(raw.estimated_cost_usd || 0);
    usage.image_count += Number(raw.image_count || 0);
    usage.latency_ms += Number(raw.latency_ms || 0);
    usage.recognition_worker_calls += Number(raw.recognition_worker_calls || 0);
    return usage;
  }, {
    provider_calls: 0,
    estimated_cost_usd: 0,
    image_count: 0,
    latency_ms: 0,
    recognition_worker_calls: 0
  });
}

function completionTrace(item = {}) {
  return Array.isArray(item.completion_trace) ? item.completion_trace : [];
}

const focusedFieldGroupsByAction = Object.freeze({
  CROP_AND_READ_SERIAL: {
    group: "serial_number",
    fields: ["serial_number"]
  },
  CROP_AND_READ_PARALLEL: {
    group: "parallel",
    fields: ["surface_color", "parallel_family", "parallel_exact", "parallel", "variation"]
  },
  CROP_AND_READ_YEAR_PRODUCT: {
    group: "year_product",
    fields: ["year", "manufacturer", "brand", "product", "set", "subset"]
  },
  CROP_AND_READ_GRADE_LABEL: {
    group: "grade_label",
    fields: ["grade_company", "card_grade", "auto_grade", "grade_type"]
  },
  CROP_AND_READ_CARD_CODE: {
    group: "card_code",
    fields: ["collector_number", "checklist_code"]
  },
  CROP_AND_READ_SUBJECT: {
    group: "subject",
    fields: ["players", "character", "rc", "first_bowman"]
  }
});

function normalizedEventValue(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  if (typeof value === "boolean") return value;
  return normalizeText(value);
}

function pickCandidateFields(fields = {}, names = []) {
  const picked = {};
  names.forEach((name) => {
    const value = normalizedEventValue(fields[name]);
    if (Array.isArray(value) ? value.length > 0 : value !== "" && value !== false && value !== null && value !== undefined) {
      picked[name] = value;
    }
  });
  return picked;
}

function candidateChanged(left = {}, right = {}) {
  return JSON.stringify(left || {}) !== JSON.stringify(right || {});
}

function valueTextMatchesTitle(value, referenceTitle) {
  const candidate = canonicalText(Array.isArray(value) ? value.join(" ") : value);
  const reference = canonicalText(referenceTitle);
  if (!candidate || !reference) return null;
  const candidateTokens = titleTokens(candidate);
  if (!candidateTokens.length) return null;
  return candidateTokens.every((token) => reference.includes(token));
}

function candidateMatchesReference(group, candidate = {}, referenceTitle = "") {
  const hasCandidate = Object.keys(candidate || {}).length > 0;
  if (!hasCandidate) return null;

  if (group === "serial_number") {
    const value = normalizeSerial(candidate.serial_number);
    const referenceSerials = serialsFromTitle(referenceTitle);
    if (!value || !referenceSerials.length) return null;
    return referenceSerials.includes(value);
  }

  if (group === "year_product") {
    const checks = [];
    if (candidate.year) {
      const referenceYears = yearsFromTitle(referenceTitle);
      checks.push(referenceYears.length ? yearOverlap([candidate.year], referenceYears).length > 0 : null);
    }
    ["manufacturer", "brand", "product", "set", "subset"].forEach((field) => {
      if (candidate[field]) checks.push(valueTextMatchesTitle(candidate[field], referenceTitle));
    });
    const concrete = checks.filter((value) => value !== null);
    return concrete.length ? concrete.every(Boolean) : null;
  }

  if (group === "grade_label") {
    const referenceGrades = gradesFromTitle(referenceTitle);
    const gradeText = canonicalText([candidate.grade_company, candidate.card_grade, candidate.auto_grade].filter(Boolean).join(" ")).toUpperCase();
    if (!gradeText || !referenceGrades.length) return null;
    return referenceGrades.some((reference) => reference.includes(gradeText) || gradeText.includes(reference));
  }

  if (group === "parallel") {
    const parallelText = [
      candidate.surface_color,
      candidate.parallel_family,
      candidate.parallel_exact,
      candidate.parallel,
      candidate.variation
    ].filter(Boolean).join(" ");
    return valueTextMatchesTitle(parallelText, referenceTitle);
  }

  if (group === "card_code") {
    return valueTextMatchesTitle([candidate.collector_number, candidate.checklist_code].filter(Boolean).join(" "), referenceTitle);
  }

  if (group === "subject") {
    return valueTextMatchesTitle([...(candidate.players || []), candidate.character].filter(Boolean).join(" "), referenceTitle);
  }

  return null;
}

function focusedEventFromTrace(entry = {}, {
  initialFields = {},
  finalFields = {},
  referenceTitle = ""
} = {}) {
  const action = entry.action || "";
  const groupConfig = focusedFieldGroupsByAction[action];
  const focused = entry.output?.focused_vision || {};
  const group = groupConfig?.group || (Array.isArray(focused.focus_fields) ? focused.focus_fields.join(",") : action);
  const fields = groupConfig?.fields || focused.focus_fields || [];
  const gptInitialCandidate = pickCandidateFields(initialFields, fields);
  const agnesCandidate = pickCandidateFields(focused.field_values || {}, fields);
  const finalResolvedValue = pickCandidateFields(finalFields, fields);
  const gptInitialReferenceMatch = candidateMatchesReference(group, gptInitialCandidate, referenceTitle);
  const agnesReferenceMatch = candidateMatchesReference(group, agnesCandidate, referenceTitle);
  const finalReferenceMatch = candidateMatchesReference(group, finalResolvedValue, referenceTitle);
  const changedFinalFromGpt = candidateChanged(gptInitialCandidate, finalResolvedValue);

  return {
    trigger_reason: entry.reason || "cascade secondary verifier focused reread",
    focused_field_group: group,
    action,
    status: entry.status || "",
    gpt_initial_candidate: gptInitialCandidate,
    agnes_candidate: agnesCandidate,
    final_resolved_value: finalResolvedValue,
    agnes_latency_ms: Number(entry.duration_ms || 0),
    gpt_initial_reference_match: gptInitialReferenceMatch,
    agnes_reference_match: agnesReferenceMatch,
    final_reference_match: finalReferenceMatch,
    whether_recovered: gptInitialReferenceMatch === false && finalReferenceMatch === true,
    whether_agnes_changed_a_correct_gpt_result: gptInitialReferenceMatch === true && changedFinalFromGpt && finalReferenceMatch === false
  };
}

function secondaryVerificationEvents({
  trace = [],
  initialFields = {},
  finalFields = {},
  referenceTitle = ""
} = {}) {
  return (Array.isArray(trace) ? trace : [])
    .filter((entry) => entry?.output?.focused_vision)
    .map((entry) => focusedEventFromTrace(entry, {
      initialFields,
      finalFields,
      referenceTitle
    }));
}

function hasEventCandidate(candidate = {}) {
  return Object.keys(candidate || {}).length > 0;
}

function secondaryVerifierCaseReview(events = []) {
  const executed = events.filter((event) => event.status === "executed");
  const noInformation = events.filter((event) => {
    return event.status === "no_information" || !hasEventCandidate(event.agnes_candidate);
  });
  const sameAsGpt = events.filter((event) => {
    return hasEventCandidate(event.gpt_initial_candidate)
      && hasEventCandidate(event.agnes_candidate)
      && !candidateChanged(event.gpt_initial_candidate, event.agnes_candidate);
  });
  const changedCandidate = events.filter((event) => {
    return hasEventCandidate(event.gpt_initial_candidate)
      && hasEventCandidate(event.agnes_candidate)
      && candidateChanged(event.gpt_initial_candidate, event.agnes_candidate);
  });
  const resolverMissed = events.filter((event) => {
    return event.agnes_reference_match === true && event.final_reference_match !== true;
  });
  const sameWrong = events.filter((event) => {
    return event.gpt_initial_reference_match === false && event.agnes_reference_match === false;
  });

  return {
    executed_count: executed.length,
    no_information_count: noInformation.length,
    same_as_gpt_count: sameAsGpt.length,
    changed_candidate_count: changedCandidate.length,
    same_wrong_count: sameWrong.length,
    possible_resolver_missed_count: resolverMissed.length,
    agnes_reference_match_true_count: events.filter((event) => event.agnes_reference_match === true).length,
    agnes_reference_match_false_count: events.filter((event) => event.agnes_reference_match === false).length,
    agnes_reference_match_unknown_count: events.filter((event) => event.agnes_reference_match === null).length
  };
}

function traceUsesAgnesFocusedVerifier(trace = []) {
  return trace.some((entry) => {
    const providerIds = entry?.output?.provider_ids || [];
    return entry?.output?.focused_vision
      || providerIds.includes(evalProviders.AGNES)
      || String(entry?.action || "").includes("CROP_AND_READ");
  });
}

function traceHasSecondaryVerifierError(trace = []) {
  return trace.some((entry) => {
    const providerIds = entry?.output?.provider_ids || [];
    const reason = String(entry?.reason || "").toLowerCase();
    return providerIds.includes(evalProviders.AGNES)
      && (entry?.status === "error" || /timeout|timed out|rate|network|unavailable/.test(reason));
  });
}

function publicationGate(item = {}) {
  return item.publication_gate || item.output?.publication_gate || item.prediction?.publication_gate || {};
}

function fieldLevelPublication(item = {}) {
  return publicationGate(item).field_level_publication || item.field_level_publication || {};
}

function nonEmptyPredictionFieldCount(fields = {}) {
  return Object.values(fields || {}).filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value === true;
    return value !== null && value !== undefined && normalizeText(value) !== "";
  }).length;
}

function providerQualitySummary(results = []) {
  const attempted = results.length;
  const providerItems = results.filter((item) => item.provider_result);
  const providerSuccessItems = providerItems.filter((item) => item.status === "evaluated");
  const repairAttempted = providerItems.filter((item) => item.provider_result?.format_repair_attempted === true).length;
  const localRepairSuccess = providerItems.filter((item) => item.provider_result?.local_json_repair_success === true).length;
  const textRepairSuccess = providerItems.filter((item) => item.provider_result?.text_repair_success === true).length;
  const fallbackItems = providerItems.filter((item) => item.provider_result?.fallback_provider_id).length;
  const providerTimings = results
    .map((item) => Number(item.timing?.provider_total_ms || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const writerReadyTimings = results
    .filter(gateAcceptsForWriter)
    .map((item) => Number(item.timing?.total_ms || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const criticalBeforeGate = results.filter((item) => item.corrected_title_comparison?.critical_title_error === true).length;

  return {
    provider_success_count: providerSuccessItems.length,
    provider_success_rate: rate(providerSuccessItems.length, attempted),
    native_schema_valid_count: providerItems.filter((item) => item.provider_result?.native_schema_valid === true).length,
    native_schema_valid_rate: rate(providerItems.filter((item) => item.provider_result?.native_schema_valid === true).length, attempted),
    format_repair_attempted_count: repairAttempted,
    format_repair_attempted_rate: rate(repairAttempted, attempted),
    local_json_repair_success_count: localRepairSuccess,
    local_json_repair_success_rate: rate(localRepairSuccess, attempted),
    local_json_repair_success_of_repair_attempted_rate: rate(localRepairSuccess, repairAttempted),
    text_repair_success_count: textRepairSuccess,
    text_repair_success_rate: rate(textRepairSuccess, attempted),
    text_repair_success_of_repair_attempted_rate: rate(textRepairSuccess, repairAttempted),
    format_error_type_counts: countBy(providerItems.map((item) => item.provider_result?.format_error_type)),
    gpt_fallback_count: fallbackItems,
    gpt_fallback_rate: rate(fallbackItems, attempted),
    fallback_reason_counts: countBy(providerItems.map((item) => item.provider_result?.fallback_reason)),
    raw_field_completeness_avg: average(results.map((item) => nonEmptyPredictionFieldCount(item.prediction?.fields || {}))),
    raw_critical_error_before_gate_count: criticalBeforeGate,
    raw_critical_error_before_gate_rate: rate(criticalBeforeGate, attempted),
    time_to_first_draft_ms_avg: average(providerTimings),
    time_to_writer_ready_ms_avg: average(writerReadyTimings)
  };
}

function summarize(results = [], {
  elapsedMs = 0,
  providerId = evalProviders.AGNES
} = {}) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const invalid = results.filter((item) => item.status === "invalid_candidate").length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const itemTimeouts = results.filter((item) => item.status === "provider_error" && item.error_code === "item_timeout").length;
  const identityAbstains = results.filter(isIdentityAbstain).length;
  const writerReviewReady = results.filter((item) => publicationGate(item).writer_review_ready === true).length;
  const partialWriterDrafts = results.filter((item) => publicationGate(item).partial_writer_draft === true).length;
  const autoPublishReady = results.filter((item) => publicationGate(item).auto_publish_allowed === true).length;
  const modelAutoPublishRecommended = results.filter((item) => {
    const gate = publicationGate(item);
    return gate.model_quick_review_recommended === true || gate.model_auto_publish_recommended === true;
  }).length;
  const fieldLevelPublications = results.map(fieldLevelPublication).filter((item) => item && typeof item === "object");
  const fieldLevelPartialOutputs = fieldLevelPublications.filter((item) => item.has_partial_output === true).length;
  const identityGateStatusCounts = countBy(results.map((item) => publicationGate(item).identity_gate_status));
  const workflowRouteCounts = countBy(results.map((item) => publicationGate(item).workflow_route || publicationGate(item).status));
  const fieldPublishabilityCounts = results.reduce((counts, item) => {
    const gate = publicationGate(item);
    const fieldMap = gate.field_publishability || gate.field_publication_states || fieldLevelPublication(item).field_publishability || {};
    Object.values(fieldMap).forEach((status) => {
      if (!status) return;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, {});
  const allInCommercialSuccesses = results.filter(isAllInCommercialSuccess).length;
  const allInCommercialFailures = attempted - allInCommercialSuccesses;
  const comparisons = results.map((item) => item.corrected_title_comparison).filter(Boolean);
  const exact = comparisons.filter((item) => item.corrected_title_exact).length;
  const criticalTitleErrors = comparisons.filter((item) => item.critical_title_error).length;
  const wrongYear = comparisons.filter((item) => item.wrong_year).length;
  const wrongSerial = comparisons.filter((item) => item.wrong_serial).length;
  const wrongGrade = comparisons.filter((item) => item.wrong_grade).length;
  const unexpectedColor = comparisons.filter((item) => item.unexpected_color).length;
  const usage = sumUsage(results);
  const secondaryTriggered = results.filter((item) => traceUsesAgnesFocusedVerifier(completionTrace(item))).length;
  const secondaryErrors = results.filter((item) => traceHasSecondaryVerifierError(completionTrace(item))).length;
  const secondaryEvents = results.flatMap((item) => Array.isArray(item.secondary_verification_events) ? item.secondary_verification_events : []);
  const secondaryFieldRecovered = secondaryEvents.filter((event) => event.whether_recovered === true).length;
  const secondaryFieldRegressed = secondaryEvents.filter((event) => event.whether_agnes_changed_a_correct_gpt_result === true).length;
  const secondaryRecovered = results.filter((item) => {
    return traceUsesAgnesFocusedVerifier(completionTrace(item))
      && isAllInCommercialSuccess(item);
  }).length;
  const effectiveElapsedMs = Number(elapsedMs) > 0 ? Number(elapsedMs) : Number(usage.latency_ms || 0);
  const attemptedCardsPerMinute = perMinute(attempted, effectiveElapsedMs);
  const evaluatedCardsPerMinute = perMinute(evaluated, effectiveElapsedMs);
  const correctCardsPerMinute = perMinute(allInCommercialSuccesses, effectiveElapsedMs);
  const rootCauses = rootCauseSummary(results);
  const componentQuality = componentQualityReport(results, {
    fieldGroundTruthAvailable: false
  });
  const providerQuality = providerQualitySummary(results);
  const secondaryProvider = evalProviders.AGNES;

  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    invalid_candidate_count: invalid,
    provider_error_count: providerErrors,
    item_timeout_count: itemTimeouts,
    identity_abstain_count: identityAbstains,
    identity_abstain_rate: rate(identityAbstains, attempted),
    writer_review_ready_count: writerReviewReady,
    writer_review_ready_rate: rate(writerReviewReady, attempted),
    partial_writer_draft_count: partialWriterDrafts,
    partial_writer_draft_rate: rate(partialWriterDrafts, attempted),
    field_level_partial_output_count: fieldLevelPartialOutputs,
    field_level_partial_output_rate: rate(fieldLevelPartialOutputs, attempted),
    field_level_usable_field_count_avg: average(fieldLevelPublications.map((item) => Number(item.usable_field_count || 0))),
    field_level_review_field_count_avg: average(fieldLevelPublications.map((item) => Number(item.review_field_count || 0))),
    auto_publish_ready_count: autoPublishReady,
    auto_publish_ready_rate: rate(autoPublishReady, attempted),
    model_auto_publish_recommended_count: modelAutoPublishRecommended,
    model_auto_publish_recommended_rate: rate(modelAutoPublishRecommended, attempted),
    identity_gate_status_counts: identityGateStatusCounts,
    workflow_route_counts: workflowRouteCounts,
    field_publishability_counts: fieldPublishabilityCounts,
    all_in_commercial_success_count: allInCommercialSuccesses,
    all_in_commercial_failure_count: allInCommercialFailures,
    all_in_commercial_accuracy: rate(allInCommercialSuccesses, attempted),
    all_in_commercial_accuracy_target: 0.95,
    all_in_commercial_accuracy_passed: rate(allInCommercialSuccesses, attempted) !== null
      ? rate(allInCommercialSuccesses, attempted) >= 0.95
      : false,
    corrected_title_exact_count: exact,
    corrected_title_exact_rate: rate(exact, attempted),
    corrected_title_token_recall_avg: average(comparisons.map((item) => item.token_recall)),
    corrected_title_token_precision_avg: average(comparisons.map((item) => item.token_precision)),
    critical_title_error_count: criticalTitleErrors,
    critical_title_error_rate: rate(criticalTitleErrors, attempted),
    wrong_year_count: wrongYear,
    wrong_serial_count: wrongSerial,
    wrong_grade_count: wrongGrade,
    unexpected_color_count: unexpectedColor,
    secondary_verifier: {
      provider: secondaryProvider,
      triggered_count: secondaryTriggered,
      trigger_rate: rate(secondaryTriggered, attempted),
      error_count: secondaryErrors,
      error_rate: rate(secondaryErrors, secondaryTriggered),
      recovered_success_count: secondaryRecovered,
      recovery_rate: rate(secondaryRecovered, secondaryTriggered),
      field_recovered_count: secondaryFieldRecovered,
      field_regressed_count: secondaryFieldRegressed,
      field_regression_rate: rate(secondaryFieldRegressed, secondaryEvents.length),
      net_benefit: secondaryFieldRecovered - secondaryFieldRegressed,
      event_count: secondaryEvents.length,
      case_review: secondaryVerifierCaseReview(secondaryEvents)
    },
    parsed_success_rate: rate(evaluated, attempted),
    provider_success_count: providerQuality.provider_success_count,
    provider_success_rate: providerQuality.provider_success_rate,
    native_schema_valid_count: providerQuality.native_schema_valid_count,
    native_schema_valid_rate: providerQuality.native_schema_valid_rate,
    format_repair_attempted_count: providerQuality.format_repair_attempted_count,
    format_repair_attempted_rate: providerQuality.format_repair_attempted_rate,
    local_json_repair_success_count: providerQuality.local_json_repair_success_count,
    local_json_repair_success_rate: providerQuality.local_json_repair_success_rate,
    text_repair_success_count: providerQuality.text_repair_success_count,
    text_repair_success_rate: providerQuality.text_repair_success_rate,
    gpt_fallback_count: providerQuality.gpt_fallback_count,
    gpt_fallback_rate: providerQuality.gpt_fallback_rate,
    raw_field_completeness_avg: providerQuality.raw_field_completeness_avg,
    raw_critical_error_before_gate_count: providerQuality.raw_critical_error_before_gate_count,
    raw_critical_error_before_gate_rate: providerQuality.raw_critical_error_before_gate_rate,
    time_to_first_draft_ms_avg: providerQuality.time_to_first_draft_ms_avg,
    time_to_writer_ready_ms_avg: providerQuality.time_to_writer_ready_ms_avg,
    provider_quality: providerQuality,
    elapsed_ms: Math.max(0, Math.round(effectiveElapsedMs || 0)),
    attempted_cards_per_minute: attemptedCardsPerMinute,
    evaluated_cards_per_minute: evaluatedCardsPerMinute,
    correct_cards_per_minute: correctCardsPerMinute,
    throughput_objective: {
      metric: "correct_cards_per_minute",
      definition: "all_in_commercial_success_count per wall-clock minute, including abstains and provider errors in the attempted denominator",
      value: correctCardsPerMinute,
      supporting_metrics: {
        attempted_cards_per_minute: attemptedCardsPerMinute,
        evaluated_cards_per_minute: evaluatedCardsPerMinute,
        all_in_commercial_accuracy: rate(allInCommercialSuccesses, attempted)
      }
    },
    gate_confusion_matrix: rootCauses.gate_confusion_matrix,
    root_cause_summary: rootCauses,
    component_quality: componentQuality,
    dangerous_error_rate: componentQuality.factors.decision_quality.dangerous_error_rate,
    accepted_coverage_rate: componentQuality.factors.decision_quality.coverage_rate,
    open_world_metric_contract: openWorldEvaluationMetrics,
    usage
  };
}

function buildReport({
  dataset,
  selectedItems,
  results,
  startedAt,
  now,
  providerId = evalProviders.AGNES,
  fullSampleEvaluation,
  identityResolution,
  excludeSelfApprovedMemory,
  recognitionPreflight = false,
  singleModelFastPath = false,
  proactiveFocusedRereads = false,
  proactiveSerialOnly = false,
  rateLimitRetries = 0,
  rateLimitPauseMs = 60000,
  concurrency = 2,
  maxConcurrency = 5,
  workerCount = 0,
  resumedCount = 0,
  pendingCount = 0,
  itemTimeoutMs = 0,
  elapsedMs = 0
}) {
  const annotatedResults = annotateEvaluationRootCauses(results);
  return {
    schema_version: schemaVersion,
    status: results.length === selectedItems.length ? "completed" : "partial",
    generated_at: now().toISOString(),
    started_at: startedAt.toISOString(),
    provider: providerId,
    provider_display_name: providerDisplayName(providerId),
    identity_resolution_enabled: identityResolution,
    internal_memory_self_exclusion_enabled: identityResolution && excludeSelfApprovedMemory,
    recognition_preflight_enabled: identityResolution && recognitionPreflight,
    single_model_fast_path_enabled: identityResolution && singleModelFastPath,
    proactive_focused_rereads_enabled: identityResolution && proactiveFocusedRereads,
    proactive_serial_only_enabled: identityResolution && proactiveFocusedRereads && proactiveSerialOnly,
    rate_limit_retry_enabled: rateLimitRetries > 0,
    rate_limit_retry_limit: rateLimitRetries,
    rate_limit_retry_pause_ms: rateLimitPauseMs,
    configured_concurrency: concurrency,
    max_concurrency: maxConcurrency,
    worker_count: workerCount,
    resumed_count: resumedCount,
    pending_count: pendingCount,
    item_timeout_ms: itemTimeoutMs,
    source_dataset_schema_version: dataset.schema_version || null,
    source_manifest_hash: dataset.manifest_hash || null,
    source_provider: dataset.source?.provider || null,
    source_table: dataset.source?.table || null,
    source_row_count: dataset.source?.source_row_count ?? null,
    image_backed_row_count: dataset.source?.image_backed_row_count ?? dataset.summary?.item_count ?? selectedItems.length,
    corrected_title_reference_only: true,
    field_ground_truth_available: false,
    commercial_accuracy_claim_allowed: false,
    commercial_accuracy_eval_eligible: false,
    field_ground_truth_required_for_commercial: true,
    no_feedback_retention_side_effects: true,
    full_sample_evaluation: fullSampleEvaluation,
    target_count: selectedItems.length,
    ...summarize(annotatedResults, { elapsedMs, providerId }),
    results: annotatedResults
  };
}

export async function evaluateAgnesSupabaseFeedback({
  dataset,
  limit = 0,
  concurrency = 2,
  maxConcurrency = 5,
  providerId = evalProviders.AGNES,
  identityResolution = false,
  maxTitleLength = 80,
  excludeSelfApprovedMemory = true,
  recognitionPreflight = false,
  singleModelFastPath = false,
  proactiveFocusedRereads = false,
  proactiveSerialOnly = false,
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  analyzeFocusedImpl = null,
  analyzeRecognitionImpl = analyzeCardImagesWithRecognitionWorker,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  previousResults = [],
  onProgress = null,
  rateLimitRetries = 0,
  rateLimitPauseMs = 60000,
  itemTimeoutMs = 0,
  now = () => new Date()
} = {}) {
  const startedAt = now();
  const wallStartedAtMs = nowMs();
  const missingProviderEnvKeys = providerEnvKeys(providerId)
    .filter((key, index, all) => key && all.indexOf(key) === index && !env[key]);
  if (missingProviderEnvKeys.length) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: providerId,
      provider_display_name: providerDisplayName(providerId),
      target_count: 0,
      attempted_count: 0,
      corrected_title_reference_only: true,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      field_ground_truth_required_for_commercial: true,
      blocked_reason: `${missingProviderEnvKeys.join(" and ")} ${missingProviderEnvKeys.length === 1 ? "is" : "are"} not configured.`,
      results: []
    };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: providerId,
      provider_display_name: providerDisplayName(providerId),
      target_count: 0,
      attempted_count: 0,
      corrected_title_reference_only: true,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      field_ground_truth_required_for_commercial: true,
      blocked_reason: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to sign private feedback images.",
      results: []
    };
  }

  const allImageItems = (Array.isArray(dataset?.items) ? dataset.items : [])
    .filter((item) => imageInputs(item).length > 0);
  const selectedItems = limit > 0 ? allImageItems.slice(0, limit) : allImageItems;
  const fullSampleEvaluation = selectedItems.length === allImageItems.length && limit <= 0;
  const completionEnv = proactiveFocusedRereads
    ? { ...env, ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1" }
    : env;
  const reusableResultMatchesMode = (item = {}) => {
    return item?.status === "evaluated"
      && Boolean(item.identity_resolution_enabled) === Boolean(identityResolution)
      && Boolean(item.recognition_preflight_enabled) === Boolean(identityResolution && recognitionPreflight)
      && Boolean(item.single_model_fast_path_enabled) === Boolean(identityResolution && singleModelFastPath)
      && Boolean(item.internal_memory_self_excluded) === Boolean(identityResolution && excludeSelfApprovedMemory)
      && (!item.provider || item.provider === providerId);
  };
  const reusableById = new Map(
    previousResults
      .filter(reusableResultMatchesMode)
      .map((item) => [item.candidate_id, item])
  );
  const resultsById = new Map();
  const pending = [];

  for (const item of selectedItems) {
    const id = candidateId(item);
    const previous = reusableById.get(id);
    if (previous) {
      resultsById.set(id, previous);
    } else {
      pending.push(item);
    }
  }
  const requestedConcurrency = Math.max(1, Number(concurrency) || 1);
  const concurrencyCap = Math.max(1, Number(maxConcurrency) || 5);
  const workerCount = Math.max(1, Math.min(requestedConcurrency, concurrencyCap, pending.length || 1));
  const resumedCount = resultsById.size;
  const pendingCount = pending.length;

  const buildCurrentReport = (status = "partial") => {
    const results = selectedItems.map((item) => resultsById.get(candidateId(item))).filter(Boolean);
    const report = buildReport({
      dataset,
      selectedItems,
      results,
      startedAt,
      now,
      providerId,
      fullSampleEvaluation,
      identityResolution,
      excludeSelfApprovedMemory,
      recognitionPreflight,
      singleModelFastPath,
      proactiveFocusedRereads,
      proactiveSerialOnly,
      rateLimitRetries,
      rateLimitPauseMs,
      concurrency: requestedConcurrency,
	      maxConcurrency: concurrencyCap,
	      workerCount,
	      resumedCount,
	      pendingCount,
	      itemTimeoutMs,
	      elapsedMs: nowMs() - wallStartedAtMs
	    });
    return { ...report, status: results.length === selectedItems.length ? "completed" : status };
  };

  let cursor = 0;

  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      const result = await evaluateOneFeedbackItemWithOptionalTimeout(item, {
        env: completionEnv,
        analyzeImpl,
        analyzeFocusedImpl,
        providerId,
        analyzeRecognitionImpl,
        createSignedReadUrlImpl,
        identityResolution,
        maxTitleLength,
        excludeSelfApprovedMemory,
        recognitionPreflight,
        singleModelFastPath,
        rateLimitRetries,
        rateLimitPauseMs,
        itemTimeoutMs
      });
      resultsById.set(candidateId(item), result);
      if (onProgress) await onProgress(buildCurrentReport("partial"));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return buildCurrentReport("completed");
}

export function formatAgnesSupabaseFeedbackSummary(report = {}) {
  const label = report.provider_display_name || providerDisplayName(report.provider);
  return [
    `${label} Supabase feedback eval ${report.status || "unknown"}`,
    `identity_resolution_enabled: ${report.identity_resolution_enabled === true}`,
    `internal_memory_self_exclusion_enabled: ${report.internal_memory_self_exclusion_enabled === true}`,
    `recognition_preflight_enabled: ${report.recognition_preflight_enabled === true}`,
    `single_model_fast_path_enabled: ${report.single_model_fast_path_enabled === true}`,
    `proactive_focused_rereads_enabled: ${report.proactive_focused_rereads_enabled === true}`,
    `proactive_serial_only_enabled: ${report.proactive_serial_only_enabled === true}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `attempted_count: ${report.attempted_count ?? "n/a"}`,
    `evaluated_count: ${report.evaluated_count ?? "n/a"}`,
    `provider_error_count: ${report.provider_error_count ?? "n/a"}`,
    `provider_success_count: ${report.provider_success_count ?? "n/a"} (${report.provider_success_rate ?? "n/a"})`,
    `native_schema_valid_count: ${report.native_schema_valid_count ?? "n/a"} (${report.native_schema_valid_rate ?? "n/a"})`,
    `format_repair_attempted_count: ${report.format_repair_attempted_count ?? "n/a"} (${report.format_repair_attempted_rate ?? "n/a"})`,
    `local_json_repair_success_count: ${report.local_json_repair_success_count ?? "n/a"} (${report.local_json_repair_success_rate ?? "n/a"})`,
    `text_repair_success_count: ${report.text_repair_success_count ?? "n/a"} (${report.text_repair_success_rate ?? "n/a"})`,
    `gpt_fallback_count: ${report.gpt_fallback_count ?? "n/a"} (${report.gpt_fallback_rate ?? "n/a"})`,
    `format_error_type_counts: ${Object.entries(report.provider_quality?.format_error_type_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `fallback_reason_counts: ${Object.entries(report.provider_quality?.fallback_reason_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `raw_field_completeness_avg: ${report.raw_field_completeness_avg ?? "n/a"}`,
    `raw_critical_error_before_gate: ${report.raw_critical_error_before_gate_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.raw_critical_error_before_gate_rate ?? "n/a"})`,
    `time_to_first_draft_ms_avg: ${report.time_to_first_draft_ms_avg ?? "n/a"}`,
    `time_to_writer_ready_ms_avg: ${report.time_to_writer_ready_ms_avg ?? "n/a"}`,
    `item_timeout_count: ${report.item_timeout_count ?? "n/a"}`,
    `identity_abstain_count: ${report.identity_abstain_count ?? "n/a"}`,
    `writer_review_ready_count: ${report.writer_review_ready_count ?? "n/a"} (${report.writer_review_ready_rate ?? "n/a"})`,
    `partial_writer_draft_count: ${report.partial_writer_draft_count ?? "n/a"} (${report.partial_writer_draft_rate ?? "n/a"})`,
    `field_level_partial_output_count: ${report.field_level_partial_output_count ?? "n/a"} (${report.field_level_partial_output_rate ?? "n/a"})`,
    `field_level_usable_field_count_avg: ${report.field_level_usable_field_count_avg ?? "n/a"}`,
    `field_level_review_field_count_avg: ${report.field_level_review_field_count_avg ?? "n/a"}`,
    `auto_publish_ready_count: ${report.auto_publish_ready_count ?? "n/a"} (${report.auto_publish_ready_rate ?? "n/a"})`,
    `model_auto_publish_recommended_count: ${report.model_auto_publish_recommended_count ?? "n/a"} (${report.model_auto_publish_recommended_rate ?? "n/a"})`,
    `identity_gate_status_counts: ${Object.entries(report.identity_gate_status_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `workflow_route_counts: ${Object.entries(report.workflow_route_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `field_publishability_counts: ${Object.entries(report.field_publishability_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `all_in_commercial_accuracy: ${report.all_in_commercial_accuracy ?? "n/a"} target:${report.all_in_commercial_accuracy_target ?? "n/a"} passed:${report.all_in_commercial_accuracy_passed === true}`,
    `correct_cards_per_minute: ${report.correct_cards_per_minute ?? "n/a"}`,
    `attempted_cards_per_minute: ${report.attempted_cards_per_minute ?? "n/a"}`,
    `elapsed_ms: ${report.elapsed_ms ?? "n/a"}`,
    `worker_count: ${report.worker_count ?? "n/a"}/${report.max_concurrency ?? "n/a"}`,
    `secondary_verifier_triggered: ${report.secondary_verifier?.triggered_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.secondary_verifier?.trigger_rate ?? "n/a"})`,
    `secondary_verifier_errors: ${report.secondary_verifier?.error_count ?? "n/a"} (${report.secondary_verifier?.error_rate ?? "n/a"})`,
    `secondary_verifier_recovery_rate: ${report.secondary_verifier?.recovery_rate ?? "n/a"}`,
    `secondary_verifier_field_recovered: ${report.secondary_verifier?.field_recovered_count ?? "n/a"}`,
    `secondary_verifier_field_regressed: ${report.secondary_verifier?.field_regressed_count ?? "n/a"} (${report.secondary_verifier?.field_regression_rate ?? "n/a"})`,
    `secondary_verifier_net_benefit: ${report.secondary_verifier?.net_benefit ?? "n/a"}`,
    `secondary_verifier_case_review: ${Object.entries(report.secondary_verifier?.case_review || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `corrected_title_exact: ${report.corrected_title_exact_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.corrected_title_exact_rate ?? "n/a"})`,
    `corrected_title_token_recall_avg: ${report.corrected_title_token_recall_avg ?? "n/a"}`,
    `critical_title_errors: ${report.critical_title_error_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.critical_title_error_rate ?? "n/a"})`,
    `dangerous_error_rate: ${report.dangerous_error_rate ?? "n/a"}`,
    `accepted_coverage_rate: ${report.accepted_coverage_rate ?? "n/a"}`,
    `gate_confusion_matrix: ${Object.entries(report.gate_confusion_matrix || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `primary_root_causes: ${Object.entries(report.root_cause_summary?.primary_counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `gate_false_reject_subtypes: ${Object.entries(report.root_cause_summary?.gate_false_reject_subtypes || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `root_causes: ${Object.entries(report.root_cause_summary?.counts || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `root_cause_cross_tabs: ${Object.entries(report.root_cause_summary?.cross_tabs || {}).map(([code, count]) => `${code}=${count}`).join(", ") || "n/a"}`,
    `recognition_worker_calls: ${report.usage?.recognition_worker_calls ?? "n/a"}`,
    `full_sample_evaluation: ${report.full_sample_evaluation === true}`,
    `commercial_accuracy_claim_allowed: false`,
    `scope: private Supabase feedback corrected-title reference only`
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

export async function main(argv = process.argv, env = process.env) {
  const datasetPath = argValue(argv, "--dataset", env.SUPABASE_FEEDBACK_CANDIDATES_PATH || defaultDatasetPath);
  const providerId = normalizeEvalProvider(argValue(argv, "--provider", env.LISTING_EVAL_PROVIDER || evalProviders.AGNES));
  const outPath = argValue(argv, "--out", env.AGNES_SUPABASE_FEEDBACK_EVAL_OUT || defaultOutPath);
  const allowLocalProviderCalls = hasFlag(argv, "--allow-local-provider-calls")
    || booleanFromEnv(env, "ALLOW_LOCAL_PROVIDER_EVAL", false);
  if (!allowLocalProviderCalls) {
    throw new Error([
      "Local direct provider evaluation is disabled.",
      "Use scripts/evaluate-cloud-listing-api.mjs so real model calls run in the cloud.",
      "For explicit sandbox-only exceptions, pass --allow-local-provider-calls or set ALLOW_LOCAL_PROVIDER_EVAL=1."
    ].join(" "));
  }
  const limit = numberArg(argv, "--limit", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_LIMIT || 0));
  const concurrency = numberArg(argv, "--concurrency", providerDefaultConcurrency(providerId, env));
  const maxConcurrency = Math.max(1, numberArg(argv, "--max-concurrency", providerDefaultMaxConcurrency(providerId, env)));
  const identityResolution = hasFlag(argv, "--identity-resolution") || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_IDENTITY_RESOLUTION", false);
  const maxTitleLength = numberArg(argv, "--max-title-length", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_MAX_TITLE_LENGTH || 80));
  const excludeSelfApprovedMemory = !hasFlag(argv, "--allow-self-approved-memory")
    && booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_EXCLUDE_SELF_MEMORY", true);
  const recognitionPreflight = hasFlag(argv, "--recognition-preflight")
    || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_RECOGNITION_PREFLIGHT", false);
  const singleModelFastPath = hasFlag(argv, "--single-model-fast-path")
    || booleanFromEnv(env, "LISTING_EVAL_SINGLE_MODEL_FAST_PATH", false);
  const proactiveFocusedRereads = hasFlag(argv, "--proactive-focused-rereads")
    || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_PROACTIVE_FOCUSED_REREADS", false);
  const proactiveSerialOnly = hasFlag(argv, "--proactive-serial-only")
    || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_PROACTIVE_SERIAL_ONLY", false);
  const flushEvery = Math.max(1, numberArg(argv, "--flush-every", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_FLUSH_EVERY || 5)));
  const rateLimitRetries = Math.max(0, numberArg(argv, "--rate-limit-retries", Number(env.AGNES_SUPABASE_FEEDBACK_RATE_LIMIT_RETRIES || 0)));
  const rateLimitPauseMs = Math.max(0, numberArg(argv, "--rate-limit-pause-ms", Number(env.AGNES_SUPABASE_FEEDBACK_RATE_LIMIT_PAUSE_MS || 60000)));
  const itemTimeoutMs = Math.max(0, numberArg(argv, "--item-timeout-ms", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_ITEM_TIMEOUT_MS || 0)));
  const failOnProviderError = hasFlag(argv, "--fail-on-provider-error")
    || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_FAIL_ON_PROVIDER_ERROR", false);
  const resume = !hasFlag(argv, "--no-resume") && booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_RESUME", true);
  const dataset = await readJson(datasetPath);
  let previousResults = [];
  if (resume && outPath && existsSync(resolve(outPath))) {
    try {
      const previous = await readJson(outPath);
      previousResults = Array.isArray(previous.results) ? previous.results : [];
    } catch {
      previousResults = [];
    }
  }

  let completedSinceFlush = 0;
  let writeChain = Promise.resolve();
  const report = await evaluateAgnesSupabaseFeedback({
    dataset,
    limit,
    concurrency,
    maxConcurrency,
    providerId,
    identityResolution,
    maxTitleLength,
    excludeSelfApprovedMemory,
    recognitionPreflight,
    singleModelFastPath,
    proactiveFocusedRereads,
    proactiveSerialOnly,
    analyzeImpl: analyzeImplForProvider(providerId),
    env: {
      ...env,
      ...(proactiveFocusedRereads ? { ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1" } : {}),
      ...(proactiveFocusedRereads && proactiveSerialOnly ? { ENABLE_PROACTIVE_AGNES_SERIAL_ONLY: "1" } : {}),
      AGNES_MAX_RETRIES: env.AGNES_MAX_RETRIES || (itemTimeoutMs > 0 ? "0" : "1"),
      AGNES_FOCUSED_VISION_RETRIES: env.AGNES_FOCUSED_VISION_RETRIES || String(rateLimitRetries)
    },
    previousResults,
    rateLimitRetries,
    rateLimitPauseMs,
    itemTimeoutMs,
    onProgress: outPath
      ? async (partialReport) => {
        completedSinceFlush += 1;
        if (completedSinceFlush < flushEvery && partialReport.status !== "completed") return;
        completedSinceFlush = 0;
        writeChain = writeChain.then(() => writeJson(outPath, partialReport));
        await writeChain;
      }
      : null
  });

  if (outPath) await writeJson(outPath, report);
  process.stdout.write(`${formatAgnesSupabaseFeedbackSummary(report)}\n`);
  if (failOnProviderError && Number(report.provider_error_count || 0) > 0) return 1;
  return report.status === "skipped" ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Supabase feedback eval failed: ${error.message}`);
    process.exit(1);
  }
}
