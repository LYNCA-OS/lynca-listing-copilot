import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWriterTitleSemCandidate } from "../lib/listing/csm/title-derived-sem.mjs";
import { buildSemValidationEvent } from "../lib/listing/csm/sem-validation.mjs";
import {
  DATA_FLYWHEEL_ERROR_TYPES,
  buildErrorDatasetCandidate,
  buildGoldenSemCandidate,
  buildGoldenTitleCandidate
} from "../lib/listing/evaluation/data-asset-projections.mjs";
import { buildGoldenTitleRelease } from "../lib/listing/evaluation/golden-title-release.mjs";
import { buildDataIdentitySnapshot } from "../lib/listing/feedback/data-identity.mjs";
import { buildAuthoritativeRecognitionResult } from "../lib/listing/feedback/feedback-capture.mjs";
import { buildTitleDiff } from "../lib/listing/feedback/title-diff.mjs";
import { buildDailyLearningExport, writeDailyLearningExport } from "../lib/listing/learning/daily-learning-export.mjs";
import { loadSupabaseDailyLearningBundle } from "../lib/listing/learning/supabase-daily-learning-source.mjs";
import { buildV4FeedbackArtifacts } from "../lib/listing/v4/feedback/feedback-loop.mjs";

const aiTitle = "Messi Gold Auto";
const writerTitle = "Lionel Messi Gold Refractor Auto /50 PSA10";
const durableAssetId = "asset_11111111-1111-4111-8111-111111111111";
const diff = buildTitleDiff(aiTitle, writerTitle);
assert.deepEqual(diff.added, ["Lionel", "Refractor", "/50", "PSA10"]);
assert.deepEqual(diff.removed, [], "Messi is retained and must not be reported as lexically removed");
assert.deepEqual(buildTitleDiff("Messi Messi Auto", "Messi Auto").removed, ["Messi"]);

const semExtraction = buildWriterTitleSemCandidate(`2024 Topps Chrome ${writerTitle}`);
assert.equal(semExtraction.validation_status, "PENDING");
assert.equal(semExtraction.semantic_truth, false);
assert.equal(semExtraction.training_eligible, false);
assert.equal(semExtraction.sem_object.year, "2024");
assert.deepEqual(semExtraction.sem_object.subject, ["Lionel Messi"]);
assert.equal(semExtraction.sem_object.parallel, "Gold Refractor");
assert.equal(semExtraction.sem_object.numerical_rarity, "#/50");
assert.deepEqual(semExtraction.sem_object.grading, {
  company: "PSA",
  card_grade: "10",
  grade_type: "CARD_ONLY"
});
assert.equal(semExtraction.sem_object.autograph, true);
assert.equal(semExtraction.sem_object.patch, false);
assert.ok(semExtraction.confidence > 0 && semExtraction.confidence <= 0.8);
assert.deepEqual(Object.keys(semExtraction.validation.validation_sources), [
  "IMAGE_EVIDENCE",
  "OCR",
  "CATALOG",
  "HUMAN_CONFIRMATION"
]);

const identity = buildDataIdentitySnapshot({
  payload: {
    asset_id: durableAssetId,
    client_asset_ref: "asset-1",
    images: [{
      role: "front_original",
      bucket: "cards",
      object_path: "feedback/front.jpg",
      content_sha256: "a".repeat(64)
    }]
  },
  tenantId: "pilot-tenant",
  userId: "writer-1",
  operatorId: "writer-1"
});
assert.equal(identity.tenant_id, "pilot-tenant");
assert.equal(identity.user_id, "writer-1");
assert.equal(identity.asset_id, durableAssetId);
assert.match(identity.stable_asset_id, /^asset_content_sha256_[0-9a-f]{64}$/);
assert.equal(identity.client_asset_ref, "asset-1");
assert.equal(identity.asset_identity_status, "CONTENT_ADDRESSED");
assert.equal(identity.image_references[0].bucket, "cards");

