function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && cleanText(value) !== "";
}

export const reviewedCatalogActivationPolicy = Object.freeze({
  reviewed_source_type: "INTERNAL_CORRECTED_TITLE",
  activated_review_status: "REVIEWED_INTERNAL",
  ai_draft_can_promote_gap: false,
  writer_final_title_overrides_ai_draft: true,
  writer_edit_can_supersede_promoted_gap: true,
  marketplace_title_can_promote_gap: false
});

export function isPromptSafeReviewedCatalogCard(row = {}) {
  const sourceType = cleanText(row.source_type || row.source?.source_type).toUpperCase();
  const sourceStatus = cleanText(row.source_status || row.source?.source_status).toUpperCase();
  const metadata = isPlainObject(row.metadata) ? row.metadata : {};
  if (sourceType && sourceType !== reviewedCatalogActivationPolicy.reviewed_source_type) return false;
  if (metadata.seller_title_used_for_catalog_import === true || metadata.marketplace_title_used_as_truth === true) return false;
  return metadata.prompt_safe_internal_writer_title === true
    || metadata.corrected_title_is_reviewed_title_ground_truth === true
    || [
      "VERIFIED_CANONICAL_TITLE",
      "AUTO_PARSED_FROM_VERIFIED_TITLE",
      "REVIEWED_INTERNAL"
    ].includes(sourceStatus);
}

export function catalogCardActivationDecision(row = {}) {
  const currentStatus = cleanText(row.review_status).toUpperCase();
  const eligible = isPromptSafeReviewedCatalogCard(row);
  return {
    catalog_card_id: row.id || row.catalog_card_id || null,
    eligible,
    current_review_status: currentStatus || null,
    target_review_status: eligible ? reviewedCatalogActivationPolicy.activated_review_status : null,
    needs_update: eligible && currentStatus !== reviewedCatalogActivationPolicy.activated_review_status,
    reason: eligible
      ? "internal_writer_reviewed_catalog_prompt_safe"
      : "not_internal_reviewed_prompt_safe"
  };
}

export function writerFinalTitleForGap(row = {}) {
  return cleanText(row.writer_final_title || row.metadata?.writer_final_title);
}

export function writerConfirmedFieldsForGap(row = {}) {
  const fields = isPlainObject(row.writer_confirmed_fields) ? row.writer_confirmed_fields : {};
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => hasValue(value)));
}

export function catalogGapPromotionReadiness(row = {}) {
  const writerFinalTitle = writerFinalTitleForGap(row);
  const writerConfirmedFields = writerConfirmedFieldsForGap(row);
  const hasConfirmedFields = Object.keys(writerConfirmedFields).length > 0;
  const aiDraftTitle = cleanText(row.ai_draft_title);
  const previousPromotionTitle = cleanText(
    row.promoted_title
    || row.metadata?.promoted_title
    || row.metadata?.promotion_title
    || row.metadata?.last_promoted_title
    || row.metadata?.writer_final_title_at_promotion
    || row.metadata?.ai_draft_title_at_promotion
  );
  const status = cleanText(row.status || row.promotion_status).toUpperCase();
  const alreadyPromoted = ["APPROVED", "PROMOTED", "MERGED"].includes(status)
    || ["APPROVED", "PROMOTED", "MERGED"].includes(cleanText(row.promotion_status).toUpperCase());
  const supersedesPreviousPromotion = reviewedCatalogActivationPolicy.writer_edit_can_supersede_promoted_gap === true
    && alreadyPromoted
    && Boolean(writerFinalTitle)
    && Boolean(previousPromotionTitle)
    && writerFinalTitle !== previousPromotionTitle;

  return {
    gap_id: row.gap_id || row.client_gap_key || null,
    asset_id: row.asset_id || null,
    can_promote: supersedesPreviousPromotion || (!alreadyPromoted && Boolean(writerFinalTitle || hasConfirmedFields)),
    already_promoted: alreadyPromoted,
    supersedes_previous_promotion: supersedesPreviousPromotion,
    previous_promotion_title: previousPromotionTitle || "",
    promotion_title: writerFinalTitle || "",
    writer_confirmed_field_count: Object.keys(writerConfirmedFields).length,
    ai_draft_title: aiDraftTitle,
    ai_draft_used_as_truth: false,
    training_eligible_after_promotion: !alreadyPromoted && Boolean(writerFinalTitle || hasConfirmedFields),
    reason: supersedesPreviousPromotion
      ? "writer_final_title_supersedes_previous_promotion"
      : alreadyPromoted
        ? "already_promoted"
      : writerFinalTitle
        ? "writer_final_title_ready"
        : hasConfirmedFields
          ? "writer_confirmed_fields_ready"
          : aiDraftTitle
            ? "writer_review_missing_ai_draft_only"
            : "writer_review_missing"
  };
}

export function buildReviewedCatalogActivationReport({
  catalogCards = [],
  gapRows = [],
  applied = false,
  now = new Date()
} = {}) {
  const catalogDecisions = (Array.isArray(catalogCards) ? catalogCards : []).map(catalogCardActivationDecision);
  const gapDecisions = (Array.isArray(gapRows) ? gapRows : []).map(catalogGapPromotionReadiness);
  return {
    schema_version: "reviewed-catalog-activation-v1",
    generated_at: now.toISOString(),
    applied: applied === true,
    policy: reviewedCatalogActivationPolicy,
    catalog: {
      inspected_count: catalogDecisions.length,
      eligible_count: catalogDecisions.filter((decision) => decision.eligible).length,
      needs_update_count: catalogDecisions.filter((decision) => decision.needs_update).length,
      activated_review_status: reviewedCatalogActivationPolicy.activated_review_status
    },
    gaps: {
      inspected_count: gapDecisions.length,
      promotable_count: gapDecisions.filter((decision) => decision.can_promote).length,
      ai_draft_only_blocked_count: gapDecisions.filter((decision) => decision.reason === "writer_review_missing_ai_draft_only").length,
      already_promoted_count: gapDecisions.filter((decision) => decision.already_promoted && !decision.supersedes_previous_promotion).length,
      writer_supersede_count: gapDecisions.filter((decision) => decision.supersedes_previous_promotion).length
    },
    sample_catalog_updates: catalogDecisions.filter((decision) => decision.needs_update).slice(0, 20),
    sample_gap_readiness: gapDecisions.slice(0, 30)
  };
}
