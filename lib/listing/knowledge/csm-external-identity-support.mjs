import { createHash } from "node:crypto";

const RECEIPT_SCHEMA = "csm-external-identity-support-receipt.v1";
const PACK_ID = "lynca.csm.external-identity";
const PACK_VERSION = "2026-08-10";
const INDEX_ID = "basketball.1996-97-topps-stadium-club-high-risers";
const INDEX_VERSION = "tcdb-2551.psa-25618.beckett-3117708.2026-08-10";
const RETRIEVED_AT = "2026-08-10";
const VERIFIED_ORIGINAL_SET_DOMAIN = "lynca.csm.verified-original-set.v1";
const HR14_VERIFIED_ORIGINAL_SET_SHA256 =
  "61ee1d99b10690cf5877e9b5f08b53ba98051a3961d0a9e5c04f9e8e130db159";

const REQUIRED_ANCHORS = Object.freeze([
  "manufacturer",
  "product",
  "subject",
  "card_number"
]);

const IDENTITY_FIELDS = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "subjects",
  "team",
  "card_number"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function computeVerifiedOriginalSetSha256(values) {
  if (!Array.isArray(values) || values.length !== 2) {
    throw new TypeError("verified_original_set_requires_two_images");
  }
  const originalImageSha256 = values.map((value) => String(value || "").trim().toLowerCase());
  if (originalImageSha256.some((value) => !/^[0-9a-f]{64}$/.test(value))) {
    throw new TypeError("verified_original_set_sha256_invalid");
  }
  if (new Set(originalImageSha256).size !== 2) {
    throw new TypeError("verified_original_set_requires_distinct_images");
  }
  originalImageSha256.sort();
  return sha256({
    domain: VERIFIED_ORIGINAL_SET_DOMAIN,
    original_image_sha256: originalImageSha256
  });
}

const SOURCE_SNAPSHOTS = Object.freeze([
  {
    source_id: "tcdb.set.2551",
    url: "https://www.tcdb.com/Checklist.cfm/sid/2551/1996-97-Stadium-Club---High-Risers",
    retrieved_at: RETRIEVED_AT,
    supports: ["year", "product", "set", "subject", "team", "card_number", "checklist_count"]
  },
  {
    source_id: "psa.set-registry.25618",
    url: "https://www.psacard.com/psasetregistry/basketball/company-sets/1996-97-stadium-club-high-risers-members-only/composition/25618",
    retrieved_at: RETRIEVED_AT,
    supports: ["year", "product", "set", "subject", "card_number", "checklist_count"]
  },
  {
    source_id: "beckett.item.3117708",
    url: "https://www.beckett.com/basketball/1996-97/stadium-club-high-risers/hr14-michael-jordan-3117708",
    retrieved_at: RETRIEVED_AT,
    supports: ["year", "manufacturer", "product", "set", "subject", "team", "card_number"]
  }
]);

const SOURCE_IDS = Object.freeze({
  checklist: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618"]),
  hr14: Object.freeze(["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"])
});

const CHECKLIST = Object.freeze([
  ["HR1", "Scottie Pippen", "Chicago Bulls", ["Bulls"]],
  ["HR2", "Anfernee Hardaway", "Orlando Magic", ["Magic"]],
  ["HR3", "Vin Baker", "Milwaukee Bucks", ["Bucks"]],
  ["HR4", "Brent Barry", "Los Angeles Clippers", ["LA Clippers", "L.A. Clippers", "Clippers"]],
  ["HR5", "Clyde Drexler", "Houston Rockets", ["Rockets"]],
  ["HR6", "Kevin Garnett", "Minnesota Timberwolves", ["Timberwolves", "Wolves"]],
  ["HR7", "Grant Hill", "Detroit Pistons", ["Pistons"]],
  ["HR8", "Michael Finley", "Phoenix Suns", ["Suns"]],
  ["HR9", "Jerry Stackhouse", "Philadelphia 76ers", ["76ers", "Sixers"]],
  ["HR10", "Isaiah Rider", "Portland Trail Blazers", ["Trail Blazers", "Blazers"]],
  ["HR11", "Shaquille O'Neal", "Los Angeles Lakers", ["LA Lakers", "L.A. Lakers", "Lakers"]],
  ["HR12", "Antonio McDyess", "Denver Nuggets", ["Nuggets"]],
  ["HR13", "Shawn Kemp", "Seattle SuperSonics", ["Seattle Supersonics", "SuperSonics", "Supersonics", "Sonics"]],
  ["HR14", "Michael Jordan", "Chicago Bulls", ["Bulls"]],
  ["HR15", "Juwan Howard", "Washington Bullets", ["Bullets"]]
]);

function recordFromChecklist([cardNumber, subject, team, teamAliases]) {
  return {
    record_id: `tcdb-2551-${cardNumber.toLowerCase()}`,
    year: "1996-97",
    manufacturer: "Topps",
    product: "Stadium Club",
    set: "High Risers",
    subject,
    team,
    team_aliases: teamAliases,
    card_number: cardNumber,
    source_ids: cardNumber === "HR14" ? SOURCE_IDS.hr14 : SOURCE_IDS.checklist
  };
}

export const HIGH_RISERS_EXTERNAL_IDENTITY_INDEX = deepFreeze({
  schema_version: "csm-external-identity-index.v2",
  index_id: INDEX_ID,
  index_version: INDEX_VERSION,
  records: CHECKLIST.map(recordFromChecklist),
  // Reviewed image identity is deliberately independent from catalog facts.
  // Only the domain-separated set digest is shipped: component hashes, image
  // roles, asset ids and expected titles are not part of the runtime mapping.
  original_set_record_ids: {
    [HR14_VERIFIED_ORIGINAL_SET_SHA256]: "tcdb-2551-hr14"
  }
});

const INDEX_SHA256 = sha256(HIGH_RISERS_EXTERNAL_IDENTITY_INDEX);