const referenceIdentity = buildDataIdentitySnapshot({
  payload: {
    asset_id: "asset_22222222-2222-4222-8222-222222222222",
    client_asset_ref: "asset-2",
    images: [{ role: "front_original", object_path: "feedback/reference-only.jpg" }]
  },
  tenantId: "pilot-tenant",
  userId: "writer-1",
  operatorId: "writer-1"
});
assert.equal(referenceIdentity.asset_id, "asset_22222222-2222-4222-8222-222222222222");
assert.match(referenceIdentity.stable_asset_id, /^asset_reference_sha256_[0-9a-f]{64}$/);
assert.equal(referenceIdentity.asset_identity_status, "REFERENCE_FINGERPRINTED");
const samePathDifferentBucket = buildDataIdentitySnapshot({
  payload: {
    asset_id: "asset_33333333-3333-4333-8333-333333333333",
    client_asset_ref: "asset-2",
    images: [{ role: "front_original", bucket: "other-cards", object_path: "feedback/reference-only.jpg" }]
  },
  tenantId: "pilot-tenant",
  userId: "writer-1",
  operatorId: "writer-1"
});
assert.notEqual(
  samePathDifferentBucket.asset_fingerprint,
  referenceIdentity.asset_fingerprint,
  "bucket is part of reference identity when content hash is unavailable"
);

const recognitionResult = buildAuthoritativeRecognitionResult({
  id: "session-1",
  schema_version: "v4-test",
  asset_id: durableAssetId,
  stable_asset_id: identity.stable_asset_id,
  client_asset_ref: identity.client_asset_ref,
  asset_fingerprint: identity.asset_fingerprint,
  tenant_id: identity.tenant_id,
  user_id: identity.user_id,
  operator_id: "writer-1",
  identity_snapshot: identity,
  final_title: aiTitle,
  resolved_fields: { players: ["Messi"], product: "Topps Chrome", auto: true, surface_color: "Gold" },
  model_version: "gpt-test-1",
  prompt_version: "listing-intelligence-v1",
  provider_result_summary: { provider: "openai_legacy", model: "gpt-test-1" }
});
assert.equal(recognitionResult.tenant_id, "pilot-tenant");
assert.equal(recognitionResult.asset_id, durableAssetId);
assert.equal(recognitionResult.model_version, "gpt-test-1");
assert.equal(recognitionResult.prompt_version, "listing-intelligence-v1");
assert.match(recognitionResult.result_sha256, /^[0-9a-f]{64}$/);

function feedbackArtifacts(submissionId) {
  return buildV4FeedbackArtifacts({
    sessionId: "session-1",
    action: "EDIT",
    writerTitle,
    resultPayload: { max_title_length: 80 },
    operatorId: "writer-1",
    submissionId,
    recognitionResult,
    reviewedSemanticFields: false
  });
}

const first = feedbackArtifacts("submission-0001");
const retry = feedbackArtifacts("submission-0001");
const laterEdit = feedbackArtifacts("submission-0002");
const rejected = buildV4FeedbackArtifacts({
  sessionId: "session-1",
  action: "REJECT",
  writerTitle: "",
  operatorId: "writer-1",
  submissionId: "submission-reject-0001",
  recognitionResult
});
assert.equal(first.feedbackEvent.id, retry.feedbackEvent.id);
assert.equal(first.payloadSha256, retry.payloadSha256);
assert.notEqual(first.feedbackEvent.id, laterEdit.feedbackEvent.id);
assert.equal(first.feedbackEvent.writer_raw_title, writerTitle);
assert.equal(first.feedbackEvent.tenant_id, "pilot-tenant");
assert.equal(first.feedbackEvent.user_id, "writer-1");
assert.equal(first.feedbackEvent.asset_id, identity.asset_id);
assert.equal(first.feedbackEvent.dataset_disposition, "OBSERVE_ONLY");
assert.equal(first.learningEvent.training_eligible, false);
assert.equal(first.learningEvent.semantic_truth, false);
assert.deepEqual(first.feedbackEvent.title_diff.added, ["Lionel", "Refractor", "/50", "PSA10"]);
const rejectedDaily = buildDailyLearningExport({
  feedback_events: [rejected.feedbackEvent],
  learning_events: [rejected.learningEvent]
}, { date: "2026-07-15", generatedAt: "2026-07-15T23:59:59.000Z" });
assert.equal(rejectedDaily.manifest.counts.feedback, 1);
assert.equal(rejectedDaily.manifest.counts.semantic, 0, "REJECT has no writer title and must not masquerade as title truth");
assert.equal(rejectedDaily.manifest.counts.errors, 1);

