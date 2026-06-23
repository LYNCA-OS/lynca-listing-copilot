import { captureSurfaceTypes, criticalRegionStatus, glareRoutes } from "./quality-gate.mjs";

const defaultEnabled = true;
const identityBlockingRegions = Object.freeze([
  "subject_name",
  "year_product",
  "card_type"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(normalizeText(value).toLowerCase());
}

function falsy(value) {
  return ["0", "false", "no", "off"].includes(normalizeText(value).toLowerCase());
}

function qualityGateEnabled(env = process.env) {
  const explicit = env.LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED
    ?? env.LISTING_PREPROVIDER_RESCAN_GATE_ENABLED;
  if (explicit === undefined || explicit === null || explicit === "") return defaultEnabled;
  if (falsy(explicit)) return false;
  return truthy(explicit);
}

function collectRegionNames(captureQuality = {}) {
  const names = new Set();
  if (Array.isArray(captureQuality.unresolved_regions)) {
    captureQuality.unresolved_regions.forEach((name) => names.add(normalizeText(name)));
  }

  Object.entries(captureQuality.critical_region_occlusion || {}).forEach(([name, detail]) => {
    if (detail?.status === criticalRegionStatus.OCCLUDED || detail?.status === "OCCLUDED") {
      names.add(normalizeText(name));
    }
  });

  return [...names].filter(Boolean);
}

function slabLike(captureQuality = {}) {
  if (captureQuality.capture_surface_type === captureSurfaceTypes.SLAB) return true;
  if (Array.isArray(captureQuality.images)) {
    return captureQuality.images.some((quality) => quality?.capture_surface_type === captureSurfaceTypes.SLAB);
  }
  return false;
}

function blockingRegionsForQuality(captureQuality = {}) {
  const occludedRegions = collectRegionNames(captureQuality);
  return occludedRegions.filter((region) => {
    if (identityBlockingRegions.includes(region)) return true;
    return region === "grade_label" && slabLike(captureQuality);
  });
}

export function evaluatePreProviderRescanGate({
  captureQuality = {},
  env = process.env
} = {}) {
  if (!qualityGateEnabled(env)) {
    return {
      blocked: false,
      reason: "pre_provider_rescan_gate_disabled",
      route: "CONTINUE"
    };
  }

  const route = captureQuality.route || captureQuality.glare_route || "";
  if (route !== glareRoutes.TARGETED_RESCAN_REQUIRED) {
    return {
      blocked: false,
      reason: "capture_quality_does_not_require_rescan",
      route: route || "CONTINUE"
    };
  }

  const blockingRegions = blockingRegionsForQuality(captureQuality);
  if (!blockingRegions.length) {
    return {
      blocked: false,
      reason: "non_identity_region_occluded",
      route,
      occluded_regions: collectRegionNames(captureQuality)
    };
  }

  return {
    blocked: true,
    reason: "identity_critical_region_occluded_before_provider",
    route: glareRoutes.TARGETED_RESCAN_REQUIRED,
    blocking_regions: blockingRegions,
    occluded_regions: collectRegionNames(captureQuality),
    capture_profile_id: captureQuality.capture_profile_id || null
  };
}

