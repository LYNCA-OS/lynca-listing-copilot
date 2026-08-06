#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCandidateExpressionV3Request,
  finishCandidateExpressionV3
} from "../lib/listing/thin/candidate-expression-v3.mjs";
import {
  CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS,
  analyzeCandidateExpressionV3Mechanism,
  loadCandidateExpressionV3MechanismInputs
} from "./analyze-candidate-expression-v3-mechanism.mjs";
import {
  ARM_SPECS,
  buildRunManifest,
  requestFingerprint
} from "./run-thin-path-eval.mjs";

const ARM = "candidate_expression_v3_high";
const MODEL = "gpt-5.6-luna";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const cohortManifestPath = new URL(
  "../artifacts/bounded-evidence-v2/cohorts/cohort-manifest.json",
  import.meta.url
);
const cohortIdsPath = new URL(
  "../artifacts/bounded-evidence-v2/cohorts/product-mechanism-6.asset-ids.json",
  import.meta.url
);
const [cohortManifestBody, cohortAssetIdsBody] = await Promise.all([
  readFile(cohortManifestPath, "utf8"),
  readFile(cohortIdsPath, "utf8")
]);
const cohortManifest = JSON.parse(cohortManifestBody);
const cohortAssetIds = JSON.parse(cohortAssetIdsBody);
const cohortAssetIdsSha256 = sha256(cohortAssetIdsBody);

const arm = { key: ARM, ...ARM_SPECS[ARM] };
const baseManifest = await buildRunManifest({
  arms: [arm],
  model: MODEL,
  effort: "none",
  imageDetail: "high",
  limit: 6,
  dataset: "/not-read/dataset.json",
  sealedLabels: "/not-read/labels.jsonl",
  concurrency: 120,
  requestTimeoutMs: 120_000,
  maxAttempts: 3,
  datasetBody: Buffer.from("candidate-expression-v3-test-dataset"),
  sealedLabelsBody: Buffer.from("candidate-expression-v3-test-labels"),
  assetIdsBody: Buffer.from(cohortAssetIdsBody),
  selectedAssetIds: cohortAssetIds,
  selectionRole: "mechanism_probe_known_wins"
});

const targetValue = Object.freeze({
  reviewed_blind_8945fde9c65cb1b9f3a8: "Leaf Metal Draft",
  reviewed_blind_7059d3b39d01402f0e61: "VeeFriends",
  reviewed_blind_7c93444e09007eaec82f: "Upper Deck MJx",
  reviewed_blind_7815e1aeda1f8e00dd4e: "Topps Chrome VeeFriends",
  reviewed_blind_a4051a222e9be2cf8149: "Topps Star Wars",
  reviewed_blind_a8a73b44f77bf6e823e2: "Topps Chrome UFC"
});

function targetFact(assetId) {
  if (assetId === "reviewed_blind_8945fde9c65cb1b9f3a8") {
    return {
      value: targetValue[assetId], kind: "identity", basis: "model_knowledge",
      image: "none", region: "unknown", uncertainty: "uncertain"
    };
  }
  return {
    value: targetValue[assetId], kind: "identity", basis: "exact_text",
    image: "image_1", region: "card_front", uncertainty: "none"
  };
}

function refreshedRow(row, candidateFacts) {
  const raw = JSON.stringify({ candidate_facts: candidateFacts, unreadable_regions: [] });
  const finished = finishCandidateExpressionV3(raw);
  return {
    ...row,
    raw_title: raw,
    title: finished.title,
    raw_length: finished.raw_length,
    length: finished.length,
    candidate_schema_version: finished.candidate_schema_version,
    candidate_facts: finished.candidate_facts,
    unreadable_regions: finished.unreadable_regions,
    candidate_defects: finished.candidate_defects
  };
}

