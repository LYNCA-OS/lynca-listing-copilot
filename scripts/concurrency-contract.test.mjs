import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  concurrencyContractSnapshot,
  evaluateConcurrencyArm,
  listingConcurrencyContract,
  selectConcurrencyKnee
} from "../lib/listing/v4/orchestration/concurrency-contract.mjs";
import { catalogFingerprint, parseConcurrencies } from "./run-stage-capacity-sweep.mjs";
import { listingStageCapacityPlan } from "../lib/listing/v4/orchestration/stage-capacity.mjs";
import { openAiProviderGlobalConcurrency } from "../lib/listing/providers/openai-key-pool.mjs";
import { v4QueueSubmissionConcurrency } from "../lib/listing/v4/jobs/production-job-queue.mjs";
import { internalQueryConcurrency } from "../lib/listing/retrieval/retrieval-engine.mjs";

assert.equal(listingConcurrencyContract.image_preprocess.concurrency, 4);
assert.equal(listingConcurrencyContract.upload_validation.concurrency, 4);
assert.equal(listingConcurrencyContract.upload_validation.execution_model, "fused_into_image_preprocess");
assert.equal(listingConcurrencyContract.storage_upload.concurrency, 3);
assert.equal(listingConcurrencyContract.background_preparation.concurrency, 4);
assert.equal(listingConcurrencyContract.signed_url_preparation.concurrency, 4);
assert.equal(listingConcurrencyContract.signed_url_preparation.execution_model, "bounded_inside_background_preparation");
assert.equal(listingConcurrencyContract.queue_submission.concurrency, 2);
assert.equal(listingConcurrencyContract.gpt_provider.concurrency, 2);
assert.equal(listingConcurrencyContract.paddle_ocr.concurrency, 8);
assert.equal(listingConcurrencyContract.paddle_ocr.per_asset_concurrency, 1);
assert.equal(listingConcurrencyContract.paddle_ocr.per_asset_batch_size, 3);
assert.equal(listingConcurrencyContract.paddle_ocr.anchor_lane_limit, 8);
assert.equal(listingConcurrencyContract.paddle_ocr.detail_lane_limit, 2);
assert.equal(listingConcurrencyContract.catalog_retrieval.status, "FROZEN");
assert.equal(listingConcurrencyContract.catalog_retrieval.concurrency, 1);
assert.equal(listingConcurrencyContract.catalog_internal_queries.status, "FROZEN");
assert.equal(listingConcurrencyContract.catalog_internal_queries.concurrency, 4);
assert.equal(listingConcurrencyContract.vector_query.status, "FROZEN");
assert.equal(listingConcurrencyContract.vector_query.concurrency, 3);

