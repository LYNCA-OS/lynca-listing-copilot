import { extractAnchorDossier, resolvedHintFromAnchorDossier } from "./anchor-extractor.mjs";
import { anchorRoutes, planAnchorRoute } from "./anchor-router.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../fast-scout/exact-anchor-finalize.mjs";

function now() {
  return Date.now();
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
  const result = {
    schema_version: "v4-pre-l2-anchor-probe-v1",
    dossier,
    plan,
    resolved_hint: resolvedHint,
    finalized: false,
    reason: plan.reason,
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
    policy: {
      allow_tcg_code_only: plan.route === anchorRoutes.TCG_EXACT_LOOKUP,
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
    timing: {
      extraction_ms: extractionMs,
      lookup_ms: lookupMs,
      total_ms: now() - startedAt
    }
  };
}
