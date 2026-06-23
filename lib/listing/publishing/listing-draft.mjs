export const listingReviewStatuses = Object.freeze({
  APPROVED: "APPROVED",
  PENDING_REVIEW: "PENDING_REVIEW",
  REJECTED: "REJECTED"
});

export const listingPublishStatuses = Object.freeze({
  READY: "READY",
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED"
});

export class PublishingApprovalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PublishingApprovalError";
    this.code = "approval_required";
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeListingDraft(input = {}) {
  return {
    asset_id: normalizeText(input.asset_id || input.assetId),
    review_id: normalizeText(input.review_id || input.reviewId),
    final_title: normalizeText(input.final_title || input.finalTitle),
    resolved_fields: plainObject(input.resolved_fields || input.resolvedFields || input.resolved),
    modules: plainObject(input.modules),
    review_status: normalizeText(input.review_status || input.reviewStatus || listingReviewStatuses.PENDING_REVIEW).toUpperCase(),
    approved_by: normalizeText(input.approved_by || input.approvedBy),
    approved_at: normalizeText(input.approved_at || input.approvedAt),
    publish_status: normalizeText(input.publish_status || input.publishStatus || listingPublishStatuses.READY).toUpperCase()
  };
}

export function validateListingDraft(input = {}) {
  const draft = normalizeListingDraft(input);
  const errors = [];

  if (!draft.asset_id) errors.push("asset_id is required.");
  if (!draft.review_id) errors.push("review_id is required.");
  if (!draft.final_title) errors.push("final_title is required.");
  if (!Object.keys(draft.resolved_fields).length) errors.push("resolved_fields are required.");
  if (draft.review_status !== listingReviewStatuses.APPROVED) errors.push("review_status must be APPROVED before publishing.");
  if (!draft.approved_by) errors.push("approved_by is required before publishing.");
  if (!draft.approved_at) errors.push("approved_at is required before publishing.");
  if (draft.publish_status !== listingPublishStatuses.READY) errors.push("publish_status must be READY before publishing.");

  return {
    ok: errors.length === 0,
    errors,
    draft
  };
}

export function assertApprovedListingDraft(input = {}) {
  const result = validateListingDraft(input);
  if (!result.ok) {
    throw new PublishingApprovalError("Listing draft is not approved for publishing.", {
      errors: result.errors
    });
  }

  return result.draft;
}
