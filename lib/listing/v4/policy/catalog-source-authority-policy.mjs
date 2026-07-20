export const catalogSourceAuthorityPolicyVersion = "catalog-source-authority-policy-v1-20260719";

const profiles = Object.freeze({
  WRITER_DIRECTORY: Object.freeze({
    catalog_admission: "PRIMARY",
    commercial_expression_rank: 3,
    identity_structure_rank: 2,
    physical_instance_rank: 0
  }),
  OFFICIAL_DIRECTORY: Object.freeze({
    catalog_admission: "PRIMARY",
    commercial_expression_rank: 2,
    identity_structure_rank: 3,
    physical_instance_rank: 0
  }),
  OTHER_REFERENCE: Object.freeze({
    catalog_admission: "ASSIST",
    commercial_expression_rank: 1,
    identity_structure_rank: 1,
    physical_instance_rank: 0
  })
});

function cleanUpper(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function catalogSourceAuthorityProfile({ sourceType = "", sourceTrust = "" } = {}) {
  const type = cleanUpper(sourceType);
  const trust = cleanUpper(sourceTrust);
  const sourceClass = type === "INTERNAL_CORRECTED_TITLE"
    ? "WRITER_DIRECTORY"
    : type.includes("OFFICIAL") || trust === "OFFICIAL_CHECKLIST"
      ? "OFFICIAL_DIRECTORY"
      : "OTHER_REFERENCE";
  return {
    policy_version: catalogSourceAuthorityPolicyVersion,
    evaluation_scope: "OFFLINE_STRATEGY_ONLY",
    runtime_chain_effect: "NONE",
    source_class: sourceClass,
    ...profiles[sourceClass]
  };
}

export function compareCatalogSourceAuthority(left = {}, right = {}, dimension = "commercial_expression") {
  const rankKey = `${dimension}_rank`;
  const leftProfile = catalogSourceAuthorityProfile(left);
  const rightProfile = catalogSourceAuthorityProfile(right);
  return {
    dimension,
    left_rank: Number(leftProfile[rankKey] || 0),
    right_rank: Number(rightProfile[rankKey] || 0),
    preferred: leftProfile[rankKey] === rightProfile[rankKey]
      ? "TIE"
      : leftProfile[rankKey] > rightProfile[rankKey]
        ? "LEFT"
        : "RIGHT",
    runtime_chain_effect: "NONE"
  };
}
