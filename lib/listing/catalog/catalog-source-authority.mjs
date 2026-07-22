import { isOfficialCatalogSourceType } from "./catalog-contract.mjs";

export const catalogSourceAuthorityVersion = "catalog-source-authority-v2-20260723";

const sourceClasses = Object.freeze({
  WRITER_DIRECTORY: "WRITER_DIRECTORY",
  OFFICIAL_DIRECTORY: "OFFICIAL_DIRECTORY",
  OTHER_REFERENCE: "OTHER_REFERENCE"
});

const profiles = Object.freeze({
  [sourceClasses.WRITER_DIRECTORY]: Object.freeze({
    catalog_admission: "PRIMARY",
    decision_trust_rank: 6,
    commercial_expression_rank: 3,
    identity_structure_rank: 2,
    physical_instance_rank: 0
  }),
  [sourceClasses.OFFICIAL_DIRECTORY]: Object.freeze({
    catalog_admission: "PRIMARY",
    decision_trust_rank: 6,
    commercial_expression_rank: 2,
    identity_structure_rank: 3,
    physical_instance_rank: 0
  }),
  [sourceClasses.OTHER_REFERENCE]: Object.freeze({
    catalog_admission: "ASSIST",
    decision_trust_rank: 0,
    commercial_expression_rank: 1,
    identity_structure_rank: 1,
    physical_instance_rank: 0
  })
});

const referenceTrustRanks = Object.freeze({
  REVIEWED_INTERNAL: 6,
  INTERNAL_APPROVED_HISTORY: 6,
  APPROVED_REFERENCE: 6,
  OFFICIAL_CHECKLIST: 6,
  INTERNAL_VERIFIED_TITLE: 4,
  LICENSED_EXTERNAL_DIRECTORY: 3,
  COMMUNITY_API: 2,
  MARKETPLACE: 1,
  VISUAL_ONLY: 0,
  REFERENCE_CANDIDATE: 0
});

function cleanUpper(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function sourceClassFor({ sourceType = "", sourceTrust = "" } = {}) {
  const type = cleanUpper(sourceType);
  const trust = cleanUpper(sourceTrust);
  if (type === "INTERNAL_CORRECTED_TITLE"
    || trust.includes("REVIEWED_INTERNAL")
    || trust.includes("INTERNAL_APPROVED")) {
    return sourceClasses.WRITER_DIRECTORY;
  }
  if (isOfficialCatalogSourceType(type) || type.includes("OFFICIAL") || trust.includes("OFFICIAL")) {
    return sourceClasses.OFFICIAL_DIRECTORY;
  }
  return sourceClasses.OTHER_REFERENCE;
}

export function catalogSourceAuthorityProfile(input = {}) {
  const sourceClass = sourceClassFor(input);
  return {
    policy_version: catalogSourceAuthorityVersion,
    evaluation_scope: "SHARED_CATALOG_DECISION_FOUNDATION",
    runtime_chain_effect: "SOURCE_AUTHORITY_ONLY",
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
    runtime_chain_effect: "SOURCE_AUTHORITY_ONLY"
  };
}

export function catalogDecisionTrustRank({ sourceType = "", sourceTrust = "" } = {}) {
  const profile = catalogSourceAuthorityProfile({ sourceType, sourceTrust });
  if (profile.source_class !== sourceClasses.OTHER_REFERENCE) return profile.decision_trust_rank;
  return referenceTrustRanks[cleanUpper(sourceTrust)] ?? 0;
}

