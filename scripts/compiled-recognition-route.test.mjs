import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompiledRecognitionRoutePacket,
  CompiledRecognitionRouteContractError
} from "../lib/listing/evaluation/compiled-recognition-route.mjs";

const imageHash = "1".repeat(64);
const imageSetHash = "2".repeat(64);
const packHash = "3".repeat(64);
const manifestHash = "4".repeat(64);

function canonicalProducer() {
  return {
    kind: "CANONICAL_PREINGESTION_EVIDENCE",
    contract_revision: "preingestion-evidence-fields-v2",
    permission: "DIRECT_IMAGE_EVIDENCE"
  };
}

function source(overrides = {}) {
  return {
    source_id: "official-panini-product-pages",
    source_type: "OFFICIAL_PRODUCT_PAGE",
    source_version: "2026-07-30",
    source_trust: "OFFICIAL_CHECKLIST",
    rule_id: "release-pack-product-row-v1",
    ...overrides
  };
}

function releaseCandidate(overrides = {}) {
  return {
    id: "product-phoenix",
    field: "product",
    outcome: "VALUE",
    value: "Panini Phoenix",
    reason_code: "official_product_vocabulary",
    provenance: source(),
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    mode: "SHADOW",
    evaluation_scope: {
      split: "development",
      sample_id: "dev-card-001",
      holdout_consumed: false
    },
    image_snapshot: {
      schema_version: "immutable-image-snapshot-v1",
      image_generation_id: "asset-generation-001",
      image_set_sha256: imageSetHash,
      image_sha256: [imageHash]
    },
    release_pack: {
      schema_version: "release-pack-v1",
      pack_id: "panini-2025",
      revision: "2025-r1",
      content_sha256: packHash,
      source_manifest_sha256: manifestHash,
      candidates: [
        releaseCandidate(),
        releaseCandidate({
          id: "set-contours",
          field: "set_or_insert",
          value: "Contours",
          reason_code: "official_set_vocabulary"
        }),
        releaseCandidate({
          id: "parallel-unknown",
          field: "print_finish",
          outcome: "UNKNOWN",
          value: undefined,
          alternatives: ["Silver", "Blue"],
          reason_code: "official_parallel_vocabulary_not_decisive"
        }),
        releaseCandidate({
          id: "team-empty",
          field: "sport",
          outcome: "EMPTY",
          value: undefined,
          reason_code: "field_not_applicable"
        })
      ]
    },
    direct_image_evidence: [
      {
        id: "ocr-card-number",
        field: "card_number",
        value: "24",
        confidence: 0.99,
        modality: "CARD_TEXT_OCR",
        source_version: "google-vision-v1",
        normalization_version: "direct-text-v1",
        image_sha256: imageHash,
        producer: canonicalProducer()
      }
    ],
    prototype_scores: {
      schema_version: "product-prototype-score-v1",
      bank_revision: "product-bank-r1",
      scorer_revision: "local-cosine-v1",
      query_image_sha256: imageHash,
      rows: [{
        release_candidate_id: "product-phoenix",
        candidate_value: "Panini Phoenix",
        score: 0.94
      }]
    },
    ...overrides
  };
}

function expectCode(code, fn) {
  assert.throws(fn, (error) => (
    error instanceof CompiledRecognitionRouteContractError
    && error.code === code
  ));
}

function forbiddenDecisionKey(value) {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (["title", "sem", "resolved_fields", "selected_fields"].includes(key)) return true;
    if (forbiddenDecisionKey(child)) return true;
  }
  return false;
}

test("shadow compilation emits deterministic retrieval and unselected candidate packets only", () => {
  const first = buildCompiledRecognitionRoutePacket(input());
  const second = buildCompiledRecognitionRoutePacket(input());

  assert.deepEqual(first, second);
  assert.equal(first.execution.mode, "SHADOW");
  assert.equal(first.execution.production_effect, false);
  assert.equal(first.execution.provider_calls, 0);
  assert.equal(first.execution.holdout_consumed, false);
  assert.equal(first.candidate_packet.selected_candidate_id, null);
  assert.equal(first.candidate_packet.selection_owner_called, false);
  assert.equal(first.candidate_packet.resolution_owner_called, false);
  assert.equal(first.trace.output_boundary, "RETRIEVAL_AND_CANDIDATES_ONLY");
  assert.equal(forbiddenDecisionKey(first), false);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.candidate_packet.candidates));
});

test("VALUE, EMPTY, and UNKNOWN remain distinct and UNKNOWN is query-only", () => {
  const packet = buildCompiledRecognitionRoutePacket(input());
  assert.deepEqual(packet.trace.release_outcome_counts, { VALUE: 2, EMPTY: 1, UNKNOWN: 1 });

  const unknown = packet.retrieval_packet.release_constraints.find((row) => row.outcome === "UNKNOWN");
  assert.deepEqual(unknown.alternatives, ["Silver", "Blue"]);
  assert.equal(unknown.permission, "QUERY_EXPANSION_ONLY");
  assert.equal(unknown.direct_conflict, false);

  const unknownCandidates = packet.candidate_packet.candidates.filter((row) => row.release_outcome === "UNKNOWN");
  assert.deepEqual(unknownCandidates.map((row) => row.value), ["Silver", "Blue"]);
  assert.ok(unknownCandidates.every((row) => row.permission === "QUERY_EXPANSION_ONLY"));
  assert.ok(unknownCandidates.every((row) => row.eligibility === "AMBIGUOUS_QUERY_CANDIDATE"));

  const empty = packet.retrieval_packet.release_constraints.find((row) => row.outcome === "EMPTY");
  assert.equal(empty.permission, "EXPLICIT_EMPTY_CONSTRAINT");
  assert.equal(packet.candidate_packet.candidates.some((row) => row.release_candidate_id === "team-empty"), false);
});

