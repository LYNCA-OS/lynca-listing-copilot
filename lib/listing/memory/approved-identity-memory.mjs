import { createEvidenceField, normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { resolvedFieldsToLegacyFields } from "../evidence/provider-evidence-normalizer.mjs";
import { buildAssetFingerprint, extractAssetImagePaths } from "../feedback/review-records.mjs";

export const approvedIdentityMemorySource = "internal_approved_history";
export const approvedIdentityMemoryRoute = "APPROVED_IDENTITY_MEMORY";

function hasValue(value, fieldName = "") {
  if (fieldName === "grade_type") return Boolean(value && value !== "UNKNOWN");
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && value !== "";
}

function observedText(value) {
  if (Array.isArray(value)) return value.join(" / ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

function approvedHistorySource(record = {}, assetFingerprint = "") {
  return {
    source_type: "INTERNAL_APPROVED_HISTORY",
    image_id: null,
    side: null,
    capture_role: null,
    region: null,
    observed_text: record.final_title || record.title || record.corrected_title || "",
    glare_occlusion: null,
    blur_score: null,
    trust_tier: 1,
    review_id: record.id || null,
    asset_id: record.asset_id || null,
    analysis_run_id: record.analysis_run_id || null,
    asset_fingerprint: assetFingerprint || record.asset_fingerprint || "",
    approved_at: record.approved_at || null,
    training_status: record.training_status || null
  };
}

export function payloadAssetFingerprint(payload = {}) {
  const imagePaths = extractAssetImagePaths(payload.images || payload.asset_images || [], payload);
  return {
    asset_fingerprint: buildAssetFingerprint(imagePaths),
    image_paths: imagePaths
  };
}

export function approvedHistoryRecordToEvidenceDocument(record = {}, {
  assetFingerprint = ""
} = {}) {
  const resolved = normalizeResolvedFields(record.fields || record.corrected_resolved_fields || record.correctedResolvedFields || {});
  const source = approvedHistorySource(record, assetFingerprint);
  const evidence = {};

  Object.entries(resolved).forEach(([field, value]) => {
    if (!hasValue(value, field)) return;
    evidence[field] = createEvidenceField({
      value,
      normalizedValue: value,
      status: "MANUAL_CONFIRMED",
      confidence: 0.98,
      sources: [
        {
          ...source,
          observed_text: observedText(value)
        }
      ]
    });
  });

  return {
    evidence,
    resolved,
    unresolved: [],
    model_title_suggestion: "",
    schema_version: "evidence-fields-v1"
  };
}

export function approvedHistoryRecordToListingResult({
  record = {},
  payload = {},
  assetFingerprint = "",
  imagePaths = {},
  latencyMs = 0
} = {}) {
  const evidenceDocument = approvedHistoryRecordToEvidenceDocument(record, { assetFingerprint });
  const legacyFields = resolvedFieldsToLegacyFields(evidenceDocument.resolved);
  const title = record.final_title || record.title || record.corrected_title || "";

  return {
    title,
    final_title: title,
    rendered_title: "",
    model_title_suggestion: "",
    title_render_source: "approved_identity_memory",
    confidence: "HIGH",
    reason: "Exact asset fingerprint matched a previously approved identity record.",
    fields: legacyFields,
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    evidence_schema_version: evidenceDocument.schema_version,
    unresolved: [],
    source: approvedIdentityMemorySource,
    provider: approvedIdentityMemorySource,
    route: approvedIdentityMemoryRoute,
    route_reason: "Exact approved-history fingerprint match; skipped vision provider.",
    asset_id: payload.assetId || payload.asset_id || record.asset_id || null,
    analysis_run_id: payload.analysisRunId || payload.analysis_run_id || `analysis_memory_${record.id || assetFingerprint || "hit"}`,
    capture_profile_id: payload.captureProfileId || payload.capture_profile_id || null,
    capture_quality: payload.captureQuality || payload.capture_quality || {},
    identity_memory: {
      cache_hit: true,
      source: "approved_history",
      review_id: record.id || null,
      asset_id: record.asset_id || null,
      analysis_run_id: record.analysis_run_id || null,
      asset_fingerprint: assetFingerprint || record.asset_fingerprint || "",
      approved_at: record.approved_at || null,
      training_status: record.training_status || null,
      image_paths: imagePaths
    },
    usage: {
      provider_calls: 0,
      retrieval_calls: 0,
      latency_ms: Math.max(0, Math.round(Number(latencyMs) || 0)),
      estimated_cost_usd: 0,
      resolution_rounds: 0
    },
    resolution_trace: [
      {
        phase: "identity_memory",
        step: "approved_history_exact_fingerprint",
        input: {
          asset_fingerprint: assetFingerprint || record.asset_fingerprint || ""
        },
        output: {
          cache_hit: true,
          review_id: record.id || null,
          source_type: "INTERNAL_APPROVED_HISTORY"
        },
        decision: "reuse_approved_identity",
        created_at: new Date().toISOString()
      }
    ]
  };
}

export async function lookupApprovedIdentityMemory({
  payload = {},
  enabled = false,
  loadApprovedRecords = null,
  verifyImages = null,
  requireVerifiedStorage = true
} = {}) {
  if (!enabled) {
    return { hit: false, reason: "approved_identity_memory_disabled" };
  }

  const { asset_fingerprint: assetFingerprint, image_paths: imagePaths } = payloadAssetFingerprint(payload);
  if (!assetFingerprint) {
    return { hit: false, reason: "asset_fingerprint_unavailable", image_paths: imagePaths };
  }

  if (requireVerifiedStorage && !imagePaths.front_object_path && !imagePaths.back_object_path) {
    return {
      hit: false,
      reason: "verified_storage_path_required",
      asset_fingerprint: assetFingerprint,
      image_paths: imagePaths
    };
  }

  if (typeof verifyImages === "function") {
    const verified = await verifyImages({ payload, imagePaths, assetFingerprint });
    if (verified?.ok === false) {
      return {
        hit: false,
        reason: verified.reason || "storage_verification_failed",
        asset_fingerprint: assetFingerprint,
        image_paths: imagePaths
      };
    }
  }

  if (typeof loadApprovedRecords !== "function") {
    return {
      hit: false,
      reason: "approved_identity_loader_unavailable",
      asset_fingerprint: assetFingerprint,
      image_paths: imagePaths
    };
  }

  const records = await loadApprovedRecords({
    assetFingerprint,
    limit: 3
  });
  const record = (Array.isArray(records) ? records : []).find((candidate) => {
    return candidate
      && candidate.asset_fingerprint === assetFingerprint
      && candidate.reusable_approved_title !== false
      && Object.keys(candidate.fields || candidate.corrected_resolved_fields || {}).length > 0;
  });

  if (!record) {
    return {
      hit: false,
      reason: "approved_identity_memory_miss",
      asset_fingerprint: assetFingerprint,
      image_paths: imagePaths
    };
  }

  return {
    hit: true,
    record,
    asset_fingerprint: assetFingerprint,
    image_paths: imagePaths
  };
}
