// Normalize current-image preingestion patches into resolver-ready hard
// evidence. Derived OCR values stay fail-closed until their source text proves
// the same atomic fact.
import { createEvidenceField, createVisionSource } from "../evidence/evidence-schema.mjs";
import { sourceIdentityForVerifiedImage } from "../evidence/current-image-manifest.mjs";
import {
  gradeTypeForValues,
  normalizeAutoGradeValue,
  normalizeGradeType,
  normalizeGradeValue
} from "../grade/grade-value.mjs";
import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { resolveGradeFields } from "../resolver/grade-resolver.mjs";
import { normalizePrintedCardCodeForFields } from "./field-normalization.mjs";
import {
  currentPreingestionEvidencePatches,
  imagesFromPreIngestionBundle,
  readPreIngestionBundle,
  summarizePreIngestionBundle
} from "../preingestion/preingestion-bundle.mjs";
import { hasEvidenceValue, mergeEvidenceField } from "./evidence-merge.mjs";
import { normalizeStringOrNull } from "./text.mjs";
import { timeAsync } from "./timing.mjs";

const preingestionHardEvidenceFields = new Set([
  "print_run_number",
  "print_run_denominator",
  "serial_number",
  "serial_denominator",
  "numerical_rarity",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code",
  "cert_number",
  // Season-product years: only a PRINTED season range ("2025-26") read off the
  // card is admitted (see validPreingestionFieldValue). A bare copyright year
  // is season-ambiguous (©2025 appears on both 2024-25 and 2025-26 products)
  // and must never override the provider's season.
  "year"
]);

// Query context is current-image evidence, but it is deliberately not merged
// into Resolver hard evidence. It may unlock/narrow an exact catalog lookup;
// only Candidate Control + Resolver may apply the resulting identity fields.
const preingestionRetrievalContextFields = new Set([
  "manufacturer",
  "product",
  "set",
  "players"
]);

const preingestionFieldAliases = new Map(Object.entries({
  print_run_candidate: "print_run_number",
  numerical_rarity_candidate: "numerical_rarity",
  serial_candidate: "serial_number",
  serial_number_candidate: "serial_number",
  serial_denominator_candidate: "serial_denominator",
  grade_candidate: "grade",
  grade_label: "grade",
  grade_label_candidate: "grade",
  slab_label: "grade",
  card_number_candidate: "card_number",
  tcg_card_number_candidate: "tcg_card_number",
  collector_number_candidate: "collector_number",
  checklist_code_candidate: "checklist_code",
  cert_number_candidate: "cert_number",
  slab_cert: "cert_number",
  slab_cert_candidate: "cert_number",
  year_product: "year",
  year_product_candidate: "year",
  year_candidate: "year",
  copyright_year: "year",
  season: "year",
  manufacturer_text: "manufacturer",
  manufacturer_text_candidate: "manufacturer",
  product_text: "product",
  product_text_candidate: "product",
  set_or_insert: "set",
  set_text: "set",
  set_text_candidate: "set",
  subject: "players",
  subject_text: "players",
  player: "players",
  player_name: "players",
  player_text: "players",
  player_text_candidate: "players"
}));

export function normalizePreingestionEvidenceFieldName(fieldName = "") {
  const normalized = normalizeStringOrNull(fieldName)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return null;
  const field = preingestionFieldAliases.get(normalized) || normalized;
  return preingestionHardEvidenceFields.has(field) || preingestionRetrievalContextFields.has(field)
    ? field
    : null;
}