const goldenTitle = buildGoldenTitleCandidate({
  feedbackEvent: first.feedbackEvent,
  semExtraction: first.semExtraction,
  images: [{
    bucket: "cards",
    object_path: "feedback/front.jpg",
    content_sha256: "b".repeat(64),
    image_role: "front",
    object_verified: true,
    content_hash_verified: true,
    verified_at: "2026-07-15T11:00:00.000Z",
    storage_verification_source: "listing_image_verifications",
    storage_verification_record_key: "pilot-tenant\u001fcards\u001ffeedback/front.jpg",
    storage_verification_record_sha256: "c".repeat(64)
  }]
});
assert.equal(goldenTitle.source, "writer_verified");
assert.equal(goldenTitle.confidence, 1);
assert.equal(goldenTitle.title_truth, true);
assert.equal(goldenTitle.validation_status, "VALIDATED");
assert.equal(goldenTitle.sem_validation_status, "PENDING");
assert.equal(goldenTitle.training_eligible, false);
assert.equal(goldenTitle.freeze_eligible, true);
const referenceOnlyGoldenTitle = buildGoldenTitleCandidate({
  feedbackEvent: first.feedbackEvent,
  semExtraction: first.semExtraction,
  images: [{ bucket: "cards", object_path: "feedback/front.jpg", image_role: "front" }]
});
assert.equal(referenceOnlyGoldenTitle.image_reference_available, true);
assert.equal(referenceOnlyGoldenTitle.image_content_pinned, false);
assert.equal(referenceOnlyGoldenTitle.freeze_eligible, false);
assert.deepEqual(referenceOnlyGoldenTitle.freeze_blockers, ["IMAGE_STORAGE_VERIFICATION_REQUIRED"]);

assert.throws(() => buildSemValidationEvent({
  learningEventId: first.learningEvent.id,
  feedbackEventId: first.feedbackEvent.id,
  recognitionSessionId: "session-1",
  identityGroupId: "physical-card-1",
  extraction: first.semExtraction,
  validatedSem: first.semExtraction.candidate_sem,
  validationStatus: "VALIDATED",
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-07-15T12:00:00.000Z"
}), /supporting_validation_source_required/);
assert.throws(() => buildSemValidationEvent({
  learningEventId: first.learningEvent.id,
  feedbackEventId: first.feedbackEvent.id,
  recognitionSessionId: "session-1",
  identityGroupId: "physical-card-1",
  extraction: { ...first.semExtraction, parser_version: "stale-parser-v0" },
  validatedSem: first.semExtraction.candidate_sem,
  validationStatus: "VALIDATED",
  validationSources: {
    HUMAN_CONFIRMATION: { status: "SUPPORTED", evidence_refs: ["review:stale"] }
  },
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-07-15T12:00:00.000Z"
}), /validated_sem_parser_version_mismatch/);
const validatedSemEvent = buildSemValidationEvent({
  validationId: "sem-validation-0001",
  learningEventId: first.learningEvent.id,
  feedbackEventId: first.feedbackEvent.id,
  recognitionSessionId: "session-1",
  tenantId: "pilot-tenant",
  userId: "writer-1",
  assetId: identity.asset_id,
  identityGroupId: "physical-card-1",
  extraction: first.semExtraction,
  validatedSem: first.semExtraction.candidate_sem,
  validationStatus: "VALIDATED",
  confidence: 0.99,
  validationSources: {
    HUMAN_CONFIRMATION: { status: "SUPPORTED", evidence_refs: ["review:1"] },
    IMAGE_EVIDENCE: { status: "SUPPORTED", evidence_refs: ["cards:feedback/front.jpg"] }
  },
  reviewedBy: "reviewer-1",
  reviewedAt: "2026-07-15T12:00:00.000Z",
  createdAt: "2026-07-15T12:00:00.000Z"
});
assert.equal(validatedSemEvent.validation_status, "VALIDATED");
assert.equal(validatedSemEvent.semantic_truth, true);
assert.equal(validatedSemEvent.golden_sem_candidate, true);
assert.equal(validatedSemEvent.training_eligible, false);
assert.equal(buildGoldenSemCandidate({
  feedbackEvent: first.feedbackEvent,
  reviewedSem: first.semExtraction.candidate_sem,
  review: {
    status: "VALIDATED",
    reviewed_by: "reviewer-1",
    reviewed_at: "2026-07-15T12:00:00.000Z"
  },
  images: [],
  identityGroupId: "physical-card-1"
}), null, "Golden SEM must not freeze without a content-fixed image");