const requestSha256 = requestFingerprint(buildCandidateExpressionV3Request({
  imageUrls: ["https://example.invalid/front.jpg"],
  model: MODEL,
  effort: "none",
  imageDetail: "high"
}));
const baseRows = cohortAssetIds.map((assetId, index) => refreshedRow({
  asset_id: assetId,
  arm: ARM,
  image_detail: "high",
  reference: `Reference ${targetValue[assetId]}`,
  sanitised: false,
  truncated: false,
  latency_ms: 1_000 + index,
  input_tokens: 5_000,
  output_tokens: 200 + index * 20,
  total_tokens: 5_200 + index * 20,
  model: MODEL,
  requested_effort: "none",
  served_effort: "none",
  request_sha256: requestSha256,
  image_set_sha256: sha256(`images:${assetId}`),
  image_count: 1,
  request_attempt_count: 1,
  run_fingerprint: baseManifest.fingerprint,
  finisher_fingerprint: baseManifest.finisher.fingerprint,
  arm_eval_version: "candidate-expression-v3",
  fields: null,
  canonical_control_title: null,
  evidence_promotions: null,
  production_promoted: null
}, [targetFact(assetId)]));

function packaged(rows = baseRows, manifestPatch = null) {
  const checkpointBody = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const manifest = structuredClone(baseManifest);
  manifest.checkpoint_sha256 = sha256(checkpointBody);
  manifest.checkpoint_rows = rows.length;
  manifest.completed_at = "2026-08-01T00:00:00.000Z";
  if (manifestPatch) manifestPatch(manifest);
  return { rows, checkpointBody, manifest };
}

function labelsFor(rows, { limit = Infinity, unsupportedIndex = -1 } = {}) {
  return rows.flatMap((row) => row.candidate_facts
    .filter(({ basis }) => basis !== "model_knowledge")
    .map((fact) => ({ asset_id: row.asset_id, ...fact })))
    .slice(0, limit)
    .map((fact, index) => ({
      ...fact,
      verdict: index === unsupportedIndex ? "unsupported" : "supported",
      reviewer: "fixture-reviewer"
    }));
}

function analyze({ rows = baseRows, labels = null, manifestPatch = null } = {}) {
  const packed = packaged(rows, manifestPatch);
  return analyzeCandidateExpressionV3Mechanism({
    checkpointRows: rows,
    checkpointSha256: sha256(packed.checkpointBody),
    runManifest: packed.manifest,
    cohortManifest,
    cohortAssetIds,
    cohortAssetIdsSha256,
    provenanceLabels: labels
  });
}

assert.deepEqual(new Set(cohortAssetIds), new Set(Object.keys(
  CANDIDATE_EXPRESSION_V3_MECHANISM_TARGETS
)));

const unlabeled = analyze();
assert.equal(unlabeled.decision, "MANUAL_REVIEW_REQUIRED");
assert.equal(unlabeled.target_capture.captured_cards, 6);
assert.equal(unlabeled.provenance_review.expected_visible_labels, 5);
assert.equal(unlabeled.provenance_review.supplied_labels, 0);
assert.equal(unlabeled.usage.median_output_tokens, 250);
assert.deepEqual(unlabeled.hard_failures, []);

const partial = analyze({ labels: labelsFor(baseRows, { limit: 4 }) });
assert.equal(partial.decision, "MANUAL_REVIEW_REQUIRED");
assert.equal(partial.provenance_review.missing_labels.length, 1);

const completeLabels = labelsFor(baseRows);
const passed = analyze({ labels: completeLabels });
assert.equal(passed.decision, "CAPTURE_ONLY_PASS");
assert.equal(passed.provenance_review.complete, true);
assert.match(passed.interpretation, /no accuracy or production-promotion claim/);

const unsupported = analyze({
  labels: labelsFor(baseRows, { unsupportedIndex: 0 })
});
assert.equal(unsupported.decision, "STOP");
assert.ok(unsupported.hard_failures.some((failure) => (
  failure.startsWith("visible_provenance_unsupported:")
)));

const missingTargetRows = structuredClone(baseRows);
missingTargetRows[0] = refreshedRow(missingTargetRows[0], [{
  ...targetFact(missingTargetRows[0].asset_id), value: "Leaf Metal"
}]);
const missed = analyze({ rows: missingTargetRows, labels: labelsFor(missingTargetRows) });
assert.equal(missed.decision, "STOP");
assert.ok(missed.hard_failures.includes(`target_miss:${missingTargetRows[0].asset_id}`));