function preingestionEvidenceSourceType(sourceType = "", fieldName = "") {
  const normalized = normalizeStringOrNull(sourceType)?.toUpperCase() || "";
  if (!normalized) return null;
  if (normalized.includes("SLAB") || normalized.includes("GRADE_LABEL")) return "SLAB_LABEL";
  if (normalized.includes("CARD_FRONT")) return "CARD_FRONT";
  if (normalized.includes("CARD_BACK")) return "CARD_BACK";
  if (normalized.includes("OCR") || normalized.includes("PADDLE")) return "OCR";
  if (normalized.includes("OPERATOR")) return "OPERATOR";
  if (normalized.includes("PREINGESTION") && /^(?:print_run|serial|card_number|tcg_card_number|collector_number|checklist_code|year)/.test(fieldName)) return "OCR";
  return null;
}

function clampPreingestionConfidence(value, fallback = 0.78) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizedComparableText(value) {
  return normalizeStringOrNull(value)
    ?.replace(/[｜|]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toUpperCase() || "";
}

function preingestionPatchFieldConfidence(patch = {}, value = "") {
  let confidence = clampPreingestionConfidence(patch.confidence, 0.78);
  const expected = normalizedComparableText(value);
  for (const candidate of patch.text_candidates || patch.textCandidates || []) {
    const observed = normalizedComparableText(typeof candidate === "object" ? candidate.value || candidate.text : candidate);
    if (!expected || !observed) continue;
    const numericOnly = /^\d{1,14}$/.test(expected);
    const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = observed === expected || (!numericOnly && new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, "i").test(observed));
    if (!matches) continue;
    confidence = Math.max(confidence, clampPreingestionConfidence(
      typeof candidate === "object" ? candidate.confidence : null,
      confidence
    ));
  }
  return confidence;
}

function validPreingestionFieldValue(fieldName, value) {
  const text = normalizeStringOrNull(value);
  if (!text) return false;
  if (fieldName === "grade_company") return /^(?:PSA(?:\/DNA)?|BGS|BECKETT|CGC|SGC|TAG)$/i.test(text);
  if (fieldName === "card_grade" || fieldName === "auto_grade") {
    if (/^(?:AUTH|AUTHENTIC|ALTERED)$/i.test(text)) return true;
    if (!/^\d{1,2}(?:\.\d)?$/.test(text)) return false;
    const grade = Number(text);
    return grade >= 1 && grade <= 10;
  }
  if (fieldName === "grade_type") return normalizeGradeType(text) !== "UNKNOWN";
  if (fieldName === "year") {
    // Decisive only when the card PRINTS the season range. A bare 4-digit
    // year is a copyright/legal line and compatible with two seasons.
    return /^(?:19|20)\d{2}\s*[-/]\s*\d{2}$/.test(text);
  }
  if (preingestionRetrievalContextFields.has(fieldName)) {
    return text.length <= 96
      && /[A-Za-z]/.test(text)
      && !/(?:https?:\/\/|\bwww\.|all rights reserved|privacy|trademark|copyright)/i.test(text);
  }
  return true;
}

function preingestionPatchValue(patch = {}) {
  return normalizeStringOrNull(
    patch.value
    ?? patch.normalized_value
    ?? patch.normalizedValue
    ?? patch.raw_text
    ?? patch.rawText
  );
}

const printedCodeEvidenceFields = new Set([
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code"
]);

function printedCodePatchCorpus(patch = {}) {
  return [
    patch.raw_text,
    patch.rawText,
    patch.observed_text,
    patch.observedText,
    ...(patch.text_candidates || patch.textCandidates || []).map((candidate) => (
      typeof candidate === "object" ? candidate.value || candidate.text : candidate
    ))
  ].map((value) => normalizeStringOrNull(value)).filter(Boolean).join(" \n ");
}

