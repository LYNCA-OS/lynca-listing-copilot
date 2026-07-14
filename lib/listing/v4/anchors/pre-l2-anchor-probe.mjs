import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "./anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "./anchor-router.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../fast-scout/exact-anchor-finalize.mjs";

function now() {
  return Date.now();
}

function countAnchorTypes(anchors = []) {
  return anchors.reduce((counts, anchor) => {
    const type = String(anchor?.anchor_type || "unknown");
    counts[type] = Number(counts[type] || 0) + 1;
    return counts;
  }, {});
}

export async function probePreL2Anchors({
  payload = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1600
} = {}) {
  const startedAt = now();
  const dossier = extractAnchorDossier(payload);
  const extractionMs = now() - startedAt;
  const plan = planAnchorRoute(dossier);
  const resolvedHint = resolvedHintFromAnchorDossier(dossier);
  const baseMetrics = {
    patch_count: Number(dossier.patch_count || 0),
    anchor_count: Array.isArray(dossier.anchors) ? dossier.anchors.length : 0,
    direct_anchor_count: Number(dossier.direct_anchor_count || 0),
    anchor_type_breakdown: countAnchorTypes(dossier.anchors || []),
    context_dimensions: Number(plan.context_dimensions || 0),
    direct_context_dimensions: Number(plan.direct_context_dimensions || 0),
    lookup_attempted: false,
    catalog_candidate_count: 0,
    trusted_candidate_count: 0,
    eligible_candidate_count: 0
  };
  const result = {
    schema_version: "v4-pre-l2-anchor-probe-v1",
    dossier,
    plan,
    resolved_hint: resolvedHint,
    finalized: false,
    reason: plan.reason,
    metrics: baseMetrics,
    timing: {
      extraction_ms: extractionMs,
      lookup_ms: 0,
      total_ms: extractionMs
    }
  };

  if (![anchorRoutes.TCG_EXACT_LOOKUP, anchorRoutes.SPORTS_COMPOSITE_LOOKUP, anchorRoutes.CERT_VERIFY].includes(plan.route)) {
    return result;
  }

  const lookupStartedAt = now();
  const finalize = await maybeFinalizeL1FromExactAnchor({
    scoutResult: {
      resolved_fields: resolvedHint,
      evidence: {},
      anchor_dossier: dossier
    },
    env,
    fetchImpl,
    timeoutMs,
    excludeSourceFeedbackIds: [payload.source_feedback_id || payload.sourceFeedbackId].filter(Boolean),
    policy: {
      allow_tcg_code_only: plan.route === anchorRoutes.TCG_EXACT_LOOKUP,
      allow_sports_product_key: plan.route === anchorRoutes.SPORTS_COMPOSITE_LOOKUP,
      allow_catalog_finalize: plan.allow_identity_finalize === true,
      allow_cert_lane: plan.route === anchorRoutes.CERT_VERIFY
    }
  }).catch((error) => ({
    finalized: false,
    reason: "anchor_probe_error",
    error: String(error?.message || error || "anchor_probe_error").slice(0, 180)
  }));
  const lookupMs = now() - lookupStartedAt;
  return {
    ...result,
    finalized: finalize?.finalized === true,
    reason: finalize?.reason || result.reason,
    finalize,
    metrics: {
      ...baseMetrics,
      lookup_attempted: finalize?.catalog_lookup_attempted === true
        || plan.route === anchorRoutes.CERT_VERIFY,
      catalog_candidate_count: Number(finalize?.catalog_candidate_count || 0),
      trusted_candidate_count: Number(finalize?.trusted_candidate_count || 0),
      eligible_candidate_count: Number(finalize?.eligible_candidate_count || 0)
    },
    timing: {
      extraction_ms: extractionMs,
      lookup_ms: lookupMs,
      total_ms: now() - startedAt
    }
  };
}
