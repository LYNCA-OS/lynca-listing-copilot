export const RULER_ANNOTATION_PACKET_VERSION = "semantic-publication-review-packet-v2";

const DIRECT_FIELD_MAP = Object.freeze({
  print_finish: "print_finish",
  year: "year",
  set: "set",
  manufacturer: "manufacturer",
  card_name: "card_name",
  descriptive_rarity: "descriptive_rarity",
  release_variant: "release_variant",
  product: "product",
  language: "language",
  card_number: "card_number",
  serial: "numerical_rarity",
  grade: "grading_info",
  subjects: "subject",
  lot_count: "lot_quantity"
});

const TRUTH_OPTIONS = new Set(["VISIBLE_TRUE", "VISIBLE_FALSE", "UNKNOWN"]);
const TITLE_OPTIONS = new Set(["OPTIONAL_TITLE", "REQUIRED_TITLE"]);

export function canonicalFieldForLegacyDispute(field) {
  return DIRECT_FIELD_MAP[String(field || "").trim()] || null;
}

export function upgradeLegacyDisputePacket(packet = {}) {
  const cards = (packet.cards || []).map((card) => ({
    asset_id: card.asset_id,
    card_ordinal: card.card_ordinal,
    grammar: card.grammar,
    images: card.images || [],
    disputes: (card.disputes || []).map((dispute) => ({
      dispute_id: dispute.dispute_id,
      source_field: dispute.field || null,
      canonical_field: canonicalFieldForLegacyDispute(dispute.field),
      value: dispute.field_value || null,
      semantic_category: dispute.semantic_category || null,
      model_evidence: dispute.model_evidence || [],
      review_axes: {
        truth: {
          status: null,
          source_type: null,
          evidence_refs: [],
          reviewer_id: null
        },
        title: {
          policy: null,
          grammar: card.grammar || null,
          reviewer_id: null
        }
      }
    }))
  }));
  return {
    schema_version: RULER_ANNOTATION_PACKET_VERSION,
    authority: "independent_human_review_required",
    production_promoted: false,
    blind: true,
    source_packet_schema_version: packet.schema_version || null,
    claim_scope: "REFERENCE_ABSENT_PREDICTION_DISPUTES_ONLY",
    can_score_recognition_recall: false,
    can_score_publishable_card_rate: false,
    cards
  };
}

export function auditRulerAnnotationReadiness(packet = {}) {
  const disputes = (packet.cards || []).flatMap((card) => card.disputes || []);
  const axisConflated = disputes.filter((dispute) => {
    const options = new Set(dispute.reviewer_options || []);
    return [...TRUTH_OPTIONS].some((option) => options.has(option))
      && [...TITLE_OPTIONS].some((option) => options.has(option))
      && !dispute.review_axes;
  });
  const mappable = disputes.filter((dispute) => canonicalFieldForLegacyDispute(dispute.field));
  const roleResolution = disputes.filter((dispute) => !canonicalFieldForLegacyDispute(dispute.field));
  const withEvidence = disputes.filter((dispute) => (dispute.model_evidence || []).length > 0);
  const upgraded = upgradeLegacyDisputePacket(packet);
  return {
    source_schema_version: packet.schema_version || null,
    target_schema_version: upgraded.schema_version,
    cards: (packet.cards || []).length,
    disputes: disputes.length,
    disputes_with_model_evidence: withEvidence.length,
    axis_conflated_disputes: axisConflated.length,
    canonical_field_mappable_disputes: mappable.length,
    requires_role_resolution_disputes: roleResolution.length,
    requires_role_resolution_fields: [...new Set(roleResolution.map((dispute) => dispute.field))].sort(),
    labels_present: disputes.filter((dispute) => dispute.review_axes?.truth?.status
      && dispute.review_axes?.title?.policy).length,
    can_score_recognition_precision_after_review: mappable.length > 0,
    can_score_recognition_recall: false,
    can_score_publishable_card_rate: false,
    blockers: [
      axisConflated.length ? "truth_and_title_policy_are_one_mutually_exclusive_enum" : null,
      roleResolution.length ? "legacy_fields_require_canonical_role_resolution" : null,
      "packet_contains_reference_absent_predictions_but_not_complete_supported_gold_facts",
      "independent_human_labels_are_missing"
    ].filter(Boolean)
  };
}
