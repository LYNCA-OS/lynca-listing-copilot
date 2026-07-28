import { extractAnchorDossier } from "./anchor-extractor.mjs";
import { planAnchorRoute } from "./anchor-router.mjs";
import { preL2AnchorInputTrace } from "./anchor-input-trace.mjs";

export const anchorRouteLateShadowVersion = "v4-anchor-route-late-shadow-v1";

const providerContextFields = Object.freeze(["year", "product", "players"]);
const directCurrentImageSourceTypes = new Set(["CARD_FRONT", "CARD_BACK", "OCR", "SLAB_LABEL"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function booleanFlag(value) {
  if (typeof value === "boolean") return value;
  const normalized = clean(value).toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

export function postRendezvousAnchorExecutionSummary(rendezvous = {}) {
  const candidates = [
    rendezvous?.sweep?.execution_summary,
    rendezvous?.execution_summary
  ].filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  if (!candidates.length) return null;
  const rowCount = (candidate) => Math.max(
    Number(candidate.evidence_job_observability_count || 0),
    Array.isArray(candidate.evidence_job_observability) ? candidate.evidence_job_observability.length : 0
  );
  // Sweep wins a tie because it is the newer view; a persisted merged summary
  // wins whenever it contains more of the multi-wave OCR history.
  return candidates.reduce((best, candidate) => rowCount(candidate) > rowCount(best) ? candidate : best);
}

export function anchorRouteLateShadowEnabled({ payload = {}, env = process.env } = {}) {
  const options = payload.provider_options && typeof payload.provider_options === "object"
    ? payload.provider_options
    : payload.providerOptions && typeof payload.providerOptions === "object"
      ? payload.providerOptions
      : {};
  for (const value of [
    options.enable_anchor_route_late_shadow,
    env.ENABLE_ANCHOR_ROUTE_LATE_SHADOW
  ]) {
    const explicit = booleanFlag(value);
    if (explicit !== null) return explicit;
  }
  const profile = clean(
    options.recognition_benchmark_profile
      || payload.recognition_benchmark_profile
      || payload.benchmark_profile
  ).toLowerCase();
  const traceLevel = clean(options.trace_level || payload.trace_level).toLowerCase();
  return ["cold_algorithm", "cold_algorithm_benchmark"].includes(profile)
    && traceLevel === "evaluation";
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return value !== null && value !== undefined && clean(value) !== "";
}

function currentImageIds(payload = {}) {
  return new Set((Array.isArray(payload.images) ? payload.images : [])
    .flatMap((image) => [image?.id, image?.image_id, image?.imageId])
    .map(clean)
    .filter(Boolean));
}

function fieldValue(field = {}) {
  return field.normalized_value ?? field.normalizedValue ?? field.value ?? null;
}

function directCurrentImageSource(field = {}, imageIds = new Set()) {
  return (Array.isArray(field.sources) ? field.sources : []).find((source) => {
    const sourceType = clean(source?.source_type || source?.sourceType).toUpperCase();
    const imageId = clean(source?.image_id || source?.imageId || source?.source_image_id || source?.sourceImageId);
    return source?.direct_observation === true
      && directCurrentImageSourceTypes.has(sourceType)
      && (!imageIds.size || (imageId && imageIds.has(imageId)));
  }) || null;
}

export function postProviderContextShadowPatches(result = {}, payload = {}) {
  const evidence = result.normalized_evidence || result.evidence || {};
  const imageIds = currentImageIds(payload);
  const patches = [];
  for (const fieldName of providerContextFields) {
    const field = evidence?.[fieldName];
    const value = fieldValue(field);
    const status = clean(field?.status).toUpperCase();
    const confidence = Number(field?.confidence || 0);
    const source = directCurrentImageSource(field, imageIds);
    if (!hasValue(value)
      || !["CONFIRMED", "MANUAL_CONFIRMED"].includes(status)
      || confidence < 0.86
      || !source) {
      continue;
    }
    patches.push(Object.freeze({
      field: fieldName,
      value,
      confidence,
      source_type: source.source_type,
      source_image_id: source.image_id || source.source_image_id,
      crop_id: source.source_crop_id || null,
      provenance: Object.freeze({
        decision_scope: "POST_PROVIDER_ROUTE_SHADOW_ONLY",
        source_inference_method: source.source_inference_method || null,
        crop_type: source.region || source.capture_role || null
      })
    }));
  }
  return Object.freeze(patches);
}

function routeSnapshot(payload = {}, { executionSummary } = {}) {
  const dossier = extractAnchorDossier(payload);
  const plan = planAnchorRoute(dossier);
  const anchors = Array.isArray(dossier.anchors) ? dossier.anchors : [];
  return Object.freeze({
    plan: Object.freeze({
      route: plan.route,
      reason: plan.reason,
      primary_anchor_type: plan.primary_anchor?.anchor_type || null,
      lookup_target: plan.lookup_target || null,
      allow_identity_finalize: plan.allow_identity_finalize === true,
      context_dimensions: Number(plan.context_dimensions || 0),
      direct_context_dimensions: Number(plan.direct_context_dimensions || 0)
    }),
    anchor_count: anchors.length,
    direct_anchor_count: anchors.filter((anchor) => anchor?.direct === true).length,
    input_trace: preL2AnchorInputTrace(payload, dossier, plan, { executionSummary })
  });
}

// Runs after the Provider/OCR rendezvous and performs no lookup. The strict
// snapshot answers whether direct OCR arrived too late for the pre-L2 probe.
// The counterfactual additionally asks whether already-paid, current-image,
// direct Provider context would have made a sports route structurally viable.
// It is explicitly ineligible for a fast final because the Provider has
// already run; neither snapshot is written back into payload.v4_anchor_probe.
export function buildPostRefreshAnchorRouteShadow({
  payload = {},
  result = {},
  executionSummary
} = {}) {
  const strict = routeSnapshot(payload, { executionSummary });
  const contextPatches = postProviderContextShadowPatches(result, payload);
  const counterfactualPayload = {
    ...payload,
    resolved: {},
    resolvedHint: {},
    resolved_hint: {},
    preingestion_evidence_patches: [
      ...(Array.isArray(payload.preingestion_evidence_patches) ? payload.preingestion_evidence_patches : []),
      ...contextPatches
    ]
  };
  const counterfactual = routeSnapshot(counterfactualPayload, { executionSummary });
  return Object.freeze({
    schema_version: anchorRouteLateShadowVersion,
    mode: "ROUTE_ONLY_SHADOW",
    fast_final_eligible: false,
    strict_post_refresh: strict,
    post_provider_context_counterfactual: Object.freeze({
      ...counterfactual,
      provider_context_patch_fields: Object.freeze(contextPatches.map((patch) => patch.field)),
      provider_already_called: true,
      fast_path_eligible: false
    }),
    effects: Object.freeze({
      catalog_lookup: false,
      provider_skip: false,
      resolver: false,
      renderer: false,
      production_title: false
    })
  });
}