const falseKnowledgeRows = structuredClone(baseRows);
falseKnowledgeRows[0] = refreshedRow(falseKnowledgeRows[0], [{
  ...targetFact(falseKnowledgeRows[0].asset_id), image: "image_1"
}]);
const falseKnowledge = analyze({
  rows: falseKnowledgeRows,
  labels: labelsFor(falseKnowledgeRows)
});
assert.equal(falseKnowledge.decision, "STOP");
assert.ok(falseKnowledge.target_capture.rows[0].candidate_defects.some((defect) => (
  defect.startsWith("candidate_v3_knowledge_provenance_invalid:")
)));

const overflowRows = structuredClone(baseRows);
overflowRows[0] = refreshedRow(overflowRows[0], [
  targetFact(overflowRows[0].asset_id),
  ...Array.from({ length: 16 }, (_, index) => ({
    value: `Visible Extra ${index}`,
    kind: "other",
    basis: "exact_text",
    image: "image_1",
    region: "card_front",
    uncertainty: "none"
  }))
]);
const overflow = analyze({ rows: overflowRows, labels: labelsFor(overflowRows) });
assert.equal(overflow.decision, "STOP");
assert.ok(overflow.hard_failures.includes(
  `candidate_fact_limit_exceeded:${overflowRows[0].asset_id}`
));

const expensiveRows = baseRows.map((row) => ({ ...row, output_tokens: 401 }));
const expensive = analyze({ rows: expensiveRows, labels: labelsFor(expensiveRows) });
assert.equal(expensive.decision, "STOP");
assert.ok(expensive.hard_failures.includes("median_output_tokens_exceeded:401"));

const fieldLeakRows = structuredClone(baseRows);
fieldLeakRows[0].fields = { product: "must not exist" };
const fieldLeak = analyze({ rows: fieldLeakRows, labels: labelsFor(fieldLeakRows) });
assert.equal(fieldLeak.decision, "STOP");
assert.ok(fieldLeak.hard_failures.includes(`canonical_fields_present:${fieldLeakRows[0].asset_id}`));

assert.throws(() => analyze({
  labels: completeLabels,
  manifestPatch: (manifest) => {
    manifest.contract.arms[0].response_schema_sha256 = "0".repeat(64);
    manifest.fingerprint = sha256(JSON.stringify(manifest.contract));
  }
}), /run_manifest_schema_hash_mismatch/);

const schemaMismatchRows = structuredClone(baseRows);
schemaMismatchRows[0].candidate_schema_version = "candidate-expression-v2";
assert.throws(() => analyze({ rows: schemaMismatchRows, labels: labelsFor(schemaMismatchRows) }),
  /checkpoint_candidate_schema_invalid/);

assert.throws(() => analyze({ labels: [...completeLabels, completeLabels[0]] }),
  /provenance_label_duplicate/);

const temporary = await mkdtemp(join(tmpdir(), "candidate-expression-v3-gate-"));
try {
  const packed = packaged(baseRows);
  const checkpointPath = join(temporary, "checkpoint.jsonl");
  const manifestPath = join(temporary, "run-manifest.json");
  const labelsPath = join(temporary, "provenance-labels.jsonl");
  await Promise.all([
    writeFile(checkpointPath, packed.checkpointBody, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(packed.manifest, null, 2)}\n`, "utf8"),
    writeFile(labelsPath, `${completeLabels.map((label) => JSON.stringify(label)).join("\n")}\n`, "utf8")
  ]);
  const loaded = await loadCandidateExpressionV3MechanismInputs({
    checkpointPath,
    runManifestPath: manifestPath,
    cohortManifestPath: cohortManifestPath.pathname,
    provenanceLabelsPath: labelsPath
  });
  assert.equal(analyzeCandidateExpressionV3Mechanism(loaded).decision, "CAPTURE_ONLY_PASS");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("candidate expression v3 mechanism analyzer tests passed");