const errorCandidate = buildErrorDatasetCandidate({
  feedbackEvent: {
    ...first.feedbackEvent,
    recognition_result: {
      ...first.feedbackEvent.recognition_result,
      ai_sem: {
        product: "Topps Chrome",
        players: ["Messi"],
        surface_color: "Gold",
        card_number: "1",
        grade_company: "PSA",
        card_grade: "9"
      }
    }
  },
  semExtraction: {
    candidate_sem: {
      product: "Panini Prizm",
      subject: ["Lionel Messi"],
      print_finish: "Gold Refractor",
      numerical_rarity: "#/50",
      card_number: "10",
      grading_info: { company: "PSA", card_grade: "10" }
    }
  }
});
assert.ok(errorCandidate.error_types.includes("WRONG_PRODUCT"));
assert.ok(errorCandidate.error_types.includes("WRONG_SUBJECT"));
assert.ok(errorCandidate.error_types.includes("WRONG_PARALLEL"));
assert.ok(errorCandidate.error_types.includes("MISSING_NUMBERED"));
assert.ok(errorCandidate.error_types.includes("WRONG_CARD_NUMBER"));
assert.ok(errorCandidate.error_types.includes("WRONG_GRADE"));
assert.ok(errorCandidate.error_types.includes("MISSING_FIELD"));
assert.ok(errorCandidate.error_types.every((type) => DATA_FLYWHEEL_ERROR_TYPES.includes(type)));
assert.equal(errorCandidate.human_verified, false);
assert.equal(errorCandidate.training_eligible, false);

const sourcePolicyRejected = buildGoldenTitleRelease([{ id: "1", corrected_title: "Verified-looking title" }]);
assert.equal(sourcePolicyRejected.item_count, 0);
assert.equal(sourcePolicyRejected.rejected[0].reason, "WRITER_VERIFIED_SOURCE_REQUIRED");
const sourcePolicyAccepted = buildGoldenTitleRelease([{
  id: "1",
  corrected_title: writerTitle,
  front_object_path: "feedback/front.jpg"
}], { sourcePolicy: "WRITER_VERIFIED_SUPABASE" });
assert.equal(sourcePolicyAccepted.item_count, 1);
assert.equal(sourcePolicyAccepted.image_backed_count, 1);
assert.equal(sourcePolicyAccepted.image_reference_count, 1);
assert.equal(sourcePolicyAccepted.image_content_pinned_count, 0);
assert.equal(sourcePolicyAccepted.image_benchmark_eligible_count, 0);
assert.equal(sourcePolicyAccepted.items[0].confidence, 1);
assert.equal(sourcePolicyAccepted.items[0].sem_validation_status, "PENDING");
assert.equal(sourcePolicyAccepted.items[0].image_benchmark_eligible, false);

