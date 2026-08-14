#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  prepareCanonicalListingPath
} from "../lib/listing/thin/csm-orchestration.mjs";
import {
  buildCsmModelExecutionContract,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes,
  EBAY_EXTERNAL_IDENTITY_PROFILE_VERSION,
  THIN_EXTERNAL_IDENTITY_COMPOSER_VERSION,
  THIN_EXTERNAL_IDENTITY_RESOLVER_VERSION
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  replayFromRows,
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";
import {
  VERIFIED_EXTERNAL_IDENTITY_DROP_ORDER_V2
} from "../lib/listing/thin/canonical-composer.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  validateSetCardNameRelationTransition
} from "../lib/listing/thin/set-card-name-reconciliation.mjs";
import {
  computeVerifiedOriginalSetSha256,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";

const HR14_ORIGINAL_SHA256 = Object.freeze([
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
]);
const HR14_ORIGINAL_SET_SHA256 = computeVerifiedOriginalSetSha256(HR14_ORIGINAL_SHA256);
assert.deepEqual(VERIFIED_EXTERNAL_IDENTITY_DROP_ORDER_V2, [
  "print_finish", "card_number", "descriptive_rarity", "manufacturer",
  "product", "set", "release_variant", "card_name", "year"
]);

const createdAt = "2026-08-10T00:00:00Z";
const clone = (value) => structuredClone(value);

function reseal(rows) {
  rows.resolution.recognition_packet_sha256 = computeCsmPacketHashes(rows).csm_recognition_packet_sha256;
  rows.output.resolution_packet_sha256 = computeCsmPacketHashes(rows).csm_resolution_packet_sha256;
  rows.session_hashes = computeCsmPacketHashes(rows);
  return rows;
}

function completedProvider(fields, inspect = () => {}) {
  return async (request) => {
    inspect(request);
    const sourceFields = [
      "year", "language", "manufacturer", "product", "set", "subjects", "team",
      "card_name", "release_variant", "surface_color", "parallel_family",
      "parallel_exact", "descriptive_rarity", "card_number", "serial", "attributes",
      "grading_info", "grammar", "lot_count", "special_stamp", "description"
    ];
    const audited = {
      ...fields,
      field_sources: sourceFields.filter((field) => {
        const value = fields[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(String(value ?? "").trim());
      }).map((field) => ({ field, source_ids: ["original_image_1"] })),
      set_card_name_relations: {
        set: fields.set ? "CURRENT_CARD_MEMBER_OF_SET" : "",
        card_name: fields.card_name ? "CURRENT_CARD_NAMED_BY_DESIGN" : ""
      }
    };
    return new Response(JSON.stringify({
      id: "resp_external_identity_fixture",
      model: request.model,
      status: "completed",
      output_text: JSON.stringify(audited),
      reasoning: request.reasoning,
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 }
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_external_identity_fixture" }
    });
  };
}

const observedHr14 = {
  year: "",
  manufacturer: "Topps",
  product: "Stadium Club",
  set: "",
  subjects: ["Michael Jordan"],
  team: "Bulls",
  card_name: "",
  release_variant: "",
  surface_color: "Rainbow",
  parallel_family: "",
  parallel_exact: "",
  descriptive_rarity: "",
  card_number: "",
  serial: "",
  attributes: [],
  grade: "",
  grammar: "standard",
  lot_count: "",
  unreadable: [],
  low_confidence: []
};
const liveCandidateObservation = {
  ...observedHr14,
  year: "1994-95",
  set: "Hardwood Heroes",
  team: "Chicago Bulls",
  parallel_family: "Foil",
  parallel_exact: "Members Only",
  print_finish: "Members Only",
  card_number: "HR14"
};

let providerCalls = 0;
const prepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
  createdAt,
  callProvider: completedProvider(liveCandidateObservation, (request) => {
    providerCalls += 1;
    assert.equal(request.model, "gpt-5.6-luna");
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.max_output_tokens, 8192);
    assert.deepEqual(request.tools, [{ type: "web_search" }]);
    assert.equal(request.tool_choice, "auto");
    assert.equal(request.max_tool_calls, 2,
      "one provider request may use two bounded Web actions; registry resolution remains post-observation");
    const providerWire = JSON.stringify(request);
    for (const secretIdentity of [...HR14_ORIGINAL_SHA256, HR14_ORIGINAL_SET_SHA256]) {
      assert.doesNotMatch(providerWire, new RegExp(secretIdentity),
        "server-owned image identity must stay outside the provider wire");
    }
  })
});