function sourceFactPayload(sourceId) {
  const fields = sourceId === "tcdb.set.2551"
    ? ["year", "product", "set", "subject", "team", "card_number"]
    : sourceId === "psa.set-registry.25618"
      ? ["year", "product", "set", "subject", "card_number"]
      : ["year", "manufacturer", "product", "set", "subject", "team", "card_number"];
  const records = sourceId === "beckett.item.3117708"
    ? HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.filter((record) => record.card_number === "HR14")
    : HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records;
  return {
    index_id: INDEX_ID,
    checklist_count: records.length,
    records: records.map((record) => Object.fromEntries(fields.map((field) => [field, record[field]])))
  };
}

const SOURCES = SOURCE_SNAPSHOTS.map((source) => ({
  ...source,
  fact_sha256: sha256({
    source_id: source.source_id,
    url: source.url,
    retrieved_at: source.retrieved_at,
    supports: source.supports,
    facts: sourceFactPayload(source.source_id)
  })
}));

const PACK_PAYLOAD = {
  schema_version: "csm-external-identity-pack.v1",
  pack_id: PACK_ID,
  pack_version: PACK_VERSION,
  index_id: INDEX_ID,
  index_version: INDEX_VERSION,
  index_sha256: INDEX_SHA256,
  sources: SOURCES
};

export const EXTERNAL_IDENTITY_SUPPORT_PACK = deepFreeze({
  ...PACK_PAYLOAD,
  pack_sha256: sha256(PACK_PAYLOAD)
});

export const EXTERNAL_IDENTITY_RESOLVER_VERSION = "thin-path-exact-external-identity-v2";
export const EXTERNAL_IDENTITY_CONFLICT_POLICY_VERSION = "exact-unique-or-original-set-visible-conflict-wins-v2";
export const EXTERNAL_IDENTITY_COMPOSER_VERSION = "thin-marketplace-composer-v3-verified-external-identity";
export const EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION = "ebay-verified-external-identity-v1";
export const EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID = "registry_thin_external_identity_high_risers_v1";

const RESOLUTION_CONTRACT_PAYLOAD = {
  schema_version: "csm-post-observation-resolution-contract.v1",
  contract_id: "lynca.csm.post-observation.external-identity.v1",
  support_pack_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
  resolver_version: EXTERNAL_IDENTITY_RESOLVER_VERSION,
  conflict_policy_version: EXTERNAL_IDENTITY_CONFLICT_POLICY_VERSION,
  composer_version: EXTERNAL_IDENTITY_COMPOSER_VERSION,
  marketplace_profile_version: EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION,
  registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  matching: "exact_unique_four_anchor_or_verified_original_set",
  visible_conflict_policy: "abstain",
  physical_copy_fields: "immutable",
  provider_calls_added: 0
};

export const EXTERNAL_IDENTITY_RESOLUTION_CONTRACT = deepFreeze({
  ...RESOLUTION_CONTRACT_PAYLOAD,
  contract_sha256: sha256(RESOLUTION_CONTRACT_PAYLOAD)
});

export const EXTERNAL_IDENTITY_RELEASE_CONTRACT = deepFreeze({
  schema_version: "csm-external-identity-release-contract.v1",
  support_pack: {
    id: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
    version: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
    sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256
  },
  index: {
    id: EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
    version: EXTERNAL_IDENTITY_SUPPORT_PACK.index_version,
    sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256
  },
  resolution_contract: {
    id: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_id,
    sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
    resolver_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.resolver_version,
    conflict_policy_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.conflict_policy_version,
    composer_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.composer_version,
    marketplace_profile_version: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.marketplace_profile_version
  },
  registry_release: {
    id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
    content_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256
  }
});

// Replay compatibility is append-only release history, not a view of the
// active pack. Every published descriptor is intentionally literal: deriving
// it from today's constants would make a future pack/index replacement rewrite
// the meaning of already-persisted receipts. Add a sibling entry for a new
// release; never edit or remove a released entry.
export const EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY = deepFreeze({
  schema_version: "csm-external-identity-replay-compatibility-registry.v1",
  releases: {
    registry_thin_external_identity_high_risers_v1: {
      receipt: {
        schema_version: "csm-external-identity-support-receipt.v1",
        pack_id: "lynca.csm.external-identity",
        pack_version: "2026-08-10",
        pack_sha256: "f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
        index_id: "basketball.1996-97-topps-stadium-club-high-risers",
        index_version: "tcdb-2551.psa-25618.beckett-3117708.2026-08-10",
        index_sha256: "984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
        registry_release_id: "registry_thin_external_identity_high_risers_v1",
        resolution_contract_sha256: "e0b2e3463e8dc13f33d5ca2dbb3739b6e07c7b02f820901b4961ed83d0d945df"
      },
      resolution: {
        registry_release_id: "registry_thin_external_identity_high_risers_v1",
        resolver_version: "thin-path-exact-external-identity-v2",
        conflict_policy_version: "exact-unique-or-original-set-visible-conflict-wins-v2"
      },
      output: {
        composer_version: "thin-marketplace-composer-v3-verified-external-identity",
        marketplace_profile_version: "ebay-verified-external-identity-v1"
      },
      match_modes: ["EXACT_FOUR_ANCHOR", "VERIFIED_ORIGINAL_SET"]
    },
    registry_thin_external_identity_high_risers_v2: {
      receipt: {
        schema_version: "csm-external-identity-support-receipt.v2",
        pack_id: "lynca.csm.external-identity",
        pack_version: "2026-08-10",
        pack_sha256: "f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
        index_id: "basketball.1996-97-topps-stadium-club-high-risers",
        index_version: "tcdb-2551.psa-25618.beckett-3117708.2026-08-10",
        index_sha256: "984f718fd917a7d685f446bcdbed43f95667021443259134e7b7872fa225ce96",
        registry_release_id: "registry_thin_external_identity_high_risers_v2",
        resolution_contract_sha256: "407f69668256c799b0beeae8bd9dbdbe3073f86b6f6367c8216417973d6b691f"
      },
      resolution: {
        registry_release_id: "registry_thin_external_identity_high_risers_v2",
        resolver_version: "thin-path-exact-external-identity-v3",
        conflict_policy_version: "verified-original-set-four-anchor-release-correction-v3"
      },
      output: {
        composer_version: "thin-marketplace-composer-v4-verified-external-identity",
        marketplace_profile_version: "ebay-verified-external-identity-v2"
      },
      match_modes: ["EXACT_FOUR_ANCHOR", "VERIFIED_ORIGINAL_SET"]
    }
  }
});

