#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  canonicalSemanticStateJson,
  canonicalProjectionAtoms,
  COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1,
  sha256SemanticState,
  validateCollectibleSemanticStateV1
} from "../experiments/csm-frontier/collectible-semantic-state-v1.mjs";
import {
  auditFrontierModelCsmResponse,
  buildFrontierModelCsmEnvelope,
  buildFrontierModelCsmRequest,
  FRONTIER_MODEL_CSM_EVALUATION_PROFILE,
  FRONTIER_MODEL_CSM_PROFILE_TARGETS,
  validateFrontierModelCsmAuditBundle
} from "../experiments/csm-frontier/frontier-model-csm-harness-v1.mjs";
import {
  evaluateSubsetAGroundedUnderstanding
} from "../experiments/csm-frontier/subset-a-grounded-understanding-v1.mjs";
import { CSM_ACTIVE_MODEL_PROFILE } from "../lib/listing/thin/csm-model-profile.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../fixtures/csm/subset-a-low-canonical-v1.json", import.meta.url),
  "utf8"
));

const jsonClone = (value) => JSON.parse(JSON.stringify(value));

function emptySchemaValue(schema) {
  if (schema.type === "string") return "";
  if (schema.type === "array") return [];
  if (schema.type === "object") {
    return Object.fromEntries((schema.required || []).map((key) => (
      [key, emptySchemaValue(schema.properties[key])]
    )));
  }
  throw new TypeError("unsupported_test_schema");
}

function completeProjection(fields) {
  return {
    ...emptySchemaValue(COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1.properties.canonical_projection),
    ...jsonClone(fields)
  };
}

function caseSources(entry) {
  const images = entry.images.map((image, index) => {
    const bytes = Buffer.from(`cos59-harness-fixture:${entry.id}:${image.name}`);
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      source_id: `src_${entry.id}_${index + 1}`,
      source_kind: "ORIGINAL_IMAGE",
      content_sha256: contentSha256,
      approval: "APPROVED_FOR_EVALUATION",
      payload: {
        image_ref: `data:image/webp;base64,${bytes.toString("base64")}`,
        image_name: image.name,
        image_sha256: contentSha256,
        governed_fixture_image_sha256: image.sha256
      }
    };
  });
  const approvedPayload = {
    authority: "governed_subset_a_fixture",
    case_id: entry.id,
    source_evidence_content_sha256: fixture.contract.source_evidence_content_sha256
  };
  return [...images, {
    source_id: `src_${entry.id}_approved_reference`,
    source_kind: "APPROVED_REFERENCE",
    content_sha256: sha256SemanticState(approvedPayload),
    approval: "APPROVED_FOR_EVALUATION",
    payload: approvedPayload
  }];
}

function stateFor(entry, envelope, { addOpenFact = false } = {}) {
  const sourceId = envelope.source_inventory[0].source_id;
  const projection = completeProjection(entry.canonical_fields);
  const facts = canonicalProjectionAtoms(projection).map((atom, index) => ({
    fact_id: `fact_${entry.id}_${index + 1}`,
    concept: `canonical.${atom.canonical_path}`,
    canonical_path: atom.canonical_path,
    value: atom.value,
    status: "SUPPORTED",
    confidence: "HIGH",
    source_ids: [sourceId]
  }));
  if (addOpenFact) {
    facts.push({
      fact_id: `fact_${entry.id}_open_medium`,
      concept: "collectible.medium",
      canonical_path: "",
      value: "trading card",
      status: "SUPPORTED",
      confidence: "HIGH",
      source_ids: [sourceId]
    });
  }
  return {
    schema_version: "collectible-semantic-state-v1",
    state_id: `css_subset_a_${entry.id}`,
    grammar: entry.canonical_fields.grammar,
    source_inventory_sha256: envelope.source_inventory_sha256,
    facts,
    relationships: [],
    uncertainties: [],
    canonical_projection: projection
  };
}

assert.equal(COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1.additionalProperties, false);
assert.deepEqual(
  FRONTIER_MODEL_CSM_PROFILE_TARGETS.map((target) => target.profile_id),
  ["lynca-standard-name-v0.2", "ebay-profile-v1"],
  "the harness must represent active LYNCA and a non-LYNCA historical profile"
);
assert.equal(CSM_ACTIVE_MODEL_PROFILE.reasoning_effort, "low");
assert.equal(CSM_ACTIVE_MODEL_PROFILE.image_detail, "high");
assert.equal(FRONTIER_MODEL_CSM_EVALUATION_PROFILE.reasoning_effort,
  CSM_ACTIVE_MODEL_PROFILE.reasoning_effort);