assert.equal(providerCalls, 1);
assert.equal(
  prepared.title,
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls"
);
assert.equal(prepared.length, 73);
assert.equal(prepared.truncated, false);
assert.deepEqual(prepared.observed_fields.subjects, ["Michael Jordan"]);
assert.equal(prepared.observed_fields.year, "1994-95");
assert.equal(prepared.observed_fields.set, "Hardwood Heroes");
assert.equal(prepared.observed_fields.team, "Chicago Bulls");
assert.equal(prepared.observed_fields.card_number, "HR14");
assert.equal(prepared.fields.year, "1996-97");
assert.equal(prepared.fields.set, "High Risers");
assert.equal(prepared.fields.team, "Chicago Bulls");
assert.equal(prepared.fields.card_number, "HR14");
assert.deepEqual(prepared.set_card_name_relation_receipt.set, {
  predicate: "CURRENT_CARD_MEMBER_OF_SET",
  value: "High Risers"
}, "the final Set relation is re-issued only after the external resolver receipt validates");
assert.equal(prepared.set_card_name_relation_receipt.card_name, null);
for (const physicalField of [
  "surface_color", "parallel_family", "parallel_exact", "print_finish", "serial", "grade"
]) {
  assert.deepEqual(prepared.fields[physicalField], prepared.observed_fields[physicalField],
    `${physicalField} must remain visual/current-copy authority`);
}

assert.equal(prepared.external_identity_support.status, "APPLIED");
assert.equal(prepared.external_identity_support.record_id, "tcdb-2551-hr14");
assert.equal(prepared.external_identity_support.match_mode, "VERIFIED_ORIGINAL_SET");
assert.equal(prepared.external_identity_support.original_set_sha256, HR14_ORIGINAL_SET_SHA256);
assert.equal(prepared.external_identity_support.field_decisions.year.action, "CORRECT_CONFLICT");
assert.equal(prepared.external_identity_support.field_decisions.set.action, "CORRECT_CONFLICT");
assert.equal(prepared.external_identity_support.field_decisions.card_number.action, "CORROBORATE");
assert.ok(prepared.dropped_brackets.includes("print_finish"));
assert.ok(!prepared.dropped_brackets.includes("card_number"));
assert.equal(
  prepared.resolution_contract_sha256,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
);
assert.equal(prepared.csm_rows.resolution.registry_release_id, EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID);
assert.equal(prepared.csm_rows.resolution.resolver_version, THIN_EXTERNAL_IDENTITY_RESOLVER_VERSION);
assert.equal(prepared.csm_rows.output.composer_version, THIN_EXTERNAL_IDENTITY_COMPOSER_VERSION);
assert.equal(
  prepared.csm_rows.output.marketplace_profile_version,
  EBAY_EXTERNAL_IDENTITY_PROFILE_VERSION
);
assert.equal(
  prepared.csm_rows.output.structured_output.external_identity_support.match_mode,
  "VERIFIED_ORIGINAL_SET"
);
assert.equal(
  prepared.csm_rows.output.structured_output.external_identity_support.original_set_sha256,
  HR14_ORIGINAL_SET_SHA256
);
assert.equal(
  prepared.csm_rows.evidence.filter((row) => row.modality === "REGISTRY").length,
  7
);
for (const bracket of ["year", "manufacturer", "product", "set", "subject", "card_number", "search_optimization"]) {
  const resolved = prepared.csm_rows.resolved.find((row) => row.bracket === bracket);
  assert.ok(resolved.rationale_codes.includes("EXACT_EXTERNAL_IDENTITY_SUPPORT"), bracket);
  assert.equal(resolved.alternate_candidate_ids.length, 1, bracket);
}
assert.deepEqual(verifyReplay(prepared.csm_rows, prepared.title).problems, []);
assert.equal(createHash("sha256").update(JSON.stringify(prepared.csm_rows)).digest("hex"),
  "fb5b1f3c1f0cdccfeb7c43b6b392929f3ab34c6fc570f82caf7a38c2a91c8e86",
"the bridge must leave active v2 durable writer rows byte-identical");