test("direct current-image conflict blocks candidate transport without selecting an alternative", () => {
  const conflicting = input();
  conflicting.direct_image_evidence.push({
    id: "ocr-product",
    field: "product",
    value: "Panini Prizm",
    confidence: 0.99,
    modality: "CARD_TEXT_OCR",
    source_version: "google-vision-v1",
    normalization_version: "direct-text-v1",
    image_sha256: imageHash,
    producer: canonicalProducer()
  });
  const packet = buildCompiledRecognitionRoutePacket(conflicting);
  const phoenix = packet.candidate_packet.candidates.find((row) => row.release_candidate_id === "product-phoenix");
  assert.equal(phoenix.eligibility, "BLOCKED_BY_DIRECT_CONFLICT");
  assert.deepEqual(phoenix.contradicting_direct_evidence_ids, ["ocr-product"]);
  assert.equal(packet.candidate_packet.selected_candidate_id, null);
});

test("catalog-only packets are forbidden because current-image evidence is mandatory", () => {
  expectCode("DIRECT_IMAGE_EVIDENCE_REQUIRED", () => buildCompiledRecognitionRoutePacket(input({
    direct_image_evidence: []
  })));
});

test("holdout cannot enter the shadow/offline contract", () => {
  const candidate = input();
  candidate.evaluation_scope.split = "holdout";
  expectCode("HOLDOUT_FORBIDDEN", () => buildCompiledRecognitionRoutePacket(candidate));
});

test("Release Pack candidates require versioned provenance and cannot carry instance fields", () => {
  const unversioned = input();
  delete unversioned.release_pack.candidates[0].provenance.source_version;
  expectCode("TEXT_REQUIRED", () => buildCompiledRecognitionRoutePacket(unversioned));

  const instanceField = input();
  instanceField.release_pack.candidates[0].field = "cert_number";
  expectCode("RETRIEVAL_FIELD_NOT_ALLOWED", () => buildCompiledRecognitionRoutePacket(instanceField));
});

test("prototype scores are local query support and must link to this image and Release Pack", () => {
  const packet = buildCompiledRecognitionRoutePacket(input());
  const phoenix = packet.candidate_packet.candidates.find((row) => row.release_candidate_id === "product-phoenix");
  assert.equal(phoenix.prototype_support.permission, "QUERY_EXPANSION_ONLY");
  assert.equal(phoenix.prototype_support.score, 0.94);
  assert.equal(phoenix.eligibility, "UNSELECTED_CANDIDATE");

  const prototypeAsDirectEvidence = input();
  prototypeAsDirectEvidence.direct_image_evidence.push({
    id: "mark-product",
    field: "product",
    value: "Panini Phoenix",
    confidence: 0.91,
    modality: "DIRECT_VISUAL_OBSERVATION",
    source_version: "product-mark-bank-v1",
    normalization_version: "mark-label-v1",
    image_sha256: imageHash,
    producer: {
      kind: "LOCAL_PRODUCT_PROTOTYPE",
      contract_revision: "product-mark-bank-v1",
      permission: "DIRECT_IMAGE_EVIDENCE"
    }
  });
  expectCode("DIRECT_EVIDENCE_PRODUCER_NOT_ALLOWED", () => (
    buildCompiledRecognitionRoutePacket(prototypeAsDirectEvidence)
  ));

  const missingProducer = input();
  delete missingProducer.direct_image_evidence[0].producer;
  expectCode("OBJECT_REQUIRED", () => buildCompiledRecognitionRoutePacket(missingProducer));

  const wrongImage = input();
  wrongImage.prototype_scores.query_image_sha256 = "9".repeat(64);
  expectCode("PROTOTYPE_SCORE_NOT_FROM_CURRENT_IMAGE", () => buildCompiledRecognitionRoutePacket(wrongImage));

  const inventedValue = input();
  inventedValue.prototype_scores.rows[0].candidate_value = "Panini Imaginary";
  expectCode("PROTOTYPE_VALUE_NOT_IN_RELEASE_PACK", () => buildCompiledRecognitionRoutePacket(inventedValue));

  const duplicate = input();
  duplicate.prototype_scores.rows.push({ ...duplicate.prototype_scores.rows[0] });
  expectCode("DUPLICATE_PROTOTYPE_SCORE", () => buildCompiledRecognitionRoutePacket(duplicate));
});

test("production mode is absent by contract", () => {
  expectCode("EXECUTION_MODE_NOT_ALLOWED", () => buildCompiledRecognitionRoutePacket(input({ mode: "PRODUCTION" })));
});
