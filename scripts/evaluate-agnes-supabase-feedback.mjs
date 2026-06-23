import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import { completeEvidence } from "../lib/listing/orchestration/evidence-completion-orchestrator.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { createRetrievalProviderRegistry } from "../lib/listing/retrieval/retrieval-provider-registry.mjs";
import {
  isSupabaseFeedbackConfigured,
  listApprovedHistoryRecords,
  listingApprovedMemoryEnabled
} from "../lib/supabase-feedback.mjs";

const schemaVersion = "agnes-supabase-feedback-eval-v1";
const defaultDatasetPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutPath = "data/eval/agnes-supabase-feedback-latest.json";
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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function imageInputs(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.object_path && image?.bucket)
    .map((image) => ({
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

function yearStart(value) {
  const match = String(value || "").match(/\b(\d{4})(?:-\d{2})?\b/);
  return match ? match[1] : "";
}

function yearOverlap(leftValues = [], rightValues = []) {
  return leftValues.filter((leftValue) => {
    const leftStart = yearStart(leftValue);
    return rightValues.some((rightValue) => {
      if (leftValue === rightValue) return true;
      const rightStart = yearStart(rightValue);
      return Boolean(leftStart && rightStart && leftStart === rightStart);
    });
  });
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialsFromTitle(title) {
  return unique((String(title || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial));
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
    route: normalizeText(result.route)
  };
}

function identityResolutionSummary(result = {}) {
  const identityResolution = result.identity_resolution || {};
  return {
    status: result.identity_resolution_status || identityResolution.status || "",
    ambiguity_status: result.ambiguity_status || identityResolution.ambiguity_status || "",
    confidence_report: result.confidence_report || identityResolution.confidence_report || null,
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
    "You are evaluating real private feedback images for LYNCA Listing Copilot.",
    "Read only the supplied front/back card or slab images. Do not use outside knowledge, marketplace wording, or memory.",
    "Return only valid JSON in this exact shape:",
    JSON.stringify({
      title: "Evidence-only English card title",
      confidence: "LOW",
      reason: "short visible evidence note",
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
        parallel: "printed or otherwise grounded color/parallel/variation; empty for visual-only foil",
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
    "Rules:",
    "- If a field is not visible, use an empty string, false, or an empty array rather than guessing.",
    "- If the image contains multiple cards or a lot, set multi_card true, include card_count when visible, and do not merge fields across cards.",
    "- For serial_number, every digit must be readable; if any digit is uncertain, leave serial_number empty and mention the uncertainty in unresolved.",
    "- For year, prefer the printed card year or season range such as 2003-04; use copyright year only when no card year or season is visible.",
    "- Set rc true when a readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker is visible.",
    "- Set first_bowman, ssp, and case_hit true only when a printed marker/text, slab label, card code, or unmistakable card-specific logo is readable.",
    "- Do not infer color/parallel/variation from foil or color impression alone; leave it empty and put 'visual-only parallel requires operator review' in unresolved.",
    "- Never invent grade, serial, autograph, patch, color, parallel, player, year, or product.",
    "- In reason, cite the visible source for each non-empty high-risk field: serial_number, grade, year, product, player, rc, first_bowman, parallel, variation.",
    "- The corrected title is not shown to you and must not be inferred.",
    "- Do not include Markdown fences or prose outside the JSON.",
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
    "For parallel, variation, 1st Bowman, SSP, and case-hit fields, return a value only when printed card text, slab label, card code, or an unmistakable logo/marker is readable.",
    "If color or foil is only a visual impression, leave parallel/variation empty and add 'visual-only parallel requires operator review' to unresolved.",
    "In reason, cite the visible source for every returned focus field, for example front printed serial, back printed card code, slab label grade, or printed parallel.",
    `Action: ${action || "focused_reread"}.`,
    `Focus fields: ${focusFields.join(", ") || "unresolved critical fields"}.`,
    "Return only valid JSON in this exact shape:",
    JSON.stringify({
      title: "",
      confidence: "LOW",
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

function createFocusedEvaluationRunner({
  signedImages = [],
  analyzeImpl,
  env
} = {}) {
  return async ({ action, focusFields = [], resolved = {} } = {}) => {
    const providerResult = await analyzeImpl({
      images: signedImagesForProvider(signedImages),
      prompt: focusedEvaluationPrompt({ action, focusFields, resolved }),
      env
    });
    const evidenceDocument = evidenceDocumentFromProviderResult(providerResult, {
      images: signedImages
    });

    return {
      provider_id: "agnes",
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
    return acc;
  }, {
    provider_calls: 0,
    estimated_cost_usd: 0,
    image_count: 0,
    latency_ms: 0,
    retrieval_calls: 0,
    resolution_rounds: 0
  });
}

async function resolvedPredictionFromProviderResult(providerResult = {}, {
  signedImages = [],
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  maxTitleLength = 80,
  excludeApprovedMemoryIds = []
} = {}) {
  const evidenceDocument = evidenceDocumentFromProviderResult(providerResult, {
    images: signedImages
  });
  const providerRegistry = createSelfExcludingApprovedMemoryRegistry({
    env,
    excludeIds: excludeApprovedMemoryIds
  });
  const completion = await completeEvidence({
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    unresolved: evidenceDocument.unresolved || [],
    env,
    providerRegistry,
    runFocusedVisionImpl: createFocusedEvaluationRunner({
      signedImages,
      analyzeImpl,
      env
    })
  });
  const gated = applyIdentityResolutionGate({
    title: providerResult.parsed?.title || "",
    model_title_suggestion: providerResult.parsed?.title || "",
    confidence: providerResult.parsed?.confidence || "",
    reason: providerResult.parsed?.reason || "",
    provider: "agnes",
    source: "agnes",
    resolved: completion.resolved,
    evidence: completion.evidence,
    unresolved: [
      ...(Array.isArray(providerResult.parsed?.unresolved) ? providerResult.parsed.unresolved : []),
      ...(Array.isArray(evidenceDocument.unresolved) ? evidenceDocument.unresolved : [])
    ],
    resolution_trace: [
      ...(Array.isArray(evidenceDocument.resolution_trace) ? evidenceDocument.resolution_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    usage: mergeEvalUsage(providerResult.usage, completion.usage)
  }, {
    maxLength: maxTitleLength,
    providerId: "agnes",
    retrievalCandidates: completion.retrieval?.selected_candidate ? [completion.retrieval.selected_candidate] : []
  });

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
      name: `${image.role || "card_image"}:${candidateId(item) || image.object_path}`,
      url,
      role: image.role,
      bucket: image.bucket,
      object_path: image.object_path
    });
  }

  return signed;
}

async function evaluateOneFeedbackItem(item, {
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  identityResolution = false,
  maxTitleLength = 80,
  excludeSelfApprovedMemory = true
} = {}) {
  const id = candidateId(item);
  const referenceTitle = correctedTitle(item);
  const base = {
    candidate_id: id,
    asset_id: item.asset_id || null,
    source_feedback_id: item.source_feedback_id || null,
    category: item.category || null,
    review_status: item.review_status || null,
    corrected_title_reference: referenceTitle,
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

  if (!id || !referenceTitle || base.image_inputs.length < 1) {
    return {
      ...base,
      status: "invalid_candidate",
      error: "Candidate is missing id, corrected title reference, or storage image inputs."
    };
  }

  try {
    const signedImages = await signedAgnesImagesForItem(item, {
      env,
      createSignedReadUrlImpl
    });
    const result = await analyzeImpl({
      images: signedImagesForProvider(signedImages),
      prompt: evaluationPrompt(item),
      env
    });
    const resolved = identityResolution
      ? await resolvedPredictionFromProviderResult(result, {
        signedImages,
        env,
        analyzeImpl,
        maxTitleLength,
        excludeApprovedMemoryIds: excludeSelfApprovedMemory ? sourceIdsForItem(item) : []
      })
      : null;
    const prediction = resolved ? predictionFromResolvedResult(resolved.result) : predictionFromResult(result);
    const comparison = titleComparison(referenceTitle, prediction.title);

    return {
      ...base,
      status: "evaluated",
      prediction,
      corrected_title_comparison: comparison,
      identity_resolution_enabled: identityResolution,
      identity_resolution_status: resolved?.result?.identity_resolution_status || null,
      identity_resolution_summary: resolved ? identityResolutionSummary(resolved.result) : null,
      route: resolved?.result?.route || null,
      completion_trace: resolved?.completion?.resolution_trace || [],
      usage: resolved?.usage || result.usage || null
    };
  } catch (error) {
    return {
      ...base,
      status: "provider_error",
      error_code: error.code || "error",
      error: safeProviderErrorMessage(error)
    };
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

function sumUsage(results = []) {
  return results.reduce((usage, item) => {
    const raw = item.usage || {};
    usage.provider_calls += Number(raw.provider_calls || 0);
    usage.estimated_cost_usd += Number(raw.estimated_cost_usd || 0);
    usage.image_count += Number(raw.image_count || 0);
    usage.latency_ms += Number(raw.latency_ms || 0);
    return usage;
  }, {
    provider_calls: 0,
    estimated_cost_usd: 0,
    image_count: 0,
    latency_ms: 0
  });
}

function summarize(results = []) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const invalid = results.filter((item) => item.status === "invalid_candidate").length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const comparisons = results.map((item) => item.corrected_title_comparison).filter(Boolean);
  const exact = comparisons.filter((item) => item.corrected_title_exact).length;
  const criticalTitleErrors = comparisons.filter((item) => item.critical_title_error).length;
  const wrongYear = comparisons.filter((item) => item.wrong_year).length;
  const wrongSerial = comparisons.filter((item) => item.wrong_serial).length;
  const wrongGrade = comparisons.filter((item) => item.wrong_grade).length;
  const unexpectedColor = comparisons.filter((item) => item.unexpected_color).length;
  const usage = sumUsage(results);

  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    invalid_candidate_count: invalid,
    provider_error_count: providerErrors,
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
    parsed_success_rate: rate(evaluated, attempted),
    usage
  };
}

function buildReport({
  dataset,
  selectedItems,
  results,
  startedAt,
  now,
  fullSampleEvaluation,
  identityResolution,
  excludeSelfApprovedMemory,
  proactiveFocusedRereads = false
}) {
  return {
    schema_version: schemaVersion,
    status: results.length === selectedItems.length ? "completed" : "partial",
    generated_at: now().toISOString(),
    started_at: startedAt.toISOString(),
    provider: "agnes",
    identity_resolution_enabled: identityResolution,
    internal_memory_self_exclusion_enabled: identityResolution && excludeSelfApprovedMemory,
    proactive_focused_rereads_enabled: identityResolution && proactiveFocusedRereads,
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
    ...summarize(results),
    results
  };
}

export async function evaluateAgnesSupabaseFeedback({
  dataset,
  limit = 0,
  concurrency = 2,
  identityResolution = false,
  maxTitleLength = 80,
  excludeSelfApprovedMemory = true,
  proactiveFocusedRereads = false,
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  previousResults = [],
  onProgress = null,
  now = () => new Date()
} = {}) {
  const startedAt = now();
  if (!env.AGNES_API_KEY) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: "agnes",
      target_count: 0,
      attempted_count: 0,
      corrected_title_reference_only: true,
      field_ground_truth_available: false,
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      field_ground_truth_required_for_commercial: true,
      blocked_reason: "AGNES_API_KEY is not configured.",
      results: []
    };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: "agnes",
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
  const reusableById = new Map(
    previousResults
      .filter((item) => item?.status === "evaluated")
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

  const buildCurrentReport = (status = "partial") => {
    const results = selectedItems.map((item) => resultsById.get(candidateId(item))).filter(Boolean);
    const report = buildReport({
      dataset,
      selectedItems,
      results,
      startedAt,
      now,
      fullSampleEvaluation,
      identityResolution,
      excludeSelfApprovedMemory,
      proactiveFocusedRereads
    });
    return { ...report, status: results.length === selectedItems.length ? "completed" : status };
  };

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, 5, pending.length || 1));

  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      const result = await evaluateOneFeedbackItem(item, {
        env: completionEnv,
        analyzeImpl,
        createSignedReadUrlImpl,
        identityResolution,
        maxTitleLength,
        excludeSelfApprovedMemory
      });
      resultsById.set(candidateId(item), result);
      if (onProgress) await onProgress(buildCurrentReport("partial"));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return buildCurrentReport("completed");
}

export function formatAgnesSupabaseFeedbackSummary(report = {}) {
  return [
    `Agnes Supabase feedback eval ${report.status || "unknown"}`,
    `identity_resolution_enabled: ${report.identity_resolution_enabled === true}`,
    `internal_memory_self_exclusion_enabled: ${report.internal_memory_self_exclusion_enabled === true}`,
    `proactive_focused_rereads_enabled: ${report.proactive_focused_rereads_enabled === true}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `attempted_count: ${report.attempted_count ?? "n/a"}`,
    `evaluated_count: ${report.evaluated_count ?? "n/a"}`,
    `provider_error_count: ${report.provider_error_count ?? "n/a"}`,
    `corrected_title_exact: ${report.corrected_title_exact_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.corrected_title_exact_rate ?? "n/a"})`,
    `corrected_title_token_recall_avg: ${report.corrected_title_token_recall_avg ?? "n/a"}`,
    `critical_title_errors: ${report.critical_title_error_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.critical_title_error_rate ?? "n/a"})`,
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
  const outPath = argValue(argv, "--out", env.AGNES_SUPABASE_FEEDBACK_EVAL_OUT || defaultOutPath);
  const limit = numberArg(argv, "--limit", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_LIMIT || 0));
  const concurrency = numberArg(argv, "--concurrency", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_CONCURRENCY || 2));
  const identityResolution = hasFlag(argv, "--identity-resolution") || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_IDENTITY_RESOLUTION", false);
  const maxTitleLength = numberArg(argv, "--max-title-length", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_MAX_TITLE_LENGTH || 80));
  const excludeSelfApprovedMemory = !hasFlag(argv, "--allow-self-approved-memory")
    && booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_EVAL_EXCLUDE_SELF_MEMORY", true);
  const proactiveFocusedRereads = hasFlag(argv, "--proactive-focused-rereads")
    || booleanFromEnv(env, "AGNES_SUPABASE_FEEDBACK_PROACTIVE_FOCUSED_REREADS", false);
  const flushEvery = Math.max(1, numberArg(argv, "--flush-every", Number(env.AGNES_SUPABASE_FEEDBACK_EVAL_FLUSH_EVERY || 5)));
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
    identityResolution,
    maxTitleLength,
    excludeSelfApprovedMemory,
    proactiveFocusedRereads,
    env: {
      ...env,
      ...(proactiveFocusedRereads ? { ENABLE_PROACTIVE_AGNES_FOCUSED_REREADS: "1" } : {}),
      AGNES_MAX_RETRIES: env.AGNES_MAX_RETRIES || "1"
    },
    previousResults,
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
  return report.status === "skipped" ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes Supabase feedback eval failed: ${error.message}`);
    process.exit(1);
  }
}
