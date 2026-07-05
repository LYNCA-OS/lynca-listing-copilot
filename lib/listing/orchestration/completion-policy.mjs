import { completionActions } from "./next-best-action.mjs";
import { completionResolutionStates } from "./completion-state.mjs";

export const listingRoutes = Object.freeze({
  AI_COMPLETE_REVIEW: "AI_COMPLETE_REVIEW",
  WRITER_REVIEW_REQUIRED: "WRITER_REVIEW_REQUIRED",
  TARGETED_RESCAN_REQUIRED: "TARGETED_RESCAN_REQUIRED",
  NON_STANDARD_MANUAL: "NON_STANDARD_MANUAL",
  FAILED_TECHNICAL: "FAILED_TECHNICAL"
});

export function deriveRouteFromCompletionState({
  state = {},
  nextBestAction = null,
  providerError = false
} = {}) {
  if (providerError) return listingRoutes.FAILED_TECHNICAL;

  if (
    nextBestAction === completionActions.REQUEST_TARGETED_RESCAN
    || state.resolution_state === completionResolutionStates.TARGETED_RESCAN_REQUIRED
  ) {
    return listingRoutes.TARGETED_RESCAN_REQUIRED;
  }

  if (
    nextBestAction === completionActions.ROUTE_TO_MANUAL
    || state.resolution_state === completionResolutionStates.MANUAL_REQUIRED
    || state.resolution_state === completionResolutionStates.BUDGET_EXHAUSTED
  ) {
    return listingRoutes.NON_STANDARD_MANUAL;
  }

  if (state.resolution_state === completionResolutionStates.EVIDENCE_CLOSED) {
    return listingRoutes.AI_COMPLETE_REVIEW;
  }

  return listingRoutes.WRITER_REVIEW_REQUIRED;
}

export function completionReasonForRoute(route, state = {}) {
  if (route === listingRoutes.AI_COMPLETE_REVIEW) {
    return "Tracked critical fields have sufficient evidence for writer review.";
  }

  if (route === listingRoutes.TARGETED_RESCAN_REQUIRED) {
    return "A critical image region is unreadable and needs targeted rescan before final resolution.";
  }

  if (route === listingRoutes.FAILED_TECHNICAL) {
    return "Evidence completion stopped because a provider, retrieval, storage, or system technical failure prevented resolution.";
  }

  if (route === listingRoutes.NON_STANDARD_MANUAL) {
    return "Automated evidence completion paths are exhausted or unavailable.";
  }

  const gaps = [
    ...(state.missing_fields || []).map((field) => `missing ${field}`),
    ...(state.weak_fields || []).map((field) => `weak ${field}`),
    ...(state.conflicting_fields || []).map((field) => `conflicting ${field}`)
  ];

  return gaps.length
    ? `Writer review remains required because evidence is incomplete: ${gaps.slice(0, 6).join(", ")}.`
    : "Writer review remains required.";
}