function printedCodeEvidenceIsDirect(fieldName, value, patch = {}) {
  const code = normalizePrintedCardCodeForFields(value);
  if (!code) return false;
  const corpus = printedCodePatchCorpus(patch);
  if (!corpus) return false;
  const normalizedCorpus = normalizedComparableText(corpus)
    .replace(/\bC0DE\b/g, "CODE")
    .replace(/\bC0M\b/g, "COM")
    .replace(/\bT0PPS\b/g, "TOPPS");

  const escaped = escapedPattern(code);
  if (new RegExp(`\\bCODE\\s*#?\\s*${escaped}(?:$|[^A-Z0-9])`, "i").test(normalizedCorpus)) return false;
  if (new RegExp(`(?:HTTPS?:\\/\\/|\\bWWW\\.)\\S{0,80}${escaped}(?:$|[^A-Z0-9])`, "i").test(normalizedCorpus)) return false;
  const codePresent = new RegExp(`(?:^|[^A-Z0-9])#?${escaped}(?:$|[^A-Z0-9])`, "i").test(normalizedCorpus);
  if (!codePresent) return false;

  if (/^[A-Z]+$/.test(code)) {
    const explicitMarker = new RegExp(
      `(?:CARD\\s*(?:NO\\.?|NUMBER|#)|NO\\.|#)\\s*${escaped}(?:$|[^A-Z0-9])`,
      "i"
    ).test(normalizedCorpus);
    const isolated = normalizedCorpus.trim() === code;
    if (!explicitMarker && !isolated) return false;
  }

  if (/^\d{1,4}$/.test(code)) {
    const explicitMarker = new RegExp(`(?:CARD\\s*(?:NO\\.?|NUMBER|#)|NO\\.?|#)\\s*0*${escaped}(?:$|[^0-9])`, "i").test(normalizedCorpus);
    const isolated = normalizedCorpus.replace(/^#\s*/, "").trim() === code;
    if (!explicitMarker && !isolated) return false;
    if (/\b(?:PASSING|RECORD|TEAM|ATT|COMP|POINTS?|ASSISTS?|REB|AVG|STATS?)\b/i.test(normalizedCorpus) && !explicitMarker) {
      return false;
    }
  }

  return true;
}

function retrievalContextEvidenceIsDirect(fieldName, value, patch = {}) {
  const cropRole = normalizeStringOrNull(
    patch.provenance?.crop_type
    || patch.provenance?.region
    || patch.provenance?.source_region
    || patch.crop_type
    || patch.cropType
  )?.toLowerCase() || "";
  const allowedCrop = fieldName === "players"
    ? /^(?:player_name|subject_crop|player_crop|grade_label_crop)$/.test(cropRole)
    : /^(?:product_text|year_product_crop|product_crop|set_crop)$/.test(cropRole);
  if (!allowedCrop) return false;
  const sourceType = preingestionEvidenceSourceType(patch.source_type || patch.sourceType, fieldName);
  if (!["OCR", "CARD_FRONT", "CARD_BACK", "SLAB_LABEL"].includes(sourceType)) return false;
  const expected = normalizedComparableText(value);
  const corpus = normalizedComparableText(printedCodePatchCorpus(patch));
  if (!expected || !corpus || /(?:HTTPS?:\/\/|\bWWW\.)/.test(corpus)) return false;
  const escaped = escapedPattern(expected).replace(/\\ /g, "\\s+");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, "i").test(corpus);
}