{
  const forgedObservedCardName = clone(prepared.csm_rows);
  const visualTemplate = forgedObservedCardName.evidence.find((row) => (
    row.modality === "WHOLE_CARD_VISUAL"
  ));
  forgedObservedCardName.evidence.push({
    ...clone(visualTemplate),
    id: `${visualTemplate.id}-forged-card-name`,
    bracket: "card_name",
    raw_value: "FORGED OBSERVED CARD NAME",
    normalized_value: "FORGED OBSERVED CARD NAME"
  });
  reseal(forgedObservedCardName);
  const checked = verifyReplay(forgedObservedCardName, prepared.title);
  assert.equal(checked.ok, false,
    "a resealed visual Card Name transition cannot hide behind external Set authority");
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "set_card_name_relation_transition_invalid"
  )));
}

// Producer and validator must agree that identity-equivalent spacing is a
// presentation alias, not a canonical presentation. Exercise the full path so
// a valid HR 14 receipt cannot be produced and then rejected by build/replay.
let aliasProviderCalls = 0;
const aliasPrepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14-card-number-alias",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
  createdAt,
  callProvider: completedProvider({ ...liveCandidateObservation, card_number: "HR 14" }, () => {
    aliasProviderCalls += 1;
  })
});
assert.equal(aliasProviderCalls, 1);
assert.equal(aliasPrepared.title,
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls");
assert.equal(aliasPrepared.observed_fields.card_number, "HR 14");
assert.equal(aliasPrepared.fields.card_number, "HR14");
assert.equal(aliasPrepared.external_identity_support.field_decisions.card_number.action,
  "NORMALIZE_ALIAS");
assert.deepEqual(verifyReplay(aliasPrepared.csm_rows, aliasPrepared.title).problems, []);

for (const [index, setAlias] of ["high risers", "HIGH RISERS"].entries()) {
  const setAliasPrepared = await prepareCanonicalListingPath({
    tenantId: "tenant-external",
    recognitionSessionId: `session-hr14-set-alias-${index}`,
    imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
    createdAt,
    callProvider: completedProvider({ ...liveCandidateObservation, set: setAlias })
  });
  assert.equal(setAliasPrepared.observed_fields.set, setAlias);
  assert.equal(setAliasPrepared.fields.set, "High Risers");
  assert.equal(setAliasPrepared.external_identity_support.field_decisions.set.action,
    "CORROBORATE");
  assert.deepEqual(setAliasPrepared.set_card_name_relation_receipt.set, {
    predicate: "CURRENT_CARD_MEMBER_OF_SET",
    value: "High Risers"
  });
  assert.deepEqual(verifyReplay(
    setAliasPrepared.csm_rows, setAliasPrepared.title
  ).problems, []);
}

const setFillPrepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14-set-fill",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
  createdAt,
  callProvider: completedProvider({ ...liveCandidateObservation, set: "" })
});
assert.equal(setFillPrepared.external_identity_support.field_decisions.set.action, "FILL");
assert.deepEqual(setFillPrepared.set_card_name_relation_receipt.set, {
  predicate: "CURRENT_CARD_MEMBER_OF_SET", value: "High Risers"
});
assert.deepEqual(verifyReplay(setFillPrepared.csm_rows, setFillPrepared.title).problems, []);

assert.throws(() => validateSetCardNameRelationTransition({
  observedFields: prepared.observed_fields,
  resolvedFields: { ...prepared.fields, card_name: "Forged Card Name" },
  externalIdentitySupport: prepared.external_identity_support
}), /set_card_name_relation_authority_missing:card_name/,
"external identity authority cannot change Card Name under any decision action");

