// Immutable COS-39 Registry release. Only claims in this reviewed artifact may
// reject a Print Finish on product-family grounds. Unknown terms fail open.

const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const PRINT_FINISH_PRODUCT_CLAIMS_V1 = freeze({
  schema_version: "print-finish-product-claims-v1",
  registry_release_id: "registry_print_finish_product_claims_v1_20260812",
  status: "FROZEN_APPROVED",
  authority: {
    decision_id: "COS-39",
    approval: "GOVERNED_REVIEW_APPROVED",
    completion_authorization: "COS_COMPLETION_AUTHORIZED_2026_08_12",
    admitted_evidence_class: "AGGREGATED_REVIEWED_OPERATOR_FEEDBACK",
    approved_on: "2026-08-12"
  },
  source_receipt: {
    path: "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json",
    sha256: "9fa09c495d04c649b1e74aa057d6a5d426f6e0cc620032f2fd53b0e2b07308ba",
    source_item_count: 255,
    source_description: "listing_title_feedback (writer-reviewed corrected titles)"
  },
  review_receipt: {
    status: "APPROVED",
    reviewed_by_role: "PAI",
    linear_comment_id: "2160874a-fd2b-4eaa-90ea-6cf60764791b",
    rule: "whole-word Refractor is owned by the Topps product family",
    matching_reviewed_titles: 75,
    matching_titles_outside_owner_family: 0
  },
  product_families: [
    { id: "topps", exact_phrases: ["topps", "bowman"] },
    { id: "panini", exact_phrases: ["panini"] }
  ],
  claims: [
    {
      term: "refractor",
      product_family: "topps",
      status: "ACTIVE",
      authority: "AGGREGATED_REVIEWED_OPERATOR_FEEDBACK"
    }
  ]
});