export function preingestionEvidenceSourceForPatch(patch = {}, fieldName = "", images = []) {
  const cropRole = normalizeStringOrNull(
    patch.provenance?.crop_type
    || patch.provenance?.region
    || patch.provenance?.source_region
    || patch.crop_type
    || patch.cropType
  )?.toLowerCase() || "";
  const gradeField = ["grade", "grade_company", "card_grade", "auto_grade", "grade_type", "cert_number"].includes(fieldName);
  const sourceType = gradeField && /(?:grade[_ -]?label|slab)/.test(cropRole)
    ? "SLAB_LABEL"
    : preingestionEvidenceSourceType(patch.source_type || patch.sourceType, fieldName);
  const imageId = normalizeStringOrNull(patch.source_image_id || patch.sourceImageId || patch.image_id || patch.imageId);
  if (!sourceType || !imageId) return null;
  const cropId = normalizeStringOrNull(patch.crop_id || patch.cropId || patch.source_crop_id || patch.sourceCropId);
  const selectedImage = images.find((image) => (
    normalizeStringOrNull(image.image_id || image.imageId || image.id || image.derived_id) === cropId
  )) || images.find((image) => (
    normalizeStringOrNull(image.image_id || image.imageId || image.id) === imageId
  ));
  const currentImageIdentity = sourceIdentityForVerifiedImage(images, selectedImage || {});
  const retainedTrustTier = Number(
    patch.provenance?.source_trust_tier
    ?? patch.provenance?.sourceTrustTier
    ?? patch.source_trust_tier
    ?? patch.sourceTrustTier
  );
  const trustTier = Number.isInteger(retainedTrustTier) && retainedTrustTier >= 1 && retainedTrustTier <= 10
    ? retainedTrustTier
    : sourceType === "SLAB_LABEL"
      ? 2
      : sourceType === "OCR"
        ? 3
        : 2;
  return createVisionSource({
    sourceType,
    imageId: currentImageIdentity?.source_image_id || null,
    sourceCropId: currentImageIdentity?.source_crop_id || null,
    side: sourceType === "CARD_BACK" ? "back" : sourceType === "CARD_FRONT" ? "front" : null,
    captureRole: "preingestion_evidence",
    region: normalizeStringOrNull(
      patch.provenance?.crop_type
      || patch.provenance?.region
      || patch.provenance?.source_region
      || patch.crop_type
      || patch.cropType
    ),
    observedText: preingestionPatchValue(patch),
    rawText: normalizeStringOrNull(patch.raw_text || patch.rawText) || preingestionPatchValue(patch),
    sourceInferenceMethod: normalizeStringOrNull(
      patch.provenance?.source_inference_method
      || patch.provenance?.sourceInferenceMethod
    ) || "preingestion_evidence_bundle",
    sourceObjectPath: currentImageIdentity?.source_object_path || null,
    derivedObjectPath: currentImageIdentity?.derived_object_path || null,
    currentImageIdentity,
    trustTier
  });
}

function createPreingestionEvidenceField(fieldName, value, patch = {}, images = []) {
  if (!fieldName || !hasEvidenceValue(value) || !validPreingestionFieldValue(fieldName, value)) return null;
  const source = preingestionEvidenceSourceForPatch(patch, fieldName, images);
  if (!source) return null;
  const confidence = preingestionPatchFieldConfidence(patch, value);
  const candidates = [{ value, confidence, sources: [source] }];
  // `text_candidates` are OCR lines from the whole crop, not alternative
  // readings of this atomic field. Keep them on the patch for audit and
  // confidence matching, but do not let a cert number or grade score become a
  // competing grade-company candidate (or vice versa). Independent patches
  // for the same field still merge below and preserve real disagreements.
  return createEvidenceField({
    value,
    normalizedValue: value,
    status: confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
    confidence,
    candidates,
    sources: [source],
    conflicts: [],
    unresolvedReason: confidence >= 0.86 ? null : "preingestion_evidence_requires_writer_review"
  });
}

function addPreingestionEvidence(evidence, resolved, fieldName, value, patch = {}, images = []) {
  const field = createPreingestionEvidenceField(fieldName, value, patch, images);
  if (!field) return;
  evidence[fieldName] = evidence[fieldName]
    ? mergeEvidenceField(fieldName, [evidence[fieldName], field])
    : field;
  const selectedValue = evidence[fieldName]?.normalized_value
    ?? evidence[fieldName]?.normalizedValue
    ?? evidence[fieldName]?.value;
  if (hasEvidenceValue(selectedValue)) resolved[fieldName] = selectedValue;
}