// An absent team does not imply an absent search_optimization observation:
// component signals share that SEM bracket. The replay binding must remove the
// fixed component vocabulary and still recover the exact empty team value.
const teamFillPrepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14-team-fill-rc",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
  createdAt,
  callProvider: completedProvider({
    ...liveCandidateObservation,
    team: "",
    attributes: ["RC"]
  })
});
assert.equal(teamFillPrepared.external_identity_support.field_decisions.team.action, "FILL");
assert.deepEqual(verifyReplay(teamFillPrepared.csm_rows, teamFillPrepared.title).problems, []);
{
  const injectedSearchSignal = clone(teamFillPrepared.csm_rows);
  const visualSearch = injectedSearchSignal.evidence.find((row) => (
    row.modality === "WHOLE_CARD_VISUAL" && row.bracket === "search_optimization"
  ));
  visualSearch.raw_value.push("Injected");
  visualSearch.normalized_value.push("Injected");
  const checked = verifyReplay(reseal(injectedSearchSignal), teamFillPrepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_observed_evidence_mismatch" && problem.field === "team"
  )));
}

// The v1 candidate receipt remains executable history. v2 changes only the
// active verified-external budget priority; it must not rewrite the title a
// previously persisted v1 tuple deterministically replays.
const replayV1 = composeCanonicalFieldsForStoredOutput(prepared.fields, {
  composer_version: "thin-marketplace-composer-v3-verified-external-identity",
  marketplace_profile_version: "ebay-verified-external-identity-v1",
  marketplace: "EBAY"
});
assert.equal(replayV1.title,
  "1996-97 Topps Stadium Club High Risers Michael Jordan Members Only Chicago Bulls");
assert.equal(replayV1.length, 80);
assert.ok(replayV1.dropped.includes("card_number"));
assert.ok(!replayV1.dropped.includes("print_finish"));
const replayV2 = composeCanonicalFieldsForStoredOutput(prepared.fields, {
  composer_version: THIN_EXTERNAL_IDENTITY_COMPOSER_VERSION,
  marketplace_profile_version: EBAY_EXTERNAL_IDENTITY_PROFILE_VERSION,
  marketplace: "EBAY"
});
assert.equal(replayV2.title,
  "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls");
assert.ok(replayV2.dropped.includes("print_finish"));
assert.ok(!replayV2.dropped.includes("card_number"));

// A no-correction exact packet is valid under both append-only release tuples.
const exactPrepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14-exact-release-replay",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  createdAt,
  callProvider: completedProvider({
    ...observedHr14,
    year: "1996-97",
    set: "High Risers",
    team: "Chicago Bulls",
    card_number: "HR14"
  })
});
assert.deepEqual(verifyReplay(exactPrepared.csm_rows, exactPrepared.title).problems, []);
const historicalV1Rows = clone(exactPrepared.csm_rows);
const historicalV1 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
  .registry_thin_external_identity_high_risers_v1;
const historicalMetadata = historicalV1Rows.output.structured_output.external_identity_support;
Object.assign(historicalMetadata, historicalV1.receipt);
Object.assign(historicalV1Rows.resolution, historicalV1.resolution);
Object.assign(historicalV1Rows.output, historicalV1.output);
for (const row of historicalV1Rows.evidence.filter((entry) => entry.modality === "REGISTRY")) {
  for (const field of [
    "pack_id", "pack_version", "pack_sha256", "index_id", "index_version", "index_sha256",
    "record_id", "registry_release_id", "resolution_contract_sha256", "match_mode"
  ]) {
    row.source_ref[field] = historicalMetadata[field];
  }
}
reseal(historicalV1Rows);
assert.deepEqual(verifyReplay(historicalV1Rows, historicalV1Rows.output.title).problems, [],
  "a literal v1 evidence tuple remains executable after v2 becomes active");

const forwardV3Rows = clone(prepared.csm_rows);
const forwardV3 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
  .registry_thin_external_identity_high_risers_v3;
