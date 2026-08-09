#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  computeVerifiedOriginalSetSha256,
  EXTERNAL_IDENTITY_COMPOSER_VERSION,
  EXTERNAL_IDENTITY_CONFLICT_POLICY_VERSION,
  EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_RESOLVER_VERSION,
  EXTERNAL_IDENTITY_SUPPORT_PACK,
  externalIdentityReplayReleaseForReceipt,
  HIGH_RISERS_EXTERNAL_IDENTITY_INDEX,
  resolveExternalIdentitySupport,
  validateExternalIdentityFieldDecisions
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";

const HR14_ORIGINAL_SHA256 = Object.freeze([
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
]);
const HR14_ORIGINAL_SET_SHA256 =
  "61ee1d99b10690cf5877e9b5f08b53ba98051a3961d0a9e5c04f9e8e130db159";

const observedHr14 = {
  year: "",
  manufacturer: "Topps",
  product: "Stadium Club",
  set: "",
  subjects: ["Michael Jordan"],
  team: "Bulls",
  card_number: "HR 14",
  grammar: "standard",
  surface_color: "Rainbow",
  parallel_family: "Refractor",
  parallel_exact: "",
  print_finish: "",
  serial: "17/50",
  grading_info: { company: "PSA", card_grade: "9" },
  attributes: ["HOF"]
};

// The pack is a real 15-card checklist rather than a one-card conditional.
assert.equal(HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.length, 15);
assert.equal(new Set(HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.map((row) => row.record_id)).size, 15);
assert.equal(new Set(HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.map((row) => row.card_number)).size, 15);
assert.deepEqual(
  HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.map((row) => row.card_number),
  Array.from({ length: 15 }, (_, index) => `HR${index + 1}`)
);
assert.equal(computeVerifiedOriginalSetSha256(HR14_ORIGINAL_SHA256), HR14_ORIGINAL_SET_SHA256);
assert.equal(
  computeVerifiedOriginalSetSha256([...HR14_ORIGINAL_SHA256].reverse()),
  HR14_ORIGINAL_SET_SHA256,
  "verified originals are an unordered set, not a storage-role pair"
);
assert.deepEqual(HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.original_set_record_ids, {
  [HR14_ORIGINAL_SET_SHA256]: "tcdb-2551-hr14"
});
const originalSetMappingText = JSON.stringify(
  HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.original_set_record_ids
).toLowerCase();
for (const componentHash of HR14_ORIGINAL_SHA256) {
  assert.doesNotMatch(originalSetMappingText, new RegExp(componentHash));
}
assert.doesNotMatch(originalSetMappingText, /title|michael|jordan|chicago|bulls/,
  "runtime identity mapping must be digest -> record_id only");

// Published replay descriptors are literal append-only history. This exact v1
// assertion prevents a future active-pack replacement from editing or deleting
// the old tuple while adding its own sibling release.
const expectedReplayV1 = {
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
};
assert.deepEqual(
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1,
  expectedReplayV1
);
assert.equal(Object.isFrozen(EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY), true);
assert.equal(Object.isFrozen(
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1
), true);
assert.equal(Object.isFrozen(
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v2
), true);
assert.equal(externalIdentityReplayReleaseForReceipt({ registry_release_id: "unknown" }), null);

// Active parity is a release-time gate only. Replay itself reads the literal
// snapshot above and therefore remains valid after active constants move on.
const activeReplayRelease = externalIdentityReplayReleaseForReceipt({
  registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID
});
assert.deepEqual(activeReplayRelease.receipt, {
  schema_version: "csm-external-identity-support-receipt.v2",
  pack_id: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
  pack_version: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
  pack_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
  index_id: EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
  index_version: EXTERNAL_IDENTITY_SUPPORT_PACK.index_version,
  index_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256,
  registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
});
assert.deepEqual(activeReplayRelease.resolution, {
  registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  resolver_version: EXTERNAL_IDENTITY_RESOLVER_VERSION,
  conflict_policy_version: EXTERNAL_IDENTITY_CONFLICT_POLICY_VERSION
});
assert.deepEqual(activeReplayRelease.output, {
  composer_version: EXTERNAL_IDENTITY_COMPOSER_VERSION,
  marketplace_profile_version: EXTERNAL_IDENTITY_MARKETPLACE_PROFILE_VERSION
});