const daily = buildDailyLearningExport({
  feedback_events: [first.feedbackEvent],
  learning_events: [first.learningEvent],
  sem_validation_events: [validatedSemEvent],
  images_by_asset: {
    [identity.asset_id]: [{
      bucket: "cards",
      object_path: "feedback/front.jpg",
      content_sha256: "b".repeat(64),
      signed_url: "https://example.invalid/storage/v1/object/sign/cards/front.jpg?token=secret"
    }]
  }
}, { date: "2026-07-15", generatedAt: "2026-07-15T23:59:59.000Z" });
assert.deepEqual(daily.manifest.counts, {
  feedback: 1,
  semantic: 1,
  errors: 1,
  golden: 1,
  golden_title: 1,
  golden_sem: 0,
  sem_validation_events: 1,
  recognition_sessions: 0
});
assert.equal(daily.manifest.dataset_disposition, "OBSERVE_ONLY");
assert.equal(daily.manifest.source_trust.storage_verification_proof, "UNTRUSTED_CALLER_INPUT");
assert.equal(daily.datasets.golden[0].freeze_eligible, false);
assert.equal(JSON.stringify(daily).includes("token=secret"), false);

const dependencyReadCalls = [];
const currentSession = {
  id: "session-1",
  tenant_id: "pilot-tenant",
  operator_id: "writer-1",
  asset_id: identity.asset_id,
  stable_asset_id: identity.stable_asset_id,
  client_asset_ref: identity.client_asset_ref,
  asset_fingerprint: identity.asset_fingerprint,
  writer_feedback_event_id: first.feedbackEvent.id,
  learning_event_id: first.learningEvent.id
};
const durableImageVerification = {
  tenant_id: "pilot-tenant",
  bucket: "cards",
  object_path: "feedback/front.jpg",
  asset_id: identity.asset_id,
  image_id: "image-front-1",
  storage_role: "front_original",
  content_type: "image/jpeg",
  size: 1024,
  width: 1000,
  height: 1400,
  content_sha256: "a".repeat(64),
  object_verified: true,
  content_hash_verified: true,
  dimension_source: "server_decode",
  verified_at: "2026-07-15T11:00:00.000Z",
  updated_at: "2026-07-15T11:00:00.000Z"
};
const lateValidationBundle = await loadSupabaseDailyLearningBundle({
  date: "2026-07-16",
  readRows: async ({ table, search }) => {
    dependencyReadCalls.push({ table, search });
    if (search.and) {
      if (table === "v4_sem_validation_events") return { ok: true, rows: [validatedSemEvent], count: 1 };
      return { ok: true, rows: [], count: 0 };
    }
    if (table === "v4_learning_events") return { ok: true, rows: [first.learningEvent], count: 1 };
    if (table === "v4_writer_feedback_events") return { ok: true, rows: [first.feedbackEvent], count: 1 };
    if (table === "v4_recognition_sessions") return { ok: true, rows: [currentSession], count: 1 };
    if (table === "listing_image_verifications") return { ok: true, rows: [durableImageVerification], count: 1 };
    return { ok: false, rows: [], error: "unexpected_table" };
  }
});
assert.equal(lateValidationBundle.learning_events[0].id, first.learningEvent.id);
assert.equal(lateValidationBundle.feedback_events[0].id, first.feedbackEvent.id);
assert.equal(lateValidationBundle.input_scope, "SUPABASE_DAILY_WITH_PARENT_CLOSURE");
assert.deepEqual(lateValidationBundle.dependency_closure, {
  daily_feedback_events: 0,
  daily_learning_events: 0,
  daily_sem_validation_events: 1,
  parent_feedback_events_loaded: 1,
  parent_learning_events_loaded: 1,
  current_feedback_events_loaded: 0,
  current_learning_events_loaded: 0,
  recognition_sessions_loaded: 1,
  storage_verification_rows_loaded: 1
});
assert.ok(dependencyReadCalls.some((call) => call.table === "v4_recognition_sessions"));
assert.ok(dependencyReadCalls.some((call) => call.table === "listing_image_verifications"));
const lateValidationDaily = buildDailyLearningExport(lateValidationBundle, {
  date: "2026-07-16",
  generatedAt: "2026-07-16T23:59:59.000Z"
});
assert.equal(lateValidationDaily.manifest.counts.semantic, 1);
assert.equal(lateValidationDaily.datasets.semantic[0].validation_status, "VALIDATED");
assert.equal(lateValidationDaily.manifest.source_trust.supabase_loader_verified, true);
assert.equal(lateValidationDaily.manifest.counts.golden_sem, 1);
assert.equal(lateValidationDaily.datasets.golden.every((row) => row.freeze_eligible), true);

