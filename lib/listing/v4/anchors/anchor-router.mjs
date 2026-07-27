import {
  anchorContextDirectDimensionCount,
  anchorContextDimensionCount,
  anchorDecisionConfidence,
  anchorIsDirectEnough
} from "./anchor-confidence.mjs";

export const anchorRoutes = Object.freeze({
  TCG_EXACT_LOOKUP: "TCG_EXACT_LOOKUP",
  SPORTS_COMPOSITE_LOOKUP: "SPORTS_COMPOSITE_LOOKUP",
  CERT_VERIFY: "CERT_VERIFY",
  PRODUCT_NARROWING: "PRODUCT_NARROWING",
  NORMAL_L2: "NORMAL_L2"
});

function bestAnchor(dossier = {}, type = "") {
  return (dossier.anchors || [])
    .filter((anchor) => anchor.anchor_type === type)
    .sort((left, right) => anchorDecisionConfidence(right, dossier) - anchorDecisionConfidence(left, dossier))[0] || null;
}

export function planAnchorRoute(dossier = {}) {
  const tcg = bestAnchor(dossier, "tcg_card_code");
  const checklist = bestAnchor(dossier, "checklist_code");
  const collector = bestAnchor(dossier, "collector_number");
  const cert = bestAnchor(dossier, "cert_number");
  const productCode = bestAnchor(dossier, "product_code");
  const contextDimensions = anchorContextDimensionCount(dossier);
  const directContextDimensions = anchorContextDirectDimensionCount(dossier);

  if (tcg && anchorIsDirectEnough(tcg, 0.84)) {
    return {
      route: anchorRoutes.TCG_EXACT_LOOKUP,
      reason: "direct_tcg_set_card_code",
      primary_anchor: tcg,
      lookup_target: "catalog",
      allow_identity_finalize: true,
      allow_code_only_finalize: true,
      context_dimensions: contextDimensions,
      direct_context_dimensions: directContextDimensions
    };
  }

  const sportsAnchor = checklist || collector;
  if (sportsAnchor
    && anchorIsDirectEnough(sportsAnchor, 0.82)
    && contextDimensions >= 2
    && directContextDimensions >= 2) {
    return {
      route: anchorRoutes.SPORTS_COMPOSITE_LOOKUP,
      reason: "direct_card_code_with_composite_context",
      primary_anchor: sportsAnchor,
      lookup_target: "catalog",
      allow_identity_finalize: true,
      allow_code_only_finalize: false,
      context_dimensions: contextDimensions,
      direct_context_dimensions: directContextDimensions
    };
  }

  if (cert && cert.grader && anchorIsDirectEnough(cert, 0.84)) {
    return {
      route: anchorRoutes.CERT_VERIFY,
      reason: "slab_cert_is_instance_verification_not_card_identity",
      primary_anchor: cert,
      lookup_target: "cert_registry",
      allow_identity_finalize: false,
      allow_code_only_finalize: false,
      context_dimensions: contextDimensions,
      direct_context_dimensions: directContextDimensions
    };
  }

  if (productCode && anchorIsDirectEnough(productCode, 0.9)) {
    return {
      route: anchorRoutes.PRODUCT_NARROWING,
      reason: "product_code_narrows_release_only",
      primary_anchor: productCode,
      lookup_target: "product_catalog",
      allow_identity_finalize: false,
      allow_code_only_finalize: false,
      context_dimensions: contextDimensions,
      direct_context_dimensions: directContextDimensions
    };
  }

  return {
    route: anchorRoutes.NORMAL_L2,
    reason: sportsAnchor ? "anchor_missing_sufficient_direct_context" : "no_lookup_anchor",
    primary_anchor: sportsAnchor || cert || productCode || null,
    lookup_target: null,
    allow_identity_finalize: false,
    allow_code_only_finalize: false,
    context_dimensions: contextDimensions,
    direct_context_dimensions: directContextDimensions
  };
}

export function anchorPlanQueryFields(dossier = {}, plan = {}) {
  const context = dossier.context || {};
  const anchor = plan.primary_anchor || {};
  const tcg = plan.route === anchorRoutes.TCG_EXACT_LOOKUP ? anchor.normalized : "";
  const checklist = anchor.anchor_type === "checklist_code" ? anchor.normalized : "";
  const collector = anchor.anchor_type === "collector_number" ? anchor.normalized : "";
  return {
    subjects: Array.isArray(context.subjects) ? context.subjects : [],
    year: context.year || "",
    manufacturer: context.manufacturer || "",
    product: context.product || "",
    set: context.set || "",
    tcg_card_number: tcg,
    checklist_code: checklist,
    collector_number: collector || tcg,
    expected_serial_denominator: ""
  };
}