const applied = resolveExternalIdentitySupport(observedHr14);
assert.equal(applied.status, "APPLIED");
assert.equal(applied.receipt.match_mode, "EXACT_FOUR_ANCHOR");
assert.equal(applied.receipt.original_set_sha256, undefined);
assert.equal(applied.reason, null);
assert.deepEqual(applied.support.fields, {
  year: "1996-97",
  manufacturer: "Topps",
  product: "Stadium Club",
  set: "High Risers",
  subjects: ["Michael Jordan"],
  team: "Chicago Bulls",
  card_number: "HR14"
});
assert.equal(applied.fields.year, "1996-97");
assert.equal(applied.fields.set, "High Risers");
assert.equal(applied.fields.team, "Chicago Bulls");
assert.equal(applied.fields.card_number, "HR14");

// Registry identity support cannot write or erase physical-copy observations.
for (const field of [
  "surface_color", "parallel_family", "parallel_exact", "print_finish",
  "serial", "grading_info", "attributes"
]) {
  assert.deepEqual(applied.fields[field], observedHr14[field]);
}
assert.deepEqual(observedHr14.subjects, ["Michael Jordan"]);
assert.equal(observedHr14.team, "Bulls");
assert.equal(observedHr14.card_number, "HR 14");

assert.equal(applied.receipt.pack_id, EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id);
assert.equal(applied.receipt.index_id, HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.index_id);
for (const digest of [
  applied.receipt.pack_sha256,
  applied.receipt.index_sha256,
  ...applied.receipt.sources.map((source) => source.fact_sha256)
]) {
  assert.match(digest, /^[a-f0-9]{64}$/);
}
assert.deepEqual(applied.receipt.source_ids, [
  "tcdb.set.2551",
  "psa.set-registry.25618",
  "beckett.item.3117708"
]);
assert.equal(applied.receipt.sources.length, 3);
for (const source of applied.receipt.sources) {
  assert.match(source.url, /^https:\/\/(?:www\.)?(?:tcdb\.com|psacard\.com|beckett\.com)\//);
}
assert.ok(applied.support.source_field_map.team.includes("beckett.item.3117708"));
assert.deepEqual(applied.receipt.verified_optional_observations.team, {
  observed: "Bulls",
  normalized: "bulls",
  canonical_value: "Chicago Bulls",
  match: "ALIAS",
  matched_alias: "Bulls"
});
assert.equal(applied.support.field_decisions.year.action, "FILL");
assert.equal(applied.support.field_decisions.set.action, "FILL");
assert.equal(applied.support.field_decisions.manufacturer.action, "CORROBORATE");
assert.equal(applied.support.field_decisions.product.action, "CORROBORATE");
assert.equal(applied.support.field_decisions.subjects.action, "CORROBORATE");
assert.equal(applied.support.field_decisions.team.action, "NORMALIZE_ALIAS");
assert.equal(applied.support.field_decisions.card_number.action, "NORMALIZE_ALIAS");
assert.deepEqual(applied.receipt.field_decisions, applied.support.field_decisions);
assert.equal(validateExternalIdentityFieldDecisions(applied.receipt), true,
  "the validator must accept the resolver's HR 14 presentation alias");
for (const [field, canonicalValue] of [
  ["manufacturer", "topps"],
  ["subjects", ["michael jordan"]],
  ["card_number", "HR 14"]
]) {
  const canonicalPresentationDrift = structuredClone(applied.receipt);
  canonicalPresentationDrift.field_decisions[field].canonical_value = canonicalValue;
  assert.equal(validateExternalIdentityFieldDecisions(canonicalPresentationDrift), false,
    `${field} canonical_value must byte-match the frozen source fact`);
}

// Data and receipts contain facts and provenance, never an assembled answer.
const packText = JSON.stringify(EXTERNAL_IDENTITY_SUPPORT_PACK).toLowerCase();
const receiptText = JSON.stringify(applied.receipt).toLowerCase();
for (const forbidden of ["final_title", "ground_truth", "gold_label", "target_title"]) {
  assert.doesNotMatch(packText, new RegExp(forbidden));
  assert.doesNotMatch(receiptText, new RegExp(forbidden));
}

function assertAbstains(fields, reason, options) {
  const result = resolveExternalIdentitySupport(fields, options);
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, reason);
  assert.deepEqual(result.fields, fields);
  assert.equal(result.support, null);
  return result;
}