export function externalIdentityReplayReleaseForReceipt(receipt) {
  const releaseId = String(receipt?.registry_release_id || "").trim();
  const releases = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases;
  return releaseId && Object.hasOwn(releases, releaseId) ? releases[releaseId] : null;
}

const EXTERNAL_IDENTITY_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "set", "subjects", "team", "card_number"
]);
const HIGH_RISERS_RECORD_IDS = Object.freeze(
  Array.from({ length: 15 }, (_, index) => `tcdb-2551-hr${index + 1}`)
);
const CHECKLIST_SOURCE_IDS = Object.freeze([
  "tcdb.set.2551", "psa.set-registry.25618"
]);
const HR14_SOURCE_IDS = Object.freeze([
  "tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708"
]);
const SOURCE_IDS_BY_FIELD = deepFreeze({
  year: HR14_SOURCE_IDS,
  manufacturer: ["beckett.item.3117708"],
  product: HR14_SOURCE_IDS,
  set: HR14_SOURCE_IDS,
  subjects: HR14_SOURCE_IDS,
  team: ["tcdb.set.2551", "beckett.item.3117708"],
  card_number: HR14_SOURCE_IDS
});

// Source snapshots are release evidence, not a hostname allowlist. A legal
// source id at a changed path/hash/date is different evidence and must not be
// reinterpreted as either the v1 or v2 pack after a rollback.
const EXTERNAL_IDENTITY_SOURCE_SNAPSHOTS = deepFreeze({
  f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2: {
    "tcdb.set.2551": {
      provider: "TCDB",
      url: "https://www.tcdb.com/Checklist.cfm/sid/2551/1996-97-Stadium-Club---High-Risers",
      retrieved_at: "2026-08-10",
      fact_sha256: "57742a7673c905bd6db1d7e3322801fb78a8709b335aad9738b22adb855e4c1d"
    },
    "psa.set-registry.25618": {
      provider: "PSA",
      url: "https://www.psacard.com/psasetregistry/basketball/company-sets/1996-97-stadium-club-high-risers-members-only/composition/25618",
      retrieved_at: "2026-08-10",
      fact_sha256: "83fd1914ef27e6c1191a64b830a83423eb7d185cdbbb3e22c6a9f1b7df86f392"
    },
    "beckett.item.3117708": {
      provider: "Beckett",
      url: "https://www.beckett.com/basketball/1996-97/stadium-club-high-risers/hr14-michael-jordan-3117708",
      retrieved_at: "2026-08-10",
      fact_sha256: "f13da45a28bc73b8abad4980493a9eee369435022342231b77a3bed8b1a3653c"
    }
  }
});

const EXTERNAL_IDENTITY_RECORD_SNAPSHOTS = deepFreeze({
  f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2: {
    "tcdb-2551-hr1": ["HR1", "Scottie Pippen", "Chicago Bulls", ["Bulls"]],
    "tcdb-2551-hr2": ["HR2", "Anfernee Hardaway", "Orlando Magic", ["Magic"]],
    "tcdb-2551-hr3": ["HR3", "Vin Baker", "Milwaukee Bucks", ["Bucks"]],
    "tcdb-2551-hr4": ["HR4", "Brent Barry", "Los Angeles Clippers", ["LA Clippers", "L.A. Clippers", "Clippers"]],
    "tcdb-2551-hr5": ["HR5", "Clyde Drexler", "Houston Rockets", ["Rockets"]],
    "tcdb-2551-hr6": ["HR6", "Kevin Garnett", "Minnesota Timberwolves", ["Timberwolves", "Wolves"]],
    "tcdb-2551-hr7": ["HR7", "Grant Hill", "Detroit Pistons", ["Pistons"]],
    "tcdb-2551-hr8": ["HR8", "Michael Finley", "Phoenix Suns", ["Suns"]],
    "tcdb-2551-hr9": ["HR9", "Jerry Stackhouse", "Philadelphia 76ers", ["76ers", "Sixers"]],
    "tcdb-2551-hr10": ["HR10", "Isaiah Rider", "Portland Trail Blazers", ["Trail Blazers", "Blazers"]],
    "tcdb-2551-hr11": ["HR11", "Shaquille O'Neal", "Los Angeles Lakers", ["LA Lakers", "L.A. Lakers", "Lakers"]],
    "tcdb-2551-hr12": ["HR12", "Antonio McDyess", "Denver Nuggets", ["Nuggets"]],
    "tcdb-2551-hr13": ["HR13", "Shawn Kemp", "Seattle SuperSonics", ["Seattle Supersonics", "SuperSonics", "Supersonics", "Sonics"]],
    "tcdb-2551-hr14": ["HR14", "Michael Jordan", "Chicago Bulls", ["Bulls"]],
    "tcdb-2551-hr15": ["HR15", "Juwan Howard", "Washington Bullets", ["Bullets"]]
  }
});