const forwardV3Metadata = forwardV3Rows.output.structured_output.external_identity_support;
Object.assign(forwardV3Metadata, forwardV3.receipt);
forwardV3Metadata.field_decisions.product = {
  ...forwardV3Metadata.field_decisions.product,
  action: "CORRECT_CONFLICT",
  observed_value: "Stadium Club Basketball"
};
Object.assign(forwardV3Rows.resolution, forwardV3.resolution);
Object.assign(forwardV3Rows.output, forwardV3.output);
const forwardProductVisual = forwardV3Rows.evidence.find((row) => (
  row.modality === "WHOLE_CARD_VISUAL" && row.bracket === "product"
));
forwardProductVisual.raw_value = "Stadium Club Basketball";
forwardProductVisual.normalized_value = "Stadium Club Basketball";
for (const row of forwardV3Rows.evidence.filter((entry) => entry.modality === "REGISTRY")) {
  for (const field of [
    "pack_id", "pack_version", "pack_sha256", "index_id", "index_version", "index_sha256",
    "record_id", "registry_release_id", "resolution_contract_sha256", "match_mode"
  ]) {
    row.source_ref[field] = forwardV3Metadata[field];
  }
  row.source_ref.decision = forwardV3Metadata.field_decisions[row.source_ref.field].action;
  row.normalization_reason_code = `EXTERNAL_IDENTITY_${row.source_ref.decision}`;
}
reseal(forwardV3Rows);
assert.deepEqual(verifyReplay(forwardV3Rows, forwardV3Rows.output.title).problems, [],
  "the neutral bridge can replay a synthetic future v3 product/year/set decision tuple");
assert.equal(forwardV3Rows.output.title, prepared.title);
assert.deepEqual(forwardV3.output,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v2.output,
"v3 replay reuses the exact published v2 output implementation");

// Replay dispatches from the stored release receipt and validates that release
// as a closed tuple. Re-sealing these counterexamples proves the release checks
// catch self-consistent drift rather than relying on packet corruption alone.
for (const field of [
  "schema_version", "pack_id", "pack_version", "pack_sha256",
  "index_id", "index_version", "index_sha256", "resolution_contract_sha256"
]) {
  const tampered = clone(prepared.csm_rows);
  tampered.output.structured_output.external_identity_support[field] = `tampered-${field}`;
  for (const row of tampered.evidence.filter((entry) => entry.modality === "REGISTRY")) {
    if (Object.hasOwn(row.source_ref, field)) row.source_ref[field] = `tampered-${field}`;
  }
  const checked = verifyReplay(reseal(tampered), prepared.title);
  assert.equal(checked.ok, false, field);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_receipt_mismatch" && problem.field === field
  )), field);
}

for (const field of ["registry_release_id", "resolver_version", "conflict_policy_version"]) {
  const tampered = clone(prepared.csm_rows);
  tampered.resolution[field] = `tampered-${field}`;
  const checked = verifyReplay(reseal(tampered), prepared.title);
  assert.equal(checked.ok, false, field);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_resolution_receipt_mismatch" && problem.field === field
  )), field);
}

for (const field of ["composer_version", "marketplace_profile_version"]) {
  const tampered = clone(prepared.csm_rows);
  tampered.output[field] = `tampered-${field}`;
  const checked = verifyReplay(reseal(tampered), prepared.title);
  assert.equal(checked.ok, false, field);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_output_receipt_mismatch" && problem.field === field
  )), field);
}

{
  const unknown = clone(prepared.csm_rows);
  const releaseId = "registry_unknown_external_identity_v99";
  unknown.output.structured_output.external_identity_support.registry_release_id = releaseId;
  unknown.resolution.registry_release_id = releaseId;
  for (const row of unknown.evidence.filter((entry) => entry.modality === "REGISTRY")) {
    row.source_ref.registry_release_id = releaseId;
  }
  const checked = verifyReplay(reseal(unknown), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_replay_release_unsupported"
      && problem.registry_release_id === releaseId
  )));
}

{
  const mismatchedEvidence = clone(prepared.csm_rows);
  mismatchedEvidence.evidence.find((row) => row.modality === "REGISTRY")
    .source_ref.original_set_sha256 = "f".repeat(64);
  const checked = verifyReplay(reseal(mismatchedEvidence), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_evidence_receipt_mismatch"
      && problem.field === "original_set_sha256"
  )));
}