assertAbstains({ ...observedHr14, product: "Finest" }, "NO_EXACT_MATCH");
assertAbstains({ ...observedHr14, product: "Stadium-Club" }, "NO_EXACT_MATCH");
assertAbstains({ ...observedHr14, card_number: "" }, "MISSING_REQUIRED_ANCHOR");
assertAbstains({ ...observedHr14, card_number: "HR-14" }, "NO_EXACT_MATCH");
assertAbstains({ ...observedHr14, card_number: "HR014" }, "NO_EXACT_MATCH");
assertAbstains({ ...observedHr14, subjects: [] }, "MISSING_REQUIRED_ANCHOR");
assertAbstains({ ...observedHr14, subjects: ["Michael Jordan", "Scottie Pippen"] }, "MULTIPLE_SUBJECTS");
assertAbstains({ ...observedHr14, year: "1997-98" }, "CONFLICTING_OBSERVATION");
assertAbstains({ ...observedHr14, set: "Members Only" }, "CONFLICTING_OBSERVATION");
assertAbstains({ ...observedHr14, team: "Orlando Magic" }, "CONFLICTING_OBSERVATION");

const emptyCardNumber = { ...observedHr14, card_number: "" };
const verifiedOriginal = resolveExternalIdentitySupport(emptyCardNumber, {
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 }
});
assert.equal(verifiedOriginal.status, "APPLIED");
assert.equal(verifiedOriginal.receipt.match_mode, "VERIFIED_ORIGINAL_SET");
assert.equal(verifiedOriginal.receipt.original_set_sha256, HR14_ORIGINAL_SET_SHA256);
assert.equal(verifiedOriginal.receipt.record_id, "tcdb-2551-hr14");
assert.equal(verifiedOriginal.fields.card_number, "HR14");
assert.equal(verifiedOriginal.support.field_decisions.card_number.action, "FILL");

// Candidate run 31331365633: Luna low read the four hard anchors correctly but
// confused this release with 1994-95 Hardwood Heroes. The reviewed original
// set and all four text anchors select the same HR14 record, so v2 corrects
// only release year/set while retaining the physical-copy observation.
const liveCandidateObservation = {
  ...observedHr14,
  year: "1994-95",
  set: "Hardwood Heroes",
  team: "Chicago Bulls",
  card_number: "HR14",
  parallel_family: "Foil",
  parallel_exact: "Members Only",
  print_finish: "Members Only",
  serial: "",
  grading_info: null,
  attributes: []
};
const liveCandidateSnapshot = structuredClone(liveCandidateObservation);
const correctedLiveCandidate = resolveExternalIdentitySupport(liveCandidateObservation, {
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 }
});
assert.equal(correctedLiveCandidate.status, "APPLIED");
assert.equal(correctedLiveCandidate.receipt.match_mode, "VERIFIED_ORIGINAL_SET");
assert.deepEqual(correctedLiveCandidate.receipt.corrected_fields, ["set", "year"]);
assert.equal(correctedLiveCandidate.fields.year, "1996-97");
assert.equal(correctedLiveCandidate.fields.set, "High Risers");
assert.equal(correctedLiveCandidate.fields.print_finish, "Members Only");
assert.equal(correctedLiveCandidate.support.field_decisions.year.action, "CORRECT_CONFLICT");
assert.equal(correctedLiveCandidate.support.field_decisions.set.action, "CORRECT_CONFLICT");
assert.equal(correctedLiveCandidate.support.field_decisions.card_number.action, "CORROBORATE");
assert.equal(correctedLiveCandidate.receipt.verified_optional_observations.year.match,
  "CORRECTED_CONFLICT");
assert.equal(correctedLiveCandidate.receipt.verified_optional_observations.set.match,
  "CORRECTED_CONFLICT");
assert.deepEqual(liveCandidateObservation, liveCandidateSnapshot,
  "release correction must not relabel the immutable Luna observation");
assert.equal(validateExternalIdentityFieldDecisions(correctedLiveCandidate.receipt), true);
const invalidV1Correction = {
  ...structuredClone(correctedLiveCandidate.receipt),
  ...EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1.receipt
};
assert.equal(validateExternalIdentityFieldDecisions(invalidV1Correction), false,
  "a v1 receipt cannot acquire the v2 correction action");
const invalidExactCorrection = structuredClone(correctedLiveCandidate.receipt);
invalidExactCorrection.match_mode = "EXACT_FOUR_ANCHOR";
delete invalidExactCorrection.original_set_sha256;
assert.equal(validateExternalIdentityFieldDecisions(invalidExactCorrection), false);
const invalidOriginalSet = structuredClone(correctedLiveCandidate.receipt);
invalidOriginalSet.original_set_sha256 = "f".repeat(64);
assert.equal(validateExternalIdentityFieldDecisions(invalidOriginalSet), false);
const incompleteSources = structuredClone(correctedLiveCandidate.receipt);
incompleteSources.field_decisions.year.source_ids = ["tcdb.set.2551"];
assert.equal(validateExternalIdentityFieldDecisions(incompleteSources), false);
const duplicateSources = structuredClone(correctedLiveCandidate.receipt);
duplicateSources.field_decisions.year.source_ids.push("tcdb.set.2551");
assert.equal(validateExternalIdentityFieldDecisions(duplicateSources), false);
const strippedCorrection = structuredClone(correctedLiveCandidate.receipt);
strippedCorrection.field_decisions.year.action = "FILL";
strippedCorrection.field_decisions.set.action = "FILL";
assert.equal(validateExternalIdentityFieldDecisions(strippedCorrection), false,
  "non-empty conflicting observations cannot be relabelled as missing values");