const EXTERNAL_IDENTITY_FIELD_DECISION_POLICIES = deepFreeze({
  registry_thin_external_identity_high_risers_v1: {
    actions: ["FILL", "CORROBORATE", "NORMALIZE_ALIAS"],
    corrected_fields: [],
    correction_match_modes: []
  },
  registry_thin_external_identity_high_risers_v2: {
    actions: ["FILL", "CORROBORATE", "NORMALIZE_ALIAS", "CORRECT_CONFLICT"],
    corrected_fields: ["year", "set"],
    correction_match_modes: ["VERIFIED_ORIGINAL_SET"],
    correction_identity: {
      record_id: "tcdb-2551-hr14",
      canonical: {
        year: "1996-97",
        manufacturer: "Topps",
        product: "Stadium Club",
        set: "High Risers",
        subjects: ["Michael Jordan"],
        team: "Chicago Bulls",
        card_number: "HR14"
      },
      hard_anchors: ["manufacturer", "product", "subjects", "card_number"]
    }
  }
});

function externalIdentityPolicy(receipt) {
  const releaseId = String(receipt?.registry_release_id || "").trim();
  const release = externalIdentityReplayReleaseForReceipt(receipt);
  const decision = EXTERNAL_IDENTITY_FIELD_DECISION_POLICIES[releaseId];
  return release && decision ? { release, decision } : null;
}

function recordSnapshot(receipt) {
  const tuple = EXTERNAL_IDENTITY_RECORD_SNAPSHOTS[receipt?.pack_sha256]?.[receipt?.record_id];
  if (!tuple) return null;
  const [cardNumber, subject, team, teamAliases] = tuple;
  return {
    year: "1996-97",
    manufacturer: "Topps",
    product: "Stadium Club",
    set: "High Risers",
    subjects: [subject],
    team,
    team_aliases: teamAliases,
    card_number: cardNumber
  };
}

function recordSourceIds(recordId) {
  return recordId === "tcdb-2551-hr14" ? HR14_SOURCE_IDS : CHECKLIST_SOURCE_IDS;
}

function expectedSourceIds(recordId, field) {
  const recordSources = new Set(recordSourceIds(recordId));
  return (SOURCE_IDS_BY_FIELD[field] || []).filter((sourceId) => recordSources.has(sourceId));
}

function expectedDecisionFields(recordId) {
  return EXTERNAL_IDENTITY_FIELDS.filter((field) => expectedSourceIds(recordId, field).length > 0);
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const exactStrings = (values) => values.every((value) => (
    typeof value === "string" && value.length > 0 && value === value.trim()
  ));
  if (!exactStrings(left) || !exactStrings(right)) return false;
  return new Set(left).size === left.length
    && new Set(right).size === right.length
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function valueAbsent(value) {
  return Array.isArray(value)
    ? value.length === 0
    : !String(value ?? "").trim();
}

function decisionValuesEqual(field, observed, canonical) {
  if (Array.isArray(observed) || Array.isArray(canonical)) {
    if (!Array.isArray(observed) || !Array.isArray(canonical)
        || observed.length !== canonical.length) return false;
    return observed.every((value, index) => (
      normalizeTextExact(value) === normalizeTextExact(canonical[index])
    ));
  }
  return field === "card_number"
    ? normalizeCardNumberExact(observed) === normalizeCardNumberExact(canonical)
    : normalizeTextExact(observed) === normalizeTextExact(canonical);
}

function canonicalDecisionValueMatches(actual, expected) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => value === expected[index]);
  }
  return actual === expected;
}

function presentationMatches(field, observed, canonical) {
  const observedText = Array.isArray(observed) ? observed[0] : observed;
  const canonicalText = Array.isArray(canonical) ? canonical[0] : canonical;
  return field === "card_number"
    ? normalizeTextExact(String(observedText ?? "").replace(/#/g, ""))
      === normalizeTextExact(canonicalText)
    : normalizeTextExact(observedText) === normalizeTextExact(canonicalText);
}

function decisionActionMatchesValues(field, decision, record) {
  const absent = valueAbsent(decision.observed_value);
  if (decision.action === "FILL") return absent;
  const presentationEqual = !absent && presentationMatches(
    field,
    decision.observed_value,
    decision.canonical_value
  );
  if (decision.action === "CORROBORATE") return presentationEqual;
  if (decision.action === "NORMALIZE_ALIAS") {
    if (absent || presentationEqual) return false;
    if (field === "card_number") {
      return normalizeCardNumberExact(decision.observed_value)
        === normalizeCardNumberExact(decision.canonical_value);
    }
    if (field === "team") {
      return record.team_aliases.some((alias) => (
        normalizeTextExact(alias) === normalizeTextExact(decision.observed_value)
      ));
    }
    return false;
  }
  if (decision.action === "CORRECT_CONFLICT") return !absent && !presentationEqual;
  return false;
}

/** Validate the private durable decision ledger for either released tuple. */
export function validateExternalIdentityFieldDecisions(receipt) {
  const policy = externalIdentityPolicy(receipt);
  const decisions = receipt?.field_decisions;
  const recordId = String(receipt?.record_id || "").trim();
  const record = recordSnapshot(receipt);
  if (!policy || !HIGH_RISERS_RECORD_IDS.includes(recordId)
      || !record
      || !policy.release.match_modes.includes(receipt?.match_mode)
      || !decisions || typeof decisions !== "object" || Array.isArray(decisions)) return false;
  if (Object.entries(policy.release.receipt)
    .some(([field, value]) => receipt?.[field] !== value)) return false;

  const fields = expectedDecisionFields(recordId);
  if (JSON.stringify(Object.keys(decisions).sort()) !== JSON.stringify([...fields].sort())) return false;
  if (receipt.supported_fields != null
      && (!Array.isArray(receipt.supported_fields)
        || !sameStringSet(receipt.supported_fields, fields))) return false;
  if (receipt.match_mode === "VERIFIED_ORIGINAL_SET") {
    if (receipt.original_set_sha256 !== HR14_VERIFIED_ORIGINAL_SET_SHA256
        || recordId !== "tcdb-2551-hr14") return false;
  } else if (receipt.original_set_sha256 != null) return false;

  const allowedActions = new Set(policy.decision.actions);
  const correctedFields = new Set(policy.decision.corrected_fields);
  const correctionMatchModes = new Set(policy.decision.correction_match_modes);
  for (const [field, decision] of Object.entries(decisions)) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)
        || !allowedActions.has(decision.action)
        || !sameStringSet(decision.source_ids, expectedSourceIds(recordId, field))
        || !canonicalDecisionValueMatches(decision.canonical_value, record[field])
        || !decisionActionMatchesValues(field, decision, record)) return false;
    if (decision.action === "CORRECT_CONFLICT"
        && (!correctedFields.has(field) || !correctionMatchModes.has(receipt.match_mode))) return false;
  }

  const corrections = Object.entries(decisions)
    .filter(([, decision]) => decision.action === "CORRECT_CONFLICT")
    .map(([field]) => field).sort();
  if (receipt.corrected_fields != null
      && (!Array.isArray(receipt.corrected_fields)
        || !sameStringSet(receipt.corrected_fields, corrections))) return false;
  if (!corrections.length) return true;

  const correction = policy.decision.correction_identity;
  if (!correction || recordId !== correction.record_id) return false;
  for (const [field, canonical] of Object.entries(correction.canonical)) {
    if (!canonicalDecisionValueMatches(decisions[field]?.canonical_value, canonical)) return false;
  }
  return correction.hard_anchors.every((field) => (
    decisionValuesEqual(
      field,
      decisions[field]?.observed_value,
      correction.canonical[field]
    )
  ));
}