{
  const forgedSource = clone(prepared.csm_rows);
  const source = forgedSource.evidence.find((row) => row.modality === "REGISTRY")
    .source_ref.sources.find((item) => item.source_id === "tcdb.set.2551");
  source.url = "https://www.tcdb.com/forged-path";
  source.fact_sha256 = "f".repeat(64);
  const checked = verifyReplay(reseal(forgedSource), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_source_provenance_invalid"
  )));
}

{
  const missingCoverage = clone(prepared.csm_rows);
  let retained = false;
  missingCoverage.evidence = missingCoverage.evidence.filter((row) => {
    if (row.modality !== "REGISTRY") return true;
    if (!retained) {
      retained = true;
      return true;
    }
    return false;
  });
  const checked = verifyReplay(reseal(missingCoverage), prepared.title);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.filter((problem) => (
    problem.kind === "external_identity_field_evidence_cardinality_invalid"
      && problem.count === 0
  )).length, 6);
}

{
  const duplicateCoverage = clone(prepared.csm_rows);
  duplicateCoverage.evidence.push(clone(
    duplicateCoverage.evidence.find((row) => row.modality === "REGISTRY")
  ));
  reseal(duplicateCoverage);
  assert.throws(() => replayFromRows(duplicateCoverage),
    /external_identity_field_evidence_cardinality_invalid/,
    "direct replay must reject duplicate Registry authority evidence");
  const checked = verifyReplay(duplicateCoverage, prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_field_evidence_cardinality_invalid"
      && problem.count === 2
  )));
}

{
  const extraCoverage = clone(prepared.csm_rows);
  const extra = clone(extraCoverage.evidence.find((row) => row.modality === "REGISTRY"));
  extra.source_ref.field = "parallel_exact";
  extra.bracket = "print_finish";
  extraCoverage.evidence.push(extra);
  reseal(extraCoverage);
  assert.throws(() => replayFromRows(extraCoverage),
    /external_identity_source_provenance_invalid/,
    "direct replay must reject extra Registry authority evidence");
  const checked = verifyReplay(extraCoverage, prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_field_evidence_unexpected"
      && problem.field === "parallel_exact"
  )));
}

{
  const forgedObservedValues = clone(prepared.csm_rows);
  const decisions = forgedObservedValues.output.structured_output
    .external_identity_support.field_decisions;
  decisions.year.observed_value = "1988-89";
  decisions.set.observed_value = "Forged Set";
  const checked = verifyReplay(reseal(forgedObservedValues), prepared.title);
  assert.equal(checked.ok, false);
  for (const field of ["year", "set"]) {
    assert.ok(checked.problems.some((problem) => (
      problem.kind === "external_identity_observed_evidence_mismatch" && problem.field === field
    )), field);
  }
}

{
  const invalidMode = clone(prepared.csm_rows);
  invalidMode.output.structured_output.external_identity_support.match_mode = "FUZZY";
  for (const row of invalidMode.evidence.filter((entry) => entry.modality === "REGISTRY")) {
    row.source_ref.match_mode = "FUZZY";
  }
  const checked = verifyReplay(reseal(invalidMode), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "external_identity_match_mode_invalid"));
}

for (const mutate of [
  (receipt) => { receipt.field_decisions.subjects.action = "CORRECT_CONFLICT"; },
  (receipt) => { receipt.field_decisions.year.source_ids = ["tcdb.set.2551"]; },
  (receipt) => { receipt.field_decisions.year.source_ids = ["evil.source"]; },
  (receipt) => { delete receipt.field_decisions.manufacturer; },
  (receipt) => {
    receipt.match_mode = "EXACT_FOUR_ANCHOR";
    delete receipt.original_set_sha256;
  }
]) {
  const tampered = clone(prepared.csm_rows);
  mutate(tampered.output.structured_output.external_identity_support);
  const checked = verifyReplay(reseal(tampered), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "external_identity_field_decisions_invalid"
  )));
}

