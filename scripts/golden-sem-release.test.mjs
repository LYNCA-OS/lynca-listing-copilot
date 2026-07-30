import assert from "node:assert/strict";
import {
  buildGoldenSemReviewPacket,
  freezeGoldenSemReleaseSets,
  goldenSemLaunchFields,
  validateGoldenSemReviewPacket
} from "../lib/listing/evaluation/golden-sem-release.mjs";
import {
  evaluateGoldenSemAccuracy,
  normalizeGoldenSemValue
} from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { assessLaunchAccuracy } from "../lib/listing/evaluation/launch-benchmark.mjs";
import { releaseSetItemSetSha256 } from "../lib/listing/evaluation/release-set-contract.mjs";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";

function withRendererReplay(row) {
  const replay = {
    schema_version: "listing-renderer-replay-v1",
    renderer_version: "renderer-v3-scg",
    max_length: 80,
    resolved_fields: structuredClone(row.resolved_fields),
    field_evidence: {},
    serial_numerator_verified: null,
    trust_resolved_print_run_without_evidence: true
  };
  const presentation = renderListingPresentation({
    resolved: replay.resolved_fields,
    evidence: replay.field_evidence,
    maxLength: replay.max_length,
    serialNumeratorVerified: replay.serial_numerator_verified,
    trustResolvedPrintRunWithoutEvidence: replay.trust_resolved_print_run_without_evidence
  });
  return {
    ...row,
    final_title: presentation.final_title,
    renderer_replay: { ...replay, renderer_version: presentation.renderer_version }
  };
}

function refreshRendererReplay(row) {
  Object.assign(row, withRendererReplay(row));
  return row;
}

const source = {
  schema_version: "recognition-candidate-export-v1",
  source: { table: "listing_title_feedback" },
  items: Array.from({ length: 20 }, (_, index) => ({
    asset_id: `asset-${index + 1}`,
    source_feedback_id: `feedback-${index + 1}`,
    card_identity_id: `identity-${index + 1}`,
    images: [{
      image_id: `image-${index + 1}`,
      bucket: "listing-feedback-images",
      object_path: `reviewed/${index + 1}.jpg`,
      content_sha256: (index + 1).toString(16).padStart(64, "0")
    }],
    source_titles: {
      corrected_title: "2024 Topps Chrome Test Player Gold 2/3 PSA 10"
    }
  }))
};

const packet = buildGoldenSemReviewPacket(source, {
  datasetId: "golden-sem-test",
  now: () => new Date("2026-07-14T00:00:00.000Z")
});
assert.equal(packet.items.length, 20);
assert.equal(packet.summary.with_writer_reviewed_title_count, 20);
assert.equal(packet.items[0].reviewed_ground_truth.fields.year.reviewed_value, "");
assert.equal(packet.items[0].reviewed_ground_truth.fields.year.parser_suggestion, "2024");
assert.equal(packet.items[0].sealed_reference.title_visible_to_recognition, false);
assert.equal(packet.items[0].recognition_input.corrected_title, undefined);
assert.equal(validateGoldenSemReviewPacket(packet).ok, true);
assert.equal(validateGoldenSemReviewPacket(packet, { requireApproved: true }).ok, false);

for (const [index, item] of packet.items.entries()) {
  item.reviewed_ground_truth.review_status = "APPROVED";
  item.reviewed_ground_truth.reviewed_by = "reviewer-1";
  item.reviewed_ground_truth.reviewed_at = "2026-07-14T01:00:00.000Z";
  const confirmed = {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Chrome",
    subject: ["Test Player"],
    card_name: "Base",
    numerical_rarity: "2/3",
    print_finish: "Gold",
    grading_info: { company: "PSA", card_grade: "10" }
  };
  for (const field of goldenSemLaunchFields) {
    const row = item.reviewed_ground_truth.fields[field];
    if (Object.hasOwn(confirmed, field)) {
      row.reviewed_status = "CONFIRMED";
      row.reviewed_value = confirmed[field];
      row.evidence_sources = [{
        source_id: `feedback-${index + 1}`,
        source_sha256: (index + 101).toString(16).padStart(64, "0")
      }];
    } else {
      row.reviewed_status = "NOT_APPLICABLE";
      row.reviewed_value = Array.isArray(row.reviewed_value) ? [] : "";
    }
  }
}