/** Bind the private decision values to the immutable provider observation. */
export function validateExternalIdentityDecisionObservation(receipt, observedFields, resolvedFields) {
  if (!validateExternalIdentityFieldDecisions(receipt)
      || !observedFields || typeof observedFields !== "object" || Array.isArray(observedFields)
      || !resolvedFields || typeof resolvedFields !== "object" || Array.isArray(resolvedFields)) return false;
  for (const field of Object.keys(receipt.field_decisions)) {
    const observed = field === "subjects"
      ? (Array.isArray(observedFields.subjects)
        ? observedFields.subjects
        : String(observedFields.subject || "").trim() ? [observedFields.subject] : [])
      : observedFields[field];
    const resolved = field === "subjects"
      ? (Array.isArray(resolvedFields.subjects)
        ? resolvedFields.subjects
        : String(resolvedFields.subject || "").trim() ? [resolvedFields.subject] : [])
      : resolvedFields[field];
    const decision = receipt.field_decisions[field];
    if (!canonicalDecisionValueMatches(
      observed ?? (field === "subjects" ? [] : ""),
      decision.observed_value
    ) || !canonicalDecisionValueMatches(resolved, decision.canonical_value)) return false;
  }
  return true;
}

/** Validate the full private source receipt before checkpoint persistence. */
export function validateExternalIdentitySourceProvenance(receipt) {
  if (!validateExternalIdentityFieldDecisions(receipt)) return false;
  const expectedIds = recordSourceIds(receipt.record_id);
  if (!sameStringSet(receipt.source_ids, expectedIds)
      || !Array.isArray(receipt.sources)
      || receipt.sources.length !== expectedIds.length) return false;
  const snapshots = EXTERNAL_IDENTITY_SOURCE_SNAPSHOTS[receipt.pack_sha256];
  if (!snapshots) return false;
  const seen = new Set();
  for (const source of receipt.sources) {
    const sourceId = source?.source_id;
    const snapshot = snapshots[sourceId];
    if (typeof sourceId !== "string" || !sourceId || sourceId !== sourceId.trim()
        || !snapshot || seen.has(sourceId)
        || source?.url !== snapshot.url
        || source?.retrieved_at !== snapshot.retrieved_at
        || source?.fact_sha256 !== snapshot.fact_sha256) return false;
    seen.add(sourceId);
  }
  if (receipt.source_field_map != null) {
    if (!receipt.source_field_map || typeof receipt.source_field_map !== "object"
        || Array.isArray(receipt.source_field_map)
        || JSON.stringify(Object.keys(receipt.source_field_map).sort())
          !== JSON.stringify([...EXTERNAL_IDENTITY_FIELDS].sort())) return false;
    for (const field of EXTERNAL_IDENTITY_FIELDS) {
      if (!sameStringSet(receipt.source_field_map[field], expectedSourceIds(receipt.record_id, field))) {
        return false;
      }
    }
  }
  return seen.size === expectedIds.length;
}

export function externalIdentitySourceSnapshot(receipt, sourceId) {
  const release = externalIdentityReplayReleaseForReceipt(receipt);
  if (!release || receipt?.pack_sha256 !== release.receipt.pack_sha256) return null;
  return EXTERNAL_IDENTITY_SOURCE_SNAPSHOTS[release.receipt.pack_sha256]?.[sourceId] || null;
}

