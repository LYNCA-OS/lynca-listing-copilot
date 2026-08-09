#!/usr/bin/env node

import assert from "node:assert/strict";

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
import { verifyReplay } from "../lib/listing/thin/csm-replay.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import {
  computeVerifiedOriginalSetSha256,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";

const HR14_ORIGINAL_SHA256 = Object.freeze([
  "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
  "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
]);
const HR14_ORIGINAL_SET_SHA256 = computeVerifiedOriginalSetSha256(HR14_ORIGINAL_SHA256);

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
    return new Response(JSON.stringify({
      id: "resp_external_identity_fixture",
      model: "gpt-5.6-luna-2026-08-01",
      status: "completed",
      output_text: JSON.stringify(fields),
      reasoning: { effort: "low" },
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

let providerCalls = 0;
const prepared = await prepareCanonicalListingPath({
  tenantId: "tenant-external",
  recognitionSessionId: "session-hr14",
  imageUrls: ["https://example.test/front.jpg", "https://example.test/back.jpg"],
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  externalIdentityContext: { originalImageSha256: HR14_ORIGINAL_SHA256 },
  createdAt,
  callProvider: completedProvider(observedHr14, (request) => {
    providerCalls += 1;
    assert.equal(request.model, "gpt-5.6-luna");
    assert.equal(request.reasoning.effort, "low");
    assert.equal(request.max_output_tokens, 8192);
    assert.equal(Object.hasOwn(request, "tools"), false,
      "external identity resolution is deterministic and must not buy a second provider/tool call");
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
assert.equal(prepared.observed_fields.year, "");
assert.equal(prepared.observed_fields.set, "");
assert.equal(prepared.observed_fields.team, "Bulls");
assert.equal(prepared.observed_fields.card_number, "");
assert.equal(prepared.fields.year, "1996-97");
assert.equal(prepared.fields.set, "High Risers");
assert.equal(prepared.fields.team, "Chicago Bulls");
assert.equal(prepared.fields.card_number, "HR14");
for (const physicalField of ["surface_color", "parallel_family", "parallel_exact", "serial", "grade"]) {
  assert.deepEqual(prepared.fields[physicalField], prepared.observed_fields[physicalField],
    `${physicalField} must remain visual/current-copy authority`);
}

assert.equal(prepared.external_identity_support.status, "APPLIED");
assert.equal(prepared.external_identity_support.record_id, "tcdb-2551-hr14");
assert.equal(prepared.external_identity_support.match_mode, "VERIFIED_ORIGINAL_SET");
assert.equal(prepared.external_identity_support.original_set_sha256, HR14_ORIGINAL_SET_SHA256);
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
  const invalidMode = clone(prepared.csm_rows);
  invalidMode.output.structured_output.external_identity_support.match_mode = "FUZZY";
  for (const row of invalidMode.evidence.filter((entry) => entry.modality === "REGISTRY")) {
    row.source_ref.match_mode = "FUZZY";
  }
  const checked = verifyReplay(reseal(invalidMode), prepared.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "external_identity_match_mode_invalid"));
}

// No exact support changes neither canonical facts nor any deterministic CSM
// packet bytes. Only the top-level ABSTAINED diagnostic receipt is additional.
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
    dropped: baseline.dropped_brackets,
    suppressed: baseline.suppressed_brackets,
    restored: baseline.restored_brackets,
    truncated: baseline.truncated,
    input_empty_fields: baseline.input_empty_fields,
    normalization_reasons: baseline.normalization_reasons,
    character_budget: baseline.character_budget,
    length: baseline.length
  },
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
