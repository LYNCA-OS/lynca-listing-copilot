import { hasV4GradeCertConflict } from "./evidence/field-evidence.mjs";

export const v4ResultOutcomeTypes = Object.freeze({
  TITLE_READY: "TITLE_READY",
  WRITER_REVIEW_REQUIRED: "WRITER_REVIEW_REQUIRED",
  TECHNICAL_FAILURE: "TECHNICAL_FAILURE"
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function titleFromV4Result(result = {}) {
  return cleanText(result.final_title || result.rendered_title || result.title);
}

function providerError(result = {}) {
  return cleanText(
    result.provider_error_type
      || result.provider_error_code
      || result.error_code
      || result.provider_result?.provider_error_type
      || result.provider_result?.provider_error_code
  );
}

export function isV4SemanticReviewRequired(result = {}) {
  if (hasV4GradeCertConflict(result)) return true;
  if (titleFromV4Result(result)) return false;
  if (providerError(result)) return false;
  const identityStatus = cleanText(
    result.identity_resolution_status
      || result.identity_resolution?.status
      || result.ambiguity_status
  ).toUpperCase();
  const route = cleanText(result.workflow_route || result.route || result.cold_start_status).toUpperCase();
  const renderSource = cleanText(result.title_render_source).toLowerCase();
  return identityStatus === "ABSTAIN"
    || route === "WRITER_REVIEW_REQUIRED"
    || route === "MANUAL_REQUIRED"
    || renderSource === "identity_resolution_abstain";
}

export function classifyV4ResultOutcome(result = {}) {
  const title = titleFromV4Result(result);
  const error = providerError(result);
  const semanticReviewRequired = isV4SemanticReviewRequired(result);
  const confidenceFailed = cleanText(result.confidence).toUpperCase() === "FAILED";
  const outcome = semanticReviewRequired
    ? v4ResultOutcomeTypes.WRITER_REVIEW_REQUIRED
    : title
      ? v4ResultOutcomeTypes.TITLE_READY
      : v4ResultOutcomeTypes.TECHNICAL_FAILURE;

  return {
    outcome,
    title,
    provider_error: error || null,
    confidence_failed: confidenceFailed,
    title_ready: outcome === v4ResultOutcomeTypes.TITLE_READY,
    writer_review_required: outcome === v4ResultOutcomeTypes.WRITER_REVIEW_REQUIRED,
    technical_failure: outcome === v4ResultOutcomeTypes.TECHNICAL_FAILURE
  };
}