{
  const invalidSupport = clone(prepared.external_identity_support);
  invalidSupport.match_mode = "EXACT_FOUR_ANCHOR";
  delete invalidSupport.original_set_sha256;
  assert.throws(() => buildCsmStageRows({
    tenantId: "tenant-external",
    recognitionSessionId: "session-invalid-correction",
    fields: prepared.fields,
    observedFields: prepared.observed_fields,
    externalIdentitySupport: invalidSupport,
    composed: {
      grammar: prepared.grammar,
      brackets: prepared.brackets,
      dropped: prepared.dropped_brackets,
      suppressed: prepared.suppressed_brackets,
      restored: prepared.restored_brackets,
      truncated: prepared.truncated,
      input_empty_fields: prepared.input_empty_fields,
      normalization_reasons: prepared.normalization_reasons,
      character_budget: prepared.character_budget,
      length: prepared.length
    },
    title: prepared.title,
    registryReleaseId: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
    createdAt
  }), /external_identity_release_receipt_mismatch/);
}

{
  const forgedObservedSupport = clone(prepared.external_identity_support);
  forgedObservedSupport.field_decisions.year.observed_value = "1988-89";
  assert.throws(() => buildCsmStageRows({
    tenantId: "tenant-external",
    recognitionSessionId: "session-forged-observed-decision",
    fields: prepared.fields,
    observedFields: prepared.observed_fields,
    externalIdentitySupport: forgedObservedSupport,
    composed: {
      grammar: prepared.grammar,
      brackets: prepared.brackets,
      dropped: prepared.dropped_brackets,
      suppressed: prepared.suppressed_brackets,
      restored: prepared.restored_brackets,
      truncated: prepared.truncated,
      input_empty_fields: prepared.input_empty_fields,
      normalization_reasons: prepared.normalization_reasons,
      character_budget: prepared.character_budget,
      length: prepared.length
    },
    title: prepared.title,
    registryReleaseId: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
    createdAt
  }), /external_identity_release_receipt_mismatch/);
}

// No exact registry support changes neither canonical facts nor deterministic
// CSM packet bytes. The mandatory v3 Web/relation receipts are held identical;
// only the top-level ABSTAINED registry diagnostic is additional.
const noMatchFields = {
  ...observedHr14,
  product: "Topps Chrome",
  subjects: ["Victor Wembanyama"],
  team: "San Antonio Spurs",
  card_number: "221",
  year: "2025-26"
};
const noMatch = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-no-match",
  imageUrls: ["https://example.test/front.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  createdAt,
  callProvider: completedProvider(noMatchFields)
});
const baseline = finishCanonicalTitle(JSON.stringify(noMatchFields));
const baselineRows = buildCsmStageRows({
  tenantId: "tenant-external",
  recognitionSessionId: "session-no-match",
  fields: baseline.fields,
  composed: {
    grammar: baseline.grammar,
    brackets: baseline.brackets,
    bracket_text: baseline.bracket_text,
    dropped: baseline.dropped_brackets,
    suppressed: baseline.suppressed_brackets,
    restored: baseline.restored_brackets,
    truncated: baseline.truncated,
    input_empty_fields: baseline.input_empty_fields,
    normalization_reasons: baseline.normalization_reasons,
    character_budget: baseline.character_budget,
    length: baseline.length,
    composer_version: baseline.composer_version,
    marketplace_profile_version: baseline.marketplace_profile_version,
    canonical_naming_trace: baseline.canonical_naming_trace,
    canonical_naming_publishable: baseline.canonical_naming_publishable,
    publication_coverage: baseline.publication_coverage
  },
  founderBetaWebReceipt: noMatch.founder_beta_web_receipt,
  setCardNameRelationReceipt: noMatch.set_card_name_relation_receipt,
  title: baseline.title,
  createdAt
});
assert.equal(noMatch.external_identity_support.status, "ABSTAINED");
assert.equal(noMatch.external_identity_support.reason, "NO_EXACT_MATCH");
assert.equal(noMatch.title, baseline.title);
assert.deepEqual(noMatch.fields, baseline.fields);
assert.deepEqual(noMatch.csm_rows, baselineRows);

// The model-execution wire remains the same model contract; the detachable
// resolution contract is a post-observation receipt, not prompt pollution.
const execution = buildCsmModelExecutionContract({
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  imageUrls: ["https://example.test/front.jpg"]
});
assert.equal(Object.hasOwn(execution, "resolution_contract_sha256"), false);

console.log("external identity production path: ok");
