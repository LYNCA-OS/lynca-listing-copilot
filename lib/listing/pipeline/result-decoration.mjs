// Result decoration stage (merge + request metadata) — extracted from
// the v2 monolith (R1). Copied verbatim; behavior must stay bit-identical.
import crypto from "node:crypto";
import { createEvidenceField, createVisionSource } from "../evidence/evidence-schema.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { hasRecognitionEvidence } from "../recognition/recognition-evidence-normalizer.mjs";
import { defaultCaptureProfileId } from "../image-quality/quality-gate.mjs";
import { hasEvidenceValue, mergeEvidenceField } from "./evidence-merge.mjs";
import { preingestionEvidenceDocumentFromPayload } from "./preingestion-evidence.mjs";
import { captureQualityForPayload } from "./provider-prompt.mjs";

const defaultMaxTitleLength = 80;

function providerLotCountAfterIndependentDetection(result = {}, recognitionEvidenceDocument = null) {
  if (recognitionEvidenceDocument?.resolved?.multi_card !== true) return null;
  const rejection = (result.provider_field_rejections || []).find((item) => (
    item?.reason === "separate_physical_cards_not_directly_observed"
  ));
  const count = Number(rejection?.value?.card_count);
  if (!Number.isInteger(count) || count < 2 || count > 100) return null;

  const evidence = rejection?.rejected_evidence?.card_count
    || rejection?.rejected_evidence?.multi_card
    || null;
  const signal = [
    evidence?.visible_text,
    evidence?.raw_text,
    evidence?.source_region,
    evidence?.evidence_kind
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  const explicitCount = new RegExp(`(?:^|\\D)${count}(?:\\D|$)`).test(signal);
  const directObservation = evidence?.directly_observed === true || evidence?.direct_observation === true;
  if (!directObservation || !explicitCount) return null;

  const confidence = Math.min(0.75, Math.max(0.5, Number(evidence?.confidence || 0.65)));
  const source = {
    ...createVisionSource({
      sourceType: "VISION_MODEL",
      imageId: evidence?.source_image_id || null,
      region: evidence?.source_region || "multi_card_layout",
      observedText: evidence?.visible_text || `${count} separate cards`,
      rawText: evidence?.raw_text || evidence?.visible_text || null,
      sourceInferenceMethod: "provider_count_after_independent_plurality_detection",
      trustTier: 10
    }),
    review_required: true
  };

  return {
    evidence: {
      card_count: createEvidenceField({
        value: count,
        status: "REVIEW",
        confidence,
        sources: [source],
        unresolvedReason: "writer_must_confirm_lot_quantity"
      })
    },
    resolved: {
      card_count: count,
      lot_type: rejection?.value?.lot_type || "multi_card_lot"
    }
  };
}

export function mergeEvidenceMaps(...maps) {
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

export function mergeResolvedFields(...resolvedDocuments) {
  const merged = {};
  resolvedDocuments.forEach((resolved) => {
    Object.entries(resolved || {}).forEach(([field, value]) => {
      if (!hasEvidenceValue(value)) return;
      merged[field] = value;
    });
  });
  return merged;
}

export function withRecognitionEvidence(result, recognitionEvidenceDocument = null, payload = {}) {
  const preingestionEvidenceDocument = preingestionEvidenceDocumentFromPayload(payload);
  const evidenceDocuments = [
    hasRecognitionEvidence(recognitionEvidenceDocument) ? recognitionEvidenceDocument : null,
    hasRecognitionEvidence(preingestionEvidenceDocument) ? preingestionEvidenceDocument : null
  ].filter(Boolean);
  if (!evidenceDocuments.length) return result;
  const providerLotCount = providerLotCountAfterIndependentDetection(result, recognitionEvidenceDocument);

  const evidence = mergeEvidenceMaps(
    ...evidenceDocuments.map((document) => document.evidence),
    providerLotCount?.evidence,
    result.evidence
  );
  const resolved = mergeResolvedFields(
    ...evidenceDocuments.map((document) => document.resolved),
    providerLotCount?.resolved,
    result.resolved,
    preingestionEvidenceDocument?.resolved
  );
  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || payload.max_title_length || defaultMaxTitleLength,
    serialNumeratorVerified: payload.serial_numerator_verified ?? payload.serialNumeratorVerified ?? null
  });

  const unresolved = [
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...evidenceDocuments.flatMap((document) => Array.isArray(document.unresolved) ? document.unresolved : [])
  ].filter((item, index, items) => {
    if (resolved.multi_card === true && String(item || "").trim() === "multi_card") return false;
    return items.indexOf(item) === index;
  }).slice(0, 16);

  return {
    ...result,
    fields: {
      ...(result.fields || {}),
      multi_card: resolved.multi_card === true,
      card_count: resolved.card_count || null,
      lot_type: resolved.lot_type || null
    },
    evidence,
    resolved,
    rendered_title: presentation.rendered_title || result.rendered_title || "",
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    recognition_preflight: recognitionEvidenceDocument?.recognition || null,
    preingestion_evidence_applied: hasRecognitionEvidence(preingestionEvidenceDocument),
    unresolved,
    resolution_trace: [
      ...evidenceDocuments.flatMap((document) => Array.isArray(document.resolution_trace) ? document.resolution_trace : []),
      ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : [])
    ]
  };
}

export function withRequestMetadata(result, payload) {
  return {
    ...result,
    asset_id: payload.assetId || payload.asset_id || `asset_${crypto.randomUUID()}`,
    analysis_run_id: payload.analysisRunId || payload.analysis_run_id || `analysis_${crypto.randomUUID()}`,
    capture_profile_id: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
    capture_quality: captureQualityForPayload(payload)
  };
}
