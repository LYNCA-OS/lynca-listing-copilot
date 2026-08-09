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
    }
  }
});

export function externalIdentityReplayReleaseForReceipt(receipt) {
  const releaseId = String(receipt?.registry_release_id || "").trim();
  const releases = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases;
  return releaseId && Object.hasOwn(releases, releaseId) ? releases[releaseId] : null;
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
