import crypto from "node:crypto";
import { anchorRoutes } from "./anchor-router.mjs";
import { anchorIsDirectEnough } from "./anchor-confidence.mjs";

const codePatchFields = new Set([
  "card_number",
  "card_number_candidate",
  "tcg_card_number",
  "collector_number",
  "checklist_code"
]);

const routableCodeAnchorTypes = new Set([
  "tcg_card_code",
  "checklist_code",
  "collector_number"
]);

const sportsDirectContextRoles = Object.freeze([
  "year_product_crop",
  "subject_crop"
]);

const terminalOcrJobStatuses = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function boundedReasonCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function patchRows(payload = {}) {
  const initial = payload.preingestion_initial_evidence && typeof payload.preingestion_initial_evidence === "object"
    ? Object.values(payload.preingestion_initial_evidence)
    : [];
  return [
    ...initial,
    ...(Array.isArray(payload.preingestion_evidence_patches) ? payload.preingestion_evidence_patches : [])
  ].filter((patch) => patch && typeof patch === "object" && !Array.isArray(patch));
}

function cropRole(value = {}) {
  return clean(value.role || value.crop_role || value.cropRole || value.crop_metadata?.crop_role).toLowerCase();
}

function executionSummary(payload = {}, override) {
  if (override !== undefined) {
    return override && typeof override === "object" && !Array.isArray(override)
      ? override
      : null;
  }
  return payload.preingestion_summary?.ocr_stage_execution
    || payload.preingestion_bundle?.quality_summary?.ocr_stage_execution
    || null;
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function terminalOcrJob(job = {}) {
  return terminalOcrJobStatuses.has(clean(job.status).toUpperCase());
}

function evidenceBoundaryObservable(job = {}) {
  return [
    "patch_count",
    "patches_appended",
    "evidence_produced",
    "evidence_outcome",
    "evidence_reason_codes",
    "normalized_field_count",
    "raw_text_present_count"
  ].some((key) => hasOwn(job, key));
}

function roleSet(rows = []) {
  return new Set(rows.map(cropRole).filter((role) => sportsDirectContextRoles.includes(role)));
}

// This module owns only compact, read-only diagnostics. Keeping it separate
// from the catalog-capable probe lets route-only shadows remain unable to
// perform lookup or finalize an identity by construction.
export function preL2AnchorInputTrace(payload = {}, dossier = {}, plan = {}, {
  executionSummary: executionSummaryOverride
} = {}) {
  const patches = patchRows(payload);
  const codePatches = patches.filter((patch) => {
    const field = clean(patch.field || patch.evidence_field).toLowerCase();
    const role = clean(patch.provenance?.crop_type || patch.crop_type || patch.cropType).toLowerCase();
    return codePatchFields.has(field) || /(?:card_code|collector_number|checklist_code|tcg_code)/.test(role);
  });
  const directCodeAnchors = (Array.isArray(dossier.anchors) ? dossier.anchors : [])
    .filter((anchor) => anchor?.direct === true && routableCodeAnchorTypes.has(anchor.anchor_type));
  const thresholdEligibleCodeAnchors = directCodeAnchors.filter((anchor) => anchorIsDirectEnough(
    anchor,
    anchor.anchor_type === "tcg_card_code" ? 0.84 : 0.82
  ));
  const cropPlan = Array.isArray(payload.preingestion_bundle?.crop_plan)
    ? payload.preingestion_bundle.crop_plan
    : [];
  const cardCodeCropAvailableCount = cropPlan.filter((crop) => cropRole(crop) === "card_code_crop").length;
  const directContextCropAvailableCount = cropPlan.filter((crop) => (
    sportsDirectContextRoles.includes(cropRole(crop))
  )).length;
  const summary = executionSummary(payload, executionSummaryOverride);
  const observableJobs = Array.isArray(summary?.evidence_job_observability)
    ? summary.evidence_job_observability
    : [];
  const cardCodeJobs = observableJobs.filter((job) => cropRole(job) === "card_code_crop");
  const directContextJobs = observableJobs.filter((job) => (
    sportsDirectContextRoles.includes(cropRole(job))
  ));
  const terminalDirectContextJobs = directContextJobs.filter(terminalOcrJob);
  const observableTerminalDirectContextJobs = terminalDirectContextJobs.filter(evidenceBoundaryObservable);
  const directContextPatches = patches.filter((patch) => sportsDirectContextRoles.includes(clean(
    patch.provenance?.crop_type || patch.crop_type || patch.cropType
  ).toLowerCase()));
  const observedDirectContextRoles = roleSet(directContextJobs);
  const terminalDirectContextRoles = roleSet(terminalDirectContextJobs);
  const observableTerminalDirectContextRoles = roleSet(observableTerminalDirectContextJobs);
  const patchProducingDirectContextRoles = new Set([
    ...observableTerminalDirectContextJobs
      .filter((job) => job.evidence_produced === true || Number(job.patch_count || 0) > 0)
      .map(cropRole),
    ...directContextPatches.map((patch) => clean(
      patch.provenance?.crop_type || patch.crop_type || patch.cropType
    ).toLowerCase())
  ].filter((role) => sportsDirectContextRoles.includes(role)));
  let sportsPreProviderReachability;
  const reasonCodes = [];

  if (!payload.preingestion_bundle && !payload.preingestion_summary) {
    reasonCodes.push("ANCHOR_INPUT_BUNDLE_SNAPSHOT_UNAVAILABLE");
  }
  if (cardCodeCropAvailableCount > 0) reasonCodes.push("CARD_CODE_CROP_AVAILABLE");
  else if (cropPlan.length > 0) reasonCodes.push("CARD_CODE_CROP_NOT_AVAILABLE");
  else reasonCodes.push("CARD_CODE_CROP_PLAN_UNOBSERVED");

  if (cardCodeJobs.some((job) => ["QUEUED", "RUNNING"].includes(clean(job.status).toUpperCase()))) {
    reasonCodes.push("CARD_CODE_JOB_NOT_TERMINAL_AT_PROBE");
  }
  if (cardCodeJobs.some((job) => clean(job.status).toUpperCase() === "FAILED")) {
    reasonCodes.push("CARD_CODE_JOB_FAILED");
  }
  for (const reason of cardCodeJobs.flatMap((job) => (
    Array.isArray(job.evidence_reason_codes) ? job.evidence_reason_codes : []
  ))) {
    if (clean(reason)) reasonCodes.push(clean(reason));
  }

  if (codePatches.length > 0) reasonCodes.push("CURRENT_IMAGE_CODE_PATCH_PRESENT");
  else reasonCodes.push("NO_CURRENT_CODE_PATCH");
  if (directCodeAnchors.length > 0) reasonCodes.push("TYPED_DIRECT_CODE_ANCHOR_PRESENT");
  else if (codePatches.length > 0) reasonCodes.push("CODE_PATCH_NOT_TYPED_AS_DIRECT_ANCHOR");
  else reasonCodes.push("NO_TYPED_DIRECT_CODE_ANCHOR");

  if (directCodeAnchors.length > 0 && thresholdEligibleCodeAnchors.length === 0) {
    reasonCodes.push("ANCHOR_BELOW_DIRECT_THRESHOLD");
  } else if (plan.route === anchorRoutes.NORMAL_L2 && thresholdEligibleCodeAnchors.length > 0) {
    reasonCodes.push("DIRECT_CONTEXT_MISSING");
  } else if ([anchorRoutes.TCG_EXACT_LOOKUP, anchorRoutes.SPORTS_COMPOSITE_LOOKUP, anchorRoutes.CERT_VERIFY].includes(plan.route)) {
    reasonCodes.push("ANCHOR_ROUTE_READY");
  }
  if (!summary) {
    reasonCodes.push("SPORTS_PRE_PROVIDER_JOB_PROFILE_UNCHECKED");
    sportsPreProviderReachability = "UNCHECKED_JOB_PROFILE";
  } else if (observedDirectContextRoles.size < sportsDirectContextRoles.length) {
    reasonCodes.push("SPORTS_DIRECT_CONTEXT_JOBS_NOT_OBSERVED");
    sportsPreProviderReachability = "CONTEXT_JOBS_NOT_OBSERVED";
  } else if (terminalDirectContextRoles.size < sportsDirectContextRoles.length) {
    reasonCodes.push("SPORTS_DIRECT_CONTEXT_JOBS_NOT_TERMINAL");
    sportsPreProviderReachability = "CONTEXT_JOBS_NOT_TERMINAL";
  } else if (observableTerminalDirectContextRoles.size < sportsDirectContextRoles.length) {
    reasonCodes.push("SPORTS_DIRECT_CONTEXT_EVIDENCE_UNOBSERVED");
    sportsPreProviderReachability = "CONTEXT_EVIDENCE_UNOBSERVED";
  } else if (patchProducingDirectContextRoles.size < sportsDirectContextRoles.length) {
    reasonCodes.push("SPORTS_DIRECT_CONTEXT_PATCH_NOT_PRODUCED");
    sportsPreProviderReachability = "CONTEXT_EVIDENCE_NOT_PRODUCED";
  } else {
    reasonCodes.push("SPORTS_DIRECT_CONTEXT_EVIDENCE_REACHABLE");
    sportsPreProviderReachability = "CONTEXT_EVIDENCE_REACHABLE";
  }

  const uniqueReasonCodes = [...new Set(reasonCodes.map(boundedReasonCode).filter(Boolean))];
  const retainedReasonCodes = uniqueReasonCodes.slice(0, 24);
  return Object.freeze({
    schema_version: "v4-pre-l2-anchor-input-trace-v1",
    execution_summary_source: executionSummaryOverride !== undefined
      ? "POST_RENDEZVOUS_OVERRIDE"
      : "PAYLOAD_SNAPSHOT",
    snapshot_source: payload.preingestion_bundle
      ? "PREINGESTION_BUNDLE"
      : payload.preingestion_summary
        ? "PREINGESTION_SUMMARY"
        : "NONE",
    reason_codes: Object.freeze(retainedReasonCodes),
    reason_codes_total_count: uniqueReasonCodes.length,
    reason_codes_retained_count: retainedReasonCodes.length,
    reason_codes_truncated_count: Math.max(0, uniqueReasonCodes.length - retainedReasonCodes.length),
    reason_codes_sha256: crypto.createHash("sha256").update(JSON.stringify(uniqueReasonCodes)).digest("hex"),
    card_code_crop_available_count: cardCodeCropAvailableCount,
    direct_context_crop_available_count: directContextCropAvailableCount,
    observable_card_code_job_count: cardCodeJobs.length,
    observable_direct_context_job_count: directContextJobs.length,
    observable_direct_context_role_count: observedDirectContextRoles.size,
    terminal_direct_context_role_count: terminalDirectContextRoles.size,
    evidence_observable_direct_context_role_count: observableTerminalDirectContextRoles.size,
    patch_producing_direct_context_role_count: patchProducingDirectContextRoles.size,
    card_code_job_terminal_count: cardCodeJobs.filter(terminalOcrJob).length,
    card_code_job_patch_count: cardCodeJobs.reduce((sum, job) => sum + Number(job.patch_count || 0), 0),
    card_code_job_text_observed_count: cardCodeJobs.filter((job) => Number(job.raw_text_present_count || 0) > 0).length,
    card_code_job_normalized_field_count: cardCodeJobs.reduce((sum, job) => sum + Number(job.normalized_field_count || 0), 0),
    current_code_patch_count: codePatches.length,
    typed_direct_code_anchor_count: directCodeAnchors.length,
    threshold_eligible_code_anchor_count: thresholdEligibleCodeAnchors.length,
    sports_pre_provider_reachability: sportsPreProviderReachability,
    effects: Object.freeze({
      catalog_lookup: false,
      provider_skip: false,
      resolver: false,
      renderer: false,
      production_title: false
    })
  });
}
