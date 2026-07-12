// Preingestion evidence stage — extracted from the v2 monolith
// (docs/REFORM_PLAN.md R1, "evidence assembly"). Copied verbatim and
// delegated; behavior must stay bit-identical.
import { createEvidenceField, createVisionSource } from "../evidence/evidence-schema.mjs";
import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { resolveGradeFields } from "../resolver/grade-resolver.mjs";
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
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code",
  "cert_number"
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
  slab_cert_candidate: "cert_number"
}));

export function normalizePreingestionEvidenceFieldName(fieldName = "") {
  const normalized = normalizeStringOrNull(fieldName)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized) return null;
  const field = preingestionFieldAliases.get(normalized) || normalized;
  return preingestionHardEvidenceFields.has(field) ? field : null;
}

function preingestionEvidenceSourceType(sourceType = "", fieldName = "") {
  const normalized = normalizeStringOrNull(sourceType)?.toUpperCase() || "";
  if (!normalized) return null;
  if (normalized.includes("SLAB") || normalized.includes("GRADE_LABEL")) return "SLAB_LABEL";
  if (normalized.includes("CARD_FRONT")) return "CARD_FRONT";
  if (normalized.includes("CARD_BACK")) return "CARD_BACK";
  if (normalized.includes("OCR") || normalized.includes("PADDLE")) return "OCR";
  if (normalized.includes("OPERATOR")) return "OPERATOR";
  if (normalized.includes("PREINGESTION") && /^(?:print_run|serial|card_number|tcg_card_number|collector_number|checklist_code)/.test(fieldName)) return "OCR";
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

export function preingestionEvidenceSourceForPatch(patch = {}, fieldName = "") {
  const sourceType = preingestionEvidenceSourceType(patch.source_type || patch.sourceType, fieldName);
  const imageId = normalizeStringOrNull(patch.source_image_id || patch.sourceImageId || patch.image_id || patch.imageId);
  if (!sourceType || !imageId) return null;
  return createVisionSource({
    sourceType,
    imageId,
    sourceCropId: normalizeStringOrNull(patch.crop_id || patch.cropId || patch.source_crop_id || patch.sourceCropId),
    side: sourceType === "CARD_BACK" ? "back" : sourceType === "CARD_FRONT" ? "front" : null,
    captureRole: "preingestion_evidence",
    region: normalizeStringOrNull(patch.provenance?.region || patch.provenance?.source_region || patch.crop_type || patch.cropType),
    observedText: preingestionPatchValue(patch),
    rawText: normalizeStringOrNull(patch.raw_text || patch.rawText) || preingestionPatchValue(patch),
    sourceInferenceMethod: "preingestion_evidence_bundle",
    sourceObjectPath: normalizeStringOrNull(patch.provenance?.source_object_path || patch.source_object_path),
    derivedObjectPath: normalizeStringOrNull(patch.provenance?.derived_object_path || patch.derived_object_path),
    trustTier: sourceType === "SLAB_LABEL" || sourceType === "OCR" ? 1 : 2
  });
}

function createPreingestionEvidenceField(fieldName, value, patch = {}) {
  if (!fieldName || !hasEvidenceValue(value) || !validPreingestionFieldValue(fieldName, value)) return null;
  const source = preingestionEvidenceSourceForPatch(patch, fieldName);
  if (!source) return null;
  const confidence = preingestionPatchFieldConfidence(patch, value);
  const candidates = [{ value, confidence, sources: [source] }];
  if (Array.isArray(patch.text_candidates) || Array.isArray(patch.textCandidates)) {
    for (const candidate of (patch.text_candidates || patch.textCandidates || [])) {
      const candidateValue = normalizeStringOrNull(typeof candidate === "object" ? candidate.value || candidate.text : candidate);
      if (!candidateValue || candidateValue === value) continue;
      candidates.push({
        value: candidateValue,
        confidence: clampPreingestionConfidence(typeof candidate === "object" ? candidate.confidence : null, Math.max(0.5, confidence - 0.12)),
        sources: [source]
      });
    }
  }
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

function addPreingestionEvidence(evidence, resolved, fieldName, value, patch = {}) {
  const field = createPreingestionEvidenceField(fieldName, value, patch);
  if (!field) return;
  evidence[fieldName] = evidence[fieldName]
    ? mergeEvidenceField(fieldName, [evidence[fieldName], field])
    : field;
  if (hasEvidenceValue(value)) resolved[fieldName] = value;
}

function addPreingestionPrintRunEvidence(evidence, resolved, fieldName, value, patch = {}) {
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
    addPreingestionEvidence(evidence, resolved, nextField, nextValue, patch);
  });
}

function addPreingestionGradeEvidence(evidence, resolved, value, patch = {}) {
  addPreingestionEvidence(evidence, resolved, "grade", value, patch);
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
    addPreingestionEvidence(evidence, resolved, fieldName, parsed[fieldName], patch);
  });
}

export function preingestionEvidenceDocumentFromPayload(payload = {}) {
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
  const skipped = [];
  for (const patch of patches) {
    const fieldName = normalizePreingestionEvidenceFieldName(patch.field || patch.evidence_field);
    const value = preingestionPatchValue(patch);
    if (!fieldName || !value) {
      skipped.push(patch.field || patch.evidence_field || "unknown");
      continue;
    }
    if (/^(?:print_run|serial|numerical_rarity)/.test(fieldName)) {
      addPreingestionPrintRunEvidence(evidence, resolved, fieldName, value, patch);
    } else if (/^grade/.test(fieldName)) {
      addPreingestionGradeEvidence(evidence, resolved, value, patch);
    } else {
      addPreingestionEvidence(evidence, resolved, fieldName, value, patch);
    }
  }
  if (!Object.keys(evidence).length) return null;

  return {
    evidence,
    resolved,
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
        skipped_fields: skipped.slice(0, 12)
      },
      decision: "emit_current_image_hard_evidence",
      created_at: new Date().toISOString()
    }],
    schema_version: "preingestion-evidence-fields-v1"
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
  fetchImpl = globalThis.fetch
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
    env: process.env,
    fetchImpl
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
  payload.preingestion_bundle_id = bundle.bundle_id;
  payload.preingestionBundleId = bundle.bundle_id;
  payload.preingestion_bundle = bundle;
  payload.preingestion_bundle_used = true;
  payload.preingestion_bundle_status = bundle.status || "READY";
  payload.preingestion_summary = summarizePreIngestionBundle(bundle);
  payload.preingestion_initial_evidence = bundle.initial_evidence || {};
  payload.preingestion_evidence_patches = currentPreingestionEvidencePatches(bundle.evidence_patches);
  payload.images = bundleImages;

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