const paginationOffsets = [];
const pagedFeedback = [first.feedbackEvent, laterEdit.feedbackEvent];
const pagedBundle = await loadSupabaseDailyLearningBundle({
  date: "2026-07-15",
  pageSize: 1,
  requireExactCount: true,
  readRows: async ({ table, search }) => {
    if (table === "v4_recognition_sessions") return { ok: true, rows: [
      { ...currentSession, writer_feedback_event_id: laterEdit.feedbackEvent.id, learning_event_id: null }
    ], count: 1 };
    if (table !== "v4_writer_feedback_events") return { ok: true, rows: [], count: 0 };
    const offset = Number(search.offset || 0);
    paginationOffsets.push(offset);
    return { ok: true, rows: pagedFeedback.slice(offset, offset + 1), count: pagedFeedback.length };
  }
});
assert.deepEqual(paginationOffsets, [0, 1]);
assert.equal(pagedBundle.feedback_events.length, 2);
await assert.rejects(() => loadSupabaseDailyLearningBundle({
  date: "2026-07-15",
  requireExactCount: true,
  readRows: async () => ({ ok: true, rows: [], count: null })
}), /daily_learning_source_count_required/);

const exportRoot = await mkdtemp(join(tmpdir(), "lynca-learning-export-"));
try {
  const written = await writeDailyLearningExport({
    bundle: {
      feedback_events: [first.feedbackEvent],
      learning_events: [first.learningEvent],
      sem_validation_events: [validatedSemEvent],
      images_by_asset: {
        [identity.asset_id]: [{
          bucket: "cards",
          object_path: "feedback/front.jpg",
          content_sha256: "b".repeat(64)
        }]
      }
    },
    outRoot: exportRoot,
    date: "2026-07-15",
    generatedAt: "2026-07-15T23:59:59.000Z"
  });
  for (const dataset of ["feedback", "semantic", "errors", "golden"]) {
    await readFile(written.files[dataset], "utf8");
  }
  assert.equal(JSON.parse(await readFile(written.manifest_path, "utf8")).counts.golden_sem, 0);
} finally {
  await rm(exportRoot, { recursive: true, force: true });
}

const migration = await readFile(new URL("../supabase/migrations/20260715065752_track_d_feedback_capture_v1.sql", import.meta.url), "utf8");
for (const required of [
  "tenant_id text",
  "user_id text",
  "asset_fingerprint text",
  "model_version text",
  "prompt_version text",
  "submission_id text",
  "payload_sha256 text",
  "recognition_result jsonb",
  "writer_feedback jsonb",
  "sem_extraction jsonb",
  "sem_validation jsonb",
  "prevent_v4_writer_feedback_mutation",
  "OBSERVE_ONLY",
  "for update",
  "feedback_projection_mismatch",
  "golden_sem_candidate"
]) assert.ok(migration.toLowerCase().includes(required.toLowerCase()), `migration missing ${required}`);
assert.equal(/on conflict[\s\S]{0,80}do update/i.test(migration), false, "new feedback transaction must never overwrite facts");

const writerUi = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
assert.match(writerUi, /feedback_submission_id:\s*v4Submission\.id/);
assert.match(writerUi, /pendingFeedbackSubmissionSignature/);
assert.match(writerUi, /clearPendingV4FeedbackSubmission\(result, v4Submission\)/);

console.log("V4 feedback data-assets tests passed.");