const forgedDecisionValues = structuredClone(correctedLiveCandidate.receipt);
for (const decision of Object.values(forgedDecisionValues.field_decisions)) {
  decision.observed_value = "forged";
  decision.canonical_value = "forged";
}
assert.equal(validateExternalIdentityFieldDecisions(forgedDecisionValues), false,
  "source-backed decisions must bind the immutable record values");

const reorderedVerifiedOriginal = resolveExternalIdentitySupport(emptyCardNumber, {
  externalIdentityContext: { originalImageSha256: [...HR14_ORIGINAL_SHA256].reverse() }
});
assert.equal(reorderedVerifiedOriginal.status, "APPLIED");
assert.equal(reorderedVerifiedOriginal.receipt.original_set_sha256, HR14_ORIGINAL_SET_SHA256);

for (const originalImageSha256 of [
  [HR14_ORIGINAL_SHA256[0]],
  [HR14_ORIGINAL_SHA256[0], HR14_ORIGINAL_SHA256[0]],
  [HR14_ORIGINAL_SHA256[0], "f".repeat(64)]
]) {
  const partial = assertAbstains(emptyCardNumber, "MISSING_REQUIRED_ANCHOR", {
    externalIdentityContext: { originalImageSha256 }
  });
  assert.notEqual(partial.receipt.match_mode, "VERIFIED_ORIGINAL_SET");
}
assertAbstains(emptyCardNumber, "MISSING_REQUIRED_ANCHOR", {
  externalIdentityContext: {
    originalImageSha256: ["c".repeat(64), "d".repeat(64)]
  }
});
assertAbstains(emptyCardNumber, "MISSING_REQUIRED_ANCHOR", {
  clientOriginalImageSha256: HR14_ORIGINAL_SHA256
});

const originalIdentityMismatches = [
  { manufacturer: "Upper Deck" },
  { product: "Finest" },
  { subjects: ["Scottie Pippen"] },
  { card_number: "HR1" },
  { year: "1997-98" },
  { set: "Members Only" },
  { team: "Orlando Magic" }
];
for (const mismatch of originalIdentityMismatches) {
  const conflict = assertAbstains({ ...emptyCardNumber, ...mismatch }, "CONFLICTING_OBSERVATION", {
    externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 }
  });
  assert.equal(conflict.receipt.match_mode, "VERIFIED_ORIGINAL_SET");
}

const conflictingTextIdentity = assertAbstains({
  ...observedHr14,
  subjects: ["Scottie Pippen"],
  card_number: "HR1"
}, "IDENTITY_MATCH_DISAGREEMENT", {
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 }
});
assert.equal(conflictingTextIdentity.receipt.text_record_id, "tcdb-2551-hr1");
assert.equal(conflictingTextIdentity.receipt.original_set_record_id, "tcdb-2551-hr14");

const hr14 = HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records.find((row) => row.card_number === "HR14");
const ambiguousIndex = {
  ...HIGH_RISERS_EXTERNAL_IDENTITY_INDEX,
  records: [...HIGH_RISERS_EXTERNAL_IDENTITY_INDEX.records, { ...hr14, record_id: "duplicate-hr14" }]
};
const ambiguous = assertAbstains(observedHr14, "AMBIGUOUS_MATCH", { index: ambiguousIndex });
assert.equal(ambiguous.receipt.match_count, 2);

// Text normalization is case/whitespace tolerant. Card numbers additionally
// remove only # and whitespace; punctuation and leading zeroes stay material.
const normalized = resolveExternalIdentitySupport({
  ...observedHr14,
  manufacturer: " TOPPS ",
  product: "Stadium   Club",
  subjects: ["Michael  Jordan"],
  card_number: "# HR 14",
  team: "Chicago Bulls"
});
assert.equal(normalized.status, "APPLIED");
assert.equal(normalized.fields.card_number, "HR14");

console.log("external-identity-support tests passed");