function printRunPatchText(patch = {}) {
  const values = [
    patch.raw_text,
    patch.rawText,
    patch.observed_text,
    patch.observedText,
    ...(patch.text_candidates || patch.textCandidates || []).map((candidate) => (
      typeof candidate === "object" ? candidate.value || candidate.text : candidate
    ))
  ];
  return values
    .map((value) => normalizeStringOrNull(value))
    .filter(Boolean)
    .join(" \n ")
    .replace(/[｜|]/g, "/")
    .replace(/\s*\/\s*/g, "/");
}

function escapedPattern(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printRunEvidenceIsDirect(fieldName, value, patch = {}) {
  const expanded = expandPrintRunFields({ [fieldName]: value });
  const denominator = normalizeStringOrNull(
    expanded.print_run_denominator
    || expanded.numbered_to
    || expanded.serial_denominator
  );
  if (!denominator || expanded.suspicious_print_run === true) return false;

  const corpus = printRunPatchText(patch);
  if (!corpus) {
    const sourceType = preingestionEvidenceSourceType(patch.source_type || patch.sourceType, fieldName);
    return sourceType === "OPERATOR" && /^(?:#?\d{1,6}|#)\/\d{1,6}$/.test(normalizedComparableText(value));
  }

  const directCorpus = corpus.replace(/\b(?:19|20)\d{2}\s*\/\s*\d{2}\b/g, " ");
  const denominatorPattern = escapedPattern(denominator);
  const slashEvidence = new RegExp(`(?:^|[^0-9])(?:#|0*\\d{1,6})\\s*\\/\\s*0*${denominatorPattern}(?:$|[^0-9])`, "i");
  const numberedToEvidence = new RegExp(`\\b(?:NUMBERED|NUMBER|NO\\.?|LIMITED)\\s*(?:TO|OF|\\/)\\s*0*${denominatorPattern}\\b`, "i");
  if (!slashEvidence.test(directCorpus) && !numberedToEvidence.test(directCorpus)) return false;

  const numerator = normalizeStringOrNull(expanded.print_run_numerator);
  if (!numerator) return true;
  const fullPattern = new RegExp(
    `(?:^|[^0-9])#?0*${escapedPattern(numerator)}\\s*\\/\\s*0*${denominatorPattern}(?:$|[^0-9])`,
    "i"
  );
  return fullPattern.test(directCorpus);
}

function addPreingestionPrintRunEvidence(evidence, resolved, fieldName, value, patch = {}, images = []) {
  const expanded = expandPrintRunFields({
    [fieldName]: value,
    print_run_number: value,
    serial_number: value,
    numerical_rarity: value
  });
  const sourceValueMap = {
    print_run_number: expanded.print_run_number || value,
    serial_number: expanded.serial_number || expanded.print_run_number || value,
    numerical_rarity: expanded.print_run_number || value,
    print_run_numerator: expanded.print_run_numerator,
    print_run_denominator: expanded.print_run_denominator,
    numbered_to: expanded.numbered_to,
    serial_denominator: expanded.serial_denominator || expanded.print_run_denominator,
    expected_serial_denominator: expanded.expected_serial_denominator || expanded.print_run_denominator
  };
  Object.entries(sourceValueMap).forEach(([nextField, nextValue]) => {
    if (!hasEvidenceValue(nextValue)) return;
    addPreingestionEvidence(evidence, resolved, nextField, nextValue, patch, images);
  });
}

function addPreingestionGradeEvidence(evidence, resolved, value, patch = {}, images = []) {
  addPreingestionEvidence(evidence, resolved, "grade", value, patch, images);
  const parsed = resolveGradeFields({
    resolved: {},
    legacyFields: {
      title: value,
      model_title_suggestion: value,
      grade: value,
      grade_company: value
    }
  }).resolved || {};
  ["grade_company", "card_grade", "auto_grade", "grade_type"].forEach((fieldName) => {
    if (!hasEvidenceValue(parsed[fieldName]) || parsed[fieldName] === "UNKNOWN") return;
    addPreingestionEvidence(evidence, resolved, fieldName, parsed[fieldName], patch, images);
  });
}

function normalizePreingestionGradeCompany(value) {
  const text = normalizeStringOrNull(value)?.toUpperCase() || "";
  if (!text) return null;
  if (/\bBECKETT\b/.test(text)) return "BGS";
  if (/\bPSA\s*\/?\s*DNA\b/.test(text)) return "PSA/DNA";
  return text.match(/\b(PSA|BGS|CGC|SGC|TAG)\b/)?.[1] || null;
}

function normalizedAtomicGradeValue(fieldName, value) {
  if (fieldName === "grade_company") return normalizePreingestionGradeCompany(value);
  if (fieldName === "card_grade") return normalizeGradeValue(value);
  if (fieldName === "auto_grade") return normalizeAutoGradeValue(value);
  if (fieldName === "grade_type") {
    const normalized = normalizeGradeType(value);
    return normalized === "UNKNOWN" ? null : normalized;
  }
  return null;
}

function addPreingestionAtomicGradeEvidence(evidence, resolved, fieldName, value, patch = {}, images = []) {
  const normalized = normalizedAtomicGradeValue(fieldName, value);
  if (!normalized) return;
  addPreingestionEvidence(evidence, resolved, fieldName, normalized, patch, images);
}

function reconcilePreingestionGradeType(evidence, resolved, gradePatches = [], images = []) {
  const derivedGradeType = gradeTypeForValues(resolved.card_grade, resolved.auto_grade, resolved.grade_type);
  if (derivedGradeType === "UNKNOWN" || resolved.grade_type === derivedGradeType) return;
  const sourcePatch = gradePatches.find((entry) => ["card_grade", "auto_grade"].includes(entry.fieldName))?.patch
    || gradePatches[0]?.patch;
  if (!sourcePatch) return;
  addPreingestionEvidence(evidence, resolved, "grade_type", derivedGradeType, sourcePatch, images);
}

export function preingestionEvidenceDocumentFromPayload(payload = {}) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const initialEvidence = payload.preingestion_initial_evidence
    && typeof payload.preingestion_initial_evidence === "object"
    && !Array.isArray(payload.preingestion_initial_evidence)
    ? payload.preingestion_initial_evidence
    : {};
  const patches = [
    ...Object.values(initialEvidence),
    ...(Array.isArray(payload.preingestion_evidence_patches) ? payload.preingestion_evidence_patches : [])
  ].filter((patch) => patch && typeof patch === "object" && !Array.isArray(patch));
  if (!patches.length) return null;

  const evidence = {};
  const resolved = {};
  const retrievalContextEvidence = {};
  const retrievalContext = {};
  const skipped = [];
  const gradePatches = [];
  for (const patch of patches) {
    const fieldName = normalizePreingestionEvidenceFieldName(patch.field || patch.evidence_field);
    const rawValue = preingestionPatchValue(patch);
    const value = printedCodeEvidenceFields.has(fieldName)
      ? normalizePrintedCardCodeForFields(rawValue, resolved)
      : fieldName === "year" && rawValue
        ? rawValue.replace(/^((?:19|20)\d{2})\s*[-/]\s*(\d{2})$/, "$1-$2")
        : rawValue;
    if (!fieldName || !value) {
      skipped.push(patch.field || patch.evidence_field || "unknown");
      continue;
    }
    if (preingestionRetrievalContextFields.has(fieldName)) {
      if (!retrievalContextEvidenceIsDirect(fieldName, value, patch)) {
        skipped.push(`${fieldName}:direct_retrieval_context_evidence_missing`);
        continue;
      }
      addPreingestionEvidence(retrievalContextEvidence, retrievalContext, fieldName, value, patch, images);
      continue;
    }
    if (/^(?:print_run|serial|numerical_rarity)/.test(fieldName)) {
      if (!printRunEvidenceIsDirect(fieldName, value, patch)) {
        skipped.push(`${fieldName}:direct_print_run_evidence_missing`);
        continue;
      }
      addPreingestionPrintRunEvidence(evidence, resolved, fieldName, value, patch, images);
    } else if (printedCodeEvidenceFields.has(fieldName)) {
      if (!printedCodeEvidenceIsDirect(fieldName, value, patch)) {
        skipped.push(`${fieldName}:direct_printed_code_evidence_missing`);
        continue;
      }
      addPreingestionEvidence(evidence, resolved, fieldName, value, patch, images);
    } else if (fieldName === "grade") {
      addPreingestionGradeEvidence(evidence, resolved, value, patch, images);
      gradePatches.push({ fieldName, patch });
    } else if (["grade_company", "card_grade", "auto_grade", "grade_type"].includes(fieldName)) {
      addPreingestionAtomicGradeEvidence(evidence, resolved, fieldName, value, patch, images);
      gradePatches.push({ fieldName, patch });
    } else {
      addPreingestionEvidence(evidence, resolved, fieldName, value, patch, images);
    }
  }
  reconcilePreingestionGradeType(evidence, resolved, gradePatches, images);
  if (!Object.keys(evidence).length && !Object.keys(retrievalContextEvidence).length) return null;

  return {
    evidence,
    resolved,
    retrieval_context_evidence: retrievalContextEvidence,
    retrieval_context: retrievalContext,
    unresolved: [],
    recognition: null,
    resolution_trace: [{
      phase: "preingestion",
      step: "normalize_preingestion_evidence",
      input: {
        bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || null,
        patch_count: patches.length
      },
      output: {
        evidence_fields: Object.keys(evidence),
        retrieval_context_fields: Object.keys(retrievalContextEvidence),
        skipped_fields: skipped.slice(0, 12)
      },
      decision: "emit_current_image_hard_evidence",
      created_at: new Date().toISOString()
    }],
    schema_version: "preingestion-evidence-fields-v2"
  };
}

const preingestionRetrievalAnchorFields = new Set([
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code",
  "print_run_number",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "expected_serial_denominator"
]);

export function confirmedPreingestionRetrievalFields(payload = {}) {
  const document = preingestionEvidenceDocumentFromPayload(payload);
  if (!document) return {};
  return Object.fromEntries(
    Object.entries(document.evidence || {})
      .filter(([fieldName, field]) => (
        preingestionRetrievalAnchorFields.has(fieldName)
        && field?.status === "CONFIRMED"
        && Number(field?.confidence || 0) >= 0.86
        && (!Array.isArray(field?.conflicts) || field.conflicts.length === 0)
      ))
      .map(([fieldName, field]) => [fieldName, field.normalized_value ?? field.normalizedValue ?? field.value])
      .filter(([, value]) => hasEvidenceValue(value))
  );
}

export async function applyPreIngestionBundleToPayload(payload = {}, {
  timingContext = null,
  fetchImpl = globalThis.fetch,
  signal = null,
  preserveExistingImages = payload.v4_preserve_canonical_images_on_bundle_load === true
} = {}) {
  const bundleId = payload.preingestion_bundle_id || payload.preingestionBundleId;
  if (!bundleId) {
    return {
      applied: false,
      reason: "bundle_id_missing"
    };
  }

  const loaded = await timeAsync(timingContext, "preingestion_bundle_load_ms", () => readPreIngestionBundle({
    bundleId,
    tenantId: payload.tenant_id || payload.tenantId,
    env: process.env,
    fetchImpl,
    signal
  }));
  if (!loaded.found || !loaded.bundle) {
    payload.preingestion_bundle_id = bundleId;
    payload.preingestion_bundle_used = false;
    payload.preingestion_bundle_status = loaded.reason || "bundle_not_found";
    payload.preingestion_summary = {
      bundle_id: bundleId,
      status: payload.preingestion_bundle_status,
      found: false
    };
    return {
      applied: false,
      reason: loaded.reason || "bundle_not_found"
    };
  }

  const bundle = loaded.bundle;
  const bundleImages = imagesFromPreIngestionBundle(bundle);
  const existingImages = Array.isArray(payload.images) ? payload.images : [];
  payload.preingestion_bundle_id = bundle.bundle_id;
  payload.preingestionBundleId = bundle.bundle_id;
  payload.preingestion_bundle = bundle;
  payload.preingestion_bundle_used = true;
  payload.preingestion_bundle_status = bundle.status || "READY";
  payload.preingestion_summary = summarizePreIngestionBundle(bundle);
  payload.preingestion_initial_evidence = bundle.initial_evidence || {};
  payload.preingestion_evidence_patches = currentPreingestionEvidencePatches(bundle.evidence_patches);
  payload.images = preserveExistingImages && existingImages.length > 0
    ? existingImages
    : bundleImages;

  if (!payload.asset_id && bundle.asset_id) payload.asset_id = bundle.asset_id;
  if (!payload.assetId && bundle.asset_id) payload.assetId = bundle.asset_id;
  if (!payload.capture_quality && bundle.quality_summary?.capture_quality) {
    payload.capture_quality = bundle.quality_summary.capture_quality;
  }
  if (!payload.captureQuality && bundle.quality_summary?.capture_quality) {
    payload.captureQuality = bundle.quality_summary.capture_quality;
  }

  return {
    applied: true,
    bundle,
    image_count: bundleImages.length
  };
}

export function applyPreIngestionEvidencePatchesToPayload(payload = {}, rawPatches = [], {
  source = "in_memory_snapshot"
} = {}) {
  const previousCount = Array.isArray(payload.preingestion_evidence_patches)
    ? payload.preingestion_evidence_patches.length
    : 0;
  const safeRawPatches = Array.isArray(rawPatches) ? rawPatches : [];
  const patches = currentPreingestionEvidencePatches(safeRawPatches);
  payload.preingestion_evidence_patches = patches;
  return {
    refreshed: true,
    source,
    patch_count: patches.length,
    raw_patch_count: safeRawPatches.length,
    stale_ocr_patch_count: safeRawPatches.length - patches.length,
    added_patch_count: Math.max(0, patches.length - previousCount)
  };
}

// OCR runs beside the provider call. Refresh only the evidence payload after
// the provider finishes so late hard-text patches can participate in the same
// resolver/render pass without replacing signed images or delaying model start.
export async function refreshPreIngestionEvidencePatches(payload = {}, {
  timingContext = null,
  fetchImpl = globalThis.fetch,
  timingKey = "preingestion_evidence_refresh_ms"
} = {}) {
  const bundleId = payload.preingestion_bundle_id || payload.preingestionBundleId;
  if (!bundleId) return { refreshed: false, reason: "bundle_id_missing", patch_count: 0, added_patch_count: 0 };

  const loaded = await timeAsync(timingContext, timingKey, () => readPreIngestionBundle({
    bundleId,
    tenantId: payload.tenant_id || payload.tenantId,
    env: process.env,
    fetchImpl
  }));
  if (!loaded.found || !loaded.bundle) {
    return { refreshed: false, reason: loaded.reason || "bundle_not_found", patch_count: 0, added_patch_count: 0 };
  }

  const rawPatches = Array.isArray(loaded.bundle.evidence_patches) ? loaded.bundle.evidence_patches : [];
  const patchResult = applyPreIngestionEvidencePatchesToPayload(payload, rawPatches, {
    source: "bundle_refresh"
  });
  payload.preingestion_initial_evidence = loaded.bundle.initial_evidence || payload.preingestion_initial_evidence || {};
  payload.preingestion_summary = summarizePreIngestionBundle(loaded.bundle);
  payload.preingestion_bundle_status = loaded.bundle.status || payload.preingestion_bundle_status || "READY";

  return {
    ...patchResult,
    source: "bundle_refresh"
  };
}