assert.equal(FRONTIER_MODEL_CSM_EVALUATION_PROFILE.image_detail,
  CSM_ACTIVE_MODEL_PROFILE.image_detail);

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("cos59_offline_harness_network_forbidden");
};

const envelopes = [];
const bundles = [];
try {
  for (const [index, entry] of fixture.cases.entries()) {
    const envelope = buildFrontierModelCsmEnvelope({
      caseId: entry.id,
      sources: caseSources(entry)
    });
    envelopes.push(envelope);
    const request = buildFrontierModelCsmRequest(envelope);
    assert.deepEqual(Object.keys(request).sort(), [
      "input", "max_output_tokens", "model", "reasoning", "text"
    ]);
    assert.equal(request.input.length, 1);
    assert.equal(request.input[0].role, "user");
    assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length,
      envelope.source_inventory.filter((source) => source.source_kind === "ORIGINAL_IMAGE").length);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.reasoning.effort, CSM_ACTIVE_MODEL_PROFILE.reasoning_effort);
    assert.ok(request.input[0].content.filter((part) => part.type === "input_image")
      .every((part) => part.detail === CSM_ACTIVE_MODEL_PROFILE.image_detail));
    assert.strictEqual(request.text.format.schema, COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1);
    assert.equal(Object.prototype.hasOwnProperty.call(request, "tools"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(request, "tool_choice"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(request, "retry"), false);
    const prompt = request.input[0].content.find((part) => part.type === "input_text").text;
    assert.ok(prompt.includes(envelope.source_inventory_sha256));
    for (const source of envelope.source_inventory) {
      assert.ok(prompt.includes(canonicalSemanticStateJson(source)),
        `${entry.id}: exact canonical source bytes must be in the sole user input`);
      assert.ok(prompt.includes(source.source_id));
      assert.ok(prompt.includes(source.content_sha256));
    }
    const state = stateFor(entry, envelope, { addOpenFact: index === 0 });
    const bundle = auditFrontierModelCsmResponse(envelope, state);
    bundles.push(bundle);
    assert.equal(
      bundle.recognition_audit_view.model_response_sha256,
      bundle.identity_resolution_audit_view.model_response_sha256,
      `${entry.id}: both audit views must derive from one model response`
    );
    assert.equal(bundle.isolated_stage_model_calls, 0);
    assert.equal(bundle.semantic_state.canonical_projection.grammar, state.grammar);
  }
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(networkCalls, 0);
assert.equal(bundles[0].semantic_state.facts.at(-1).concept, "collectible.medium");
assert.equal(bundles[0].semantic_state.facts.at(-1).canonical_path, "",
  "richer semantic facts must survive outside the canonical projection");

for (const mutate of [
  (value) => { value.source_inventory.pop(); },
  (value) => {
    const added = jsonClone(value.source_inventory[0]);
    added.source_id = "src_added";
    value.source_inventory.push(added);
  },
  (value) => { value.source_inventory[0].payload.image_name = "changed.webp"; }
]) {
  const changed = jsonClone(envelopes[0]);
  mutate(changed);
  assert.throws(() => buildFrontierModelCsmRequest(changed), /frontier_harness_inventory_drift/);
}

const exact = evaluateSubsetAGroundedUnderstanding({ fixture, envelopes, auditBundles: bundles });
assert.equal(exact.case_count, 16);
assert.equal(exact.provider_calls, 0);
assert.equal(exact.title_strings_read, false);
assert.equal(exact.marketplace_projection_evaluated, false);
assert.equal(exact.aggregate.f1, 1);
assert.equal(exact.critical_error_count, 0);
assert.equal(exact.open_fact_count_unscored, 1);

const titleMutatedFixture = jsonClone(fixture);
for (const entry of titleMutatedFixture.cases) {
  entry.expected.title = `projection-is-not-ground-truth-${entry.id}`;
  entry.expected.length = entry.expected.title.length;
}
const titleIndependent = evaluateSubsetAGroundedUnderstanding({
  fixture: titleMutatedFixture,
  envelopes,
  auditBundles: bundles
});
assert.deepEqual(titleIndependent.aggregate, exact.aggregate,
  "grounded understanding must be independent from expected marketplace titles");
assert.equal(titleIndependent.governed_label_sha256, exact.governed_label_sha256);

const wrongEntry = fixture.cases[0];
const wrongEnvelope = envelopes[0];
const wrongState = stateFor(wrongEntry, wrongEnvelope, { addOpenFact: true });
wrongState.canonical_projection.year = "2024";
wrongState.facts.find((fact) => fact.canonical_path === "year").value = "2024";
const wrongBundle = auditFrontierModelCsmResponse(wrongEnvelope, wrongState);
const wrongEval = evaluateSubsetAGroundedUnderstanding({
  fixture,
  envelopes,
  auditBundles: [wrongBundle, ...bundles.slice(1)]
});
assert.ok(wrongEval.aggregate.f1 < 1);
assert.equal(wrongEval.critical_error_count, 1);
assert.deepEqual(wrongEval.cases[0].critical_errors, ["year"]);

const unknownSource = stateFor(wrongEntry, wrongEnvelope);
unknownSource.facts[0].source_ids = ["src_unapproved"];
assert.throws(() => validateCollectibleSemanticStateV1(unknownSource, {
  sourceIds: wrongEnvelope.source_inventory.map((source) => source.source_id),
  sourceInventorySha256: wrongEnvelope.source_inventory_sha256
}), /semantic_state_fact_unknown_source/);

const extraKey = stateFor(wrongEntry, wrongEnvelope);
extraKey.private_reasoning = "must never be accepted";
assert.throws(() => auditFrontierModelCsmResponse(wrongEnvelope, extraKey),
  /semantic_state_shape/);

assert.throws(() => buildFrontierModelCsmEnvelope({
  caseId: "unapproved",
  sources: [{ ...caseSources(wrongEntry)[0], approval: "UNREVIEWED" }]
}), /frontier_harness_source_not_approved/);

const mismatchedImageSource = jsonClone(caseSources(wrongEntry)[0]);
mismatchedImageSource.payload.image_ref =
  `data:image/webp;base64,${Buffer.from("different-image-bytes").toString("base64")}`;
assert.throws(() => buildFrontierModelCsmEnvelope({
  caseId: "mismatched-image-bytes",
  sources: [mismatchedImageSource, caseSources(wrongEntry).at(-1)]
}), /frontier_harness_source_content_mismatch/,
"an original image claim must hash the actual decoded data URL bytes");

const mismatchedReferenceSource = jsonClone(caseSources(wrongEntry).at(-1));
mismatchedReferenceSource.payload.authority = "forged_reference";
assert.throws(() => buildFrontierModelCsmEnvelope({
  caseId: "mismatched-reference-payload",
  sources: [caseSources(wrongEntry)[0], mismatchedReferenceSource]
}), /frontier_harness_source_content_mismatch/,
"non-image evidence must hash its canonical payload bytes");

for (const mutate of [
  (value) => { value.semantic_state_sha256 = "0".repeat(64); },
  (value) => { value.model_response_sha256 = "0".repeat(64); },
  (value) => { value.recognition_audit_view.evidence_linked_fact_ids = []; },
  (value) => { value.identity_resolution_audit_view.selected_fact_ids = []; }
]) {
  const forged = jsonClone(bundles[0]);
  mutate(forged);
  assert.throws(
    () => validateFrontierModelCsmAuditBundle(envelopes[0], forged),
    /frontier_harness_audit_bundle_drift/
  );
  assert.throws(
    () => evaluateSubsetAGroundedUnderstanding({
      fixture,
      envelopes,
      auditBundles: [forged, ...bundles.slice(1)]
    }),
    /frontier_harness_audit_bundle_drift/,
    "the evaluator must recompute, not trust, every audit hash and derived view"
  );
}

for (const sourcePath of [
  "../experiments/csm-frontier/collectible-semantic-state-v1.mjs",
  "../experiments/csm-frontier/frontier-model-csm-harness-v1.mjs",
  "../experiments/csm-frontier/subset-a-grounded-understanding-v1.mjs"
]) {
  const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
}

process.stdout.write("COS-59 semantic-state harness: 16/16 grounded contract cases passed (offline)\n");