/** Validate one durable REGISTRY evidence reference against its receipt. */
export function validateExternalIdentityEvidenceSourceRef(receipt, sourceRef) {
  if (!validateExternalIdentityFieldDecisions(receipt)
      || !sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return false;
  const field = sourceRef.field;
  const decision = receipt.field_decisions[field];
  if (typeof field !== "string" || !field || field !== field.trim()
      || !decision || sourceRef.support_type !== "EXACT_EXTERNAL_IDENTITY"
      || sourceRef.decision !== decision.action) return false;
  for (const fieldName of [
    "pack_id", "pack_version", "pack_sha256", "index_id", "index_version", "index_sha256",
    "record_id", "registry_release_id", "resolution_contract_sha256", "match_mode"
  ]) {
    if (sourceRef[fieldName] !== receipt[fieldName]) return false;
  }
  if ((sourceRef.original_set_sha256 ?? null) !== (receipt.original_set_sha256 ?? null)
      || !Array.isArray(sourceRef.sources)
      || sourceRef.sources.length !== decision.source_ids.length) return false;
  const seen = new Set();
  for (const source of sourceRef.sources) {
    const sourceId = source?.source_id;
    const snapshot = externalIdentitySourceSnapshot(receipt, sourceId);
    if (typeof sourceId !== "string" || !sourceId || sourceId !== sourceId.trim()
        || !snapshot || seen.has(sourceId) || !decision.source_ids.includes(sourceId)
        || source?.url !== snapshot.url
        || source?.retrieved_at !== snapshot.retrieved_at
        || source?.fact_sha256 !== snapshot.fact_sha256) return false;
    seen.add(sourceId);
  }
  return seen.size === decision.source_ids.length;
}

// Public receipts omit observed/canonical values and the reviewed image-set
// digest. They still have to preserve the exact release-scoped action/source
// matrix; the private writer validates the omitted bytes before projection.
export function validateExternalIdentityPublicFieldDecisions(receipt) {
  const policy = externalIdentityPolicy(receipt);
  const recordId = receipt?.record_id;
  const decisions = receipt?.field_decisions;
  if (typeof recordId !== "string" || !recordId || recordId !== recordId.trim()
      || !policy || !HIGH_RISERS_RECORD_IDS.includes(recordId)
      || !policy.release.match_modes.includes(receipt?.match_mode)
      || !decisions || typeof decisions !== "object" || Array.isArray(decisions)) return false;
  if (receipt.match_mode === "VERIFIED_ORIGINAL_SET" && recordId !== "tcdb-2551-hr14") {
    return false;
  }
  const fields = expectedDecisionFields(recordId);
  if (!Array.isArray(receipt.supported_fields)
      || !sameStringSet(receipt.supported_fields, fields)
      || JSON.stringify(Object.keys(decisions).sort()) !== JSON.stringify([...fields].sort())) return false;
  const allowedActions = new Set(policy.decision.actions);
  const correctedFields = new Set(policy.decision.corrected_fields);
  const correctionMatchModes = new Set(policy.decision.correction_match_modes);
  return Object.entries(decisions).every(([field, decision]) => (
    decision && typeof decision === "object" && !Array.isArray(decision)
      && allowedActions.has(decision.action)
      && sameStringSet(decision.source_ids, expectedSourceIds(recordId, field))
      && (decision.action !== "CORRECT_CONFLICT"
        || (correctedFields.has(field) && correctionMatchModes.has(receipt.match_mode)))
  ));
}

const EXTERNAL_IDENTITY_PUBLIC_RELEASE_POLICIES = deepFreeze({
  registry_thin_external_identity_high_risers_v1: {
    registry_version: "thin-path-external-identity-high-risers-v1",
    sem_standard_version: "linear-cos-10-23-v25"
  },
  registry_thin_external_identity_high_risers_v2: {
    registry_version: "thin-path-external-identity-high-risers-v2",
    sem_standard_version: "linear-cos-10-23-v25"
  }
});

/** Validate the complete already-projected Glass Box receipt as one tuple. */
export function validateExternalIdentityPublicReceipt(value) {
  const releaseId = value?.registry_release?.id;
  const release = externalIdentityReplayReleaseForReceipt({ registry_release_id: releaseId });
  const publicPolicy = EXTERNAL_IDENTITY_PUBLIC_RELEASE_POLICIES[releaseId];
  if (typeof releaseId !== "string" || !releaseId || releaseId !== releaseId.trim()
      || !release || !publicPolicy
      || value?.schema_version !== "csm-external-identity-public-receipt.v1"
      || value?.status !== "APPLIED"
      || value?.registry_release?.registry_version !== publicPolicy.registry_version
      || value?.registry_release?.content_sha256 !== release.receipt.pack_sha256
      || value?.registry_release?.sem_standard_version !== publicPolicy.sem_standard_version
      || value?.resolver_version !== release.resolution.resolver_version
      || value?.conflict_policy_version !== release.resolution.conflict_policy_version
      || value?.composer_version !== release.output.composer_version
      || value?.marketplace_profile_version !== release.output.marketplace_profile_version
      || value?.resolution_contract_sha256 !== release.receipt.resolution_contract_sha256
      || value?.pack?.id !== release.receipt.pack_id
      || value?.pack?.version !== release.receipt.pack_version
      || value?.pack?.sha256 !== release.receipt.pack_sha256
      || value?.index?.id !== release.receipt.index_id
      || value?.index?.version !== release.receipt.index_version
      || value?.index?.sha256 !== release.receipt.index_sha256
      || !validateExternalIdentityPublicFieldDecisions({
        registry_release_id: releaseId,
        record_id: value?.record_id,
        match_mode: value?.match_basis,
        supported_fields: value?.supported_fields,
        field_decisions: value?.field_decisions
      })) return false;

  const expectedIds = recordSourceIds(value.record_id);
  const actualSources = Array.isArray(value.sources) ? value.sources : [];
  if (actualSources.length !== expectedIds.length
      || !sameStringSet(actualSources.map((source) => source?.source_id), expectedIds)) return false;
  return expectedIds.every((sourceId) => {
    const snapshot = externalIdentitySourceSnapshot(release.receipt, sourceId);
    const actual = actualSources.find((source) => source?.source_id === sourceId);
    const fields = Object.entries(value.field_decisions)
      .filter(([, decision]) => decision.source_ids.includes(sourceId))
      .map(([field]) => field);
    return snapshot
      && actual?.provider === snapshot.provider
      && actual?.url === snapshot.url
      && actual?.retrieved_at === snapshot.retrieved_at
      && actual?.fact_sha256 === snapshot.fact_sha256
      && sameStringSet(actual?.fields, fields);
  });
}

export function computePostObservationResolutionContractSha256(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("post_observation_resolution_contract_invalid");
  }
  const { contract_sha256: _claimed, ...payload } = value;
  return sha256(payload);
}