const ready = validateGoldenSemReviewPacket(packet, { requireApproved: true });
assert.equal(ready.ok, true, ready.errors.join("; "));
const bundle = freezeGoldenSemReleaseSets(packet, {
  version: "v1",
  seed: "test-seed",
  now: () => new Date("2026-07-14T02:00:00.000Z")
});
assert.deepEqual(bundle.split_policy.actual_counts, {
  development: 14,
  validation: 3,
  holdout: 3
});
assert.equal(bundle.split_policy.cross_split_identity_overlap_count, 0);
assert.equal(bundle.holdout_release_set.leakage_policy.exclude_from_training, true);
assert.equal(bundle.holdout_release_set.leakage_policy.exclude_from_threshold_tuning, true);
assert.equal(bundle.validation.holdout_release_set.ok, true);

const holdoutPredictions = {
  schema_version: "golden-sem-prediction-run-v1",
  provider: "openai",
  provenance: {
    deployment_git_commit_sha: "a".repeat(40),
    recognition_pipeline_fingerprint: "b".repeat(64),
    catalog_snapshot_revision: "catalog-snapshot-1"
  },
  results: bundle.holdout_release_set.items.map((item, index) => withRendererReplay({
    asset_id: item.item_id,
    deployment_git_commit_sha: "a".repeat(40),
    recognition_pipeline_fingerprint: "b".repeat(64),
    catalog_snapshot_revision: "catalog-snapshot-1",
    resolved_fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: item.reviewed_ground_truth.fields.subject,
      card_name: "Base",
      print_run_number: index === 0 ? "#/3" : "2/3",
      parallel: "Gold",
      grade_company: "PSA",
      card_grade: "10"
    }
  }))
};
const accuracy = evaluateGoldenSemAccuracy({
  dataset: bundle.holdout_release_set,
  predictions: holdoutPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(accuracy.status, "COMPLETED");
assert.equal(accuracy.source.partition, "holdout");
assert.equal(accuracy.summary.evaluated_card_count, 3);
assert.equal(accuracy.metrics.sem_card_exact_accuracy.correct, 2);
assert.equal(accuracy.metrics.per_field_exact_accuracy.numerical_rarity.correct, 2);
assert.match(accuracy.source.prediction_content_sha256, /^[0-9a-f]{64}$/);
assert.equal(accuracy.source.release_set_item_set_sha256, bundle.holdout_release_set.item_set_sha256);
assert.equal(accuracy.scope.prediction_run_provenance_complete, true);
assert.equal(accuracy.cards[0].fields.numerical_rarity.is_correct, false);
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_prediction, "#/3");
assert.equal(accuracy.cards[0].fields.numerical_rarity.normalized_ground_truth, "2/3");
assert.equal(normalizeGoldenSemValue("numerical_rarity", "02/003"), "2/3");
assert.equal(normalizeGoldenSemValue("numerical_rarity", "#/003"), "#/3");

const denominatorOnlyDataset = structuredClone(bundle.holdout_release_set);
denominatorOnlyDataset.items[0].reviewed_ground_truth.fields.numerical_rarity = "#/3";
const denominatorOnlyAccuracy = evaluateGoldenSemAccuracy({
  dataset: denominatorOnlyDataset,
  predictions: holdoutPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(denominatorOnlyAccuracy.cards[0].fields.numerical_rarity.is_correct, true);
assert.equal(denominatorOnlyAccuracy.metrics.sem_card_exact_accuracy.correct, 3);

const overclaimPredictions = structuredClone(holdoutPredictions);
overclaimPredictions.results[0].resolved_fields.print_run_number = "2/3";
for (const status of ["UNKNOWN", "NOT_APPLICABLE"]) {
  const overclaimDataset = structuredClone(bundle.holdout_release_set);
  overclaimDataset.items[0].reviewed_ground_truth.field_statuses.product = status;
  overclaimDataset.items[0].reviewed_ground_truth.fields.product = status;
  const overclaimAccuracy = evaluateGoldenSemAccuracy({
    dataset: overclaimDataset,
    predictions: overclaimPredictions,
    now: () => new Date("2026-07-14T03:00:00.000Z")
  });
  assert.equal(overclaimAccuracy.cards[0].card_exact, false);
  assert.equal(overclaimAccuracy.cards[0].fields.product.critical_overclaim, true);
  assert.equal(overclaimAccuracy.metrics.critical_overclaim_count, 1);
  assert.equal(overclaimAccuracy.metrics.critical_fabrication_count, 1);
  assert.equal(overclaimAccuracy.metrics.catastrophic_title_count, 1);
  assert.ok(overclaimAccuracy.cards[0].errors.some((error) => (
    error.reason === `CRITICAL_${status}_OVERCLAIM`
  )));
}

const missingTruthPolicy = structuredClone(bundle.holdout_release_set);
delete missingTruthPolicy.evaluation_truth_policy;
missingTruthPolicy.item_set_sha256 = bundle.holdout_release_set.item_set_sha256;
const missingTruthAccuracy = evaluateGoldenSemAccuracy({
  dataset: missingTruthPolicy,
  predictions: holdoutPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(missingTruthAccuracy.status, "INCONCLUSIVE");
assert.equal(missingTruthAccuracy.scope.launch_gate_eligible, false);
assert.equal(missingTruthAccuracy.scope.explicit_evaluation_truth_policy, false);

const driftedPredictionProvenance = structuredClone(holdoutPredictions);
driftedPredictionProvenance.results[0].recognition_pipeline_fingerprint = "c".repeat(64);
const driftedPredictionAccuracy = evaluateGoldenSemAccuracy({
  dataset: bundle.holdout_release_set,
  predictions: driftedPredictionProvenance,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(driftedPredictionAccuracy.status, "INCONCLUSIVE");
assert.equal(driftedPredictionAccuracy.scope.prediction_run_provenance_complete, false);
assert.equal(driftedPredictionAccuracy.scope.launch_gate_eligible, false);

const stalePartition = structuredClone(bundle.partitions.holdout);
stalePartition.items[0].reviewed_ground_truth.fields.product = "Tampered Product";
const stalePartitionPredictions = structuredClone(holdoutPredictions);
stalePartitionPredictions.results[0].resolved_fields.product = "Tampered Product";
stalePartitionPredictions.results[0].resolved_fields.print_run_number = "2/3";
refreshRendererReplay(stalePartitionPredictions.results[0]);
const stalePartitionAccuracy = evaluateGoldenSemAccuracy({
  dataset: stalePartition,
  predictions: stalePartitionPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(stalePartitionAccuracy.metrics.sem_card_exact_accuracy.correct, 2);
assert.equal(stalePartitionAccuracy.status, "INCONCLUSIVE");
assert.equal(stalePartitionAccuracy.scope.launch_gate_eligible, false);
assert.ok(stalePartitionAccuracy.validation.errors.some((error) => (
  error.includes("requires release-set-v1 CORE_HOLDOUT")
)));

const criticalMismatchDataset = structuredClone(bundle.holdout_release_set);
const criticalTemplate = criticalMismatchDataset.items[0];
criticalMismatchDataset.items = Array.from({ length: 45 }, (_, index) => ({
  ...structuredClone(criticalTemplate),
  item_id: `critical-${index + 1}`,
  query_card_id: `critical-${index + 1}`,
  identity_group_id: `critical-identity-${index + 1}`
}));
criticalMismatchDataset.item_set_sha256 = releaseSetItemSetSha256(criticalMismatchDataset.items, {
  split: criticalMismatchDataset.partition,
  evaluationTruthPolicy: criticalMismatchDataset.evaluation_truth_policy
});
const criticalMismatchPredictions = {
  schema_version: "golden-sem-prediction-run-v1",
  provider: "openai",
  provenance: structuredClone(holdoutPredictions.provenance),
  results: criticalMismatchDataset.items.map((item, index) => withRendererReplay({
    asset_id: item.item_id,
    deployment_git_commit_sha: "a".repeat(40),
    recognition_pipeline_fingerprint: "b".repeat(64),
    catalog_snapshot_revision: "catalog-snapshot-1",
    resolved_fields: {
      year: "2024",
      manufacturer: "Topps",
      product: index === 0 ? "Fabricated Product" : "Topps Chrome",
      players: item.reviewed_ground_truth.fields.subject,
      card_name: "Base",
      print_run_number: "2/3",
      parallel: "Gold",
      grade_company: "PSA",
      card_grade: "10"
    }
  }))
};
const valid45Predictions = structuredClone(criticalMismatchPredictions);
valid45Predictions.results[0].resolved_fields.product = "Topps Chrome";
refreshRendererReplay(valid45Predictions.results[0]);
const valid45Accuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: valid45Predictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(valid45Accuracy.status, "COMPLETED");
assert.equal(valid45Accuracy.metrics.sem_card_exact_accuracy.correct, 45);
assert.equal(valid45Accuracy.metrics.renderer_fidelity.rate, 1);
assert.equal(valid45Accuracy.metrics.title_critical_fidelity.rate, 1);
assert.equal(assessLaunchAccuracy(valid45Accuracy).verdict, "PASS");

const oldSchemaPredictions = structuredClone(valid45Predictions);
oldSchemaPredictions.schema_version = "prediction-report-v1";
const oldSchemaAccuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: oldSchemaPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(oldSchemaAccuracy.status, "INCONCLUSIVE");
assert.equal(oldSchemaAccuracy.scope.prediction_run_provenance_complete, false);
assert.notEqual(assessLaunchAccuracy(oldSchemaAccuracy).verdict, "PASS");

const duplicatePredictionRows = structuredClone(valid45Predictions);
duplicatePredictionRows.results.at(-1).asset_id = duplicatePredictionRows.results[0].asset_id;
const duplicatePredictionAccuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: duplicatePredictionRows,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(duplicatePredictionAccuracy.status, "INCONCLUSIVE");
assert.equal(duplicatePredictionAccuracy.source.prediction_item_ids_unique, false);
assert.equal(duplicatePredictionAccuracy.source.prediction_exact_item_set_match, false);
assert.notEqual(assessLaunchAccuracy(duplicatePredictionAccuracy).verdict, "PASS");

const fabricatedTitlePredictions = structuredClone(valid45Predictions);
fabricatedTitlePredictions.results[0].final_title = "TOTALLY FABRICATED WRONG TITLE";
const fabricatedTitleAccuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: fabricatedTitlePredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(fabricatedTitleAccuracy.status, "COMPLETED");
assert.equal(fabricatedTitleAccuracy.cards[0].renderer_fidelity.exact_title_match, false);
assert.equal(fabricatedTitleAccuracy.metrics.renderer_fidelity.correct, 44);
assert.equal(assessLaunchAccuracy(fabricatedTitleAccuracy).verdict, "FAIL");

const thinTruthDataset = structuredClone(criticalMismatchDataset);
for (const item of thinTruthDataset.items) {
  item.reviewed_ground_truth.fields = { language: "English" };
  item.reviewed_ground_truth.field_statuses = { language: "CONFIRMED" };
  item.reviewed_ground_truth.evidence_sources = {
    language: [{ source_id: "thin-source", source_sha256: "d".repeat(64) }]
  };
}
thinTruthDataset.item_set_sha256 = releaseSetItemSetSha256(thinTruthDataset.items, {
  split: thinTruthDataset.partition,
  evaluationTruthPolicy: thinTruthDataset.evaluation_truth_policy
});
const thinTruthPredictions = {
  ...structuredClone(valid45Predictions),
  results: thinTruthDataset.items.map((item) => withRendererReplay({
    asset_id: item.item_id,
    deployment_git_commit_sha: "a".repeat(40),
    recognition_pipeline_fingerprint: "b".repeat(64),
    catalog_snapshot_revision: "catalog-snapshot-1",
    resolved_fields: { language: "English" }
  }))
};
const thinTruthAccuracy = evaluateGoldenSemAccuracy({
  dataset: thinTruthDataset,
  predictions: thinTruthPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(thinTruthAccuracy.status, "INCONCLUSIVE");
assert.equal(thinTruthAccuracy.validation.ok, false);
assert.notEqual(assessLaunchAccuracy(thinTruthAccuracy).verdict, "PASS");

const criticalMismatchAccuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: criticalMismatchPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(criticalMismatchAccuracy.metrics.sem_card_exact_accuracy.correct, 44);
assert.equal(criticalMismatchAccuracy.metrics.sem_card_exact_accuracy.total, 45);
assert.ok(criticalMismatchAccuracy.metrics.critical_confirmed_mismatch_count >= 1);
assert.ok(criticalMismatchAccuracy.metrics.critical_fabrication_count >= 1);
assert.equal(criticalMismatchAccuracy.metrics.catastrophic_title_count, 1);
const criticalMismatchAssessment = assessLaunchAccuracy(criticalMismatchAccuracy);
assert.equal(criticalMismatchAssessment.verdict, "FAIL");
assert.ok(criticalMismatchAssessment.failure_reasons.includes("CRITICAL_FABRICATION_PRESENT"));
assert.ok(criticalMismatchAssessment.failure_reasons.includes("CATASTROPHIC_TITLE_PRESENT"));

const criticalMissingPredictions = structuredClone(criticalMismatchPredictions);
delete criticalMissingPredictions.results[0].resolved_fields.product;
refreshRendererReplay(criticalMissingPredictions.results[0]);
const criticalMissingAccuracy = evaluateGoldenSemAccuracy({
  dataset: criticalMismatchDataset,
  predictions: criticalMissingPredictions,
  now: () => new Date("2026-07-14T03:00:00.000Z")
});
assert.equal(criticalMissingAccuracy.metrics.critical_fabrication_count, 0);
assert.equal(criticalMissingAccuracy.metrics.catastrophic_title_count, 1);
assert.equal(assessLaunchAccuracy(criticalMissingAccuracy).verdict, "FAIL");

const leakedPacket = structuredClone(packet);
leakedPacket.items[0].reviewed_ground_truth.fields.year.evidence_sources = [];
assert.equal(validateGoldenSemReviewPacket(leakedPacket, { requireApproved: true }).ok, false);

console.log("golden SEM release tests passed");