const appSource = await readFile("app/listing-copilot.js", "utf8");
const stageCapacitySource = await readFile("lib/listing/v4/orchestration/stage-capacity.mjs", "utf8");
const envExample = await readFile(".env.example", "utf8");
assert.match(appSource, /const IMAGE_PREPROCESS_CONCURRENCY\s*=\s*4/);
assert.match(appSource, /const STORAGE_UPLOAD_CONCURRENCY\s*=\s*3/);
assert.match(appSource, /const MAX_BACKGROUND_PREP_WORKERS\s*=\s*4/);
assert.match(envExample, /OPENAI_PROVIDER_UI_CONCURRENCY=2/);
assert.match(envExample, /V4_QUEUE_SUBMISSION_CONCURRENCY=2/);
assert.match(envExample, /PREINGESTION_OCR_GLOBAL_CAPACITY=8/);
assert.match(envExample, /RETRIEVAL_CATALOG_GLOBAL_CAPACITY=1/);
assert.match(envExample, /RETRIEVAL_INTERNAL_QUERY_CONCURRENCY=4/);
assert.match(envExample, /VECTOR_QUERY_GLOBAL_CAPACITY=3/);
assert.match(stageCapacitySource, /contractedConcurrency\(\s*"paddle_ocr"/);

assert.equal(listingStageCapacityPlan({
  PREINGESTION_OCR_GLOBAL_CAPACITY: "10",
  PREINGESTION_OCR_PER_ASSET_CAPACITY: "8",
  PREINGESTION_OCR_PER_ASSET_BATCH_SIZE: "9",
  PREINGESTION_OCR_ANCHOR_CONCURRENCY: "8",
  PREINGESTION_OCR_DETAIL_CONCURRENCY: "8"
}).ocr.global_capacity, 8, "an env edit must not raise OCR above the frozen measured knee");
assert.deepEqual(
  listingStageCapacityPlan({
    PREINGESTION_OCR_GLOBAL_CAPACITY: "10",
    PREINGESTION_OCR_PER_ASSET_CAPACITY: "8",
    PREINGESTION_OCR_PER_ASSET_BATCH_SIZE: "9",
    PREINGESTION_OCR_ANCHOR_CONCURRENCY: "12",
    PREINGESTION_OCR_DETAIL_CONCURRENCY: "8"
  }).ocr,
  {
    ...listingStageCapacityPlan({}).ocr,
    global_capacity: 8,
    per_asset_capacity: 1,
    per_asset_batch_size: 3,
    anchor_concurrency: 8,
    detail_concurrency: 2,
    local_concurrency: 1
  },
  "all measured OCR sub-limits must be frozen; env edits may only lower them"
);
assert.deepEqual(
  {
    anchor: listingStageCapacityPlan({
      PREINGESTION_OCR_GLOBAL_CAPACITY: "10",
      PREINGESTION_OCR_ANCHOR_CONCURRENCY: "8",
      PREINGESTION_OCR_DETAIL_CONCURRENCY: "2"
    }).ocr.anchor_concurrency,
    detail: listingStageCapacityPlan({
      PREINGESTION_OCR_GLOBAL_CAPACITY: "10",
      PREINGESTION_OCR_ANCHOR_CONCURRENCY: "8",
      PREINGESTION_OCR_DETAIL_CONCURRENCY: "2"
    }).ocr.detail_concurrency
  },
  { anchor: 8, detail: 2 },
  "OCR lane ceilings remain visible while the allocator enforces their shared global capacity"
);

assert.equal(evaluateConcurrencyArm({
  concurrency: 1,
  task_count: 1,
  success_count: 1,
  timeout_count: 0,
  throughput_per_second: 1,
  p95_ms: null
}).p95_ms, null, "missing telemetry must stay missing instead of becoming a fake zero");

const stageSweepSource = await readFile("scripts/run-stage-capacity-sweep.mjs", "utf8");
const vectorIndexApiSource = await readFile("api/admin-index-visual-vector-seed.js", "utf8");
const listingApiSource = await readFile("api/listing-copilot-title.js", "utf8");
assert.match(stageSweepSource, /value !== null && value !== undefined && value !== ""/);
assert.match(stageSweepSource, /transportAttempts: 3/);
assert.match(stageSweepSource, /capacity_sweep: true/);
assert.match(vectorIndexApiSource, /finiteNumberOrNull\(summary\.worker_latency_p50_ms\)/);
assert.match(listingApiSource, /contractedConcurrency\(\s*["']signed_url_preparation["']/);
assert.equal(openAiProviderGlobalConcurrency({
  OPENAI_API_KEY: "test-key",
  OPENAI_PER_KEY_STABLE_CONCURRENCY: "8",
  OPENAI_PROVIDER_MAX_TOTAL_CONCURRENCY: "8"
}), 2, "an env edit must not raise GPT above the frozen measured knee");
assert.equal(v4QueueSubmissionConcurrency({
  OPENAI_API_KEY: "test-key",
  V4_QUEUE_SUBMISSION_CONCURRENCY: "8"
}), 2, "an env edit must not raise queue submission above the frozen measured knee");
assert.equal(listingStageCapacityPlan({
  RETRIEVAL_CATALOG_GLOBAL_CAPACITY: "8",
  RETRIEVAL_INTERNAL_QUERY_CONCURRENCY: "8",
  VECTOR_QUERY_GLOBAL_CAPACITY: "8"
}).catalog.global_capacity, 1, "catalog card concurrency cannot exceed the frozen production knee");
assert.equal(listingStageCapacityPlan({
  RETRIEVAL_CATALOG_GLOBAL_CAPACITY: "8",
  RETRIEVAL_INTERNAL_QUERY_CONCURRENCY: "8",
  VECTOR_QUERY_GLOBAL_CAPACITY: "8"
}).catalog.query_concurrency, 4, "catalog query concurrency cannot exceed the frozen production knee");
assert.equal(listingStageCapacityPlan({
  RETRIEVAL_CATALOG_GLOBAL_CAPACITY: "8",
  RETRIEVAL_INTERNAL_QUERY_CONCURRENCY: "8",
  VECTOR_QUERY_GLOBAL_CAPACITY: "8"
}).vector.global_capacity, 3, "vector concurrency cannot exceed the cold-cache production knee");
assert.equal(internalQueryConcurrency({
  ENABLE_INTERNAL_RETRIEVAL_QUERY_CONCURRENCY: "true",
  RETRIEVAL_INTERNAL_QUERY_CONCURRENCY: "12"
}, 20), 4, "the retrieval engine cannot bypass the frozen catalog query limit");

const unstableFastArm = evaluateConcurrencyArm({
  concurrency: 8,
  task_count: 20,
  success_count: 19,
  timeout_count: 1,
  throughput_per_second: 12
});
assert.equal(unstableFastArm.stable, false);
assert.ok(unstableFastArm.rejection_reasons.includes("INCOMPLETE_TASKS"));
assert.ok(unstableFastArm.rejection_reasons.includes("TIMEOUTS_PRESENT"));

const recommendation = selectConcurrencyKnee([
  { concurrency: 1, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 3.1, p95_ms: 410 },
  { concurrency: 2, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 5.9, p95_ms: 470 },
  { concurrency: 4, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 6.0, p95_ms: 780 },
  { concurrency: 6, task_count: 20, success_count: 19, timeout_count: 1, result_consistency_rate: 1, throughput_per_second: 6.4, p95_ms: 1400 }
]);
assert.equal(recommendation.recommended_concurrency, 2, "choose the smallest stable arm within 97% of peak throughput");
assert.equal(recommendation.rows.find((row) => row.concurrency === 6).stable, false);

const accuracyGuard = selectConcurrencyKnee([
  { concurrency: 2, task_count: 10, success_count: 10, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 2, accuracy: 0.9 },
  { concurrency: 4, task_count: 10, success_count: 10, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 4, accuracy: 0.8 }
], { requireAccuracy: true });
assert.equal(accuracyGuard.recommended_concurrency, 2);
assert.ok(accuracyGuard.rows.find((row) => row.concurrency === 4).rejection_reasons.includes("ACCURACY_REGRESSION"));

const demandSizedRecommendation = selectConcurrencyKnee([
  { concurrency: 1, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 0.25, p95_ms: 300 },
  { concurrency: 2, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 0.4, p95_ms: 620 },
  { concurrency: 4, task_count: 20, success_count: 20, timeout_count: 0, result_consistency_rate: 1, throughput_per_second: 0.5, p95_ms: 1100 }
], { minimumRequiredThroughputPerSecond: 0.2 });
assert.equal(demandSizedRecommendation.recommended_concurrency, 1);
assert.equal(demandSizedRecommendation.reason, "LOWEST_P95_ARM_MEETING_REQUIRED_THROUGHPUT");

assert.equal(concurrencyContractSnapshot().schema_version, "listing-concurrency-contract-v1");
assert.deepEqual(parseConcurrencies("4,3,2,1,4"), [4, 3, 2, 1], "counterbalanced sweeps must preserve the requested arm order");

const stableCatalogDecision = {
  prompt_candidate_count: 1,
  candidates: [{ candidate_id: "catalog_identity_1_1", candidate_identity_id: "identity-1", title: "A" }]
};
assert.equal(
  catalogFingerprint({
    ...stableCatalogDecision,
    raw_candidate_count: 30,
    raw_candidates: [{ candidate_id: "catalog_identity_2_1", candidate_identity_id: "identity-2" }]
  }),
  catalogFingerprint({
    ...stableCatalogDecision,
    candidates: [{ candidate_id: "catalog_identity_1_9", candidate_identity_id: "identity-1", title: "A" }],
    raw_candidate_count: 60,
    raw_candidates: [{ candidate_id: "catalog_identity_3_1", candidate_identity_id: "identity-3" }]
  }),
  "raw diagnostic fan-out and synthetic candidate indexes must not masquerade as a decision change"
);

console.log("concurrency contract tests passed");
