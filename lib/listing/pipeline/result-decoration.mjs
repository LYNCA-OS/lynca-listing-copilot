// Result decoration stage (merge + request metadata) — extracted from
// the v2 monolith (R1). Copied verbatim; behavior must stay bit-identical.
import crypto from "node:crypto";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { hasRecognitionEvidence } from "../recognition/recognition-evidence-normalizer.mjs";
import { defaultCaptureProfileId } from "../image-quality/quality-gate.mjs";
import { hasEvidenceValue, mergeEvidenceField } from "./evidence-merge.mjs";
import { preingestionEvidenceDocumentFromPayload } from "./preingestion-evidence.mjs";
import { captureQualityForPayload } from "./provider-prompt.mjs";

const defaultMaxTitleLength = 80;

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

  const evidence = mergeEvidenceMaps(
    ...evidenceDocuments.map((document) => document.evidence),
    result.evidence
  );
  const resolved = mergeResolvedFields(
    ...evidenceDocuments.map((document) => document.resolved),
    result.resolved,
    preingestionEvidenceDocument?.resolved
  );
  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || payload.max_title_length || defaultMaxTitleLength,
    serialNumeratorVerified: payload.serial_numerator_verified ?? payload.serialNumeratorVerified ?? null
  });

  return {
    ...result,
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
    unresolved: [
      ...(Array.isArray(result.unresolved) ? result.unresolved : []),
      ...evidenceDocuments.flatMap((document) => Array.isArray(document.unresolved) ? document.unresolved : [])
    ].slice(0, 16),
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