export function validatePostObservationResolutionContract(value, { expectedSha256 = null } = {}) {
  const actual = computePostObservationResolutionContractSha256(value);
  const claimed = String(value?.contract_sha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claimed) || claimed !== actual
      || (expectedSha256 && claimed !== String(expectedSha256).trim().toLowerCase())) {
    throw new TypeError("post_observation_resolution_contract_sha256_mismatch");
  }
  return value;
}

function normalizeTextExact(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCardNumberExact(value) {
  return normalizeTextExact(value)
    .replace(/#/g, "")
    .replace(/\s+/g, "");
}

function observedSubjects(fields = {}) {
  if (Array.isArray(fields.subjects)) {
    return fields.subjects.map((value) => String(value ?? "").trim()).filter(Boolean);
  }
  const subject = String(fields.subject ?? "").trim();
  return subject ? [subject] : [];
}

function anchorValues(fields = {}) {
  const subjects = observedSubjects(fields);
  return {
    manufacturer: normalizeTextExact(fields.manufacturer),
    product: normalizeTextExact(fields.product),
    subject: subjects.length === 1 ? normalizeTextExact(subjects[0]) : "",
    card_number: normalizeCardNumberExact(fields.card_number),
    subject_count: subjects.length
  };
}

function recordAnchors(record) {
  return {
    manufacturer: normalizeTextExact(record.manufacturer),
    product: normalizeTextExact(record.product),
    subject: normalizeTextExact(record.subject),
    card_number: normalizeCardNumberExact(record.card_number)
  };
}

function sourceRefs(sourceIds) {
  const sourceSet = new Set(sourceIds);
  return EXTERNAL_IDENTITY_SUPPORT_PACK.sources
    .filter((source) => sourceSet.has(source.source_id))
    .map(({ source_id, url, retrieved_at, fact_sha256 }) => ({
      source_id,
      url,
      retrieved_at,
      fact_sha256
    }));
}

function receiptBase(status, reason) {
  return {
    schema_version: RECEIPT_SCHEMA,
    status,
    reason,
    pack_id: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
    pack_version: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
    pack_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
    index_id: EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
    index_version: EXTERNAL_IDENTITY_SUPPORT_PACK.index_version,
    index_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256,
    registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
  };
}

function abstain(fields, reason, details = {}) {
  return {
    status: "ABSTAINED",
    reason,
    fields: { ...fields },
    support: null,
    receipt: {
      ...receiptBase("ABSTAINED", reason),
      ...details
    }
  };
}

function optionalConflicts(fields, record) {
  const conflicts = [];
  for (const field of ["year", "set"]) {
    const observed = normalizeTextExact(fields[field]);
    if (observed && observed !== normalizeTextExact(record[field])) conflicts.push(field);
  }

  const observedTeam = normalizeTextExact(fields.team);
  if (observedTeam) {
    const acceptedTeams = [record.team, ...(record.team_aliases || [])].map(normalizeTextExact);
    if (!acceptedTeams.includes(observedTeam)) conflicts.push("team");
  }
  return conflicts;
}

function identityConflicts(fields, record) {
  const conflicts = [];
  const subjects = observedSubjects(fields);
  if (subjects.length > 1
      || (subjects.length === 1
        && normalizeTextExact(subjects[0]) !== normalizeTextExact(record.subject))) {
    conflicts.push("subject");
  }
  for (const field of ["manufacturer", "product", "card_number", "year", "set"]) {
    const observed = field === "card_number"
      ? normalizeCardNumberExact(fields[field])
      : normalizeTextExact(fields[field]);
    if (!observed) continue;
    const canonical = field === "card_number"
      ? normalizeCardNumberExact(record[field])
      : normalizeTextExact(record[field]);
    if (observed !== canonical) conflicts.push(field);
  }
  const observedTeam = normalizeTextExact(fields.team);
  if (observedTeam) {
    const acceptedTeams = [record.team, ...(record.team_aliases || [])].map(normalizeTextExact);
    if (!acceptedTeams.includes(observedTeam)) conflicts.push("team");
  }
  return conflicts;
}

function matchVerifiedOriginalSet(externalIdentityContext, index) {
  const values = externalIdentityContext?.originalImageSha256;
  if (values == null) return { state: "ABSENT", digest: null, record: null };
  let digest;
  try {
    digest = computeVerifiedOriginalSetSha256(values);
  } catch {
    return { state: "INVALID", digest: null, record: null };
  }
  const recordId = index?.original_set_record_ids?.[digest];
  if (!recordId) return { state: "UNMAPPED", digest, record: null };
  const records = index.records.filter((record) => record.record_id === recordId);
  if (records.length !== 1) return { state: "BROKEN_MAPPING", digest, record: null };
  return { state: "MATCHED", digest, record: records[0] };
}

function verifiedOptionalObservations(fields, record) {
  const verified = {};
  for (const field of ["year", "set"]) {
    const observed = String(fields[field] ?? "").trim();
    if (!observed) continue;
    verified[field] = {
      observed,
      normalized: normalizeTextExact(observed),
      canonical_value: record[field],
      match: "CANONICAL"
    };
  }

  const observedTeam = String(fields.team ?? "").trim();
  if (observedTeam) {
    const normalizedTeam = normalizeTextExact(observedTeam);
    const alias = (record.team_aliases || []).find((value) => normalizeTextExact(value) === normalizedTeam);
    verified.team = {
      observed: observedTeam,
      normalized: normalizedTeam,
      canonical_value: record.team,
      match: normalizeTextExact(record.team) === normalizedTeam ? "CANONICAL" : "ALIAS",
      ...(alias ? { matched_alias: alias } : {})
    };
  }
  return verified;
}

function observedFieldValue(fields, field) {
  if (field === "subjects") return observedSubjects(fields);
  return fields[field];
}

function canonicalFieldValue(record, field) {
  return field === "subjects" ? [record.subject] : record[field];
}

function fieldDecision(fields, record, field, sourceIds) {
  const observed = observedFieldValue(fields, field);
  const canonical = canonicalFieldValue(record, field);
  const absent = Array.isArray(observed)
    ? observed.length === 0
    : !String(observed ?? "").trim();
  if (absent) {
    return { action: "FILL", observed_value: observed, canonical_value: canonical, source_ids: sourceIds };
  }

  const observedText = Array.isArray(observed) ? observed[0] : observed;
  const canonicalText = Array.isArray(canonical) ? canonical[0] : canonical;
  const presentationMatches = field === "card_number"
    ? normalizeTextExact(String(observedText).replace(/#/g, "")) === normalizeTextExact(canonicalText)
    : normalizeTextExact(observedText) === normalizeTextExact(canonicalText);
  return {
    action: presentationMatches ? "CORROBORATE" : "NORMALIZE_ALIAS",
    observed_value: observed,
    canonical_value: canonical,
    source_ids: sourceIds
  };
}

/**
 * Exact, deterministic identity support. It never mutates the observation and
 * never infers physical-copy fields. Missing, conflicting or non-unique input
 * abstains and returns the observation byte-for-byte at field value level.
 */
export function resolveExternalIdentitySupport(fields = {}, {
  index = HIGH_RISERS_EXTERNAL_IDENTITY_INDEX,
  externalIdentityContext = null
} = {}) {
  const anchors = anchorValues(fields);
  if (anchors.subject_count > 1) {
    return abstain(fields, "MULTIPLE_SUBJECTS", { subject_count: anchors.subject_count });
  }

  const missingAnchors = REQUIRED_ANCHORS.filter((name) => !anchors[name]);
  const matches = missingAnchors.length ? [] : index.records.filter((record) => {
    const candidate = recordAnchors(record);
    return REQUIRED_ANCHORS.every((name) => candidate[name] === anchors[name]);
  });
  if (matches.length > 1) {
    return abstain(fields, "AMBIGUOUS_MATCH", {
      match_count: matches.length,
      record_ids: matches.map((record) => record.record_id)
    });
  }

  const originalSetMatch = matchVerifiedOriginalSet(externalIdentityContext, index);
  if (originalSetMatch.state === "BROKEN_MAPPING") {
    return abstain(fields, "ORIGINAL_SET_MAPPING_INVALID", {
      original_set_sha256: originalSetMatch.digest
    });
  }
  if (originalSetMatch.record && matches[0]
      && originalSetMatch.record.record_id !== matches[0].record_id) {
    return abstain(fields, "IDENTITY_MATCH_DISAGREEMENT", {
      text_record_id: matches[0].record_id,
      original_set_record_id: originalSetMatch.record.record_id,
      original_set_sha256: originalSetMatch.digest
    });
  }

  const matchMode = originalSetMatch.record ? "VERIFIED_ORIGINAL_SET" : "EXACT_FOUR_ANCHOR";
  const record = originalSetMatch.record || matches[0];
  if (!record) {
    if (missingAnchors.length) {
      return abstain(fields, "MISSING_REQUIRED_ANCHOR", {
        missing_anchors: missingAnchors,
        original_set_match: originalSetMatch.state
      });
    }
    return abstain(fields, "NO_EXACT_MATCH", {
      matched_anchors: Object.fromEntries(REQUIRED_ANCHORS.map((name) => [name, anchors[name]])),
      original_set_match: originalSetMatch.state
    });
  }

  const conflictFields = matchMode === "VERIFIED_ORIGINAL_SET"
    ? identityConflicts(fields, record)
    : optionalConflicts(fields, record);
  if (conflictFields.length) {
    return abstain(fields, "CONFLICTING_OBSERVATION", {
      record_id: record.record_id,
      conflict_fields: conflictFields,
      match_mode: matchMode,
      ...(originalSetMatch.digest ? { original_set_sha256: originalSetMatch.digest } : {})
    });
  }

  const sources = sourceRefs(record.source_ids);
  const sourceFieldMap = Object.fromEntries(IDENTITY_FIELDS.map((field) => [
    field,
    record.source_ids.filter((sourceId) => {
      const source = EXTERNAL_IDENTITY_SUPPORT_PACK.sources.find((item) => item.source_id === sourceId);
      const sourceField = field === "subjects" ? "subject" : field;
      return source?.supports.includes(sourceField);
    })
  ]));
  const supportedFields = Object.fromEntries(IDENTITY_FIELDS
    .filter((field) => sourceFieldMap[field].length > 0)
    .map((field) => [field, canonicalFieldValue(record, field)]));
  const fieldDecisions = Object.fromEntries(Object.keys(supportedFields).map((field) => [
    field,
    fieldDecision(fields, record, field, sourceFieldMap[field])
  ]));

  return {
    status: "APPLIED",
    reason: null,
    fields: { ...fields, ...supportedFields },
    support: {
      record_id: record.record_id,
      fields: supportedFields,
      field_decisions: fieldDecisions,
      source_field_map: sourceFieldMap
    },
    receipt: {
      ...receiptBase("APPLIED", null),
      record_id: record.record_id,
      match_mode: matchMode,
      ...(matchMode === "VERIFIED_ORIGINAL_SET" ? {
        original_set_sha256: originalSetMatch.digest
      } : {}),
      matched_anchors: Object.fromEntries(REQUIRED_ANCHORS.map((name) => [name, anchors[name]])),
      verified_optional_observations: verifiedOptionalObservations(fields, record),
      field_decisions: fieldDecisions,
      supported_fields: Object.keys(supportedFields),
      source_ids: [...record.source_ids],
      sources
    }
  };
}
