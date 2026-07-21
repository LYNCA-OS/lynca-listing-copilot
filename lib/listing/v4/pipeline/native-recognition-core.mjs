import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { analyzeCardEvidenceWithOpenAiEmergency } from "../../providers/openai-emergency-provider.mjs";
import { runWithProviderConcurrency } from "../../providers/provider-concurrency.mjs";
import {
  addTiming,
  createTimingContext,
  emptyTiming,
  nowMs,
  recordNodeSpan,
  timeAsync,
  timeSync
} from "../../pipeline/timing.mjs";
import { buildPipelineNodeLedger } from "../../pipeline/node-observability.mjs";
import { applySafeCurrentImageMultiCardInference } from "../evidence/field-evidence.mjs";
import {
  mergeUsage,
  safeProviderDiagnostics,
  withProviderMetadata
} from "../../pipeline/provider-result-metadata.mjs";
import { envFlag, optionFlag } from "../../pipeline/flags.mjs";
import { normalizeStringOrNull } from "../../pipeline/text.mjs";
import {
  evidenceCandidateKey,
  evidenceFieldCandidatesWithSources,
  hasEvidenceValue,
  mergeEvidenceField
} from "../../pipeline/evidence-merge.mjs";
import { openAiRequestContextFromPayload, runTimedProviderCall } from "../../pipeline/provider-stage.mjs";
import {
  applyPreIngestionEvidencePatchesToPayload,
  applyPreIngestionBundleToPayload,
  confirmedPreingestionRetrievalFields,
  preingestionEvidenceDocumentFromPayload,
  refreshPreIngestionEvidencePatches
} from "../../pipeline/preingestion-evidence.mjs";
import {
  defaultProviderOptionsFromEnv,
  evidenceCompletionEnabled,
  resolvedForRetrievalFromPayload,
  valuePresent,
  normalizePositiveIntegerOrNull,
  postObservationCatalogVectorHedgeMs,
  postObservationExactAnchorCatalogBudgetMs,
  postObservationStructuredAnchorCatalogBudgetMs,
  postObservationRetrievalCriticalPathBudgetMs,
  postObservationRetrievalDeadlineEnabled,
  positiveIntegerFromEnv,
  providerOptionsFromPayload,
  retrievalApplicationEnabled,
  singleModelFastPathEnabled,
  ultraFastImageDetail,
  ultraFastTextVerbosity,
  ultraFastServiceTier,
  vectorEmbeddingWarmupOptions
} from "../../pipeline/provider-options.mjs";
import {
  buildInitialProviderPrompt,
  captureQualityForPayload,
  compactL2PromptEnabled,
  fastInitialProviderPromptEnabled,
  l1FastScoutHintPromptSection,
  providerMinimalOutputShape,
  ultraFastL2Enabled,
  vectorCandidatePromptSection
} from "../../pipeline/provider-prompt.mjs";
import {
  normalizeBoolean,
  explicitlyUncertainIdentityFields,
  normalizeFields,
  normalizeGradeCompanyForFields,
  normalizeObservableComponents,
  normalizePrintedCardCodeForFields
} from "../../pipeline/field-normalization.mjs";
import {
  calibrateConfidence,
  hasUncertainty,
  narrowSurfaceColorFromOpenSetParallel,
  normalizeUnresolved,
  resultHasDirectParallelSupport,
  suppressReviewOnlyParallelFields,
  unresolvedWithSuppressedParallelReview
} from "../../pipeline/result-calibration.mjs";
import {
  visualParallelWriterSuggestion,
  writerSuggestionEvidenceNode
} from "../../pipeline/writer-review-suggestions.mjs";
import {
  moveLeadingGradeToEnd,
  normalizeTitle,
  repairOrphanAutoGradeSuffix,
  sanitizeResultText
} from "../../pipeline/title-grammar.mjs";
import {
  mergeEvidenceMaps,
  mergeResolvedFields,
  withRecognitionEvidence,
  withRequestMetadata
} from "../../pipeline/result-decoration.mjs";
import {
  normalizeSerialText,
  rawIncludes,
  searchable,
  serialLimitForTitle,
  textMentionsAny,
  titleIncludesSerial
} from "../../pipeline/text-match.mjs";
import {
  defaultProviderModels,
  providerLabels,
  providerMetadata,
  providerModelOverrideFromOptions,
  visionProviderIds
} from "../../providers/provider-contract.mjs";
import { openAiKeyPoolSize } from "../../providers/openai-key-pool.mjs";
import { safeProviderErrorMessage } from "../../providers/provider-errors.mjs";
import { selectVisionProvider } from "../../providers/provider-registry.mjs";
import {
  createListingImageSignedReadUrl,
  verifyListingImageVerificationToken
} from "../../storage/supabase-image-storage.mjs";
import { readListingImageVerificationRecord } from "../../storage/storage-verification-store.mjs";
import { defaultCaptureProfileId, summarizeAssetImageQuality } from "../../image-quality/quality-gate.mjs";
import { evaluatePreProviderRescanGate } from "../../image-quality/pre-provider-rescan-gate.mjs";
import { createEvidenceField, createVisionSource } from "../../evidence/evidence-schema.mjs";
import { providerPayloadToEvidenceDocument, resolvedFieldsToLegacyFields } from "../../evidence/provider-evidence-normalizer.mjs";
import { renderListingPresentation } from "../../renderer/listing-renderer.mjs";
import { serialLimitText } from "../../renderer/title-cleanup.mjs";
import { expandPrintRunFields } from "../../print-run/print-run-fields.mjs";
import {
  enforceAtomicGradeFields,
  gradeAtomicCompleteness
} from "../../grade/grade-value.mjs";
import {
  gradeOcrRescueDecision,
  guardGradeFieldStates
} from "../../pipeline/grade-atomic-policy.mjs";
import {
  captureQualityLooksLikeSlab,
  criticalOcrRendezvousDecision
} from "../../pipeline/ocr-rendezvous-policy.mjs";
import { extractDirectSlabLabelParallel } from "../../preingestion/slab-label-evidence.mjs";
import { resolveGradeFields } from "../../resolver/grade-resolver.mjs";
import { completeEvidence } from "../../orchestration/evidence-completion-orchestrator.mjs";
import { createIdentityConvergenceRetriever } from "../../orchestration/identity-convergence-retriever.mjs";
import { attachFieldTaskOrchestration } from "../../orchestration/field-task-orchestrator.mjs";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence
} from "../../../identity-resolution/listing-resolution-gate.mjs";
import { identityStatuses } from "../../../identity-resolution/types.mjs";
import {
  isSupabaseFeedbackConfigured,
  listApprovedHistoryRecords,
  listingApprovedMemoryEnabled
} from "../../../supabase-feedback.mjs";
import {
  approvedHistoryRecordToListingResult,
  approvedIdentityMemorySource,
  lookupApprovedIdentityMemory
} from "../../memory/approved-identity-memory.mjs";
import { analyzeCardImagesWithRecognitionWorker } from "../../recognition/recognition-client.mjs";
import { recognitionRequestedFields } from "../../recognition/recognition-contract.mjs";
import { safeRecognitionError } from "../../recognition/recognition-errors.mjs";
import { recognitionWorkerConfig } from "../../recognition/recognition-feature-flags.mjs";
import {
  hasRecognitionEvidence,
  recognitionResponseToEvidenceDocument
} from "../../recognition/recognition-evidence-normalizer.mjs";
import {
  buildIdentityResultCacheKey,
  identityResultCacheReadEnabled,
  identityResultCacheRecordToListingResult,
  identityResultCacheWriteEnabled,
  readIdentityResultCacheRecord,
  saveIdentityResultCacheRecord
} from "../../cache/identity-result-cache.mjs";
import {
  identityInFlightCoalescingEnabled,
  runWithInFlightIdentityRequest
} from "../../cache/inflight-identity-request.mjs";
import {
  hasUsableVisualFeatures,
  lookupStoredVisualFeaturesForImages
} from "../../retrieval/stored-visual-features.mjs";
import { runRetrieval } from "../../retrieval/retrieval-engine.mjs";
import { retrievalModes, retrievalQueryFamilies } from "../../retrieval/retrieval-contract.mjs";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  vectorCandidatePacketAssistEligibility,
  vectorCandidatePacketHasPromptContent
} from "../../retrieval/vector-candidate-packet.mjs";
import { vectorIndexReady, vectorRetrievalActive, vectorRetrievalConfig, vectorRetrievalModes } from "../../retrieval/vector-feature-flags.mjs";
import { embedImagesWithVectorWorker } from "../../retrieval/vector-worker-client.mjs";
import { recordVectorRetrievalTelemetry } from "../../retrieval/vector-telemetry.mjs";
import { buildCandidateContextSummary } from "../../retrieval/candidate-context-summary.mjs";
import { mergeCatalogCandidateContexts } from "../../retrieval/catalog-context-merge.mjs";
import { v4ProductionStrategy } from "../../v4/policy/production-strategy.mjs";
import { providerTerminalPathActions } from "../../v4/policy/provider-terminal-path-policy.mjs";
import { applyColdStartSafeDraftPolicy } from "../../cold-start/cold-start-policy.mjs";
import { attachWorkflowSidecarsToListingResult } from "../../../data-loop/workflow-sidecar-dispatcher.mjs";
import {
  releaseV4ProviderCapacityForJob,
  v4ProviderDoneCapacityHandoffEnabled
} from "../../v4/jobs/production-job-queue.mjs";
import { triggerReleasedProviderCapacityRefill } from "../../v4/jobs/writer-ready-capacity-refill.mjs";
import {
  imagesFromPreIngestionBundle,
  readPreIngestionBundle,
  summarizePreIngestionBundle
} from "../../preingestion/preingestion-bundle.mjs";
import { waitForPreingestionOcrEvidence } from "../../preingestion/preingestion-ocr-worker.mjs";
import {
  listingStageCapacityPlan,
  runWithListingStageCapacity
} from "../../v4/orchestration/stage-capacity.mjs";
import { contractedConcurrency } from "../../v4/orchestration/concurrency-contract.mjs";

const maxFallbackTitleLength = 80;
// Accept optional bounded derived crop images while keeping provider input capped.
const defaultMaxPayloadImages = 14;
const hardMaxPayloadImages = 24;
const signedUrlConcurrency = contractedConcurrency(
  "signed_url_preparation",
  process.env.LISTING_SIGNED_URL_PREPARATION_CONCURRENCY
    || process.env.LISTING_SIGNED_URL_CONCURRENCY,
  { fallback: 4 }
);
const catalogCandidateContextCache = new Map();
const defaultCatalogCacheTtlMs = 10 * 60 * 1000;
const defaultCatalogCacheMaxEntries = 500;
const defaultCatalogFastLaneBudgetMs = 120;
const defaultPreingestionOcrPostProviderWaitMs = 0;
const defaultPreingestionOcrGradeRescueWaitMs = 10_000;
const defaultPreingestionOcrCriticalFieldWaitMs = 2_500;
const defaultPreingestionOcrSerialWaitMs = 8_000;
const confirmedOcrSerialConfidence = 0.86;
const singleCropOcrSerialConfidence = 0.94;

function configuredMaxPayloadImages(env = process.env) {
  return Math.max(
    2,
    Math.min(
      hardMaxPayloadImages,
      normalizePositiveIntegerOrNull(env.LISTING_MAX_PAYLOAD_IMAGES) || defaultMaxPayloadImages
    )
  );
}

export function verifiedSerialNumeratorFromPreingestion(payload = {}) {
  const patches = Array.isArray(payload.preingestion_evidence_patches)
    ? payload.preingestion_evidence_patches
    : [];
  const currentImageIds = new Set((Array.isArray(payload.images) ? payload.images : [])
    .map((image) => String(image?.image_id || image?.imageId || image?.id || "").trim())
    .filter(Boolean));
  const fullValues = new Map();
  for (const patch of patches) {
    if (!["print_run_number", "serial_number", "numerical_rarity"].includes(String(patch?.field || "").trim())) continue;
    if (String(patch?.source_type || "").trim().toUpperCase() !== "OCR") continue;
    const patchImageId = String(patch?.source_image_id || patch?.sourceImageId || "").trim();
    if (patchImageId && currentImageIds.size > 0 && !currentImageIds.has(patchImageId)) continue;
    const expanded = expandPrintRunFields({ print_run_number: patch.value, serial_number: patch.value });
    const fieldConfidence = ocrPatchPrintRunConfidence(patch, expanded.print_run_number || "");
    if (fieldConfidence < confirmedOcrSerialConfidence) continue;
    if (expanded.print_run_numerator && expanded.print_run_denominator) {
      const value = `${expanded.print_run_numerator}/${expanded.print_run_denominator}`;
      const provenance = patch?.provenance || {};
      const observationKey = String(
        provenance.job_key
        || provenance.crop_id
        || patch?.crop_id
        || `${patchImageId || "unknown-image"}:${provenance.source_region || provenance.crop_type || "unknown-region"}`
      ).trim();
      const observationDescriptor = [
        provenance.source_region,
        provenance.crop_type,
        provenance.job_key,
        provenance.crop_id,
        patch?.crop_id
      ].filter(Boolean).join(" ").toLowerCase();
      const directSerialCrop = /serial/.test(observationDescriptor) && !/full[_ -]?image/.test(observationDescriptor);
      const current = fullValues.get(value) || {
        value,
        confidence: 0,
        patch_count: 0,
        source_image_ids: new Set(),
        observation_keys: new Set(),
        direct_crop_observation_keys: new Set()
      };
      current.confidence = Math.max(current.confidence, fieldConfidence);
      current.patch_count += 1;
      if (patchImageId) current.source_image_ids.add(patchImageId);
      if (observationKey) current.observation_keys.add(observationKey);
      if (directSerialCrop && observationKey) current.direct_crop_observation_keys.add(observationKey);
      fullValues.set(value, current);
    }
  }
  if (fullValues.size !== 1) {
    return {
      verified: false,
      value: null,
      confidence: 0,
      conflict: fullValues.size > 1,
      candidate_values: [...fullValues.keys()]
    };
  }
  const only = [...fullValues.values()][0];
  const independentObservationCount = only.observation_keys.size;
  const directCropObservationCount = only.direct_crop_observation_keys.size;
  const verificationBasis = independentObservationCount >= 2
    ? "independent_ocr_agreement"
    : directCropObservationCount >= 1 && only.confidence >= singleCropOcrSerialConfidence
      ? "high_confidence_direct_serial_crop"
      : null;
  if (!verificationBasis) {
    return {
      verified: false,
      value: null,
      confidence: only.confidence,
      patch_count: only.patch_count,
      independent_observation_count: independentObservationCount,
      direct_crop_observation_count: directCropObservationCount,
      verification_basis: null,
      source_image_ids: [...only.source_image_ids],
      conflict: false,
      candidate_values: [only.value]
    };
  }
  return {
    verified: true,
    value: only.value,
    confidence: only.confidence,
    patch_count: only.patch_count,
    independent_observation_count: independentObservationCount,
    direct_crop_observation_count: directCropObservationCount,
    verification_basis: verificationBasis,
    source_image_ids: [...only.source_image_ids],
    conflict: false,
    candidate_values: [only.value]
  };
}

export function serialNumeratorVerificationFromPreingestion(payload = {}, rendezvous = null) {
  const verification = verifiedSerialNumeratorFromPreingestion(payload);
  if (verification.verified) return true;
  if (verification.conflict) return false;
  // OCR producing no serial reading is ABSENCE of evidence, not a rejection.
  // `false` means "current-image OCR rejected the numerator" to the renderer
  // and strips a provider-read serial the card actually shows (rendered as a
  // bare `#/denominator`). Only a real conflicting observation may veto;
  // pending or empty OCR stays `null` so the renderer falls back to the
  // evidence document's own provenance gate (CONFIRMED + direct current-image
  // source types), which already blocks unsourced numerators.
  return null;
}

export function preingestionEvidenceRefreshDecision(payload = {}, rendezvous = null) {
  const loadedPatchCount = Array.isArray(payload.preingestion_evidence_patches)
    ? payload.preingestion_evidence_patches.length
    : 0;
  const bundleId = String(payload.preingestion_bundle_id || payload.preingestionBundleId || "").trim();
  if (!bundleId) {
    return {
      skip: true,
      reason: "preingestion_not_requested",
      loaded_patch_count: loadedPatchCount,
      rendezvous_patch_count: 0
    };
  }

  const rendezvousPatchCount = Number.isFinite(Number(rendezvous?.patch_count))
    ? Number(rendezvous.patch_count)
    : 0;
  const settledWithoutWorker = ["NOT_REQUESTED", "UNCONFIGURED"].includes(
    String(rendezvous?.status || "").trim().toUpperCase()
  );
  const deferredAfterProvider = String(rendezvous?.status || "").trim().toUpperCase() === "DEFERRED_AFTER_PROVIDER";
  const noPatchDelta = rendezvousPatchCount <= loadedPatchCount;
  return {
    skip: noPatchDelta && (rendezvous?.terminal === true || settledWithoutWorker || deferredAfterProvider),
    reason: noPatchDelta ? "no_new_ocr_patches" : "new_ocr_patches_available",
    loaded_patch_count: loadedPatchCount,
    rendezvous_patch_count: rendezvousPatchCount
  };
}

function ocrPatchPrintRunConfidence(patch = {}, expectedPrintRun = "") {
  let confidence = Number.isFinite(Number(patch.confidence)) ? Number(patch.confidence) : 0;
  if (!expectedPrintRun) return confidence;
  for (const candidate of Array.isArray(patch.text_candidates) ? patch.text_candidates : []) {
    const candidateValue = candidate?.value ?? candidate?.text ?? candidate?.normalized_text ?? "";
    const parsed = expandPrintRunFields({ print_run_number: candidateValue, serial_number: candidateValue });
    if (parsed.print_run_number !== expectedPrintRun) continue;
    const candidateConfidence = Number(candidate?.confidence);
    if (Number.isFinite(candidateConfidence)) confidence = Math.max(confidence, candidateConfidence);
  }
  return confidence;
}

function serialNumeratorVerificationFromPayload(payload = {}) {
  return payload.serial_numerator_verified ?? payload.serialNumeratorVerified ?? null;
}

function storedVisualFeatureLookupEnabled(env = process.env, options = {}) {
  if (vectorRetrievalActive(env, options)) return true;
  if (Object.prototype.hasOwnProperty.call(options, "enable_stored_visual_features")) {
    return optionFlag(options, "enable_stored_visual_features", false);
  }
  return envFlag(env, "ENABLE_STORED_VISUAL_FEATURE_LOOKUP", false);
}

function queryVisualVectorPreflightEnabled(env = process.env, options = {}) {
  if (vectorRetrievalActive(env, options)) return true;
  if (Object.prototype.hasOwnProperty.call(options, "enable_query_visual_embeddings")) {
    return optionFlag(options, "enable_query_visual_embeddings", false);
  }
  return envFlag(env, "ENABLE_QUERY_VISUAL_VECTOR_PREFLIGHT", false);
}


function finalizeTiming(timingContext, result = {}) {
  const timing = {
    ...emptyTiming(),
    ...(timingContext?.timing || {})
  };
  timing.total_ms = Math.max(0, Math.round(nowMs() - Number(timingContext?.started_at_ms || nowMs())));
  timing.server_queue_ms = Math.max(0, Math.round(
    Number(timing.server_queue_ms || 0)
    + Number(result.identity_inflight?.coalesced ? result.identity_inflight.wait_ms : 0)
  ));

  const usageLatency = Number(result.usage?.latency_ms);
  if (!timing.provider_total_ms && Number.isFinite(usageLatency) && usageLatency > 0) {
    timing.provider_total_ms = Math.round(usageLatency);
  }

  return timing;
}

function withTiming(result = {}, timingContext) {
  const timedResult = {
    ...result,
    timing: finalizeTiming(timingContext, result)
  };
  return attachFieldTaskOrchestration(timedResult, { timing: timedResult.timing });
}

async function mapWithConcurrency(items, limit, worker) {
  const source = Array.from(items || []);
  const results = new Array(source.length);
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, source.length || 1));
  let cursor = 0;

  async function runWorker() {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

const defaultFields = {
  year: null,
  manufacturer: null,
  brand: null,
  product: null,
  multi_card: false,
  card_count: null,
  lot_type: null,
  set: null,
  subset: null,
  language: null,
  card_type: null,
  official_card_type: null,
  observable_components: [],
  insert: null,
  surface_color: null,
  parallel_family: null,
  parallel_exact: null,
  parallel: null,
  variation: null,
  player: null,
  players: [],
  character: null,
  card_name: null,
  artist: null,
  team: null,
  card_number: null,
  collector_number: null,
  checklist_code: null,
  print_run_number: null,
  print_run_numerator: null,
  print_run_denominator: null,
  numbered_to: null,
  serial_number: null,
  serial_denominator: null,
  numerical_rarity: null,
  expected_serial_denominator: null,
  grade_company: null,
  grade: null,
  card_grade: null,
  auto_grade: null,
  grade_type: "UNKNOWN",
  rc: false,
  first_bowman: false,
  ssp: false,
  case_hit: false,
  auto: false,
  relic: false,
  patch: false,
  jersey: false,
  sketch: false,
  redemption: false,
  one_of_one: false,
  suspicious_print_run: false,
  print_run_review_required: false
};
const finalizerCurrentImageFieldAllowList = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "subset",
  "language",
  "players",
  "player",
  "character",
  "card_name",
  "team",
  "card_type",
  "official_card_type",
  "observable_components",
  "insert",
  "surface_color",
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator",
  "numerical_rarity",
  "expected_serial_denominator",
  "collector_number",
  "card_number",
  "checklist_code",
  "grade_company",
  "grade",
  "card_grade",
  "auto_grade",
  "grade_type",
  "rc",
  "first_bowman",
  "ssp",
  "case_hit",
  "auto",
  "patch",
  "relic",
  "jersey",
  "sketch",
  "redemption",
  "one_of_one",
  "suspicious_print_run",
  "print_run_review_required"
]);

const finalizerNeverPromoteFromRawFields = Object.freeze([
  "parallel_exact",
  "parallel_family",
  "parallel",
  "variation",
  "collector_number",
  "card_number",
  "checklist_code"
]);

function finalizerFieldSupportSet(result = {}) {
  const fields = new Set();
  [
    result.catalog_assist_eligibility?.field_support_fields,
    result.vector_assist_eligibility?.field_support_fields,
    result.catalog_assist_summary?.field_support_fields,
    result.vector_assist_summary?.field_support_fields
  ].forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((field) => {
      const key = normalizeStringOrNull(field);
      if (key) fields.add(key);
    });
  });
  return fields;
}

function finalizerValuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).replace(/\s+/g, " ").trim() !== "" && value !== "UNKNOWN";
}

const finalizerConfirmedEvidenceStatuses = new Set(["CONFIRMED", "MANUAL_CONFIRMED"]);
const finalizerCurrentInstancePrintRunSources = new Set([
  "CARD_FRONT",
  "CARD_FRONT_PRINTED_TEXT",
  "CARD_BACK",
  "CARD_BACK_PRINTED_TEXT",
  "SLAB_LABEL",
  "OCR",
  "OPERATOR",
  "OFFICIAL_GRADING_DATA"
]);
const finalizerCurrentInstanceGradeSources = new Set([
  "SLAB_LABEL",
  "OCR",
  "OPERATOR",
  "OFFICIAL_GRADING_DATA"
]);

function finalizerEvidenceEntriesForField(evidence = {}, fieldNames = []) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  return fieldNames
    .map((fieldName) => evidence[fieldName])
    .filter((field) => field && typeof field === "object" && !Array.isArray(field));
}

function finalizerEvidenceStatusIsConfirmed(field = {}) {
  const status = normalizeStringOrNull(field.status || field.resolution_status || field.display_status);
  if (!status) return true;
  return finalizerConfirmedEvidenceStatuses.has(status.toUpperCase());
}

function finalizerEvidenceSources(field = {}) {
  const sources = Array.isArray(field.sources) ? field.sources : [];
  const sourceTypes = sources
    .map((source) => normalizeStringOrNull(source?.source_type || source?.sourceType || source?.type))
    .filter(Boolean);
  const direct = normalizeStringOrNull(field.source_type || field.sourceType || field.support_type || field.supportType);
  if (direct) sourceTypes.push(direct);
  return sourceTypes.map((sourceType) => sourceType.toUpperCase());
}

function finalizerEvidenceHasSource(field = {}, allowedSources = new Set()) {
  return finalizerEvidenceSources(field).some((sourceType) => allowedSources.has(sourceType));
}

function finalizerCandidateHasSource(candidate = {}, allowedSources = new Set()) {
  const sources = Array.isArray(candidate.sources) ? candidate.sources : [];
  return sources
    .map((source) => normalizeStringOrNull(source?.source_type || source?.sourceType || source?.type))
    .filter(Boolean)
    .some((sourceType) => allowedSources.has(sourceType.toUpperCase()));
}

function finalizerDirectEvidenceEntry(field = {}, allowedSources = new Set()) {
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  if (finalizerEvidenceStatusIsConfirmed(field) && finalizerEvidenceHasSource(field, allowedSources)) return field;

  const candidate = (Array.isArray(field.candidates) ? field.candidates : [])
    .filter((item) => (
      finalizerValuePresent(item?.value)
      && Number(item?.confidence || 0) >= 0.86
      && finalizerCandidateHasSource(item, allowedSources)
    ))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
  if (!candidate) return null;

  return {
    ...field,
    value: candidate.value,
    normalized_value: candidate.value,
    status: "CONFIRMED",
    confidence: candidate.confidence,
    sources: candidate.sources || field.sources || []
  };
}

function finalizerCurrentImageEvidenceEntriesForField(evidence = {}, fieldNames = [], allowedSources = new Set()) {
  return finalizerEvidenceEntriesForField(evidence, fieldNames)
    .map((field) => finalizerDirectEvidenceEntry(field, allowedSources))
    .filter(Boolean);
}

function finalizerEvidenceText(field = {}) {
  return [
    field.value,
    field.normalized_value,
    field.normalizedValue,
    field.visible_text,
    field.raw_text,
    field.observed_text,
    field.text,
    ...(Array.isArray(field.sources)
      ? field.sources.flatMap((source) => [
        source?.observed_text,
        source?.raw_text,
        source?.visible_text,
        source?.text
      ])
      : [])
  ].map(normalizeStringOrNull).filter(Boolean).join(" ");
}

function finalizerEvidenceValue(field = {}) {
  return normalizeStringOrNull(field.value ?? field.normalized_value ?? field.normalizedValue)
    || finalizerEvidenceText(field);
}

function finalizerEvidencePrintRunFields(evidence = {}) {
  const entries = finalizerCurrentImageEvidenceEntriesForField(evidence, [
    "print_run_number",
    "numerical_rarity",
    "serial_number",
    "print_run_denominator",
    "numbered_to",
    "serial_denominator"
  ], finalizerCurrentInstancePrintRunSources);

  for (const field of entries) {
    const value = finalizerEvidenceValue(field);
    const expanded = expandPrintRunFields({
      print_run_number: value,
      serial_number: value,
      numerical_rarity: value,
      print_run_numerator: field.print_run_numerator,
      print_run_denominator: field.print_run_denominator,
      numbered_to: field.numbered_to,
      serial_denominator: field.serial_denominator
    });
    if (expanded.print_run_number || expanded.print_run_denominator) return expanded;
  }
  return {};
}

function finalizerEvidenceGradeFields(evidence = {}) {
  const gradeEntry = finalizerCurrentImageEvidenceEntriesForField(
    evidence,
    ["grade"],
    finalizerCurrentInstanceGradeSources
  )[0] || null;
  const atomicEvidence = Object.fromEntries(["grade_company", "card_grade", "auto_grade", "grade_type"]
    .map((fieldName) => [fieldName, evidence?.[fieldName]])
    .filter(([, field]) => (
      field
      && typeof field === "object"
      && !Array.isArray(field)
      && finalizerEvidenceStatusIsConfirmed(field)
      && finalizerEvidenceHasSource(field, finalizerCurrentInstanceGradeSources)
    )));
  const gradeText = finalizerEvidenceText(gradeEntry || {});
  const parsed = gradeText
    ? resolveGradeFields({
      resolved: {},
      legacyFields: {
        title: gradeText,
        model_title_suggestion: gradeText,
        grade: gradeText,
        grade_company: gradeText,
        card_grade: "",
        auto_grade: ""
      }
    }).resolved || {}
    : {};

  const output = {};
  const company = normalizeGradeCompanyForFields(
    finalizerEvidenceValue(atomicEvidence.grade_company)
    || gradeEntry?.grade_company
    || parsed.grade_company
  );
  const cardGrade = normalizeStringOrNull(
    finalizerEvidenceValue(atomicEvidence.card_grade)
    || gradeEntry?.card_grade
    || parsed.card_grade
  );
  const autoGrade = normalizeStringOrNull(
    finalizerEvidenceValue(atomicEvidence.auto_grade)
    || gradeEntry?.auto_grade
    || parsed.auto_grade
  );
  const gradeType = normalizeStringOrNull(
    finalizerEvidenceValue(atomicEvidence.grade_type)
    || gradeEntry?.grade_type
    || parsed.grade_type
  );

  if (company) output.grade_company = company;
  if (cardGrade) {
    output.card_grade = cardGrade;
    output.grade = cardGrade;
  }
  if (autoGrade) output.auto_grade = autoGrade;
  if (gradeType && gradeType !== "UNKNOWN") {
    output.grade_type = gradeType;
  } else if (cardGrade && autoGrade) {
    output.grade_type = "CARD_AND_AUTO";
  } else if (cardGrade) {
    output.grade_type = "CARD_ONLY";
  } else if (autoGrade) {
    output.grade_type = "AUTO_ONLY";
  }
  return enforceAtomicGradeFields(output);
}

function applyEvidenceBackedPresentationOverrides(base = {}, evidence = {}) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return base;
  const output = { ...base };
  const printRun = finalizerEvidencePrintRunFields(evidence);
  if (printRun.print_run_number || printRun.print_run_denominator) {
    [
      "print_run_number",
      "print_run_numerator",
      "print_run_denominator",
      "numbered_to",
      "serial_number",
      "serial_denominator",
      "numerical_rarity",
      "expected_serial_denominator",
      "one_of_one",
      "suspicious_print_run",
      "print_run_review_required"
    ].forEach((fieldName) => {
      if (printRun[fieldName] !== undefined && printRun[fieldName] !== null && printRun[fieldName] !== "") {
        output[fieldName] = printRun[fieldName];
      }
    });
    if (!output.numerical_rarity && printRun.print_run_number) output.numerical_rarity = printRun.print_run_number;
  }

  const gradeFields = finalizerEvidenceGradeFields(evidence);
  Object.entries(gradeFields).forEach(([fieldName, value]) => {
    if (finalizerValuePresent(value)) output[fieldName] = value;
  });

  return output;
}

function applyVerifiedCurrentImagePrintRunOverride(base = {}, result = {}) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return base;
  const verification = result.preingestion_serial_verification;
  if (verification?.verified !== true || !verification.value) return base;

  const verified = expandPrintRunFields({
    print_run_number: verification.value,
    serial_number: verification.value
  });
  if (!verified.print_run_numerator || !verified.print_run_denominator) return base;

  return {
    ...base,
    ...verified,
    numerical_rarity: verified.print_run_number,
    serial_number: verified.print_run_number
  };
}

function finalizerTextLooksMoreSpecific(existing, incoming) {
  const current = normalizeStringOrNull(existing);
  const next = normalizeStringOrNull(incoming);
  if (!next) return false;
  if (!current) return true;
  const currentFolded = current.toLowerCase();
  const nextFolded = next.toLowerCase();
  if (currentFolded === nextFolded) return false;
  return nextFolded.includes(currentFolded) && next.length > current.length;
}

function finalizerArrayLooksMoreComplete(existing, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return false;
  const subjectKey = (value) => normalizeStringOrNull(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const currentValues = Array.isArray(existing)
    ? existing
    : normalizeStringOrNull(existing)
      ? String(existing).split(/\s*\/\s*/)
      : [];
  const currentKeys = new Set(currentValues
    .map(subjectKey)
    .filter(Boolean));
  const incomingKeys = incoming
    .map(subjectKey)
    .filter(Boolean);
  if (!incomingKeys.length) return false;
  if (incomingKeys.length <= currentKeys.size) return false;
  return [...currentKeys].every((value) => incomingKeys.includes(value));
}

function finalizerMergeCurrentImageFields(base = {}, current = {}, supportFields = new Set(), {
  allowExactCodePromotion = false
} = {}) {
  const normalizedCurrent = normalizeFields(current || {});
  const output = { ...(base || {}) };

  finalizerCurrentImageFieldAllowList.forEach((field) => {
    if (!allowExactCodePromotion && finalizerNeverPromoteFromRawFields.includes(field)) return;
    const incoming = normalizedCurrent[field];
    if (!finalizerValuePresent(incoming)) return;

    const existing = output[field];
    const supported = supportFields.has(field);
    const missing = !finalizerValuePresent(existing);
    const moreSpecific = finalizerTextLooksMoreSpecific(existing, incoming);
    const moreCompleteArray = finalizerArrayLooksMoreComplete(existing, incoming);

    if (missing || supported || moreSpecific || moreCompleteArray) output[field] = incoming;
  });

  return output;
}

function finalResolvedFieldsForPresentation(result = {}, {
  enforceAtomicGrade = true,
  maxLength = maxFallbackTitleLength
} = {}) {
  const renderedFields = result.rendered_fields && typeof result.rendered_fields === "object" && !Array.isArray(result.rendered_fields)
    ? result.rendered_fields
    : {};
  const renderedFieldContainer = renderedFields.fields && typeof renderedFields.fields === "object" && !Array.isArray(renderedFields.fields)
    ? renderedFields.fields
    : null;
  const supportFields = finalizerFieldSupportSet(result);
  const retrievalApplicationOwnsCandidateFields = result.retrieval_application?.owns_candidate_application === true;
  const retrievalResolutionIsCanonical = retrievalApplicationOwnsCandidateFields
    && result.retrieval_application?.resolver_consumed === true
    && result.resolved_fields
    && typeof result.resolved_fields === "object"
    && !Array.isArray(result.resolved_fields);
  // Once Identity Resolution consumes retrieval evidence, its resolved_fields
  // are the sole final-field owner. Re-reading a stale pre-resolution render
  // container here would silently undo applied catalog evidence.
  const fieldSources = (retrievalResolutionIsCanonical
    ? [result.resolved_fields]
    : [
        renderedFieldContainer,
        result.resolved_fields,
        result.resolved,
        result.fields,
        result.raw_provider_fields
      ])
    .filter((fields) => fields && typeof fields === "object" && !Array.isArray(fields));
  const [base = {}, ...rest] = fieldSources;
  const merged = rest.reduce((current, fields) => (
    finalizerMergeCurrentImageFields(current, fields, supportFields, {
      allowExactCodePromotion: fields !== result.raw_provider_fields
    })
  ), { ...base });
  // The terminal field owner may be rebuilt by assist-shadow or identity
  // resolution after the provider result was normalized. Re-normalize the
  // merged terminal snapshot once so trusted directory taxonomy and other
  // deterministic aliases cannot disappear at the final response boundary.
  let withCandidateOverlay = normalizeFields(merged);
  if (!retrievalApplicationOwnsCandidateFields) {
    const candidateDecision = v4ProductionStrategy.candidate_control.apply_decision({
      result,
      resolvedBefore: merged,
      maxLength
    });
    Object.assign(result, candidateDecision.result_patch);
    withCandidateOverlay = candidateDecision.resolved_after;
  }
  const withEvidenceOverrides = applyEvidenceBackedPresentationOverrides(
    withCandidateOverlay,
    result.normalized_evidence || result.evidence || {}
  );
  // Evidence normalization may retain a safe denominator-only reading even
  // after current-image OCR proves the full numerator. Re-apply only the
  // explicit verified OCR value so `1/5` cannot regress to `#/5` at render.
  const withVerifiedPrintRun = applyVerifiedCurrentImagePrintRunOverride(
    withEvidenceOverrides,
    result
  );
  const withSafeMultiCardInference = applySafeCurrentImageMultiCardInference(withVerifiedPrintRun);
  if (!Object.keys(withSafeMultiCardInference).length) return null;
  return enforceAtomicGrade
    ? enforceAtomicGradeFields(withSafeMultiCardInference)
    : withSafeMultiCardInference;
}

function applyGradeAtomicGuardToResult(result = {}, resolved = null, gradeAtomic = {}) {
  const guardReason = gradeAtomic.incomplete_score_without_company
    ? "score_without_company"
    : gradeAtomic.incomplete_company_without_score
      ? "company_without_score"
      : null;
  if (!guardReason) return result;

  const guardFields = (fields) => (
    fields && typeof fields === "object" && !Array.isArray(fields)
      ? enforceAtomicGradeFields(fields)
      : fields
  );
  const renderedFields = result.rendered_fields && typeof result.rendered_fields === "object" && !Array.isArray(result.rendered_fields)
    ? result.rendered_fields
    : null;
  const trace = Array.isArray(result.resolution_trace) ? result.resolution_trace : [];
  const hasGuardTrace = trace.some((entry) => entry?.step === "enforce_atomic_grade");

  return {
    ...result,
    fields: guardFields(result.fields),
    resolved: guardFields(result.resolved),
    resolved_fields: resolved || guardFields(result.resolved_fields),
    rendered_fields: renderedFields
      ? {
        ...guardFields(renderedFields),
        fields: guardFields(renderedFields.fields)
      }
      : result.rendered_fields,
    field_states: guardGradeFieldStates(result.field_states, true, guardReason),
    unresolved: uniqueValues([
      ...(Array.isArray(result.unresolved) ? result.unresolved : []),
      guardReason === "score_without_company"
        ? "grade requires grading company from current-image direct evidence"
        : "grade requires score from current-image slab-label evidence"
    ]),
    grade_atomic_guard: {
      applied: true,
      reason: guardReason,
      discarded_grade_company: gradeAtomic.incomplete_company_without_score
        ? gradeAtomic.grade_company || null
        : null,
      discarded_card_grade: gradeAtomic.card_grade || null,
      discarded_auto_grade: gradeAtomic.auto_grade || null
    },
    resolution_trace: hasGuardTrace
      ? trace
      : [
        ...trace,
        {
          phase: "presentation",
          step: "enforce_atomic_grade",
          decision: guardReason === "score_without_company"
            ? "discard_score_without_company"
            : "suppress_company_without_score",
          output: { grade_company: null, card_grade: null, auto_grade: null, grade_type: "UNKNOWN" }
        }
      ]
  };
}

function finalizeDeterministicPresentation(result = {}, payload = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  if (result.provider_error_code || result.provider_error_type) return result;

  const unguardedResolved = finalResolvedFieldsForPresentation(result, {
    enforceAtomicGrade: false,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  });
  const gradeAtomic = gradeAtomicCompleteness(unguardedResolved || {});
  const gradeAtomicGuardApplied = gradeAtomic.incomplete_score_without_company
    || gradeAtomic.incomplete_company_without_score;
  const resolved = unguardedResolved ? enforceAtomicGradeFields(unguardedResolved) : null;
  const gradeGuardedResult = applyGradeAtomicGuardToResult(result, resolved, gradeAtomic);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved) || !Object.keys(resolved).length) return gradeGuardedResult;

  const presentation = renderListingPresentation({
    resolved,
    evidence: result.normalized_evidence || result.evidence || {},
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    // The OCR rendezvous runs inside the provider pipeline, while this final
    // render receives the outer request payload. Prefer the runtime decision
    // carried by the result so a rejected numerator cannot be reintroduced at
    // the response boundary by stale request state.
    serialNumeratorVerified: result.serial_numerator_verified
      ?? result.serialNumeratorVerified
      ?? serialNumeratorVerificationFromPayload(payload)
  });
  const renderedTitle = presentation.rendered_title || "";
  if (!renderedTitle) return gradeGuardedResult;

  const renderedFields = gradeGuardedResult.rendered_fields && typeof gradeGuardedResult.rendered_fields === "object" && !Array.isArray(gradeGuardedResult.rendered_fields)
    ? gradeGuardedResult.rendered_fields
    : {};
  const nextRenderedFields = {
    ...renderedFields,
    title: renderedTitle,
    rendered_title: renderedTitle,
    modules: presentation.modules,
    module_order: presentation.module_order,
    title_render_source: "deterministic_renderer_finalizer",
    fields: resolved
  };

  return {
    ...gradeGuardedResult,
    confidence: gradeGuardedResult.confidence === "FAILED" ? "LOW" : gradeGuardedResult.confidence,
    title_recovered_from_structured_fields: gradeGuardedResult.confidence === "FAILED" || !gradeGuardedResult.final_title,
    title: renderedTitle,
    final_title: renderedTitle,
    rendered_title: renderedTitle,
    resolved: gradeGuardedResult.resolved,
    resolved_fields: resolved,
    grade_atomic_guard: gradeAtomicGuardApplied
      ? gradeGuardedResult.grade_atomic_guard
      : {
        applied: false,
        reason: "complete_or_absent",
        discarded_card_grade: null,
        discarded_auto_grade: null
      },
    title_render_source: "deterministic_renderer_finalizer",
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    rendered_fields: nextRenderedFields,
    modules: presentation.modules,
    module_order: presentation.module_order
  };
}

function finalizeTerminalRecognitionEvidence(result = {}, recognitionEvidenceDocument = null, payload = {}) {
  return finalizeDeterministicPresentation(
    withRecognitionEvidence(result, recognitionEvidenceDocument, payload),
    payload
  );
}

function withVerifiedPreingestionPrintRun(result = {}, payload = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const verification = verifiedSerialNumeratorFromPreingestion(payload);
  if (!verification.verified || !verification.value) {
    return {
      ...result,
      preingestion_serial_verification: verification
    };
  }

  const providerPrintRun = expandPrintRunFields(
    result.resolved_fields || result.resolved || result.fields || result.raw_provider_fields || {}
  );
  const evidenceResult = withRecognitionEvidence(result, null, payload);
  const preingestionEvidence = preingestionEvidenceDocumentFromPayload(payload)?.evidence || {};
  const lockedEvidenceFields = Object.fromEntries([
    "print_run_number",
    "numerical_rarity",
    "serial_number",
    "print_run_denominator",
    "numbered_to",
    "serial_denominator"
  ].filter((fieldName) => preingestionEvidence[fieldName]).map((fieldName) => [
    fieldName,
    {
      ...preingestionEvidence[fieldName],
      status: "CONFIRMED",
      conflicts: (Array.isArray(preingestionEvidence[fieldName].conflicts)
        ? preingestionEvidence[fieldName].conflicts
        : []).map((entry) => ({ ...entry, resolved: true }))
    }
  ]));

  const printRun = expandPrintRunFields({
    print_run_number: verification.value,
    serial_number: verification.value
  });
  const overlay = {
    print_run_number: printRun.print_run_number,
    print_run_numerator: printRun.print_run_numerator,
    print_run_denominator: printRun.print_run_denominator,
    numbered_to: printRun.numbered_to,
    numerical_rarity: printRun.print_run_number,
    serial_number: printRun.serial_number,
    serial_denominator: printRun.serial_denominator,
    expected_serial_denominator: printRun.expected_serial_denominator,
    one_of_one: printRun.one_of_one === true
  };
  const previous = providerPrintRun;
  const conflict = previous.print_run_number
    && previous.print_run_number !== printRun.print_run_number
    ? {
      field: "serial_number",
      conflict_type: "OCR_CURRENT_IMAGE_OVERRIDE",
      conflicting_values: [previous.print_run_number, printRun.print_run_number],
      severity: "HIGH",
      resolved: true,
      resolved_value: printRun.print_run_number,
      reason: "Unique high-confidence current-image OCR print run overrides the provider reading."
    }
    : null;
  const renderedFields = evidenceResult.rendered_fields && typeof evidenceResult.rendered_fields === "object"
    ? evidenceResult.rendered_fields
    : {};
  const next = {
    ...evidenceResult,
    evidence: { ...(evidenceResult.evidence || {}), ...lockedEvidenceFields },
    normalized_evidence: evidenceResult.normalized_evidence
      ? { ...evidenceResult.normalized_evidence, ...lockedEvidenceFields }
      : evidenceResult.normalized_evidence,
    fields: { ...(evidenceResult.fields || {}), ...overlay },
    resolved: { ...(evidenceResult.resolved || {}), ...overlay },
    resolved_fields: { ...(evidenceResult.resolved_fields || evidenceResult.resolved || evidenceResult.fields || {}), ...overlay },
    rendered_fields: {
      ...renderedFields,
      ...overlay,
      fields: { ...(renderedFields.fields || {}), ...overlay }
    },
    serial_numerator_verified: true,
    preingestion_serial_verification: verification,
    conflict_map: conflict
      ? [...(Array.isArray(evidenceResult.conflict_map) ? evidenceResult.conflict_map : []), conflict]
      : evidenceResult.conflict_map,
    resolution_trace: [
      ...(Array.isArray(evidenceResult.resolution_trace) ? evidenceResult.resolution_trace : []),
      {
        phase: "preingestion_ocr",
        step: "lock_verified_print_run",
        input: { provider_value: previous.print_run_number || null },
        output: { resolved_value: printRun.print_run_number },
        decision: conflict ? "override_provider_with_current_image_ocr" : "confirm_current_image_print_run"
      }
    ]
  };
  return finalizeDeterministicPresentation(next, payload);
}

function withVerifiedPreingestionSlabParallel(result = {}, payload = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const verification = extractDirectSlabLabelParallel(payload.preingestion_evidence_patches);
  if (!verification.verified || !verification.value) {
    return {
      ...result,
      preingestion_slab_parallel_verification: verification
    };
  }

  const evidenceResult = withRecognitionEvidence(result, null, payload);
  const source = {
    ...createVisionSource({
      sourceType: "SLAB_LABEL",
      imageId: verification.source_image_id,
      sourceCropId: verification.crop_id,
      captureRole: "grade_label",
      region: "grade_label",
      observedText: verification.value,
      rawText: verification.raw_text,
      sourceInferenceMethod: "paddle_ocr_direct_slab_label",
      trustTier: 1
    }),
    direct_observation: true,
    text_visible: true
  };
  const previous = normalizeStringOrNull(
    evidenceResult.resolved_fields?.parallel_exact
    || evidenceResult.resolved?.parallel_exact
    || evidenceResult.fields?.parallel_exact
    || evidenceResult.fields?.parallel
  );
  const conflict = previous && searchable(previous) !== searchable(verification.value)
    ? {
      field: "parallel_exact",
      conflict_type: "SLAB_LABEL_CURRENT_IMAGE_OVERRIDE",
      conflicting_values: [previous, verification.value],
      severity: "HIGH",
      resolved: true,
      resolved_value: verification.value,
      reason: "Direct slab-label text overrides visual parallel inference."
    }
    : null;
  const parallelEvidence = createEvidenceField({
    value: verification.value,
    normalizedValue: verification.value,
    status: "CONFIRMED",
    confidence: verification.confidence,
    candidates: [{
      value: verification.value,
      confidence: verification.confidence,
      sources: [source]
    }],
    sources: [source],
    conflicts: conflict ? [conflict] : []
  });
  const surfaceColorEvidence = verification.surface_color
    ? createEvidenceField({
      value: verification.surface_color,
      normalizedValue: verification.surface_color,
      status: "CONFIRMED",
      confidence: verification.confidence,
      candidates: [{
        value: verification.surface_color,
        confidence: verification.confidence,
        sources: [source]
      }],
      sources: [source],
      conflicts: []
    })
    : null;
  const evidenceOverlay = {
    parallel_exact: parallelEvidence,
    ...(surfaceColorEvidence ? { surface_color: surfaceColorEvidence } : {})
  };
  const fieldOverlay = {
    parallel_exact: verification.value,
    parallel: verification.value,
    ...(verification.surface_color ? { surface_color: verification.surface_color } : {})
  };
  const renderedFields = evidenceResult.rendered_fields && typeof evidenceResult.rendered_fields === "object"
    ? evidenceResult.rendered_fields
    : {};
  const next = {
    ...evidenceResult,
    evidence: { ...(evidenceResult.evidence || {}), ...evidenceOverlay },
    normalized_evidence: { ...(evidenceResult.normalized_evidence || evidenceResult.evidence || {}), ...evidenceOverlay },
    fields: { ...(evidenceResult.fields || {}), ...fieldOverlay },
    resolved: { ...(evidenceResult.resolved || {}), ...fieldOverlay },
    resolved_fields: { ...(evidenceResult.resolved_fields || evidenceResult.resolved || evidenceResult.fields || {}), ...fieldOverlay },
    rendered_fields: {
      ...renderedFields,
      ...fieldOverlay,
      fields: { ...(renderedFields.fields || {}), ...fieldOverlay }
    },
    preingestion_slab_parallel_verification: verification,
    conflict_map: conflict
      ? [...(Array.isArray(evidenceResult.conflict_map) ? evidenceResult.conflict_map : []), conflict]
      : evidenceResult.conflict_map,
    open_set_presentation_guard: evidenceResult.open_set_presentation_guard
      ? {
        ...evidenceResult.open_set_presentation_guard,
        direct_slab_label_override: true,
        action: "restore_exact_parallel_from_direct_slab_label"
      }
      : evidenceResult.open_set_presentation_guard,
    resolution_trace: [
      ...(Array.isArray(evidenceResult.resolution_trace) ? evidenceResult.resolution_trace : []),
      {
        phase: "preingestion_ocr",
        step: "lock_verified_slab_parallel",
        input: { provider_value: previous || null, raw_text: verification.raw_text },
        output: { resolved_value: verification.value },
        decision: conflict ? "override_visual_parallel_with_slab_text" : "confirm_parallel_from_slab_text"
      }
    ]
  };
  return finalizeDeterministicPresentation(next, payload);
}

async function buildListingResult(statusCode, result, timingContext, payload = {}) {
  const finalizedResult = finalizeDeterministicPresentation(result, payload);
  const preingestionSummary = payload.preingestion_summary || null;
  const timedResult = withTiming({
    ...finalizedResult,
    preingestion_bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || null,
    bundle_used: payload.preingestion_bundle_used === true,
    bundle_status: payload.preingestion_bundle_status || null,
    preprocessing_summary: preingestionSummary
  }, timingContext);
  const workflowResult = await timeAsync(timingContext, "workflow_sidecars_ms", () => (
    attachWorkflowSidecarsToListingResult({
      result: timedResult,
      payload,
      env: process.env,
      fetchImpl: globalThis.fetch,
      scheduler: typeof waitUntil === "function" ? waitUntil : null
    })
  ));
  const finalResult = {
    ...workflowResult,
    timing: finalizeTiming(timingContext, workflowResult)
  };
  finalResult.pipeline_node_ledger = buildPipelineNodeLedger({
    result: finalResult,
    timingContext,
    payload
  });
  return { statusCode, body: finalResult };
}

function compactFileName(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findResolutionLabel(text, resolutionMap) {
  const upperText = text.toUpperCase();
  const match = Object.entries(resolutionMap || {}).find(([code]) => upperText.includes(code.toUpperCase()));
  return match ? match : [];
}


function stripOpenSetUnsupportedParallelTerms(value) {
  const original = normalizeStringOrNull(value);
  if (!original) return null;
  const originalSearchable = searchable(original);
  const hasUnsupportedParallelTerm = textMentionsAny(originalSearchable, [
    "cracked ice",
    "disco",
    "geometric",
    "hyper",
    "lava",
    "mojo",
    "prism",
    "prizm",
    "refractor",
    "sapphire",
    "shimmer",
    "sparkle",
    "speckle",
    "tiger",
    "velocity",
    "vinyl",
    "wave",
    "x-fractor",
    "xfractor"
  ]);
  if (!hasUnsupportedParallelTerm) return original;

  const stripped = original
    .replace(/\b(?:Cracked\s+Ice|Tiger\s+Stripes?|Tiger|X[-\s]?Fractor|Refractor|Sapphire|Shimmer|Sparkles?|Speckle|Geometric|Velocity|Prizms?|Prism|Mojo|Disco|Pulsar|Hyper|Lava|Vinyl|Wave)\b/gi, " ")
    .replace(/\b(?:Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}

function stripOpenSetUnsupportedTitleTerms(value) {
  const original = normalizeStringOrNull(value);
  if (!original) return "";
  const protectedPhrases = [];
  let text = original.replace(/\b(?:Topps|Bowman)\s+Chrome\s+Sapphire(?:\s+Edition)?\b|\bPanini\s+Prizm(?:\s+FIFA(?:\s+Soccer)?)?\b/gi, (match) => {
    const token = `__LYNCA_PRODUCT_${protectedPhrases.length}__`;
    protectedPhrases.push({ token, value: match });
    return token;
  });
  const animalPattern = /\b(?:Tiger|Zebra|Snakeskin|Snake\s+Skin|Elephant|Leopard|Animal\s+Print)\b/i.test(text);
  text = text
    .replace(/\b(?:Cracked\s+Ice|Tiger\s+Stripes?|Tiger|X[-\s]?Fractor|Refractor|Sapphire|Shimmer|Sparkles?|Speckle|Geometric|Velocity|Prizms?|Prism|Mojo|Disco|Pulsar|Hyper|Lava|Vinyl|Wave)\b/gi, " ");
  if (animalPattern) {
    text = text.replace(/\b(?:Black|Blue|Bronze|Gold|Green|Orange|Pink|Purple|Red|Silver|White|Yellow)\b/gi, " ");
  }
  text = text
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
  for (const phrase of protectedPhrases) {
    text = text.replace(phrase.token, phrase.value);
  }
  return text.replace(/\s+/g, " ").trim();
}

function exactParallelFieldsPresent(fields = {}) {
  return [
    fields.parallel_exact,
    fields.parallel_family,
    fields.parallel,
    fields.variation
  ].some((value) => {
    return valuePresent(value) && stripOpenSetUnsupportedParallelTerms(value) !== normalizeStringOrNull(value);
  });
}

function openSetUnsupportedParallelPresentationPresent(fields = {}) {
  return [
    fields.insert,
    fields.card_type,
    fields.official_card_type,
    fields.subset
  ].some((value) => stripOpenSetUnsupportedParallelTerms(value) !== normalizeStringOrNull(value));
}

function openSetAssistShadowGuardReason(result = {}) {
  const fastPath = result.fast_path || {};
  const reasonText = searchable([
    result.route_reason,
    fastPath.reason,
    result.completion_state?.open_set_reason,
    result.open_set_reason
  ].filter(Boolean).join(" "));
  if (fastPath.assist_shadow_only === true) return "assist_shadow_no_prompt_safe_candidates";
  if (reasonText.includes("assist shadow no prompt safe candidates")) return "assist_shadow_no_prompt_safe_candidates";
  if (reasonText.includes("no prompt safe catalog or vector candidates")) return "assist_shadow_no_prompt_safe_candidates";
  return "";
}

function applyOpenSetAssistShadowPresentationGuard(result = {}, payload = {}) {
  const guardReason = openSetAssistShadowGuardReason(result);
  if (!guardReason) return result;

  const compatibilityFields = {
    ...(result.fields || {})
  };
  const resolvedFields = {
    ...(result.resolved || result.resolved_fields || {})
  };
  const rawProviderFields = {
    ...(result.raw_provider_fields || {})
  };
  const mergedFields = {
    ...rawProviderFields,
    ...resolvedFields,
    ...compatibilityFields
  };
  const hadExactParallel = exactParallelFieldsPresent(mergedFields);
  const hadUnsupportedPresentationParallel = openSetUnsupportedParallelPresentationPresent(mergedFields);
  const preservedSurfaceColor = narrowSurfaceColorFromOpenSetParallel(mergedFields);
  const writerSuggestion = visualParallelWriterSuggestion({
    rawFields: rawProviderFields,
    resolved: resolvedFields,
    fieldEvidence: result.raw_provider_field_evidence,
    conflicts: result.conflict_map
  });
  if (resultHasDirectParallelSupport(result)) {
    return {
      ...result,
      open_set_presentation_guard: {
        used: false,
        reason: guardReason,
        action: "direct_parallel_evidence_preserved"
      }
    };
  }
  const currentTitle = result.rendered_title || result.final_title || result.title || "";
  const titleAfterOpenSetStrip = stripOpenSetUnsupportedTitleTerms(currentTitle);
  const hadUnsupportedTitleParallel = Boolean(titleAfterOpenSetStrip && titleAfterOpenSetStrip !== normalizeStringOrNull(currentTitle));
  if (!hadExactParallel && !hadUnsupportedPresentationParallel && !hadUnsupportedTitleParallel && !preservedSurfaceColor && !writerSuggestion) {
    return {
      ...result,
      open_set_presentation_guard: {
        used: false,
        reason: guardReason,
        action: "no_parallel_fields_present"
      }
    };
  }

  const guardedCompatibilityFields = {
    ...compatibilityFields,
    insert: stripOpenSetUnsupportedParallelTerms(compatibilityFields.insert),
    card_type: stripOpenSetUnsupportedParallelTerms(compatibilityFields.card_type),
    official_card_type: stripOpenSetUnsupportedParallelTerms(compatibilityFields.official_card_type),
    subset: stripOpenSetUnsupportedParallelTerms(compatibilityFields.subset),
    surface_color: preservedSurfaceColor || null,
    parallel_family: null,
    parallel_exact: null,
    parallel: null,
    variation: null
  };
  const guardedResolvedFields = {
    ...resolvedFields,
    insert: stripOpenSetUnsupportedParallelTerms(resolvedFields.insert),
    card_type: stripOpenSetUnsupportedParallelTerms(resolvedFields.card_type),
    official_card_type: stripOpenSetUnsupportedParallelTerms(resolvedFields.official_card_type),
    subset: stripOpenSetUnsupportedParallelTerms(resolvedFields.subset),
    surface_color: preservedSurfaceColor || null,
    parallel_family: null,
    parallel_exact: null,
    parallel: null,
    variation: null
  };
  const writerPresentationFields = writerSuggestion
    ? {
        ...guardedResolvedFields,
        parallel_exact: writerSuggestion.value,
        surface_color: preservedSurfaceColor || guardedResolvedFields.surface_color || null
      }
    : guardedResolvedFields;
  const writerSuggestionEvidence = writerSuggestionEvidenceNode(writerSuggestion);
  const writerPresentationEvidence = writerSuggestionEvidence
    ? {
        ...(result.evidence || result.normalized_evidence || {}),
        parallel_exact: writerSuggestionEvidence
      }
    : result.evidence || result.normalized_evidence || {};
  const presentation = renderListingPresentation({
    resolved: writerPresentationFields,
    evidence: writerPresentationEvidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    serialNumeratorVerified: serialNumeratorVerificationFromPayload(payload)
  });
  const presentationTitle = presentation.rendered_title || result.rendered_title || result.final_title || result.title || "";
  const renderedTitle = writerSuggestion
    ? presentationTitle
    : stripOpenSetUnsupportedTitleTerms(presentationTitle);
  const unresolved = uniqueValues([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    hadExactParallel || hadUnsupportedPresentationParallel || hadUnsupportedTitleParallel ? "open-set exact parallel requires catalog or writer review" : null,
    preservedSurfaceColor ? "surface color retained as narrow observable value" : null
  ]);

  return {
    ...result,
    title: renderedTitle,
    final_title: renderedTitle,
    rendered_title: renderedTitle,
    model_title_suggestion: renderedTitle,
    title_render_source: writerSuggestion
      ? "open_set_writer_review_suggestion"
      : "open_set_narrow_parallel_guard",
    fields: guardedCompatibilityFields,
    resolved: guardedResolvedFields,
    resolved_fields: guardedResolvedFields,
    evidence_fields: {
      ...(result.evidence_fields || {}),
      surface_color: preservedSurfaceColor || null,
      parallel_family: null,
      parallel_exact: null,
      parallel: null,
      variation: null
    },
    writer_review_suggestions: writerSuggestion
      ? {
          ...(result.writer_review_suggestions || {}),
          parallel_exact: writerSuggestion
        }
      : result.writer_review_suggestions || {},
    unresolved,
    open_set_presentation_guard: {
      used: true,
      reason: guardReason,
      action: writerSuggestion
        ? "kept_visual_parallel_in_writer_presentation_only"
        : "downgraded_exact_parallel_to_surface_color",
      removed_fields: [
        "parallel_exact",
        "parallel_family",
        "parallel",
        "variation"
      ],
      preserved_surface_color: preservedSurfaceColor || null,
      writer_review_suggestion: writerSuggestion
    },
    rendered_fields: {
      ...(result.rendered_fields || {}),
      ...guardedCompatibilityFields,
      ...(writerSuggestion ? { parallel_exact: writerSuggestion.value } : {}),
      title: renderedTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: writerSuggestion
        ? "open_set_writer_review_suggestion"
        : "open_set_narrow_parallel_guard",
      fields: writerSuggestion
        ? { ...guardedCompatibilityFields, parallel_exact: writerSuggestion.value }
        : guardedCompatibilityFields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer || result.renderer,
    renderer_version: presentation.renderer_version || result.renderer_version,
    title_length_policy: presentation.title_length_policy || result.title_length_policy
  };
}


function fallbackBaseResult(payload) {
  const firstImage = payload.images?.[0] || {};
  const sourceName = compactFileName(firstImage.name);
  const [code, resolvedLabel] = findResolutionLabel(firstImage.name, payload.resolutionMap);
  const titleParts = [sourceName];

  if (resolvedLabel && !sourceName.toLowerCase().includes(String(resolvedLabel).toLowerCase())) {
    titleParts.push(resolvedLabel);
  }

  const title = normalizeTitle(titleParts.filter(Boolean).join(" "), payload.maxTitleLength || maxFallbackTitleLength);

  const result = {
    title,
    confidence: title ? "MEDIUM" : "FAILED",
    reason: title
      ? "Fallback result from filename because no vision provider is configured."
      : "No usable filename or AI configuration.",
    fields: {
      ...defaultFields,
      insert: resolvedLabel || null,
      card_number: code || null
    },
    unresolved: ["image identification", "market wording"],
    capture_profile_id: payload.captureProfileId || defaultCaptureProfileId,
    capture_quality: captureQualityForPayload(payload),
    source: "fallback"
  };

  return withEvidenceCompatibility(result, result, payload);
}

async function fallbackResult(payload) {
  const primaryPayload = primaryPayloadForProvider(payload);
  return withEvidenceCompletion(fallbackBaseResult(primaryPayload), primaryPayload);
}

function createPreProviderRescanResult(payload = {}) {
  const captureQuality = captureQualityForPayload(payload);
  const decision = evaluatePreProviderRescanGate({ captureQuality });
  if (!decision.blocked) return null;

  const blockingRegions = Array.isArray(decision.blocking_regions) ? decision.blocking_regions : [];
  const result = withRequestMetadata({
    title: "",
    final_title: "",
    rendered_title: "",
    model_title_suggestion: "",
    title_render_source: "pre_provider_rescan_gate",
    confidence: "LOW",
    reason: "Image quality gate requires a targeted rescan before recognition or provider inference.",
    fields: defaultFields,
    resolved: {},
    evidence: {},
    unresolved: [
      `targeted rescan required: ${blockingRegions.join(", ") || "identity critical region"} occluded`
    ],
    source: "image_quality_gate",
    provider: "image_quality_gate",
    route: "TARGETED_RESCAN_REQUIRED",
    route_reason: "Identity-critical image region is occluded before any paid provider call.",
    capture_quality: captureQuality,
    pre_provider_rescan_gate: decision,
    usage: {
      provider_calls: 0,
      retrieval_calls: 0,
      recognition_worker_calls: 0,
      latency_ms: 0,
      estimated_cost_usd: 0,
      resolution_rounds: 0
    },
    resolution_trace: [
      {
        phase: "pre_provider_rescan_gate",
        step: "evaluate_capture_quality",
        input: {
          route: captureQuality.route || captureQuality.glare_route || null,
          occluded_regions: decision.occluded_regions || []
        },
        output: {
          blocked: true,
          blocking_regions: blockingRegions
        },
        decision: "request_targeted_rescan_before_provider",
        created_at: new Date().toISOString()
      }
    ]
  }, payload);

  return applyIdentityResolutionGate(result, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: "image_quality_gate"
  });
}

function storageRoleIsDerived(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return false;
  return !["image_1_original", "image_2_original", "front_original", "back_original", "front", "back", "primary"].includes(normalized);
}

function imageIsDerived(image = {}) {
  const role = image.storageRole || image.storage_role || image.role || image.capture_angle || "";
  return Boolean(image.derived || image.sourceRegion || image.source_region || storageRoleIsDerived(role));
}

function primaryImagesFromImages(images = []) {
  const primary = images.filter((image) => !imageIsDerived(image));
  return primary.length ? primary : images.slice(0, 2);
}

function providerImagesFromImages(images = [], {
  maxDerived = 6
} = {}) {
  const primaryImages = primaryImagesFromImages(images).slice(0, 2);
  const primarySet = new Set(primaryImages);
  const derivedImages = derivedImagesFromImages(images)
    .filter((image) => !primarySet.has(image))
    .slice(0, Math.max(0, Number(maxDerived) || 0));
  return [...primaryImages, ...derivedImages];
}

function explicitPrimaryImagesFromImages(images = []) {
  return images.filter((image) => !imageIsDerived(image));
}

function boundedPayloadImagesFromImages(images = [], {
  maxImages = defaultMaxPayloadImages
} = {}) {
  const payloadImages = Array.isArray(images) ? images : [];
  if (!payloadImages.length) {
    return {
      ok: false,
      reason: "empty"
    };
  }

  const explicitPrimaryImages = explicitPrimaryImagesFromImages(payloadImages);
  const primaryImages = (explicitPrimaryImages.length ? explicitPrimaryImages : primaryImagesFromImages(payloadImages)).slice(0, 2);
  if (!primaryImages.length) {
    return {
      ok: false,
      reason: "primary_images_missing"
    };
  }

  const primarySet = new Set(primaryImages);
  const derivedImages = payloadImages
    .filter((image) => !primarySet.has(image));
  const maxDerived = Math.max(0, Math.max(2, Number(maxImages) || defaultMaxPayloadImages) - primaryImages.length);
  const currentBatchImages = [
    ...primaryImages,
    ...derivedImages.slice(0, maxDerived)
  ];

  return {
    ok: true,
    images: currentBatchImages,
    primary_image_count: primaryImages.length,
    derived_image_count: derivedImages.length,
    deferred_image_count: Math.max(0, payloadImages.length - currentBatchImages.length)
  };
}

async function verifyApprovedMemoryImages({ payload = {} } = {}) {
  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  if (!primaryImages.length) return { ok: false, reason: "primary_images_missing" };
  const tenantId = payload.tenant_id || payload.tenantId || "";

  for (const image of primaryImages) {
    const metadata = storageMetadataForImage(image);
    if (!metadata.objectPath) return { ok: false, reason: "verified_storage_path_required" };
    await assertVerifiedStorageImage(image, tenantId);
  }

  return { ok: true };
}

async function createApprovedMemoryTitle(payload) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (optionFlag(providerOptions, "disable_approved_identity_memory", false)) return null;
  if (!listingApprovedMemoryEnabled() || !isSupabaseFeedbackConfigured()) return null;

  const startedAt = Date.now();
  let lookup;
  try {
    lookup = await lookupApprovedIdentityMemory({
      payload,
      enabled: true,
      loadApprovedRecords: ({ assetFingerprint, limit }) => listApprovedHistoryRecords({
        assetFingerprint,
        limit
      }),
      verifyImages: verifyApprovedMemoryImages
    });
  } catch {
    return null;
  }

  if (!lookup.hit) return null;

  const baseResult = approvedHistoryRecordToListingResult({
    record: lookup.record,
    payload,
    assetFingerprint: lookup.asset_fingerprint,
    imagePaths: lookup.image_paths,
    latencyMs: Date.now() - startedAt
  });

  return applyIdentityResolutionGate(baseResult, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: approvedIdentityMemorySource
  });
}

async function createIdentityCacheTitle(payload) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (optionFlag(providerOptions, "disable_identity_result_cache", false)) return null;
  if (!identityResultCacheReadEnabled() || !isSupabaseFeedbackConfigured()) return null;

  const startedAt = Date.now();
  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) return null;

  try {
    const verified = await verifyIdentityCacheImages(payload);
    if (!verified.ok) return null;

    const lookup = await readIdentityResultCacheRecord({
      cacheKey: key.cache_key
    });
    if (!lookup.hit) return null;

    return identityResultCacheRecordToListingResult({
      record: lookup.record,
      payload,
      latencyMs: Date.now() - startedAt
    });
  } catch {
    return null;
  }
}

async function withIdentityCacheWrite(result, payload) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (optionFlag(providerOptions, "disable_identity_result_cache", false)) {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: false,
        read_bypassed: true,
        write_attempted: false,
        write_saved: false,
        write_reason: "identity_cache_bypassed_by_request"
      }
    };
  }
  if (!identityResultCacheWriteEnabled() || !isSupabaseFeedbackConfigured()) {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        write_attempted: false,
        write_saved: false,
        write_reason: "identity_cache_write_disabled"
      }
    };
  }

  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        write_attempted: false,
        write_saved: false,
        write_reason: key.reason
      }
    };
  }

  try {
    const verified = await verifyIdentityCacheImages(payload);
    if (!verified.ok) {
      return {
        ...result,
        identity_cache: {
          ...(result.identity_cache || {}),
          cache_hit: result.identity_cache?.cache_hit === true,
          cache_key: key.cache_key,
          write_attempted: false,
          write_saved: false,
          write_reason: verified.reason
        }
      };
    }

    const saved = await saveIdentityResultCacheRecord({
      result,
      payload,
      cacheKey: key.cache_key,
      imageFingerprints: key.image_fingerprints
    });
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        cache_key: key.cache_key,
        write_attempted: true,
        write_saved: saved.saved === true,
        write_reason: saved.reason || null
      }
    };
  } catch {
    return {
      ...result,
      identity_cache: {
        ...(result.identity_cache || {}),
        cache_hit: result.identity_cache?.cache_hit === true,
        cache_key: key.cache_key,
        write_attempted: true,
        write_saved: false,
        write_reason: "identity_cache_write_failed"
      }
    };
  }
}

async function createIdentityInFlightKey(payload) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (optionFlag(providerOptions, "disable_identity_result_cache", false)) return null;
  if (!identityInFlightCoalescingEnabled()) return null;
  if (!isSupabaseFeedbackConfigured()) return null;

  const key = buildIdentityResultCacheKey(payload);
  if (!key.ok) return null;

  try {
    const verified = await verifyIdentityCacheImages(payload);
    return verified.ok ? key.cache_key : null;
  } catch {
    return null;
  }
}

function derivedImagesFromImages(images = []) {
  return images.filter(imageIsDerived);
}

function primaryPayloadForProvider(payload = {}) {
  return {
    ...payload,
    images: providerImagesFromImages(payload.images || [], {
      maxDerived: Number(process.env.PROVIDER_MAX_FIELD_CROPS || process.env.FIELD_MAX_CROPS_PER_ASSET || 1200)
    })
  };
}

function storageMetadataForImage(image = {}) {
  const cropMetadata = image.cropMetadata || image.crop_metadata || {};
  return {
    assetId: image.assetId || image.asset_id || cropMetadata.asset_id,
    objectPath: image.objectPath || image.object_path || image.storagePath || image.storage_path,
    bucket: image.bucket || image.storage_bucket,
    contentType: image.originalType || image.original_type || image.contentType || image.content_type || image.type,
    size: image.originalSize || image.original_size || image.size,
    width: image.originalWidth || image.original_width || image.width,
    height: image.originalHeight || image.original_height || image.height,
    token: image.storageVerificationToken
      || image.storage_verification_token
      || image.verificationToken
      || image.verification_token
  };
}

async function assertVerifiedStorageImage(image = {}, tenantId = "") {
  const metadata = storageMetadataForImage(image);
  const normalizedTenantId = String(tenantId || "").trim();
  if (!metadata.objectPath) {
    if (normalizedTenantId && normalizedTenantId !== "tenant_legacy") {
      throw new Error("Tenant listing images must use a verified storage object path.");
    }
    return null;
  }
  if (!normalizedTenantId) {
    throw new Error("Tenant context is required for listing image verification.");
  }

  if (!(image.storageVerified === true || image.storage_verified === true)) {
    throw new Error("Listing image storage reference has not been verified.");
  }

  if (metadata.token) {
    try {
      verifyListingImageVerificationToken({
        token: metadata.token,
        tenantId: normalizedTenantId,
        objectPath: metadata.objectPath,
        bucket: metadata.bucket,
        contentType: metadata.contentType,
        size: metadata.size,
        width: metadata.width,
        height: metadata.height
      });
      return metadata;
    } catch (error) {
      if (!/expired/i.test(String(error.message || ""))) {
        throw error;
      }
    }
  }

  const durableRecord = await readListingImageVerificationRecord({
    tenantId: normalizedTenantId,
    assetId: metadata.assetId || null,
    objectPath: metadata.objectPath,
    bucket: metadata.bucket,
    contentType: metadata.contentType,
    size: metadata.size,
    width: metadata.width,
    height: metadata.height
  });
  if (!durableRecord.verified) {
    throw new Error("Listing image storage reference has no current server verification record.");
  }

  return metadata;
}

async function verifyIdentityCacheImages(payload = {}) {
  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  if (!primaryImages.length) return { ok: false, reason: "primary_images_missing" };
  const tenantId = payload.tenant_id || payload.tenantId || "";
  if (!String(tenantId).trim()) return { ok: false, reason: "tenant_context_required" };

  for (const image of primaryImages) {
    const metadata = storageMetadataForImage(image);
    const contentSha256 = String(image.contentSha256 || image.content_sha256 || "").trim().toLowerCase();
    if (!metadata.objectPath || !contentSha256) return { ok: false, reason: "verified_content_hash_required" };
    if (!(image.storageVerified === true || image.storage_verified === true)) {
      return { ok: false, reason: "verified_storage_required" };
    }

    const durableRecord = await readListingImageVerificationRecord({
      tenantId,
      assetId: metadata.assetId || null,
      objectPath: metadata.objectPath,
      bucket: metadata.bucket,
      contentType: metadata.contentType,
      size: metadata.size,
      width: metadata.width,
      height: metadata.height
    });
    if (!durableRecord.verified) return { ok: false, reason: durableRecord.reason || "verification_record_missing" };
    const storedHash = String(durableRecord.record?.content_sha256 || "").trim().toLowerCase();
    if (!storedHash || storedHash !== contentSha256 || durableRecord.record?.content_hash_verified !== true) {
      return { ok: false, reason: "content_hash_verification_mismatch" };
    }
  }

  return { ok: true };
}

function normalizeAiResult(result, maxTitleLength, source = "openai") {
  const confidenceMap = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  };
  const confidence = confidenceMap[String(result.confidence || "").toUpperCase()] || "MEDIUM";
  const explicitlyUncertainFields = explicitlyUncertainIdentityFields(result.fields);
  const fields = normalizeFields(result.fields);
  const unresolved = normalizeUnresolved([
    ...(Array.isArray(result.unresolved) ? result.unresolved : []),
    ...explicitlyUncertainFields.map((field) => `${field} contains explicit uncertainty and requires review`)
  ], result.fields);
  const sanitized = sanitizeResultText(result, fields, confidence, unresolved, maxTitleLength);
  const title = repairOrphanAutoGradeSuffix(moveLeadingGradeToEnd(sanitized.title, maxTitleLength), fields, maxTitleLength);
  const preTitleAudit = {
    confidence: sanitized.confidence,
    reason: sanitized.reason.slice(0, 520),
    unresolved: sanitized.hadBackgroundContamination
      ? [...sanitized.unresolved, "background branding ignored"]
      : sanitized.unresolved
  };
  const calibrated = calibrateConfidence({
    title,
    confidence: preTitleAudit.confidence,
    reason: preTitleAudit.reason,
    fields,
    unresolved: preTitleAudit.unresolved
  });
  const presentationFields = suppressReviewOnlyParallelFields(fields, calibrated.reason, calibrated.unresolved);
  const presentationUnresolved = unresolvedWithSuppressedParallelReview(
    fields,
    presentationFields,
    calibrated.unresolved
  );

  return {
    title,
    model_title_suggestion: title,
    confidence: calibrated.confidence,
    reason: calibrated.reason,
    fields: presentationFields,
    unresolved: presentationUnresolved,
    vector_candidate_decision: result.vector_candidate_decision || null,
    field_normalization_guard: {
      explicit_uncertainty_suppressed_count: explicitlyUncertainFields.length,
      explicit_uncertainty_suppressed_fields: explicitlyUncertainFields
    },
    source,
    _normalized_evidence_fields: fields,
    _pre_title_audit: preTitleAudit
  };
}

function withEvidenceCompatibility(result, providerPayload, payload) {
  const {
    _pre_title_audit: preTitleAudit,
    _normalized_evidence_fields: normalizedEvidenceFields,
    ...publicResult
  } = result;
  const evidenceFields = {
    ...(normalizedEvidenceFields || providerPayload.fields || publicResult.fields || {})
  };
  if (normalizedEvidenceFields && publicResult.fields) {
    [
      "surface_color",
      "parallel_family",
      "parallel_exact",
      "parallel",
      "variation"
    ].forEach((field) => {
      if (publicResult.fields[field] === null && evidenceFields[field] !== null && evidenceFields[field] !== undefined) {
        evidenceFields[field] = null;
      }
    });
    if (valuePresent(publicResult.fields.surface_color)
      && !valuePresent(evidenceFields.surface_color)) {
      evidenceFields.surface_color = publicResult.fields.surface_color;
    }
  }
  const payloadForEvidence = {
    ...providerPayload,
    title: providerPayload.title || result.model_title_suggestion || result.title,
    confidence: preTitleAudit?.confidence || providerPayload.confidence || publicResult.confidence,
    fields: evidenceFields,
    unresolved: Array.isArray(providerPayload.unresolved) ? providerPayload.unresolved : publicResult.unresolved
  };
  const evidenceDocument = providerPayloadToEvidenceDocument(payloadForEvidence, {
    images: payload.images || []
  });
  const normalizedLegacyFields = resolvedFieldsToLegacyFields(evidenceDocument.resolved);
  const fields = {
    ...publicResult.fields,
    ...Object.fromEntries(Object.entries(normalizedLegacyFields).filter(([, value]) => value !== null && value !== undefined))
  };
  const presentation = renderListingPresentation({
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    serialNumeratorVerified: serialNumeratorVerificationFromPayload(payload)
  });
  const renderedTitle = presentation.rendered_title || "";
  const finalTitle = renderedTitle || publicResult.title || "";
  const titleMissingRiskFields = new Set([
    "serial",
    "print_run_number",
    "print_run_denominator",
    "numbered_to",
    "serial_number",
    "card_number",
    "collector_number",
    "checklist_code",
    "grade",
    "grade_company",
    "card_grade",
    "auto_grade",
    "player",
    "players",
    "character",
    "auto",
    "rc",
    "one_of_one"
  ]);
  const initialTitleMissingFields = Array.isArray(publicResult.unresolved)
    ? publicResult.unresolved
      .map((item) => String(item || "").match(/^title missing\s+(.+)$/i)?.[1])
      .filter(Boolean)
    : [];
  const initialTitleMissingRisk = publicResult.confidence === "LOW"
    && initialTitleMissingFields.some((field) => titleMissingRiskFields.has(field));
  const rendererCanSafelyRecalibrate = publicResult.confidence === "LOW"
    && initialTitleMissingFields.length > 0
    && !initialTitleMissingRisk;
  const calibrationBase = {
    confidence: initialTitleMissingRisk
      ? "MEDIUM"
      : rendererCanSafelyRecalibrate
        ? preTitleAudit?.confidence || publicResult.confidence
        : publicResult.confidence,
    reason: publicResult.reason,
    unresolved: publicResult.unresolved || []
  };
  const finalCalibration = renderedTitle
    ? calibrateConfidence({
      title: finalTitle,
      confidence: calibrationBase.confidence,
      reason: calibrationBase.reason,
      fields,
      unresolved: calibrationBase.unresolved.filter((item) => !/^title missing /i.test(String(item || "")))
    })
    : {
      confidence: publicResult.confidence,
      reason: publicResult.reason,
      unresolved: publicResult.unresolved || []
    };

  return {
    ...publicResult,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: renderedTitle,
    title_override: null,
    title_render_source: renderedTitle ? "deterministic_renderer" : "provider_title_fallback",
    fields,
    confidence: finalCalibration.confidence,
    reason: finalCalibration.reason,
    unresolved: finalCalibration.unresolved,
    evidence: evidenceDocument.evidence,
    raw_provider_fields: providerPayload.fields || publicResult.fields || null,
    normalized_evidence: evidenceDocument.evidence,
    resolved: evidenceDocument.resolved,
    resolved_fields: evidenceDocument.resolved,
    rendered_fields: {
      ...fields,
      title: finalTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: renderedTitle ? "deterministic_renderer" : "provider_title_fallback",
      fields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy,
    resolution_trace: evidenceDocument.resolution_trace || [],
    model_title_suggestion: evidenceDocument.model_title_suggestion,
    evidence_fields: evidenceFields,
    raw_observed_fields: normalizedEvidenceFields || providerPayload.fields || null,
    evidence_schema_version: evidenceDocument.schema_version,
    provider_field_rejections: Array.isArray(providerPayload.provider_field_rejections)
      ? providerPayload.provider_field_rejections
      : [],
    raw_provider_field_evidence: Array.isArray(providerPayload.field_evidence)
      ? providerPayload.field_evidence
      : []
  };
}

function withCompletedEvidencePresentation(result, completion, payload) {
  const resolved = completion.resolved || result.resolved;
  const evidence = completion.evidence || result.evidence;
  if (!resolved || !evidence) return result;

  const presentation = renderListingPresentation({
    resolved,
    evidence,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    serialNumeratorVerified: serialNumeratorVerificationFromPayload(payload)
  });
  const normalizedLegacyFields = resolvedFieldsToLegacyFields(resolved);
  const fields = {
    ...result.fields,
    ...Object.fromEntries(Object.entries(normalizedLegacyFields).filter(([, value]) => value !== null && value !== undefined))
  };
  const renderedTitle = presentation.rendered_title || "";
  const finalTitle = result.title_override || renderedTitle || result.final_title || result.title || "";

  return {
    ...result,
    title: finalTitle,
    final_title: finalTitle,
    rendered_title: renderedTitle,
    title_render_source: renderedTitle ? "deterministic_renderer" : result.title_render_source,
    fields,
    evidence,
    normalized_evidence: evidence,
    resolved,
    resolved_fields: resolved,
    rendered_fields: {
      ...fields,
      title: finalTitle,
      rendered_title: renderedTitle,
      modules: presentation.modules,
      module_order: presentation.module_order,
      title_render_source: renderedTitle ? "deterministic_renderer" : result.title_render_source,
      fields
    },
    modules: presentation.modules,
    module_order: presentation.module_order,
    renderer: presentation.renderer,
    renderer_version: presentation.renderer_version,
    title_length_policy: presentation.title_length_policy
  };
}

function normalizedCandidateConflictFields(candidate = {}, extraKeys = []) {
  const explicit = [
    candidate.conflicting_fields,
    candidate.direct_evidence_conflicts,
    candidate.conflicts,
    ...extraKeys.map((key) => candidate[key])
  ].flatMap((value) => Array.isArray(value) ? value : []);
  const anchorContradictions = Array.isArray(candidate.anchor_agreement?.contradicted)
    ? candidate.anchor_agreement.contradicted
    : [];
  return [...new Set([...explicit, ...anchorContradictions].map((conflict) => normalizeStringOrNull(
    typeof conflict === "string" ? conflict : conflict?.field || conflict?.field_name || conflict?.name || conflict?.conflicting_field
  )).filter(Boolean))];
}

function candidateConflictFields(candidate = {}) {
  return normalizedCandidateConflictFields(candidate, ["soft_conflicting_fields", "soft_conflicts"]);
}

function retrievalCandidateApprovedForIdentity(candidate = {}, providerOptions = {}) {
  if (!candidate || candidateConflictFields(candidate).length) return false;
  const status = String(
    candidate.reference_metadata?.retrieval_status
    || candidate.retrieval_status
    || candidate.reference_status
    || ""
  ).trim().toLowerCase();
  if (/^(approved|reviewed|verified)$/.test(status)) return true;
  const sourceType = String(candidate.source_type || candidate.reference_metadata?.source_type || "").toUpperCase();
  const sourceStatus = String(candidate.reference_metadata?.source_status || candidate.source_status || "").toUpperCase();
  if (
    status === "registry"
    || sourceType === "OFFICIAL_CHECKLIST"
    || /_OFFICIAL_(?:CHECKLIST|CARDLIST|CARD_DATABASE|DATABASE)$|OFFICIAL_CARD_SEARCH|OFFICIAL_RELEASE|OFFICIAL_PRODUCT_PAGE|OFFICIAL_DIGITAL_LIBRARY/.test(sourceType)
    || [
      "AUTO_PARSED_FROM_OFFICIAL_CHECKLIST",
      "OFFICIAL_CHECKLIST_CANDIDATE",
      "OFFICIAL_CHECKLIST_CONFIRMED",
      "OFFICIAL_RELEASE_SUPPORT",
      "OFFICIAL_RELEASE_METADATA",
      "TOPPS_OFFICIAL_RAW",
      "OFFICIAL_CHECKLIST_RAW"
    ].includes(sourceStatus)
  ) {
    return true;
  }
  const evalCorrectedTitleGt = optionFlag(providerOptions, "corrected_title_as_temporary_gt", false) === true;
  return evalCorrectedTitleGt
    && (
      candidate.field_derivation?.corrected_title_used === true
      || candidate.field_derivation?.corrected_title_as_temporary_gt === true
      || candidate.reference_metadata?.corrected_title_as_temporary_gt === true
      || sourceStatus === "AUTO_PARSED_FROM_VERIFIED_TITLE"
    );
}

function retrievalCandidatesForIdentity(completion = {}, providerOptions = {}) {
  const retrieval = completion.retrieval || {};
  const sources = Array.isArray(retrieval.sources) ? retrieval.sources : [];
  const selectedId = retrieval.selected_candidate?.candidate_id || "";
  const selected = retrieval.selected_candidate && retrievalCandidateApprovedForIdentity(retrieval.selected_candidate, providerOptions)
    ? [{ ...retrieval.selected_candidate, selected: true, identity_evidence_eligible: true }]
    : [];
  const topCandidates = sources
    .filter((candidate) => candidate && candidate.candidate_id !== selectedId)
    .filter((candidate) => retrievalCandidateApprovedForIdentity(candidate, providerOptions))
    .filter((candidate) => {
      const sourceType = String(candidate.source_type || "").toUpperCase();
      const score = Number(candidate.match_score || 0);
      if (sourceType === "VISUAL_VECTOR") return score >= 0.38 || Number(candidate.visual_similarity || 0) >= 0.72;
      return score >= 0.28 || Number(candidate.trust_tier || 9) <= 5;
    })
    .slice(0, 8)
    .map((candidate) => ({
      ...candidate,
      selected: candidate.selected === true,
      identity_evidence_eligible: candidate.identity_evidence_eligible === true
    }));
  const seen = new Set();
  return [...selected, ...topCandidates].filter((candidate) => {
    const key = candidate.candidate_id || candidate.source_url || JSON.stringify(candidate.fields || {});
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conflictSeverity(conflict = {}) {
  return String(conflict.severity || "").trim().toUpperCase();
}

function hasBlockingIdentityConflict(result = {}) {
  const conflicts = [
    ...(Array.isArray(result.conflict_map) ? result.conflict_map : []),
    ...(Array.isArray(result.identity_resolution?.conflict_map) ? result.identity_resolution.conflict_map : [])
  ];
  return conflicts.some((conflict) => {
    if (conflict.resolved === true) return false;
    return ["MEDIUM", "HIGH", "CRITICAL"].includes(conflictSeverity(conflict));
  });
}

function fastPathEligible(result = {}) {
  const fastVisionResolved = result.fast_vision_policy?.role === "PRIMARY_FAST_VISION"
    && result.fast_vision_policy?.allow_single_source_publish === true
    && result.identity_resolution_status === identityStatuses.RESOLVED;
  return (result.identity_resolution_status === identityStatuses.CONFIRMED || fastVisionResolved)
    && Boolean(result.final_title || result.title)
    && !hasBlockingIdentityConflict(result);
}

function providerSignalFastPathEligible(result = {}) {
  const confidence = String(result.confidence || "").trim().toUpperCase();
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved : [];
  const reasonText = searchable(result.reason || result.route_reason || "");
  if (confidence !== "HIGH") return false;
  if (hasUncertainty(reasonText, unresolved)) return false;
  return true;
}

function tryProviderFastPath(result, payload, providerId, {
  catalogContext = {},
  vectorContext = {},
  env = process.env
} = {}) {
  if (!envFlag(env, "ENABLE_LISTING_FAST_PATH", true)) return null;
  const providerOptions = providerOptionsFromPayload(payload);
  if (evidenceCompletionEnabled(env, providerOptions)
    && (optionFlag(providerOptions, "enable_catalog_assist", false) === true
      || optionFlag(providerOptions, "enable_vector_assist", false) === true)) {
    return null;
  }
  if (!providerSignalFastPathEligible(result)) return null;

  const controlled = withCandidateControl(result, {
    catalogContext,
    vectorContext,
    providerOptions,
    env,
    sourceFeedbackId: payload.source_feedback_id || payload.sourceFeedbackId || null,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  }, {
    includeRetrievalApplication: true
  });
  const gated = applyIdentityResolutionGate(controlled, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId
  });
  if (!fastPathEligible(gated)) return null;

  return {
    ...gated,
    route: "FAST_PATH_PROVIDER_CONFIRMED",
    route_reason: "Initial provider evidence resolved the required card identity fields without blocking conflicts.",
    retrieval: result.retrieval || {
      skipped: true,
      reason: "fast_path_provider_confirmed"
    },
    completion_trace: Array.isArray(result.completion_trace)
      ? result.completion_trace
      : Array.isArray(result.resolution_trace)
        ? result.resolution_trace
        : [],
    fast_path: {
      enabled: true,
      used: true,
      skipped_evidence_completion: true,
      skipped_focused_reread: true,
      skipped_retrieval: true
    },
    usage: mergeUsage(result.usage, null, {
      providerCalls: result.provider ? 1 : 0
    })
  };
}

function singleModelDraftPath(result, payload, providerId, {
  reason = "single_model_fast_path",
  allowWhenEvidenceCompletion = false,
  assistShadowOnly = false,
  catalogContext = {},
  vectorContext = {},
  env = process.env
} = {}) {
  const providerOptions = providerOptionsFromPayload(payload);
  if (evidenceCompletionEnabled(env, providerOptions) && !allowWhenEvidenceCompletion) return null;

  const controlled = withCandidateControl(result, {
    catalogContext,
    vectorContext,
    providerOptions,
    env,
    sourceFeedbackId: payload.source_feedback_id || payload.sourceFeedbackId || null,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  }, {
    includeRetrievalApplication: true
  });
  const gated = applyIdentityResolutionGate(controlled, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId
  });

  return {
    ...gated,
    route: gated.route || result.route || "SINGLE_MODEL_WRITER_DRAFT",
    route_reason: gated.route_reason || "Single-model fast path produced a writer-review draft without retrieval or focused rereads.",
    retrieval: result.retrieval || {
      skipped: true,
      reason
    },
    completion_trace: Array.isArray(result.completion_trace)
      ? result.completion_trace
      : Array.isArray(result.resolution_trace)
        ? result.resolution_trace
        : [],
    fast_path: {
      ...(result.fast_path || {}),
      enabled: true,
      used: result.fast_path?.used === true,
      single_model_fast: true,
      assist_shadow_only: assistShadowOnly,
      skipped_evidence_completion: true,
      skipped_focused_reread: true,
      skipped_retrieval: true,
      reason
    },
    usage: mergeUsage(result.usage, null, {
      providerCalls: result.provider ? 1 : 0
    })
  };
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function withPrimaryFastVisionPolicy(result = {}, {
  primaryProviderId
} = {}) {
  return {
    ...result,
    identity_provider_id: "primary_fast_vision",
    fast_vision_policy: {
      role: "PRIMARY_FAST_VISION",
      primary_provider_id: primaryProviderId || result.provider || result.source || null,
      allow_single_source_publish: true
    },
    unresolved: uniqueValues([
      ...(Array.isArray(result.unresolved) ? result.unresolved : [])
    ])
  };
}

function mergeVisualFeaturePayloads(...payloads) {
  const features = payloads.flatMap((payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.features)) return payload.features;
    return [];
  }).filter((feature) => Array.isArray(feature?.embedding) && feature.embedding.length > 0);
  if (!features.length) return {};
  return {
    status: "OK",
    features
  };
}

function withVisualFeatures(result = {}, visualFeatures = {}) {
  const merged = mergeVisualFeaturePayloads(result.visual_features, result.recognition_preflight?.visual_features, visualFeatures);
  if (!hasUsableVisualFeatures(merged)) return result;
  return {
    ...result,
    visual_features: merged,
    visual_feature_summary: {
      source: visualFeatures?.source || result.visual_feature_summary?.source || "provider_or_recognition",
      feature_count: merged.features.length,
      embedding_roles: [...new Set(merged.features.map((feature) => feature.embedding_role).filter(Boolean))]
    }
  };
}

function visualFeaturesForRetrieval(result = {}, fallbackVisualFeatures = {}) {
  if (hasUsableVisualFeatures(fallbackVisualFeatures)) return fallbackVisualFeatures;
  if (result.visual_features && typeof result.visual_features === "object") return result.visual_features;
  if (result.recognition_preflight?.visual_features && typeof result.recognition_preflight.visual_features === "object") {
    return result.recognition_preflight.visual_features;
  }
  if (result.recognition?.visual_features && typeof result.recognition.visual_features === "object") {
    return result.recognition.visual_features;
  }
  return [];
}

function emptyVectorCandidatePacket(reason = "vector_retrieval_disabled") {
  return {
    vector_retrieval: {
      status: "UNAVAILABLE",
      status_code: "VECTOR_RETRIEVAL_UNAVAILABLE",
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: [],
      unavailable: [{ provider_id: "visual_vector", reason }]
    }
  };
}

function deferredRetrievalCandidatePacket(reason = "post_observation_retrieval_deadline", providerId = "visual_vector") {
  return {
    vector_retrieval: {
      status: "DEFERRED_SHADOW",
      status_code: "RETRIEVAL_DEFERRED_OFF_CRITICAL_PATH",
      instruction: "Retrieval continues outside the writer-critical path and did not affect this title.",
      candidates: [],
      unavailable: [],
      deferred: [{ provider_id: providerId, reason }]
    }
  };
}

function vectorRetrievalEnv(env = process.env, config = vectorRetrievalConfig(env)) {
  return {
    ...env,
    ENABLE_VISUAL_VECTOR_RETRIEVAL: "true",
    VECTOR_RETRIEVAL_MODE: config.mode,
    ENABLE_VECTOR_RETRIEVAL: "true",
    VISUAL_VECTOR_MODEL_ID: config.modelId,
    VISUAL_VECTOR_MODEL_REVISION: config.modelRevision,
    VISUAL_VECTOR_PREPROCESSING_VERSION: config.preprocessingVersion,
    VISUAL_VECTOR_MATCH_COUNT: String(config.internalTopN),
    VISUAL_VECTOR_RETRIEVAL_TIMEOUT_MS: String(config.queryTimeoutMs),
    VECTOR_RETRIEVAL_INTERNAL_TOP_N: String(config.internalTopN),
    VECTOR_QUERY_TIMEOUT_MS: String(config.queryTimeoutMs),
    ENABLE_ADVANCED_RETRIEVAL: config.advancedRetrievalEnabled ? "true" : "false",
    ENABLE_HYBRID_RETRIEVAL: config.hybridRetrievalEnabled ? "true" : "false",
    VECTOR_CORRECTED_TITLE_AS_TEMPORARY_GT: config.correctedTitleAsTemporaryGt ? "true" : "false",
    VECTOR_EVAL_CORRECTED_TITLE_AS_GT: config.correctedTitleAsTemporaryGt ? "true" : "false",
    ADVANCED_RETRIEVAL_STAGE1_TOP_N: String(config.advancedStage1TopN),
    ADVANCED_RETRIEVAL_RRF_K: String(config.rrfK),
    ADVANCED_RETRIEVAL_LOW_MARGIN: String(config.lowMarginThreshold),
    POSTGRES_HYBRID_RETRIEVAL_TOP_N: String(config.advancedStage1TopN)
  };
}

function retrievalEnvForProviderOptions(env = process.env, providerOptions = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  return config.enabled ? vectorRetrievalEnv(env, config) : env;
}

function retrievalFamiliesForProviderOptions(env = process.env, providerOptions = {}) {
  const catalogAssist = optionFlag(providerOptions, "enable_catalog_assist", false);
  const vectorAssist = optionFlag(providerOptions, "enable_vector_assist", false);
  const config = vectorRetrievalConfig(env, providerOptions);
  const families = [];
  if (catalogAssist) {
    families.push(
      retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
      retrievalQueryFamilies.INTERNAL_REGISTRY,
      retrievalQueryFamilies.CATALOG_EXACT_CODE,
      retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT,
      retrievalQueryFamilies.CATALOG_PRODUCT_VOCABULARY,
      retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR,
      retrievalQueryFamilies.CATALOG_SET_SUBJECT
    );
  }
  if (config.enabled && vectorAssist) {
    families.push(retrievalQueryFamilies.VISUAL_VECTOR);
    if (config.hybridRetrievalEnabled) families.push(retrievalQueryFamilies.POSTGRES_HYBRID);
  }
  return families.length ? [...new Set(families)] : null;
}

function catalogRetrievalFamilies() {
  return [
    retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
    retrievalQueryFamilies.INTERNAL_REGISTRY,
    retrievalQueryFamilies.CATALOG_EXACT_CODE,
    retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT,
    retrievalQueryFamilies.CATALOG_PRODUCT_VOCABULARY,
    retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR,
    retrievalQueryFamilies.CATALOG_SET_SUBJECT,
    retrievalQueryFamilies.CATALOG_SUBJECT_ANCHOR
  ];
}

export function catalogRetrievalFamiliesForFields(fields = {}, {
  stagePhase = "catalog_lookup"
} = {}) {
  const allFamilies = catalogRetrievalFamilies();
  if (stagePhase !== "post_provider") return allFamilies;

  const normalized = normalizeFields(fields || {});
  const baseFamilies = [
    retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
    retrievalQueryFamilies.INTERNAL_REGISTRY
  ];
  const hasPrintedCode = fieldHasValue(normalized, "checklist_code", "collector_number", "card_number");
  const hasSubject = fieldHasValue(normalized, "players", "player", "subject", "character");
  const hasProduct = fieldHasValue(normalized, "product", "set", "subset", "insert");
  const hasYear = fieldHasValue(normalized, "year");
  const hasSerialDenominator = valuePresent(serialDenominatorAnchorValue(normalized));
  const hasInformativeSetSubject = hasSubject && catalogSetAnchorAddsInformation(normalized);
  const hasNamedSetSubject = hasSubject && fieldHasValue(normalized, "set", "subset", "insert");

  // Product-independent safety net. An exact printed code is already a
  // product-independent identity anchor; without one, a mis-identified product
  // can zero out every product-scoped lane. Whenever a subject is present with a
  // secondary anchor (serial denominator / year / named set) but no printed
  // code, add the subject-anchor lane (ignore_observed_product) so a trusted
  // candidate can still be retrieved to correct the product. Catalog lanes run
  // concurrently in INTERNAL_ONLY mode, so this adds recall without extending
  // the critical-path deadline.
  const subjectAnchorLane = (hasSubject && !hasPrintedCode
    && (hasSerialDenominator || hasYear || hasNamedSetSubject))
    ? [retrievalQueryFamilies.CATALOG_SUBJECT_ANCHOR]
    : [];

  // Post-provider catalog lookup is a deterministic resolver input, not a
  // prompt-expansion exercise. Keep at most two complementary product-scoped
  // catalog RPCs: one identity/set lane and one serial-variant lane. Running all
  // overlapping families made 5-7 calls compete with the fixed deadline, while
  // using only the denominator lane lost informative inserts such as Rain Drops.
  if (hasPrintedCode) return [...baseFamilies, retrievalQueryFamilies.CATALOG_EXACT_CODE];
  if (hasSubject && hasProduct && hasSerialDenominator) {
    return [
      ...baseFamilies,
      ...subjectAnchorLane,
      ...(hasInformativeSetSubject
        ? [retrievalQueryFamilies.CATALOG_SET_SUBJECT]
        : hasYear
          ? [retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT]
          : []),
      retrievalQueryFamilies.CATALOG_PRODUCT_SERIAL_DENOMINATOR
    ];
  }
  if (hasSubject && hasProduct && hasYear) {
    return [
      ...baseFamilies,
      ...subjectAnchorLane,
      retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT,
      ...(hasInformativeSetSubject || hasNamedSetSubject
        ? [retrievalQueryFamilies.CATALOG_SET_SUBJECT]
        : [])
    ];
  }
  if (hasSubject && fieldHasValue(normalized, "set", "subset", "insert")) {
    return [...baseFamilies, ...subjectAnchorLane, retrievalQueryFamilies.CATALOG_SET_SUBJECT];
  }
  if (subjectAnchorLane.length) {
    return [...baseFamilies, ...subjectAnchorLane];
  }
  if (hasProduct) return [...baseFamilies, retrievalQueryFamilies.CATALOG_PRODUCT_VOCABULARY];
  return baseFamilies;
}

function catalogRetrievalEnv(env = process.env, providerOptions = {}) {
  const providerMode = String(providerOptions.provider_mode || providerOptions.providerMode || providerOptions.eval_mode || providerOptions.evalMode || "").replace(/\s+/g, " ").trim();
  const evalTemporaryGtAllowed = Boolean(providerMode);
  const correctedTitleAsTemporaryGt = evalTemporaryGtAllowed
    && optionFlag(providerOptions, "corrected_title_as_temporary_gt", false);
  return {
    ...env,
    CATALOG_EVAL_CORRECTED_TITLE_AS_GT: correctedTitleAsTemporaryGt ? "true" : env.CATALOG_EVAL_CORRECTED_TITLE_AS_GT,
    CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT: correctedTitleAsTemporaryGt ? "true" : env.CATALOG_CORRECTED_TITLE_AS_TEMPORARY_GT
  };
}

function vectorRetrievalUnavailablePacket(status, reason) {
  const statusCode = status === "VECTOR_RETRIEVAL_TIMEOUT"
    ? "VECTOR_RETRIEVAL_TIMEOUT"
    : status === "VECTOR_RETRIEVAL_ERROR"
      ? "VECTOR_RETRIEVAL_ERROR"
      : "VECTOR_RETRIEVAL_UNAVAILABLE";
  return {
    vector_retrieval: {
      status: statusCode.replace(/^VECTOR_RETRIEVAL_/, "") || "UNAVAILABLE",
      status_code: statusCode,
      instruction: "These are hypotheses, not ground truth. Verify every field against the current card images.",
      candidates: [],
      unavailable: [{ provider_id: "visual_vector", reason }]
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function catalogCacheEnabled(env = process.env, providerOptions = {}) {
  return optionFlag(providerOptions, "enable_catalog_cache", envFlag(env, "ENABLE_CATALOG_LOOKUP_CACHE", true));
}

function catalogCacheTtlMs(env = process.env) {
  return Math.max(1_000, positiveIntegerFromEnv(env, "CATALOG_LOOKUP_CACHE_TTL_MS", defaultCatalogCacheTtlMs));
}

function catalogCacheMaxEntries(env = process.env) {
  return Math.max(10, positiveIntegerFromEnv(env, "CATALOG_LOOKUP_CACHE_MAX_ENTRIES", defaultCatalogCacheMaxEntries));
}

function catalogFastLaneBudgetMs(env = process.env, providerOptions = {}) {
  const optionValue = normalizePositiveIntegerOrNull(providerOptions.catalog_fast_lane_budget_ms ?? providerOptions.catalogFastLaneBudgetMs);
  return Math.max(0, optionValue ?? positiveIntegerFromEnv(env, "CATALOG_FAST_LANE_BUDGET_MS", defaultCatalogFastLaneBudgetMs));
}

function catalogCandidateContextCacheKey({
  resolvedForRetrieval = {},
  providerOptions = {},
  stagePhase = "catalog_lookup",
  env = process.env
} = {}) {
  const normalized = normalizeFields(resolvedForRetrieval || {});
  const serialDenominator = normalizeSerialText(normalized.serial_number || "").match(/\/\s*0*(\d{1,4})\b/)?.[1] || "";
  const playerValues = Array.isArray(normalized.players)
    ? normalized.players
    : [normalized.player, normalized.subject];
  const players = playerValues.map(normalizeStringOrNull).filter(Boolean);
  const keyPayload = {
    revision: env.CATALOG_LOOKUP_CACHE_REVISION || "v2",
    stage_phase: stagePhase,
    source_trust_policy_version: env.CATALOG_SOURCE_TRUST_POLICY_VERSION || "approved-reference-v1",
    fields: {
      year: normalized.year || "",
      manufacturer: normalized.manufacturer || normalized.brand || "",
      brand: normalized.brand || normalized.manufacturer || "",
      product: normalized.product || "",
      set: normalized.set || normalized.set_name || "",
      players,
      player: normalized.player || "",
      subject: normalized.subject || "",
      character: normalized.character || "",
      collector_number: normalized.collector_number || "",
      checklist_code: normalized.checklist_code || "",
      serial_denominator: normalized.expected_serial_denominator || serialDenominator
    },
    options: {
      corrected_title_as_temporary_gt: optionFlag(providerOptions, "corrected_title_as_temporary_gt", false),
      enable_catalog_assist: optionFlag(providerOptions, "enable_catalog_assist", false),
      cloud_eval_blind_to_corrected_title_hint: optionFlag(providerOptions, "cloud_eval_blind_to_corrected_title_hint", true),
      provider_mode: providerOptions.provider_mode || providerOptions.providerMode || providerOptions.eval_mode || providerOptions.evalMode || ""
    }
  };
  return crypto.createHash("sha256").update(stableJson(keyPayload)).digest("hex");
}

function pruneCatalogCandidateContextCache(maxEntries, now = Date.now()) {
  for (const [key, entry] of catalogCandidateContextCache.entries()) {
    if (!entry || entry.expires_at_ms <= now) catalogCandidateContextCache.delete(key);
  }
  while (catalogCandidateContextCache.size > maxEntries) {
    const oldestKey = catalogCandidateContextCache.keys().next().value;
    if (!oldestKey) break;
    catalogCandidateContextCache.delete(oldestKey);
  }
}

function promptCandidatesFromContext(context = {}) {
  return Array.isArray(context.assistPacket?.vector_retrieval?.candidates)
    ? context.assistPacket.vector_retrieval.candidates
    : [];
}

function supportFieldSet(candidate = {}) {
  return new Set([
    ...(Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : []),
    ...(Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [])
  ].map((field) => String(field || "").trim().toLowerCase()).filter(Boolean));
}

function compactCatalogAnchorValue(value) {
  if (Array.isArray(value)) {
    return value.map(compactCatalogAnchorValue).filter(valuePresent);
  }
  return String(value || "").replace(/\s+/g, " ").trim();
}

function serialDenominatorAnchorValue(fields = {}) {
  const explicit = [
    fields.expected_serial_denominator,
    fields.serial_denominator,
    fields.print_run_denominator,
    fields.numbered_to
  ].map(compactCatalogAnchorValue).find(valuePresent);
  if (explicit) return explicit.replace(/^\/+/, "");
  const serial = normalizeSerialText(fields.serial_number);
  const match = serial.match(/\/\s*0*(\d{1,4})\b/);
  return match ? match[1] : "";
}

function catalogAnchorTokens(value) {
  return new Set(String(normalizeStringOrNull(value) || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token && !["card", "cards", "base", "the", "topps", "panini", "chrome"].includes(token)));
}

function tokenSetsOverlap(left = new Set(), right = new Set()) {
  return [...left].some((token) => right.has(token));
}

function catalogSetAnchorAddsInformation(fields = {}) {
  const anchor = compactCatalogAnchorValue(fields.insert || fields.set || fields.subset);
  if (!anchor) return false;
  const anchorTokens = catalogAnchorTokens(anchor);
  if (!anchorTokens.size) return false;
  const productTokens = catalogAnchorTokens(fields.product);
  const addsProductInformation = [...anchorTokens].some((token) => !productTokens.has(token));
  if (!addsProductInformation) return false;
  if (valuePresent(fields.insert)
    && String(normalizeStringOrNull(anchor) || "").toLowerCase()
      === String(normalizeStringOrNull(fields.insert) || "").toLowerCase()) return true;
  const descriptorTokens = catalogAnchorTokens([
    fields.card_name,
    fields.official_card_type,
    fields.parallel_family,
    fields.parallel_exact
  ].filter(valuePresent).join(" "));
  return tokenSetsOverlap(anchorTokens, descriptorTokens);
}

function pushCatalogAnchor(anchors, {
  field,
  value,
  strength,
  lane,
  role,
  source = "current_card_observation"
} = {}) {
  const normalizedValue = compactCatalogAnchorValue(value);
  if (!valuePresent(normalizedValue)) return;
  anchors.push({
    field,
    value: normalizedValue,
    strength,
    lane,
    role,
    source
  });
}

function catalogAnchorPlanFromFields(fields = {}, {
  phase = "initial_payload",
  eligibility = null,
  retrieval = null
} = {}) {
  const normalized = normalizeFields(fields || {});
  const anchors = [];
  const primarySubject = normalized.players?.length ? normalized.players : normalized.player;
  pushCatalogAnchor(anchors, {
    field: "checklist_code",
    value: normalized.checklist_code,
    strength: "hard_exact",
    lane: "CATALOG_EXACT_CODE",
    role: "identity_candidate_recall"
  });
  pushCatalogAnchor(anchors, {
    field: "collector_number",
    value: normalized.collector_number || normalized.card_number,
    strength: "soft_exact_verification",
    lane: "CATALOG_EXACT_CODE",
    role: "identity_candidate_recall"
  });
  pushCatalogAnchor(anchors, {
    field: "subject",
    value: primarySubject,
    strength: "identity",
    lane: "CATALOG_YEAR_PRODUCT_SUBJECT",
    role: "identity_filter"
  });
  pushCatalogAnchor(anchors, {
    field: "year",
    value: normalized.year,
    strength: "identity",
    lane: "CATALOG_YEAR_PRODUCT_SUBJECT",
    role: "identity_filter"
  });
  pushCatalogAnchor(anchors, {
    field: "product",
    value: normalized.product || normalized.set,
    strength: "identity",
    lane: "CATALOG_YEAR_PRODUCT_SUBJECT",
    role: "identity_filter"
  });
  pushCatalogAnchor(anchors, {
    field: "serial_denominator",
    value: serialDenominatorAnchorValue(normalized),
    strength: "soft_exact_verification",
    lane: "CATALOG_PRODUCT_SERIAL_DENOMINATOR",
    role: "legality_check"
  });
  pushCatalogAnchor(anchors, {
    field: "surface_color",
    value: normalized.surface_color,
    strength: "soft_parallel_hint",
    lane: "CATALOG_PRODUCT_SERIAL_DENOMINATOR",
    role: "parallel_family_hint"
  });

  const retrievalLanes = [...new Set(anchors.map((anchor) => anchor.lane).filter(Boolean))];
  const retrievalMetrics = retrieval?.catalog_retrieval_metrics || retrieval?.metrics || null;
  return {
    version: "catalog_anchor_plan_v1",
    phase,
    anchors,
    retrieval_lanes: retrievalLanes,
    candidate_policy: {
      prompt_rule: "Only APPROVED_REFERENCE candidates with an identity anchor enter GPT assist.",
      hard_identity_fields: ["subject", "year", "product", "checklist_code"],
      soft_verification_fields: ["collector_number", "serial_denominator", "surface_color"],
      forbidden_reference_copy_fields: [...exactAnchorForbiddenCopyFields]
    },
    eligibility_snapshot: eligibility ? {
      raw_candidate_count: eligibility.raw_candidate_count ?? 0,
      approved_candidate_count: eligibility.approved_candidate_count ?? 0,
      conflict_blocked_count: eligibility.conflict_blocked_count ?? 0,
      prompt_candidate_count: eligibility.prompt_candidate_count ?? 0,
      prompt_candidate_ids: Array.isArray(eligibility.prompt_candidate_ids) ? eligibility.prompt_candidate_ids : [],
      reason: eligibility.reason || ""
    } : null,
    retrieval_snapshot: retrievalMetrics ? {
      catalog_raw_candidate_count: retrievalMetrics.catalog_raw_candidate_count ?? retrievalMetrics.raw_candidate_count ?? null,
      catalog_source_count: retrievalMetrics.catalog_source_count ?? retrievalMetrics.source_count ?? null
    } : null
  };
}

function fieldHasValue(fields = {}, ...keys) {
  return keys.some((key) => valuePresent(fields?.[key]));
}

function catalogCandidateHasStrongAnchor(candidate = {}, queryFields = {}) {
  const fields = candidate.fields && typeof candidate.fields === "object" ? candidate.fields : {};
  const support = supportFieldSet(candidate);
  const conflicts = Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : [];
  if (String(candidate.source_trust || "").toUpperCase() !== "APPROVED_REFERENCE") return false;
  if (conflicts.length) return false;

  const hasExactCode = support.has("collector_number")
    || support.has("card_number")
    || support.has("checklist_code")
    || fieldHasValue(fields, "collector_number", "checklist_code");
  const hasSerialDenominator = support.has("serial_denominator")
    || support.has("serial_number")
    || fieldHasValue(fields, "expected_serial_denominator");
  const hasSubject = support.has("subjects")
    || support.has("players")
    || support.has("subject")
    || fieldHasValue(fields, "subjects", "players", "player", "subject");
  const hasProductOrYear = support.has("product")
    || support.has("product_partial")
    || support.has("set")
    || support.has("year")
    || fieldHasValue(fields, "product", "set", "year")
    || fieldHasValue(queryFields, "product", "set", "year");

  return (hasExactCode && (hasSubject || hasProductOrYear))
    || (hasSerialDenominator && hasSubject && hasProductOrYear);
}

function catalogStrongCandidateForVectorLazy(context = {}, queryFields = {}) {
  if (context.promptPacket !== true) return null;
  const eligibility = context.catalog_assist_eligibility || {};
  if (Number(eligibility.prompt_candidate_count || 0) !== 1) return null;
  const candidates = promptCandidatesFromContext(context);
  const candidate = candidates[0] || null;
  return candidate && catalogCandidateHasStrongAnchor(candidate, queryFields) ? candidate : null;
}

const exactAnchorForbiddenCopyFields = Object.freeze([
  "serial_number",
  "serial_numerator",
  "grade",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "cert_number",
  "certification_number"
]);

function expectedExactAnchorSavedMs(env = process.env, providerOptions = {}) {
  const raw = providerOptions.exact_anchor_expected_saved_ms ?? env.EXACT_ANCHOR_FAST_LANE_EXPECTED_SAVED_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function buildExactAnchorFastLaneShadow({
  catalogContext = {},
  resolvedForRetrieval = {},
  providerOptions = {},
  env = process.env,
  lazyDecision = null
} = {}) {
  const candidate = catalogStrongCandidateForVectorLazy(catalogContext, resolvedForRetrieval);
  const skipDecision = lazyDecision || shouldSkipVectorForCatalogContext({
    catalogContext,
    resolvedForRetrieval,
    providerOptions,
    env
  });
  if (!candidate) {
    return {
      exact_anchor_fast_lane_eligible: false,
      exact_anchor_candidate_id: "",
      exact_anchor_candidate_identity_id: "",
      exact_anchor_reason: skipDecision?.reason || "no_strong_catalog_anchor",
      would_skip_vector: false,
      would_use_title_scaffold: false,
      forbidden_to_copy_fields: [...exactAnchorForbiddenCopyFields],
      expected_saved_ms: null
    };
  }

  return {
    exact_anchor_fast_lane_eligible: true,
    exact_anchor_candidate_id: candidate.candidate_id || candidate.candidate_identity_id || "",
    exact_anchor_candidate_identity_id: candidate.candidate_identity_id || "",
    exact_anchor_reason: "approved_reference_strong_catalog_anchor",
    would_skip_vector: skipDecision?.skip === true,
    would_use_title_scaffold: true,
    forbidden_to_copy_fields: [...exactAnchorForbiddenCopyFields],
    expected_saved_ms: expectedExactAnchorSavedMs(env, providerOptions)
  };
}

function shouldSkipVectorForCatalogContext({
  catalogContext = {},
  resolvedForRetrieval = {},
  providerOptions = {},
  env = process.env
} = {}) {
  if (optionFlag(providerOptions, "enable_vector_lazy_mode", envFlag(env, "ENABLE_VECTOR_LAZY_MODE", true)) !== true) {
    return { skip: false, reason: "vector_lazy_disabled" };
  }
  if (optionFlag(providerOptions, "enable_vector_assist", false) !== true) {
    return { skip: false, reason: "vector_assist_disabled" };
  }
  if (optionFlag(providerOptions, "force_vector_assist", false) === true) {
    return { skip: false, reason: "force_vector_assist" };
  }
  const candidate = catalogStrongCandidateForVectorLazy(catalogContext, resolvedForRetrieval);
  if (!candidate) return { skip: false, reason: "no_strong_catalog_anchor" };
  return {
    skip: true,
    reason: "strong_catalog_anchor",
    candidate_id: candidate.candidate_id || candidate.candidate_identity_id || "",
    candidate_identity_id: candidate.candidate_identity_id || ""
  };
}

function skippedVectorCandidateContext({
  reason = "vector_lazy_catalog_anchor",
  visualFeatures = {},
  worker = null,
  env = process.env,
  providerOptions = {},
  skip = {}
} = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  const packet = emptyVectorCandidatePacket(reason);
  return {
    mode: config.mode,
    visualFeatures,
    packet,
    assistPacket: packet,
    retrieval: null,
    worker,
    telemetry: null,
    vector_assist_eligibility: vectorCandidatePacketAssistEligibility(packet),
    promptPacket: false,
    skipped: true,
    skip_reason: reason,
    vector_lazy_skip: {
      skipped: true,
      reason,
      catalog_candidate_id: skip.candidate_id || "",
      catalog_candidate_identity_id: skip.candidate_identity_id || ""
    }
  };
}

function deferredRetrievalCandidateContext({
  kind = "vector",
  reason = "post_observation_retrieval_deadline",
  visualFeatures = {},
  worker = null,
  env = process.env,
  providerOptions = {}
} = {}) {
  const providerId = kind === "catalog" ? "postgres_hybrid" : "visual_vector";
  const packet = deferredRetrievalCandidatePacket(reason, providerId);
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  if (kind === "catalog") {
    return {
      retrieval: null,
      packet,
      assistPacket: packet,
      catalog_assist_eligibility: eligibility,
      promptPacket: false,
      retrieval_phase: "provider_observation_catalog_deferred",
      deferred: true,
      deferred_reason: reason
    };
  }
  return {
    mode: vectorRetrievalConfig(env, providerOptions).mode,
    visualFeatures,
    packet,
    assistPacket: packet,
    retrieval: null,
    worker,
    telemetry: null,
    vector_assist_eligibility: eligibility,
    promptPacket: false,
    retrieval_phase: "provider_observation_vector_deferred",
    deferred: true,
    deferred_reason: reason
  };
}

function rebindVectorCandidateContextToFields(context = null, queryFields = {}, {
  env = process.env,
  providerOptions = {}
} = {}) {
  if (!context || typeof context !== "object" || !context.retrieval) return context;
  const config = vectorRetrievalConfig(env, providerOptions);
  const packet = buildVectorCandidatePacket(context.retrieval, {
    limit: config.gptCandidateLimit,
    queryFields: queryFields || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  return {
    ...context,
    packet,
    assistPacket,
    vector_assist_eligibility: assistEligibility,
    promptPacket: config.mode === vectorRetrievalModes.ASSIST
      && vectorCandidatePacketHasPromptContent(assistPacket),
    retrieval_phase: "provider_observation_vector_lookup",
    rebound_to_provider_observation: true
  };
}

function rebindCatalogCandidateContextToFields(context = null, queryFields = {}) {
  if (!context || typeof context !== "object" || !context.retrieval) return context;
  const packet = buildVectorCandidatePacket(context.retrieval, {
    limit: 5,
    queryFields: queryFields || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  return {
    ...context,
    packet,
    assistPacket,
    catalog_assist_eligibility: assistEligibility,
    catalog_anchor_plan: catalogAnchorPlanFromFields(queryFields || {}, {
      phase: "provider_observation_catalog_rebind",
      eligibility: assistEligibility,
      retrieval: context.retrieval
    }),
    exact_anchor_fast_lane_shadow: null,
    promptPacket: vectorCandidatePacketHasPromptContent(assistPacket),
    retrieval_phase: "provider_observation_catalog_rebind",
    rebound_to_provider_observation: true
  };
}

function scheduleBackgroundCompletion(promise) {
  const guarded = Promise.resolve(promise).catch(() => null);
  try {
    waitUntil(guarded);
  } catch {
    // Non-Vercel test/runtime environments may not expose a request context.
  }
  return guarded;
}

function providerDoneCapacityHandoffEnabled(payload = {}, env = process.env) {
  const providerOptions = providerOptionsFromPayload(payload, env);
  return optionFlag(
    providerOptions,
    "v4_provider_done_capacity_handoff",
    v4ProviderDoneCapacityHandoffEnabled(env)
  );
}

function canOverlapProviderCapacityHandoffAfterInitialCall({ assistShadowOnly = false } = {}) {
  // The assist-shadow branch is provider-terminal by construction: it may run
  // retrieval, OCR fusion, resolution and rendering after the initial vision
  // response, but it never performs another provider call. That makes it safe
  // to return the scarce provider lease while this card finishes CPU/DB work.
  return assistShadowOnly === true;
}

async function handoffProviderCapacityAfterStage(payload = {}, req = null, timingContext = null) {
  if (!providerDoneCapacityHandoffEnabled(payload, process.env)) {
    return { enabled: false, released: false, refill: { triggered: false, reason: "provider_done_handoff_disabled" } };
  }
  const jobId = payload.v4_queue_job_id || payload.job_id || null;
  if (!jobId) {
    return { enabled: true, released: false, refill: { triggered: false, reason: "not_queue_job" } };
  }
  const startedAt = nowMs();
  const release = await releaseV4ProviderCapacityForJob({
    jobId,
    workerId: payload.v4_queue_worker_id || null,
    env: process.env,
    fetchImpl: globalThis.fetch
  });
  const refill = triggerReleasedProviderCapacityRefill(req, {
    payload,
    capacityRelease: release,
    releaseBoundary: "provider_done"
  });
  const latencyMs = nowMs() - startedAt;
  addTiming(timingContext, "provider_capacity_handoff_ms", latencyMs);
  recordNodeSpan(timingContext, {
    key: "provider_capacity_handoff_ms",
    startedAtMs: startedAt,
    durationMs: latencyMs,
    status: release.released === true ? "COMPLETED" : "PARTIAL",
    inputCount: 1,
    outputCount: release.released === true ? 1 : 0,
    metrics: {
      release_boundary: "provider_done",
      refill_triggered: refill.triggered === true,
      release_error: release.error || null
    }
  });
  return {
    enabled: true,
    release_boundary: "provider_done",
    released: release.released === true,
    released_count: Number(release.released_count || 0),
    error: release.error || null,
    latency_ms: latencyMs,
    refill
  };
}

function preingestionOcrPostProviderWaitMs(env = process.env, providerOptions = {}) {
  const configured = providerOptions.preingestion_ocr_post_provider_wait_ms
    ?? providerOptions.preingestionOcrPostProviderWaitMs
    ?? env.PREINGESTION_OCR_POST_PROVIDER_WAIT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultPreingestionOcrPostProviderWaitMs;
  return Math.min(10_000, Math.trunc(parsed));
}

function preingestionOcrGradeRescueWaitMs(env = process.env, providerOptions = {}) {
  const configured = providerOptions.preingestion_ocr_grade_rescue_wait_ms
    ?? providerOptions.preingestionOcrGradeRescueWaitMs
    ?? env.PREINGESTION_OCR_GRADE_RESCUE_WAIT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultPreingestionOcrGradeRescueWaitMs;
  return Math.min(20_000, Math.trunc(parsed));
}

function preingestionOcrCriticalFieldWaitMs(env = process.env, providerOptions = {}) {
  const configured = providerOptions.preingestion_ocr_critical_field_wait_ms
    ?? providerOptions.preingestionOcrCriticalFieldWaitMs
    ?? env.PREINGESTION_OCR_CRITICAL_FIELD_WAIT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultPreingestionOcrCriticalFieldWaitMs;
  return Math.min(10_000, Math.trunc(parsed));
}

function preingestionOcrSerialWaitMs(env = process.env, providerOptions = {}) {
  const configured = providerOptions.preingestion_ocr_serial_wait_ms
    ?? providerOptions.preingestionOcrSerialWaitMs
    ?? env.PREINGESTION_OCR_SERIAL_WAIT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultPreingestionOcrSerialWaitMs;
  return Math.min(15_000, Math.trunc(parsed));
}

function deferredPreingestionOcrSnapshot(payload = {}, latestState = null) {
  const state = latestState && typeof latestState === "object" ? latestState : {};
  const patches = Array.isArray(state.evidence_patches)
    ? state.evidence_patches
    : Array.isArray(payload.preingestion_evidence_patches)
      ? payload.preingestion_evidence_patches
      : [];
  const executionSummary = state.execution_summary
    || payload.preingestion_summary?.ocr_stage_execution
    || payload.preingestion_bundle?.quality_summary?.ocr_stage_execution
    || null;
  const serialFields = new Set([
    "print_run_number",
    "print_run_denominator",
    "serial_number",
    "serial_denominator",
    "numerical_rarity"
  ]);
  const serialPatchCount = patches.filter((patch) => serialFields.has(String(patch?.field || "").trim())).length;
  if (state.terminal === true) {
    return {
      ...state,
      status: state.status_counts?.failed ? "TERMINAL_WITH_FAILURES" : "TERMINAL",
      evidence_patches: patches,
      patch_count: state.patch_count ?? patches.length,
      serial_patch_count: state.serial_patch_count ?? serialPatchCount,
      ...(executionSummary ? { execution_summary: executionSummary } : {})
    };
  }
  return {
    ...state,
    status: "DEFERRED_AFTER_PROVIDER",
    terminal: false,
    job_count: state.job_count ?? executionSummary?.claimed ?? null,
    patch_count: state.patch_count ?? patches.length,
    serial_patch_count: state.serial_patch_count ?? serialPatchCount,
    evidence_patches: patches,
    ...(executionSummary ? { execution_summary: executionSummary } : {}),
    reason: "ocr_continues_in_background_after_writer_budget"
  };
}

function waitForPromiseWithin(promise, timeoutMs) {
  if (timeoutMs <= 0) {
    return Promise.race([
      Promise.resolve(promise).then((value) => ({ settled: true, value })),
      Promise.resolve().then(() => ({ settled: false, value: null }))
    ]);
  }
  let timeout;
  return Promise.race([
    promise.then(
      (value) => ({ settled: true, value }),
      (error) => {
        throw error;
      }
    ),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ settled: false, value: null }), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function collectPromiseEntriesWithinBudget(entries = [], timeoutMs = 0) {
  const states = entries.map((entry) => {
    const state = {
      key: String(entry?.key || ""),
      settled: false,
      value: null,
      error: null,
      promise: null
    };
    state.promise = Promise.resolve(entry?.promise).then(
      (value) => {
        state.settled = true;
        state.value = value;
        return value;
      },
      (error) => {
        state.settled = true;
        state.error = error;
        return null;
      }
    );
    return state;
  });
  if (states.length && timeoutMs > 0) {
    await waitForPromiseWithin(Promise.all(states.map((state) => state.promise)), timeoutMs);
  }
  return {
    settled: Object.fromEntries(states.filter((state) => state.settled).map((state) => [state.key, state.value])),
    settled_keys: states.filter((state) => state.settled).map((state) => state.key),
    pending_keys: states.filter((state) => !state.settled).map((state) => state.key),
    pending_promises: states.filter((state) => !state.settled).map((state) => state.promise),
    error_keys: states.filter((state) => state.error).map((state) => state.key)
  };
}

async function prepareCatalogCandidateContext({
  resolvedForRetrieval = {},
  providerOptions = {},
  excludeSourceFeedbackIds = [],
  timingContext = null,
  stageRequestId = "",
  stagePhase = "catalog_lookup",
  env = process.env
} = {}) {
  if (optionFlag(providerOptions, "enable_catalog_assist", false) !== true) {
    const packet = emptyVectorCandidatePacket("catalog_assist_disabled");
    return {
      retrieval: null,
      packet,
      assistPacket: packet,
      catalog_assist_eligibility: vectorCandidatePacketAssistEligibility(packet),
      promptPacket: false
    };
  }

  const cacheEnabled = catalogCacheEnabled(env, providerOptions);
  const cacheKey = cacheEnabled
    ? catalogCandidateContextCacheKey({ resolvedForRetrieval, providerOptions, stagePhase, env })
    : "";
  const cacheStartedAt = Date.now();
  if (cacheEnabled && cacheKey) {
    const cached = catalogCandidateContextCache.get(cacheKey);
    if (cached && cached.expires_at_ms > cacheStartedAt) {
      addTiming(timingContext, "catalog_cache_ms", Date.now() - cacheStartedAt);
      return {
        ...cached.context,
        catalog_cache_hit: true,
        catalog_stage_capacity: {
          acquired: false,
          coordinated: false,
          cache_hit: true,
          wait_ms: 0,
          attempts: 0,
          released: null
        }
      };
    }
  }

  const allowedFamilies = catalogRetrievalFamiliesForFields(resolvedForRetrieval, { stagePhase });
  const stagePlan = listingStageCapacityPlan(env).catalog;
  const stageJobId = `${stageRequestId || crypto.randomUUID()}:${stagePhase}`;
  const stageExecution = await runWithListingStageCapacity({
    plan: stagePlan,
    jobId: stageJobId,
    owner: `catalog-query-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    env,
    fetchImpl: globalThis.fetch,
    task: () => timeAsync(timingContext, "catalog_retrieval_ms", () => runRetrieval({
      resolved: resolvedForRetrieval || {},
      visualEmbeddings: [],
      mode: retrievalModes.INTERNAL_ONLY,
      allowedFamilies,
      maxQueries: allowedFamilies.length,
      excludeSourceFeedbackIds,
      env: catalogRetrievalEnv(env, providerOptions)
    }))
  });
  const stageCapacity = stageExecution.stage_capacity || null;
  addTiming(timingContext, "catalog_stage_capacity_wait_ms", Number(stageCapacity?.wait_ms || 0));
  if (stageCapacity?.coordinated) addTiming(timingContext, "catalog_stage_capacity_controlled_count", 1);
  if (!stageExecution.executed) {
    addTiming(timingContext, "catalog_stage_capacity_deferred_count", 1);
    const reason = stageCapacity?.configured === false
      ? "catalog_stage_capacity_unavailable"
      : "catalog_stage_capacity_busy";
    const packet = emptyVectorCandidatePacket(reason);
    return {
      retrieval: null,
      packet,
      assistPacket: packet,
      catalog_assist_eligibility: vectorCandidatePacketAssistEligibility(packet),
      catalog_anchor_plan: catalogAnchorPlanFromFields(resolvedForRetrieval || {}, {
        phase: stagePhase,
        eligibility: vectorCandidatePacketAssistEligibility(packet),
        retrieval: null
      }),
      promptPacket: false,
      catalog_cache_hit: false,
      catalog_stage_capacity: stageCapacity
    };
  }
  if (stageCapacity?.coordinated && stageCapacity.released !== true) {
    addTiming(timingContext, "catalog_stage_capacity_release_missing_count", 1);
  }
  const retrieval = stageExecution.value;
  const postObservationDecisionLimit = Math.max(5, Math.min(
    30,
    positiveIntegerFromEnv(env, "POST_OBSERVATION_CATALOG_DECISION_LIMIT", 30)
  ));
  const packet = buildVectorCandidatePacket(retrieval, {
    limit: stagePhase === "post_provider" ? postObservationDecisionLimit : 5,
    queryFields: resolvedForRetrieval || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  const catalogAnchorPlan = catalogAnchorPlanFromFields(resolvedForRetrieval || {}, {
    phase: stagePhase,
    eligibility: assistEligibility,
    retrieval
  });
  const context = {
    retrieval,
    packet,
    assistPacket,
    catalog_assist_eligibility: assistEligibility,
    catalog_anchor_plan: catalogAnchorPlan,
    promptPacket: vectorCandidatePacketHasPromptContent(assistPacket),
    catalog_cache_hit: false,
    catalog_stage_capacity: stageCapacity
  };
  if (cacheEnabled && cacheKey) {
    const { catalog_stage_capacity: _capacity, ...cacheableContext } = context;
    catalogCandidateContextCache.set(cacheKey, {
      expires_at_ms: Date.now() + catalogCacheTtlMs(env),
      context: cacheableContext
    });
    pruneCatalogCandidateContextCache(catalogCacheMaxEntries(env));
  }
  return context;
}

function vectorTelemetryContext(payload = {}) {
  return {
    analysisRunId: payload.analysisRunId || payload.analysis_run_id || null,
    assetId: payload.assetId || payload.asset_id || null,
    sourceFeedbackId: payload.sourceFeedbackId || payload.source_feedback_id || null,
    physicalCardId: payload.physicalCardId || payload.physical_card_id || null,
    physicalInstanceGroupId: payload.physicalInstanceGroupId || payload.physical_instance_group_id || null
  };
}

function vectorSelfExclusionDiagnostics(payload = {}, { queryAttempted = false } = {}) {
  const sourceFeedbackIds = [...new Set([
    payload.sourceFeedbackId,
    payload.source_feedback_id
  ].map(normalizeStringOrNull).filter(Boolean))].sort();
  return {
    self_exclusion_query_attempted: queryAttempted === true,
    self_exclusion_filter_active: sourceFeedbackIds.length > 0,
    self_exclusion_requested_source_count: sourceFeedbackIds.length,
    self_exclusion_source_ids_sha256: sourceFeedbackIds.length
      ? crypto.createHash("sha256").update(sourceFeedbackIds.join("\0")).digest("hex")
      : null
  };
}

async function prepareVectorCandidateContext({
  initialPayload,
  signedImages,
  visualFeatures = {},
  precomputedWorkerResult = null,
  resolvedForRetrieval = {},
  providerOptions = {},
  timingContext = null,
  onWorkerResult = null,
  env = process.env
} = {}) {
  const config = vectorRetrievalConfig(env, providerOptions);
  const selfExclusion = vectorSelfExclusionDiagnostics(initialPayload);
  if (!config.enabled) {
    return {
      mode: vectorRetrievalModes.OFF,
      visualFeatures,
      packet: emptyVectorCandidatePacket("vector_retrieval_disabled"),
      assistPacket: emptyVectorCandidatePacket("vector_retrieval_disabled"),
      retrieval: null,
      promptPacket: false,
      ...selfExclusion
    };
  }

  // Until the vector index is seeded past readiness, skip the blocking
  // online embed entirely (eBay C10: 138 stored embeddings returned noise
  // while costing 4.8s p50 / 83s p95 on the critical path). Catalog lanes
  // are unaffected; flip VECTOR_INDEX_READY=true after seeding.
  if (!vectorIndexReady(env, providerOptions)) {
    return {
      ...skippedVectorCandidateContext({
        reason: "vector_index_below_ready_threshold",
        visualFeatures,
        env,
        providerOptions
      }),
      ...selfExclusion
    };
  }

  let activeVisualFeatures = visualFeatures;
  let workerResult = precomputedWorkerResult;
  if (!hasUsableVisualFeatures(activeVisualFeatures) && hasUsableVisualFeatures(workerResult)) {
    activeVisualFeatures = workerResult;
  }
  if (!hasUsableVisualFeatures(activeVisualFeatures)) {
    if (!workerResult) {
      workerResult = await timeAsync(timingContext, "vector_embedding_ms", () => embedImagesWithVectorWorker({
        images: signedImages || initialPayload.images || [],
        requestId: `${initialPayload.assetId || initialPayload.asset_id || "asset"}_vector_query`,
        env,
        options: providerOptions
      }));
      if (hasUsableVisualFeatures(workerResult)) {
        activeVisualFeatures = workerResult;
      }
    }
  }
  const vectorStageCapacity = workerResult?.stage_capacity || null;
  if (typeof onWorkerResult === "function" && workerResult) {
    try {
      onWorkerResult(workerResult);
    } catch {
      // Observation hooks must never change retrieval behavior.
    }
  }
  addTiming(timingContext, "vector_stage_capacity_wait_ms", Number(vectorStageCapacity?.wait_ms || 0));
  if (vectorStageCapacity?.coordinated) addTiming(timingContext, "vector_stage_capacity_controlled_count", 1);
  if (vectorStageCapacity?.coordinated && vectorStageCapacity.acquired !== true) {
    addTiming(timingContext, "vector_stage_capacity_deferred_count", 1);
  }
  if (vectorStageCapacity?.coordinated
    && vectorStageCapacity.acquired === true
    && vectorStageCapacity.released !== true) {
    addTiming(timingContext, "vector_stage_capacity_release_missing_count", 1);
  }

  if (!hasUsableVisualFeatures(activeVisualFeatures)) {
    const status = workerResult?.status || "VECTOR_RETRIEVAL_UNAVAILABLE";
    const packet = vectorRetrievalUnavailablePacket(status, workerResult?.reason || "visual_embedding_missing");
    const telemetry = await recordVectorRetrievalTelemetry({
      visualFeatures: activeVisualFeatures || {},
      packet,
      mode: config.mode,
      retrievalConfig: config,
      context: vectorTelemetryContext(initialPayload),
      env
    });
    return {
      mode: config.mode,
      visualFeatures: activeVisualFeatures,
      packet,
      assistPacket: emptyVectorCandidatePacket(workerResult?.reason || "visual_embedding_missing"),
      retrieval: null,
      worker: workerResult,
      telemetry,
      promptPacket: false,
      ...selfExclusion
    };
  }

  const retrievalStartedAt = Date.now();
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions)
    || (config.hybridRetrievalEnabled
      ? [
        retrievalQueryFamilies.INTERNAL_APPROVED_HISTORY,
        retrievalQueryFamilies.INTERNAL_REGISTRY,
        retrievalQueryFamilies.VISUAL_VECTOR,
        retrievalQueryFamilies.POSTGRES_HYBRID
      ]
      : [retrievalQueryFamilies.VISUAL_VECTOR]);
  const retrieval = await timeAsync(timingContext, "vector_retrieval_ms", () => runRetrieval({
    resolved: resolvedForRetrieval || {},
    visualEmbeddings: activeVisualFeatures,
    mode: retrievalModes.INTERNAL_ONLY,
    allowedFamilies,
    maxQueries: config.hybridRetrievalEnabled ? Math.max(4, allowedFamilies.length + 2) : 2,
    env: vectorRetrievalEnv(env, config),
    excludeSourceFeedbackIds: [
      initialPayload.source_feedback_id,
      initialPayload.sourceFeedbackId
    ].filter(Boolean)
  }));
  const packet = buildVectorCandidatePacket(retrieval, {
    limit: config.gptCandidateLimit,
    queryFields: resolvedForRetrieval || {}
  });
  const assistEligibility = vectorCandidatePacketAssistEligibility(packet);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  const telemetry = await recordVectorRetrievalTelemetry({
    visualFeatures: activeVisualFeatures,
    packet,
    mode: config.mode,
    retrievalConfig: config,
    context: vectorTelemetryContext(initialPayload),
    retrievalLatencyMs: Date.now() - retrievalStartedAt,
    env
  });
  return {
    mode: config.mode,
    visualFeatures: activeVisualFeatures,
    packet,
    assistPacket,
    retrieval,
    worker: workerResult,
    telemetry,
    vector_assist_eligibility: assistEligibility,
    promptPacket: config.mode === vectorRetrievalModes.ASSIST && vectorCandidatePacketHasPromptContent(assistPacket),
    ...vectorSelfExclusionDiagnostics(initialPayload, { queryAttempted: true })
  };
}

function withVectorCandidateContext(result = {}, context = {}) {
  if (!context || !context.packet) return result;
  return {
    ...result,
    vector_retrieval_mode: context.mode || null,
    vector_retrieval: context.retrieval || null,
    vector_candidate_packet: context.packet,
    vector_assist_packet: context.assistPacket || null,
    vector_prompt_assist_used: context.promptPacket === true,
    vector_assist_eligibility: context.vector_assist_eligibility || null,
    vector_lazy_skip: context.vector_lazy_skip || null,
    vector_telemetry: context.telemetry || null,
    vector_worker: context.worker
      ? {
        status: context.worker.status || null,
        reason: context.worker.reason || "",
        latency_ms: context.worker.latency_ms ?? null,
        attempt_count: context.worker.attempt_count ?? null,
        feature_count: Array.isArray(context.worker.features) ? context.worker.features.length : 0,
        stage_capacity: context.worker.stage_capacity || null
      }
      : null
  };
}

function withCatalogCandidateContext(result = {}, context = {}) {
  if (!context || !context.packet) return result;
  const exactAnchorFastLane = context.exact_anchor_fast_lane_shadow || null;
  return {
    ...result,
    catalog_retrieval: context.retrieval || null,
    catalog_candidate_packet: context.packet,
    catalog_assist_packet: context.assistPacket || null,
    catalog_prompt_assist_used: context.promptPacket === true,
    catalog_assist_eligibility: context.catalog_assist_eligibility || null,
    catalog_anchor_plan: context.catalog_anchor_plan || null,
    catalog_cache_hit: context.catalog_cache_hit === true,
    catalog_stage_capacity: context.catalog_stage_capacity || null,
    exact_anchor_fast_lane_shadow: exactAnchorFastLane,
    exact_anchor_fast_lane_eligible: exactAnchorFastLane?.exact_anchor_fast_lane_eligible === true,
    exact_anchor_candidate_id: exactAnchorFastLane?.exact_anchor_candidate_id || "",
    exact_anchor_reason: exactAnchorFastLane?.exact_anchor_reason || null,
    would_skip_vector: exactAnchorFastLane?.would_skip_vector === true,
    would_use_title_scaffold: exactAnchorFastLane?.would_use_title_scaffold === true,
    forbidden_to_copy_fields: Array.isArray(exactAnchorFastLane?.forbidden_to_copy_fields)
      ? exactAnchorFastLane.forbidden_to_copy_fields
      : [],
    expected_saved_ms: exactAnchorFastLane?.expected_saved_ms ?? null
  };
}

function numericEligibilityValue(eligibility = {}, key = "") {
  const value = Number(eligibility?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function promptCandidateIdsFromEligibility(...eligibilities) {
  return [...new Set(eligibilities.flatMap((eligibility) => (
    Array.isArray(eligibility?.prompt_candidate_ids)
      ? eligibility.prompt_candidate_ids
      : []
  )).map((id) => String(id || "").trim()).filter(Boolean))];
}

function packetOpenSetSignal(packet = {}) {
  const retrieval = packet?.vector_retrieval || {};
  return {
    status: retrieval.status || null,
    status_code: retrieval.status_code || null,
    decision: retrieval.open_set_decision || null,
    reason: retrieval.open_set_reason || null
  };
}

function buildOpenSetReadiness(result = {}, {
  catalogContext = {},
  vectorContext = {},
  providerOptions = {}
} = {}) {
  const catalogEligibility = result.catalog_assist_eligibility
    || catalogContext.catalog_assist_eligibility
    || catalogContext.assistPacket?.vector_retrieval?.assist_filter
    || {};
  const vectorEligibility = result.vector_assist_eligibility
    || vectorContext.vector_assist_eligibility
    || vectorContext.assistPacket?.vector_retrieval?.assist_filter
    || {};
  const catalogSignal = packetOpenSetSignal(result.catalog_candidate_packet || catalogContext.packet);
  const vectorSignal = packetOpenSetSignal(result.vector_candidate_packet || vectorContext.packet);
  const catalogPromptCount = numericEligibilityValue(catalogEligibility, "prompt_candidate_count");
  const vectorPromptCount = numericEligibilityValue(vectorEligibility, "prompt_candidate_count");
  const promptCandidateCount = catalogPromptCount + vectorPromptCount;
  const catalogFieldSupportCount = numericEligibilityValue(catalogEligibility, "field_support_count");
  const vectorFieldSupportCount = numericEligibilityValue(vectorEligibility, "field_support_count");
  const fieldSupportCount = catalogFieldSupportCount + vectorFieldSupportCount;
  const rawCandidateCount = numericEligibilityValue(catalogEligibility, "raw_candidate_count")
    + numericEligibilityValue(vectorEligibility, "raw_candidate_count");
  const approvedCandidateCount = numericEligibilityValue(catalogEligibility, "approved_candidate_count")
    + numericEligibilityValue(vectorEligibility, "approved_candidate_count");
  const conflictBlockedCount = numericEligibilityValue(catalogEligibility, "conflict_blocked_count")
    + numericEligibilityValue(vectorEligibility, "conflict_blocked_count");
  const assistEnabled = optionFlag(providerOptions, "enable_catalog_assist", false) === true
    || optionFlag(providerOptions, "enable_vector_assist", false) === true;
  const reasons = [...new Set([
    catalogEligibility.reason,
    vectorEligibility.reason,
    catalogSignal.reason,
    vectorSignal.reason
  ].map((reason) => String(reason || "").trim()).filter(Boolean))];
  const unavailable = [catalogSignal, vectorSignal].some((signal) => /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${signal.status || ""} ${signal.status_code || ""}`));
  const openSetDecision = vectorSignal.decision || catalogSignal.decision || null;
  const openSetReason = vectorSignal.reason || catalogSignal.reason || null;

  let status = "ASSIST_DISABLED";
  let releasePolicy = "single_model_writer_review";
  if (assistEnabled && promptCandidateCount > 0) {
    status = "KNOWN_CATALOG_ASSISTED";
    releasePolicy = "writer_quick_review_with_catalog_assist";
  } else if (assistEnabled && fieldSupportCount > 0) {
    status = "CATALOG_FIELD_SUPPORT_ASSISTED";
    releasePolicy = "writer_review_with_catalog_field_support";
  } else if (assistEnabled && conflictBlockedCount > 0 && approvedCandidateCount > 0) {
    status = "APPROVED_CANDIDATE_CONFLICT_REVIEW";
    releasePolicy = "writer_review_catalog_conflict";
  } else if (assistEnabled && /LOW_MARGIN/i.test(`${openSetDecision} ${reasons.join(" ")}`)) {
    status = "LOW_MARGIN_SIMILAR_ONLY";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled && /NONE_OF_THE_ABOVE|NO_EXACT_MATCH|FAMILY_ONLY_MATCH/i.test(`${openSetDecision} ${reasons.join(" ")}`)) {
    status = "OPEN_SET_NO_EXACT_MATCH";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled && unavailable && rawCandidateCount === 0) {
    status = "RETRIEVAL_UNAVAILABLE";
    releasePolicy = "provider_draft_without_catalog";
  } else if (assistEnabled && rawCandidateCount > 0 && approvedCandidateCount === 0) {
    status = "REFERENCE_CANDIDATES_ONLY";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  } else if (assistEnabled) {
    status = "EVIDENCE_BACKED_NO_CATALOG";
    releasePolicy = "evidence_backed_writer_review_catalog_gap";
  }

  return {
    status,
    release_policy: releasePolicy,
    assist_enabled: assistEnabled,
    known_catalog_candidate_available: promptCandidateCount > 0,
    prompt_safe_candidate_count: promptCandidateCount,
    prompt_field_support_count: fieldSupportCount,
    catalog_field_support_count: catalogFieldSupportCount,
    vector_field_support_count: vectorFieldSupportCount,
    prompt_candidate_ids: promptCandidateIdsFromEligibility(catalogEligibility, vectorEligibility),
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    conflict_blocked_count: conflictBlockedCount,
    catalog: {
      ...catalogSignal,
      eligibility: catalogEligibility
    },
    vector: {
      ...vectorSignal,
      eligibility: vectorEligibility
    },
    open_set_decision: openSetDecision,
    open_set_reason: openSetReason,
    catalog_gap_queue_candidate: assistEnabled && promptCandidateCount === 0,
    fail_closed_candidate: assistEnabled && promptCandidateCount === 0 && (rawCandidateCount > 0 || approvedCandidateCount > 0 || conflictBlockedCount > 0),
    unknown_card_ready: assistEnabled
      && promptCandidateCount === 0
      && result.confidence !== "FAILED"
      && !result.provider_error_code
      && !result.provider_error_type,
    reasons
  };
}

function candidateControlResultPatch(candidateControl = {}) {
  return {
    candidate_control_ready: true,
    participation_level: candidateControl.participation_level,
    decision_eligible_candidate_count: candidateControl.decision_eligible_candidate_count,
    decision_eligible_candidate_ids: candidateControl.decision_eligible_candidate_ids,
    shadow_only_candidate_count: candidateControl.shadow_only_candidate_count,
    shadow_only_candidate_ids: candidateControl.shadow_only_candidate_ids,
    selected_candidate_decision: candidateControl.selected_candidate_decision,
    card_domain_reranker_shadow: candidateControl.card_domain_reranker_shadow,
    candidate_application_trace: candidateControl.candidate_application_trace,
    candidate_observation_snapshot: candidateControl.candidate_observation_snapshot,
    candidate_field_inventory: candidateControl.candidate_field_inventory,
    candidate_field_evidence: candidateControl.candidate_field_evidence,
    candidate_activation_funnel: candidateControl.candidate_activation_funnel,
    catalog_activation_funnel: candidateControl.catalog_activation_funnel,
    vector_activation_funnel: candidateControl.vector_activation_funnel,
    pre_observation_candidate_count: candidateControl.pre_observation_candidate_count,
    post_observation_candidate_count: candidateControl.post_observation_candidate_count,
    post_observation_selected_candidate_id: candidateControl.post_observation_selected_candidate_id,
    retrieval_used_observation_fields: candidateControl.retrieval_used_observation_fields,
    low_margin_safe_field_application: candidateControl.low_margin_safe_field_application,
    selected_candidate_safe_field_application: candidateControl.selected_candidate_safe_field_application,
    selected_candidate_verifier: candidateControl.selected_candidate_verifier
  };
}

function withCandidateControl(result = {}, context = {}, {
  includeRetrievalApplication = false
} = {}) {
  if (!result || typeof result !== "object") return result;
  if (result.candidate_control_ready === true
    && (!includeRetrievalApplication || result.retrieval_application?.owns_candidate_application === true)) {
    return result;
  }
  const controlledInput = context.sourceFeedbackId && !result.source_feedback_id
    ? { ...result, source_feedback_id: context.sourceFeedbackId }
    : result;
  const candidateControl = v4ProductionStrategy.candidate_control.select({
    result: controlledInput,
    catalogContext: context.catalogContext || {},
    vectorContext: context.vectorContext || {}
  });
  const controlled = {
    ...controlledInput,
    ...candidateControlResultPatch(candidateControl)
  };
  if (!includeRetrievalApplication) return controlled;
  const providerOptions = context.providerOptions || {};
  const enabled = retrievalApplicationEnabled(context.env || process.env, providerOptions);
  return {
    ...controlled,
    retrieval_application: v4ProductionStrategy.candidate_control.build_retrieval_application({
      result: controlled,
      candidateControl,
      enabled,
      maxLength: context.maxLength || maxFallbackTitleLength
    })
  };
}

function withOpenSetReadiness(result = {}, context = {}) {
  if (!result || typeof result !== "object") return result;
  const controlledResult = withCandidateControl(result, context);
  const openSetReadiness = buildOpenSetReadiness(controlledResult, context);
  const candidateContext = buildCandidateContextSummary({
    result: controlledResult,
    openSetReadiness,
    catalogContext: context.catalogContext || {},
    vectorContext: context.vectorContext || {},
    providerOptions: context.providerOptions || {},
    env: process.env
  });
  return applyColdStartSafeDraftPolicy({
    ...controlledResult,
    open_set_readiness: openSetReadiness,
    candidate_context: candidateContext
  }, {
    providerOptions: context.providerOptions || {},
    mode: context.mode || result.provider_eval_mode || "",
    openSetReadiness,
    maxLength: context.maxLength || maxFallbackTitleLength
  });
}

async function withEvidenceCompletion(result, payload, {
  runFocusedVisionImpl = null,
  env = process.env,
  timingContext = null,
  visualFeatures = {},
  providerOptions = {},
  catalogContext = {},
  vectorContext = {}
} = {}) {
  const retrievalMode = payload.retrievalMode || payload.retrieval_mode || process.env.RETRIEVAL_MODE;
  const retrievalEnv = retrievalEnvForProviderOptions(env, providerOptions);
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions);
  const completion = await timeAsync(timingContext, "evidence_completion_ms", () => completeEvidence({
    resolved: result.resolved,
    evidence: result.evidence,
    captureQuality: result.capture_quality || captureQualityForPayload(payload),
    unresolved: result.unresolved,
    visualEmbeddings: optionFlag(providerOptions, "enable_vector_assist", false)
      ? visualFeaturesForRetrieval(result, visualFeatures)
      : [],
    retrievalMode,
    allowedFamilies: allowedFamilies || undefined,
    maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined,
    env: retrievalEnv,
    excludeSourceFeedbackIds: [payload.source_feedback_id || payload.sourceFeedbackId].filter(Boolean),
    runFocusedVisionImpl
  }));
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const resolutionTrace = [
    ...(Array.isArray(result.resolution_trace) ? result.resolution_trace : []),
    ...completion.resolution_trace
  ];
  const completedResult = withCompletedEvidencePresentation(result, completion, payload);
  const route = completion.route || completedResult.route || completedResult.resolved?.route;
  const output = withCandidateControl({
    ...completedResult,
    route,
    route_reason: completion.route_reason,
    retrieval: completion.retrieval,
    completion_state: completion.state,
    completion_trace: completion.resolution_trace,
    resolution_trace: resolutionTrace,
    usage: mergeUsage(result.usage, completion.usage, {
      providerCalls: result.provider ? 1 : 0
    })
  }, {
    catalogContext,
    vectorContext,
    providerOptions,
    env,
    sourceFeedbackId: payload.source_feedback_id || payload.sourceFeedbackId || null,
    maxLength: payload.maxTitleLength || maxFallbackTitleLength
  }, {
    includeRetrievalApplication: true
  });

  return timeAsync(timingContext, "resolver_ms", () => applyIdentityResolutionGateWithConvergence(output, {
    maxLength: payload.maxTitleLength || maxFallbackTitleLength,
    providerId: output.identity_provider_id || output.provider || output.source,
    retrievalCandidates: retrievalCandidatesForIdentity(completion, providerOptions),
    retrieveEvidence: createIdentityConvergenceRetriever({
      retrievalMode,
      env: retrievalEnv,
      allowedFamilies: allowedFamilies || undefined,
      maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined
    }),
    convergenceOptions: {
      maxIterations: 1
    }
  }));
}

function retrievalSourcesFromCompletion(completion = {}) {
  const summaries = [
    completion.retrieval,
    completion.catalog_retrieval,
    completion.vector_retrieval
  ].filter((summary) => summary && typeof summary === "object" && !Array.isArray(summary));
  return summaries.flatMap((summary, summaryIndex) => [
    summary.selected_candidate
      ? {
        ...summary.selected_candidate,
        __title_assist_selected_candidate: true,
        __title_assist_source_index: -1,
        __title_assist_summary_index: summaryIndex
      }
      : null,
    ...(Array.isArray(summary.sources) ? summary.sources.map((source, sourceIndex) => ({
      ...source,
      __title_assist_selected_candidate: false,
      __title_assist_source_index: sourceIndex,
      __title_assist_summary_index: summaryIndex
    })) : [])
  ].filter((source) => source && typeof source === "object"));
}

function retrievalSourceConflictFields(source = {}) {
  return normalizedCandidateConflictFields(source);
}

function retrievalSourcePromptConflictFields(source = {}) {
  return normalizedCandidateConflictFields(source, ["soft_conflicting_fields", "soft_conflicts"]);
}

function retrievalSourceHasDirectConflict(source = {}) {
  if (retrievalSourceConflictFields(source).length) return true;
  return Number(source.field_conflict_count || source.direct_evidence_conflict_count || 0) > 0;
}

function retrievalSourceHasPromptConflict(source = {}) {
  if (retrievalSourcePromptConflictFields(source).length) return true;
  return Number(source.field_conflict_count || source.direct_evidence_conflict_count || 0) > 0;
}

const titleAssistGenericTokens = new Set([
  "the",
  "and",
  "with",
  "card",
  "cards",
  "base",
  "rookie",
  "rc",
  "auto",
  "autograph",
  "refractor",
  "parallel",
  "black",
  "white",
  "gold",
  "silver",
  "blue",
  "red",
  "green",
  "orange",
  "purple",
  "bronze",
  "pink",
  "mini",
  "common"
]);

const titleAssistManufacturerTokens = new Set([
  "topps",
  "panini",
  "upper",
  "deck",
  "bowman",
  "wizards",
  "konami"
]);

const titleAssistSubjectStopTokens = new Set([
  "de",
  "da",
  "del",
  "la",
  "le",
  "van",
  "von",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv"
]);

function meaningfulTitleAssistTokens(value, {
  includeManufacturer = true
} = {}) {
  return searchable(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !titleAssistGenericTokens.has(token))
    .filter((token) => includeManufacturer || !titleAssistManufacturerTokens.has(token));
}

function meaningfulSubjectTitleAssistTokens(value) {
  return meaningfulTitleAssistTokens(value, { includeManufacturer: false })
    .filter((token) => token.length >= 3)
    .filter((token) => !titleAssistSubjectStopTokens.has(token));
}

function nonEmptyCompatibleTextField(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  return Boolean(leftValue && rightValue && (
    leftValue === rightValue
    || leftValue.includes(rightValue)
    || rightValue.includes(leftValue)
  ));
}

function tokenCompatibleTextField(left, right, {
  includeManufacturer = true
} = {}) {
  if (nonEmptyCompatibleTextField(left, right)) return true;
  const leftTokens = meaningfulTitleAssistTokens(left, { includeManufacturer });
  const rightTokens = meaningfulTitleAssistTokens(right, { includeManufacturer });
  if (!leftTokens.length || !rightTokens.length) return false;
  return leftTokens.some((leftToken) => rightTokens.some((rightToken) => (
    leftToken === rightToken
    || (leftToken.length >= 4 && rightToken.includes(leftToken))
    || (rightToken.length >= 4 && leftToken.includes(rightToken))
  )));
}

function titleAssistIdentityTextCompatible(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  if (!leftValue || !rightValue) return true;
  return tokenCompatibleTextField(leftValue, rightValue, { includeManufacturer: false });
}

function titleAssistProductTextCompatible(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  if (!leftValue || !rightValue) return true;
  if (titleAssistIdentityTextCompatible(leftValue, rightValue)) return true;
  const compactLeft = leftValue.replace(/\s+/g, "");
  const compactRight = rightValue.replace(/\s+/g, "");
  if (compactLeft.length >= 8 && compactRight.length >= 8
    && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) {
    return true;
  }
  if ((leftValue.includes("pokemon") || leftValue.includes("pokémon") || rightValue.includes("pokemon") || rightValue.includes("pokémon"))
    && tokenCompatibleTextField(leftValue, rightValue, { includeManufacturer: true })) {
    return true;
  }
  return false;
}

function subjectTextsForTitleAssist(fields = {}) {
  const normalized = normalizeFields(fields || {});
  return [
    ...currentSubjectTokens(normalized),
    normalized.character,
    normalized.artist
  ].filter(Boolean);
}

function subjectTextCompatibleForTitleAssist(left, right) {
  if (nonEmptyCompatibleTextField(left, right)) return true;
  const leftTokens = meaningfulSubjectTitleAssistTokens(left);
  const rightTokens = meaningfulSubjectTitleAssistTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap >= Math.min(2, leftTokens.length, rightTokens.length);
}

function looseSubjectTokenOverlapWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const sourceSubjects = subjectTextsForTitleAssist(sourceFields);
  const currentSubjects = subjectTextsForTitleAssist(normalizedCurrent);
  if (!sourceSubjects.length || !currentSubjects.length) return false;
  const sourceTokens = new Set(sourceSubjects.flatMap((subject) => meaningfulSubjectTitleAssistTokens(subject)));
  const currentTokens = new Set(currentSubjects.flatMap((subject) => meaningfulSubjectTitleAssistTokens(subject)));
  return [...currentTokens].some((token) => token.length >= 5 && sourceTokens.has(token));
}

function titleSubjectOverlapWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const sourceSubjects = subjectTextsForTitleAssist(sourceFields);
  const currentSubjects = subjectTextsForTitleAssist(normalizedCurrent);
  const sourceText = [
    source.title,
    source.reference_title,
    ...sourceSubjects
  ].filter(Boolean).join(" ");
  const currentText = [
    currentTitle,
    ...currentSubjects
  ].filter(Boolean).join(" ");

  if (sourceSubjects.length && currentSubjects.length) {
    return sourceSubjects.some((sourceSubject) => currentSubjects.some((currentSubject) => (
      subjectTextCompatibleForTitleAssist(sourceSubject, currentSubject)
    )));
  }

  if (currentSubjects.length && sourceText) {
    const sourceTokens = new Set(meaningfulSubjectTitleAssistTokens(sourceText));
    return currentSubjects.some((currentSubject) => meaningfulSubjectTitleAssistTokens(currentSubject)
      .some((token) => sourceTokens.has(token)));
  }

  if (sourceSubjects.length && currentText) {
    const currentTokens = new Set(meaningfulSubjectTitleAssistTokens(currentText));
    return sourceSubjects.some((sourceSubject) => meaningfulSubjectTitleAssistTokens(sourceSubject)
      .some((token) => currentTokens.has(token)));
  }

  return false;
}

function serialDenominatorCompatibleForTitleAssist(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const currentDenominator = printRunDenominatorForTitleAssist(currentFields, currentTitle);
  const sourceDenominator = printRunDenominatorForTitleAssist(sourceFields, source.title || source.reference_title);
  return Boolean(currentDenominator && sourceDenominator && currentDenominator === sourceDenominator);
}

function currentYearLooksLikeWeakSeasonContext(value = "") {
  const text = String(value || "").trim();
  if (/^\d{2}\s*[-/]\s*\d{2}$/.test(text)) return true;
  if (/^\d{4}\s*\/\s*\d{2}$/.test(text)) return true;
  return false;
}

function sourceCanSoftenYearConflict(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (!currentYearLooksLikeWeakSeasonContext(normalizedCurrent.year)) return false;
  const subjectCompatible = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
    || looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle);
  if (!subjectCompatible) return false;
  const sourceProduct = sourceFields.product || source.title || source.reference_title;
  const currentProduct = normalizedCurrent.product || currentTitle;
  return titleAssistProductTextCompatible(sourceProduct, currentProduct)
    || titleAssistProductTextCompatible(sourceProduct, currentTitle);
}

function retrievalSourceHasBlockingTitleConflict(source = {}, currentFields = {}, currentTitle = "") {
  const conflicts = retrievalSourceConflictFields(source);
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (!conflicts.length) return Number(source.field_conflict_count || source.direct_evidence_conflict_count || 0) > 0;
  const blocking = conflicts.filter((field) => {
    if (field === "year") {
      if (yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)) return false;
      return !sourceCanSoftenYearConflict(source, currentFields, currentTitle);
    }
    if (field === "brand" || field === "manufacturer") {
      const sourceValue = sourceFields[field] || sourceFields.brand || sourceFields.manufacturer || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || normalizedCurrent.brand || normalizedCurrent.manufacturer || currentTitle;
      return !titleAssistIdentityTextCompatible(sourceValue, currentValue)
        && !titleAssistProductTextCompatible(sourceValue, currentTitle);
    }
    if (field === "product" || field === "set" || field === "insert") {
      const sourceValue = sourceFields[field] || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || normalizedCurrent.product || currentTitle;
      if (field === "product") {
        return !titleAssistProductTextCompatible(sourceValue, currentValue)
          && !titleAssistProductTextCompatible(sourceValue, currentTitle);
      }
      if (titleAssistIdentityTextCompatible(sourceValue, currentValue)) return false;
      const sourceProduct = sourceFields.product || source.title || source.reference_title;
      const currentProduct = normalizedCurrent.product || currentTitle;
      const subjectCompatible = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
        || looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle);
      return !(subjectCompatible && (
        titleAssistProductTextCompatible(sourceProduct, currentProduct)
        || titleAssistProductTextCompatible(sourceProduct, currentTitle)
      ));
    }
    if (field === "collector_number" || field === "checklist_code" || field === "card_number" || field === "tcg_card_number") {
      const sourceValue = sourceFields[field] || source.title || source.reference_title;
      const currentValue = normalizedCurrent[field] || currentTitle;
      return !compatibleTextField(sourceValue, currentValue);
    }
    if (/^(players|subjects|subject|character)$/.test(field)) {
      return !titleSubjectOverlapWithCurrent(source, currentFields, currentTitle);
    }
    if (field === "serial_number" || field === "serial_denominator" || field === "print_run_number" || field === "print_run_denominator" || field === "numbered_to" || field === "numerical_rarity") {
      return !serialDenominatorCompatibleForTitleAssist(source, currentFields, currentTitle);
    }
    return true;
  });
  return blocking.length > 0;
}

function approvedRetrievalStatus(source = {}) {
  return /approved|reviewed|verified/i.test(`${source.reference_metadata?.retrieval_status || ""} ${source.reference_metadata?.reference_status || ""} ${source.retrieval_status || ""} ${source.source_trust || ""}`);
}

function retrievalSourceIsTrustedTitleAssist(source = {}) {
  const providerId = String(source.provider_id || source.source_provider || "").toLowerCase();
  const sourceType = String(source.source_type || "").toUpperCase();
  if (sourceType === "VISUAL_VECTOR" || providerId === "visual_vector") return false;
  if (sourceType === "MARKETPLACE") return false;
  if (providerId === "catalog" || providerId === "postgres_hybrid") return approvedRetrievalStatus(source)
    || /INTERNAL_APPROVED_HISTORY|STRUCTURED_DATABASE|OFFICIAL_CHECKLIST|OFFICIAL_REGISTRY/.test(sourceType);
  return /INTERNAL_APPROVED_HISTORY|APPROVED_MEMORY|OFFICIAL_CHECKLIST|OFFICIAL_REGISTRY/.test(sourceType);
}

function retrievalSourceIsCatalogLike(source = {}) {
  return /catalog|structured_database|official|approved|registry/i.test(`${source.provider_id || ""} ${source.source_provider || ""} ${source.source_type || ""} ${source.source_url || ""}`);
}

function retrievalSourceMatchedFields(source = {}) {
  return [...new Set([
    ...(Array.isArray(source.matched_fields) ? source.matched_fields : []),
    ...(Array.isArray(source.supporting_fields) ? source.supporting_fields : [])
  ].map((field) => String(field || "").toLowerCase()).filter(Boolean))];
}

function retrievalSourceEffectiveMatchedFields(source = {}, currentFields = {}, currentTitle = "") {
  const matched = new Set(retrievalSourceMatchedFields(source));
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  if (titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)) {
    matched.add("subjects");
  }
  if (sourceFields.year && normalizedCurrent.year
    && (yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)
      || sourceCanSoftenYearConflict(source, currentFields, currentTitle))) {
    matched.add("year");
  }
  if (sourceFields.product && (normalizedCurrent.product || currentTitle)
    && (titleAssistProductTextCompatible(sourceFields.product, normalizedCurrent.product)
      || titleAssistProductTextCompatible(sourceFields.product, currentTitle))) {
    matched.add("product");
  }
  const sourceBrand = sourceFields.brand || sourceFields.manufacturer;
  const currentBrand = normalizedCurrent.brand || normalizedCurrent.manufacturer;
  if (sourceBrand && (currentBrand || currentTitle)
    && (titleAssistIdentityTextCompatible(sourceBrand, currentBrand)
      || titleAssistProductTextCompatible(sourceBrand, currentTitle))) {
    matched.add("brand");
  }
  if (serialDenominatorCompatibleForTitleAssist(source, currentFields, currentTitle)) {
    matched.add("serial_denominator");
    matched.add("print_run_denominator");
    matched.add("numbered_to");
  }
  if (sourceFields.collector_number && (normalizedCurrent.collector_number || currentTitle)
    && compatibleTextField(sourceFields.collector_number, normalizedCurrent.collector_number || currentTitle)) {
    matched.add("collector_number");
  }
  if (sourceFields.card_number && (normalizedCurrent.card_number || currentTitle)
    && compatibleTextField(sourceFields.card_number, normalizedCurrent.card_number || currentTitle)) {
    matched.add("card_number");
  }
  if (sourceFields.tcg_card_number && (normalizedCurrent.tcg_card_number || currentTitle)
    && compatibleTextField(sourceFields.tcg_card_number, normalizedCurrent.tcg_card_number || currentTitle)) {
    matched.add("tcg_card_number");
  }
  if (sourceFields.checklist_code && (normalizedCurrent.checklist_code || currentTitle)
    && compatibleTextField(sourceFields.checklist_code, normalizedCurrent.checklist_code || currentTitle)) {
    matched.add("checklist_code");
  }
  return matched;
}

function retrievalSourceHasStrongTitleSupport(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "tcg_card_number", "print_run_number", "print_run_denominator", "numbered_to", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  if (exactEvidence) {
    return ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
      .some((field) => matched.has(field));
  }
  const identityEvidenceCount = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .filter((field) => matched.has(field)).length;
  if (Number(source.__title_assist_source_index) === 0 && identityEvidenceCount >= 3 && Number(source.match_score || source.normalized_score || 0) >= 0.25) {
    return true;
  }
  return identityEvidenceCount >= 3 && Number(source.match_score || source.normalized_score || 0) >= 0.35;
}

function retrievalSourceHasExactIdentityAnchor(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["collector_number", "checklist_code", "card_number", "tcg_card_number", "print_run_number", "print_run_denominator", "numbered_to", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  const identityEvidence = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .some((field) => matched.has(field));
  return exactEvidence && identityEvidence;
}

function retrievalSourceHasHardIdentityAnchor(source = {}, currentFields = {}, currentTitle = "") {
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const exactEvidence = ["checklist_code", "print_run_number", "print_run_denominator", "numbered_to", "serial_number", "serial_denominator"].some((field) => matched.has(field));
  const identityEvidence = ["subjects", "players", "product", "year", "brand", "manufacturer", "surface_color", "trigram"]
    .some((field) => matched.has(field));
  return exactEvidence && identityEvidence;
}

function retrievalSourceCanEnterTitleAssistLane(source = {}, currentFields = {}, currentTitle = "") {
  const selectedLane = source.selected === true || source.__title_assist_selected_candidate === true;
  const sourceIndex = Number(source.__title_assist_source_index);
  const topRankedLane = sourceIndex === 0;
  if (!retrievalSourceIsTrustedTitleAssist(source)) return false;
  if (retrievalSourceHasPromptConflict(source)) return false;
  if (retrievalSourceHasBlockingTitleConflict(source, currentFields, currentTitle)) return false;
  if (!retrievalSourceCompatibleWithCurrent(source, currentFields, currentTitle)) return false;
  const matched = retrievalSourceEffectiveMatchedFields(source, currentFields, currentTitle);
  const sourceSubjects = subjectTextsForTitleAssist(source.fields || {});
  const currentSubjects = subjectTextsForTitleAssist(currentFields || {});
  const exactAnchor = retrievalSourceHasExactIdentityAnchor(source, currentFields, currentTitle);
  const subjectSupport = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle)
    || (exactAnchor && looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle));
  const identitySupportCount = ["product", "set", "year", "brand", "manufacturer", "surface_color", "trigram", "collector_number", "checklist_code", "card_number", "tcg_card_number", "print_run_denominator", "numbered_to", "serial_denominator"]
    .filter((field) => matched.has(field)).length;
  const score = Number(source.match_score || source.normalized_score || source.raw_score || 0);
  const lowerRankedCatalogLane = sourceIndex > 0
    && sourceIndex <= 12
    && retrievalSourceIsCatalogLike(source)
    && subjectSupport
    && (exactAnchor || identitySupportCount >= 3)
    && score >= 0.38;
  const lowerRankedExactCatalogLane = sourceIndex > 0
    && sourceIndex <= 12
    && retrievalSourceIsCatalogLike(source)
    && subjectSupport
    && retrievalSourceHasHardIdentityAnchor(source, currentFields, currentTitle)
    && identitySupportCount >= 3
    && score >= 0.34;
  if (!selectedLane && !topRankedLane && !lowerRankedCatalogLane && !lowerRankedExactCatalogLane) return false;
  if (!subjectSupport && (sourceSubjects.length || currentSubjects.length)) return false;
  if (!subjectSupport && !exactAnchor) return false;
  if (!selectedLane && score < 0.25) return false;
  return (exactAnchor || identitySupportCount >= 2) && (selectedLane || score >= 0.25);
}

function overlapTokenCount(left, right) {
  const leftTokens = new Set(searchable(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(searchable(right).split(" ").filter((token) => token.length > 1));
  return [...leftTokens].filter((token) => rightTokens.has(token)).length;
}

function compatibleTextField(left, right) {
  const leftValue = searchable(left);
  const rightValue = searchable(right);
  return !leftValue || !rightValue || leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function currentSubjectTokens(fields = {}) {
  const normalized = normalizeFields(fields || {});
  return Array.isArray(normalized.players) && normalized.players.length
    ? normalized.players
    : normalized.player
      ? [normalized.player]
      : [];
}

function retrievalSourceCompatibleWithCurrent(source = {}, currentFields = {}, currentTitle = "") {
  const sourceFields = normalizeFields(source.fields || {});
  const normalizedCurrent = normalizeFields(currentFields || {});
  const subjectOverlap = titleSubjectOverlapWithCurrent(source, currentFields, currentTitle);
  if (sourceFields.year && normalizedCurrent.year && !yearsCompatibleForTitleAssist(sourceFields.year, normalizedCurrent.year)
    && !sourceCanSoftenYearConflict(source, currentFields, currentTitle)) return false;
  if (sourceFields.brand && normalizedCurrent.brand && !titleAssistIdentityTextCompatible(sourceFields.brand, normalizedCurrent.brand) && !titleAssistProductTextCompatible(sourceFields.brand, currentTitle)) return false;
  if (sourceFields.manufacturer && normalizedCurrent.manufacturer && !titleAssistIdentityTextCompatible(sourceFields.manufacturer, normalizedCurrent.manufacturer) && !titleAssistProductTextCompatible(sourceFields.manufacturer, currentTitle)) return false;
  if (sourceFields.product && normalizedCurrent.product && !titleAssistProductTextCompatible(sourceFields.product, normalizedCurrent.product) && !titleAssistProductTextCompatible(sourceFields.product, currentTitle)) return false;

  const sourceSubjects = currentSubjectTokens(sourceFields);
  const currentSubjects = currentSubjectTokens(normalizedCurrent);
  if (sourceSubjects.length && currentSubjects.length && !subjectOverlap && !looseSubjectTokenOverlapWithCurrent(source, currentFields, currentTitle)) {
    return false;
  }

  const currentDenominator = printRunDenominatorForTitleAssist(normalizedCurrent, currentTitle);
  const sourceDenominator = printRunDenominatorForTitleAssist(sourceFields, source.title);
  if (!currentDenominator && sourceDenominator) return false;
  if (currentDenominator && sourceDenominator && currentDenominator !== sourceDenominator) return false;
  return true;
}

function yearsCompatibleForTitleAssist(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const leftYears = [...leftText.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const rightYears = [...rightText.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (!leftYears.length || !rightYears.length) return compatibleTextField(left, right);
  return leftYears.some((year) => rightYears.includes(year) || rightYears.includes(year + 1) || rightYears.includes(year - 1));
}

function serialDenominatorForTitleAssist(value) {
  return normalizeSerialText(value).match(/\/\s*0*(\d{1,4})\b/)?.[1] || null;
}

function printRunDenominatorForTitleAssist(fieldsOrValue = {}, fallbackText = "") {
  if (fieldsOrValue && typeof fieldsOrValue === "object" && !Array.isArray(fieldsOrValue)) {
    const fields = normalizeFields(fieldsOrValue || {});
    return normalizeStringOrNull(fields.print_run_denominator)
      || normalizeStringOrNull(fields.numbered_to)
      || normalizeStringOrNull(fields.serial_denominator)
      || normalizeStringOrNull(fields.expected_serial_denominator)
      || serialDenominatorForTitleAssist(fields.print_run_number)
      || serialDenominatorForTitleAssist(fields.numerical_rarity)
      || serialDenominatorForTitleAssist(fields.serial_number)
      || serialDenominatorForTitleAssist(fallbackText);
  }
  return serialDenominatorForTitleAssist(fieldsOrValue || fallbackText);
}

function stripReferenceInstanceOnlyTerms(title) {
  return String(title || "")
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
    .replace(/\b(?:PSA|BGS|SGC|CGC|Beckett)\s+(?:GEM\s*(?:MT|MINT)\s+|MINT\s+|AUTO\s+)?(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?)(?:\s*\/\s*(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?))?\b/gi, " ")
    .replace(/\bCert(?:ificate)?\s*#?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gradeTokenFromCurrentTitle(title) {
  return String(title || "").match(/\b(?:PSA|BGS|SGC|CGC)\s+(?:AUTO\s+)?(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?)(?:\s*\/\s*(?:AUTH(?:ENTIC)?|\d+(?:\.\d+)?))?\b/i)?.[0] || "";
}

function titleAssistFieldValuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).replace(/\s+/g, " ").trim() !== "" && value !== "UNKNOWN";
}

function mergeCurrentFieldsForTitleAssist(...fieldSets) {
  const merged = {};
  fieldSets.forEach((fields) => {
    const normalized = normalizeFields(fields || {});
    Object.entries(normalized).forEach(([field, value]) => {
      if (!titleAssistFieldValuePresent(value)) return;
      merged[field] = value;
    });
  });
  return merged;
}

function gradeTokenFromCurrentFields(fields = {}) {
  const normalized = normalizeFields(fields || {});
  const company = normalizeStringOrNull(normalized.grade_company);
  const grade = normalizeStringOrNull(normalized.card_grade || normalized.grade);
  if (!company || !grade) return "";
  return `${company} ${grade}`.replace(/\s+/g, " ").trim();
}

function appendCurrentInstanceTerms(title, currentFields = {}, currentTitle = "") {
  let output = String(title || "").replace(/\s+/g, " ").trim();
  const numericalRarity = normalizeSerialText(currentFields.print_run_number || currentFields.numerical_rarity || currentFields.serial_number || "");
  const serialLimit = serialLimitForTitle(numericalRarity, currentFields);
  if ((/\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(numericalRarity) || /^\/\d{1,4}\b/.test(serialLimit))
    && serialLimit
    && !titleIncludesSerial(output, { ...currentFields, numerical_rarity: numericalRarity })) {
    output = `${output} ${serialLimit}`.trim();
  }
  const grade = gradeTokenFromCurrentFields(currentFields) || gradeTokenFromCurrentTitle(currentTitle);
  if (grade && !rawIncludes(output, grade)) output = `${output} ${grade}`.trim();
  const collector = normalizeStringOrNull(currentFields.collector_number || currentFields.card_number);
  if (collector && !rawIncludes(output, collector)) output = `${output} #${collector}`.trim();
  return output.replace(/\s+/g, " ").trim();
}

function escapeTitleAssistRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitlePreservingSuffix(title, suffix, maxLength) {
  const suffixValue = String(suffix || "").replace(/\s+/g, " ").trim();
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (!suffixValue || normalized.length <= maxLength) return normalizeTitle(normalized, maxLength);
  const plain = normalizeTitle(normalized, maxLength);
  if (rawIncludes(plain, suffixValue)) return plain;
  const withoutSuffix = normalized
    .replace(new RegExp(`\\b${escapeTitleAssistRegExp(suffixValue)}\\b`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
  const prefixMaxLength = Math.max(0, maxLength - suffixValue.length - 1);
  const prefix = normalizeTitle(withoutSuffix, prefixMaxLength);
  return `${prefix} ${suffixValue}`.replace(/\s+/g, " ").trim();
}

function foldScaffoldText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hard direct-evidence guard for the title scaffold lane: a reference title
// may never override what the current images directly established about the
// player or the year. This is the last line of defense against candidates
// that carry only a title (no structured fields) and therefore bypass the
// field-level conflict checks.
function scaffoldTitleConflictsWithDirectEvidence(candidateTitle, currentFields = {}) {
  const title = foldScaffoldText(candidateTitle);
  if (!title) return "";
  const normalized = normalizeFields(currentFields || {});
  const players = Array.isArray(normalized.players) && normalized.players.length
    ? normalized.players
    : normalized.player
      ? [normalized.player]
      : [];
  if (players.length) {
    const supported = players.some((player) => {
      const folded = foldScaffoldText(player);
      if (!folded) return true;
      if (title.includes(folded)) return true;
      const lastName = folded.split(" ").filter((part) => part.length > 2).at(-1) || "";
      return lastName ? title.includes(lastName) : true;
    });
    if (!supported) return "scaffold_player_conflict";
  }
  const currentYears = [...String(normalized.year || "").matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const titleYears = [...title.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  if (currentYears.length && titleYears.length) {
    const compatible = titleYears.some((year) => currentYears.some((current) => Math.abs(current - year) <= 1));
    if (!compatible) return "scaffold_year_conflict";
  }
  return "";
}

function bestRetrievalTitleAssistSource(completion = {}, result = {}, diagnostics = null) {
  const currentFields = mergeCurrentFieldsForTitleAssist(
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields
  );
  const currentTitle = result.final_title || result.title || result.rendered_title || "";
  return retrievalSourcesFromCompletion(completion)
    .filter((source) => retrievalSourceCanEnterTitleAssistLane(source, currentFields, currentTitle))
    .filter((source) => source.title || source.reference_title)
    .filter((source) => {
      const conflict = scaffoldTitleConflictsWithDirectEvidence(source.title || source.reference_title || "", currentFields);
      if (conflict && diagnostics) {
        diagnostics.direct_evidence_rejected_count = (diagnostics.direct_evidence_rejected_count || 0) + 1;
        diagnostics.direct_evidence_rejected_reasons = [
          ...(diagnostics.direct_evidence_rejected_reasons || []),
          conflict
        ].slice(0, 8);
      }
      return !conflict;
    })
    .filter(retrievalSourceIsTrustedTitleAssist)
    .filter((source) => !retrievalSourceHasBlockingTitleConflict(source, currentFields, currentTitle))
    .filter((source) => retrievalSourceHasStrongTitleSupport(source, currentFields, currentTitle))
    .filter((source) => retrievalSourceCompatibleWithCurrent(source, currentFields, currentTitle))
    .sort((left, right) => {
      const leftMatched = retrievalSourceEffectiveMatchedFields(left, currentFields, currentTitle);
      const rightMatched = retrievalSourceEffectiveMatchedFields(right, currentFields, currentTitle);
      const leftCatalog = retrievalSourceIsCatalogLike(left) ? 1 : 0;
      const rightCatalog = retrievalSourceIsCatalogLike(right) ? 1 : 0;
      if (leftCatalog !== rightCatalog) return rightCatalog - leftCatalog;
      const leftExact = [...leftMatched].some((field) => /collector_number|checklist_code|card_number|tcg_card_number|print_run_number|print_run_denominator|numbered_to|serial_number|serial_denominator/.test(field)) ? 1 : 0;
      const rightExact = [...rightMatched].some((field) => /collector_number|checklist_code|card_number|tcg_card_number|print_run_number|print_run_denominator|numbered_to|serial_number|serial_denominator/.test(field)) ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftSupport = leftMatched.size;
      const rightSupport = rightMatched.size;
      if (leftSupport !== rightSupport) return rightSupport - leftSupport;
      const leftOverlap = overlapTokenCount(left.title || left.reference_title, currentTitle);
      const rightOverlap = overlapTokenCount(right.title || right.reference_title, currentTitle);
      if (leftOverlap !== rightOverlap) return rightOverlap - leftOverlap;
      return Number(right.match_score || right.normalized_score || 0) - Number(left.match_score || left.normalized_score || 0);
    })[0] || null;
}

function applySafeRetrievalTitleAssist(draft = {}, result = {}, completion = {}, payload = {}) {
  const diagnostics = {};
  const source = bestRetrievalTitleAssistSource(completion, result, diagnostics);
  if (!source) {
    if (diagnostics.direct_evidence_rejected_count) {
      return {
        ...draft,
        retrieval_title_assist: {
          used: false,
          mode: "",
          blocked_by_direct_evidence_conflict: true,
          rejected_candidate_count: diagnostics.direct_evidence_rejected_count,
          rejected_reasons: diagnostics.direct_evidence_rejected_reasons || []
        }
      };
    }
    return draft;
  }
  const currentFields = mergeCurrentFieldsForTitleAssist(
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields,
    draft.fields,
    draft.raw_provider_fields,
    draft.resolved,
    draft.resolved_fields
  );
  const currentTitle = draft.final_title || draft.title || result.final_title || result.title || "";
  const candidateTitle = stripReferenceInstanceOnlyTerms(source.title || source.reference_title || "");
  if (!candidateTitle) return draft;
  const titleWithCurrentInstanceTerms = appendCurrentInstanceTerms(candidateTitle, currentFields, currentTitle);
  const currentSerial = normalizeSerialText(currentFields.print_run_number || currentFields.serial_number || "");
  const assistedTitle = /\b\d{1,4}\s*\/\s*\d{1,4}\b/.test(currentSerial)
    ? normalizeTitlePreservingSuffix(titleWithCurrentInstanceTerms, currentSerial, payload.maxTitleLength || maxFallbackTitleLength)
    : normalizeTitle(titleWithCurrentInstanceTerms, payload.maxTitleLength || maxFallbackTitleLength);
  if (!assistedTitle || assistedTitle === currentTitle) return draft;

  return {
    ...draft,
    title: assistedTitle,
    final_title: assistedTitle,
    rendered_title: assistedTitle,
    title_render_source: "safe_retrieval_title_assist",
    retrieval_title_assist: {
      used: true,
      mode: "selected_approved_candidate_title_scaffold",
      source_url: source.source_url || "",
      provider_id: source.provider_id || source.source_provider || "",
      candidate_identity_id: source.candidate_identity_id || "",
      matched_fields: retrievalSourceMatchedFields(source),
      stripped_reference_instance_terms: true
    },
    rendered_fields: {
      ...(draft.rendered_fields || {}),
      title: assistedTitle,
      rendered_title: assistedTitle,
      title_render_source: "safe_retrieval_title_assist"
    }
  };
}

async function withEvidenceCompletionShadow(result, payload, {
  env = process.env,
  timingContext = null,
  visualFeatures = {},
  providerOptions = {},
  catalogContext = {},
  vectorContext = {},
  preparedDraft = null,
  providerId = result.identity_provider_id || result.provider || result.source
} = {}) {
  const draft = preparedDraft || singleModelDraftPath(result, payload, providerId, {
    reason: "assist_shadow_no_prompt_safe_candidates",
    allowWhenEvidenceCompletion: true,
    assistShadowOnly: true,
    catalogContext,
    vectorContext,
    env
  });
  if (!draft) return null;
  const guardedDraft = applyOpenSetAssistShadowPresentationGuard(draft, payload);
  const shadowEvidenceCompletionEnabled = optionFlag(
    providerOptions,
    "enable_assist_shadow_evidence_completion",
    envFlag(env, "ENABLE_ASSIST_SHADOW_EVIDENCE_COMPLETION", false)
  );
  if (shadowEvidenceCompletionEnabled !== true) {
    return {
      ...guardedDraft,
      route: guardedDraft.route || "ASSIST_SHADOW_WRITER_DRAFT",
      route_reason: "No prompt-safe catalog or vector candidates were available; skipped shadow retrieval/evidence completion and kept the GPT draft for writer review.",
      retrieval: {
        skipped: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      },
      completion_state: {
        shadow_only: true,
        skipped: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      },
      fast_path: {
        ...(guardedDraft.fast_path || {}),
        assist_shadow_only: true,
        assist_shadow_retrieval_only: false,
        skipped_evidence_completion: true,
        skipped_focused_reread: true,
        skipped_retrieval: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      }
    };
  }

  const retrievalMode = payload.retrievalMode || payload.retrieval_mode || process.env.RETRIEVAL_MODE;
  const retrievalEnv = retrievalEnvForProviderOptions(env, providerOptions);
  const allowedFamilies = retrievalFamiliesForProviderOptions(env, providerOptions);
  let completion;
  try {
    completion = await timeAsync(timingContext, "evidence_completion_ms", () => completeEvidence({
      resolved: result.resolved,
      evidence: result.evidence,
      captureQuality: result.capture_quality || captureQualityForPayload(payload),
      unresolved: result.unresolved,
      visualEmbeddings: optionFlag(providerOptions, "enable_vector_assist", false)
        ? visualFeaturesForRetrieval(result, visualFeatures)
        : [],
      retrievalMode,
      allowedFamilies: allowedFamilies || undefined,
      maxQueries: allowedFamilies ? Math.max(4, allowedFamilies.length) : undefined,
      env: retrievalEnv,
      excludeSourceFeedbackIds: [payload.source_feedback_id || payload.sourceFeedbackId].filter(Boolean)
    }));
  } catch (error) {
    return {
      ...guardedDraft,
      route_reason: "No prompt-safe catalog or vector candidates were available; retrieval telemetry failed and did not alter the GPT draft.",
      retrieval: {
        skipped: true,
        reason: "assist_shadow_retrieval_failed",
        error: safeRecognitionError(error)
      },
      completion_state: {
        shadow_only: true,
        error_type: "RETRIEVAL_TELEMETRY_ERROR"
      },
      fast_path: {
        ...(guardedDraft.fast_path || {}),
        assist_shadow_only: true,
        assist_shadow_retrieval_only: true,
        reason: "assist_shadow_no_prompt_safe_candidates"
      }
    };
  }
  addTiming(timingContext, "retrieval_ms", Number(completion.retrieval?.latency_ms || completion.retrieval?.retrieval_time_ms || 0));
  const assistedDraft = applySafeRetrievalTitleAssist(guardedDraft, result, completion, payload);
  const finalAssistedDraft = applyOpenSetAssistShadowPresentationGuard(assistedDraft, payload);

  return {
    ...finalAssistedDraft,
    route: finalAssistedDraft.route || "ASSIST_SHADOW_WRITER_DRAFT",
    route_reason: finalAssistedDraft.retrieval_title_assist?.used
      ? "No prompt-safe catalog or vector candidates were available; selected approved retrieval evidence was used only as a stripped title scaffold without copying reference serial, grade, or cert values."
      : "No prompt-safe catalog or vector candidates were available; retrieval ran only for telemetry and did not alter the GPT draft.",
    retrieval: completion.retrieval || finalAssistedDraft.retrieval,
    completion_state: {
      ...(completion.state || {}),
      shadow_only: true
    },
    completion_trace: [
      ...(Array.isArray(finalAssistedDraft.completion_trace) ? finalAssistedDraft.completion_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    resolution_trace: [
      ...(Array.isArray(finalAssistedDraft.resolution_trace) ? finalAssistedDraft.resolution_trace : []),
      ...(Array.isArray(completion.resolution_trace) ? completion.resolution_trace : [])
    ],
    usage: mergeUsage(finalAssistedDraft.usage, completion.usage, {
      providerCalls: result.provider ? 1 : 0
    }),
    fast_path: {
      ...(finalAssistedDraft.fast_path || {}),
      assist_shadow_only: true,
      assist_shadow_retrieval_only: true,
      reason: "assist_shadow_no_prompt_safe_candidates"
    }
  };
}

async function imagesWithSignedReadUrls(images = [], timingContext = null, tenantId = "") {
  return timeAsync(timingContext, "signed_url_ms", () => mapWithConcurrency(images, signedUrlConcurrency, async (image) => {
    const metadata = await assertVerifiedStorageImage(image, tenantId);
    if (!metadata?.objectPath) return image;

    return {
      ...image,
      signedUrl: await createListingImageSignedReadUrl({
        tenantId,
        objectPath: metadata.objectPath,
        bucket: metadata.bucket
      }),
      signed_url: undefined
    };
  }));
}

export function recognitionIdentityPreflightDecision(payload = {}, env = process.env) {
  const bundleId = String(payload.preingestion_bundle_id || payload.preingestionBundleId || "").trim();
  const bundleStatus = String(payload.preingestion_bundle_status || "").trim().toUpperCase();
  const authoritativePreingestionReady = Boolean(
    bundleId
    && payload.preingestion_bundle_used === true
    && bundleStatus === "READY"
  );
  const redundantPreflightEnabled = envFlag(
    env,
    "ENABLE_RECOGNITION_PREFLIGHT_WITH_PREINGESTION",
    false
  );

  if (authoritativePreingestionReady && !redundantPreflightEnabled) {
    return {
      run: false,
      reason: "preingestion_bundle_is_authoritative"
    };
  }

  return {
    run: true,
    reason: authoritativePreingestionReady
      ? "redundant_preflight_explicitly_enabled"
      : "preingestion_bundle_not_authoritative"
  };
}

async function createRecognitionIdentityPreflight(payload, {
  timingContext = null,
  providerOptions = {},
  signedImagesPromise = null
} = {}) {
  const decision = recognitionIdentityPreflightDecision(payload, process.env);
  if (!decision.run) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
      signedImages: null,
      skipped: true,
      reason: decision.reason
    };
  }

  const config = recognitionWorkerConfig();
  if (!config.enabled || !config.configured) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
      signedImages: null,
      skipped: true,
      reason: config.reason || "recognition_worker_not_configured"
    };
  }

  const primaryImages = explicitPrimaryImagesFromImages(payload.images || []);
  const verifiedStorageReady = primaryImages.length > 0 && primaryImages.every((image) => {
    const metadata = storageMetadataForImage(image);
    return Boolean(metadata.objectPath && (image.storageVerified === true || image.storage_verified === true));
  });
  if (!verifiedStorageReady) {
    return {
      result: null,
      evidenceDocument: null,
      response: null,
      signedImages: null,
      skipped: true,
      reason: "recognition_preflight_requires_verified_storage_images"
    };
  }

  try {
    const signedImages = await (signedImagesPromise || imagesWithSignedReadUrls(
      payload.images || [],
      timingContext,
      payload.tenant_id || payload.tenantId || ""
    ));
    const signedPrimaryImages = primaryImagesFromImages(signedImages);
    const response = await timeAsync(timingContext, "recognition_preflight_ms", () => analyzeCardImagesWithRecognitionWorker({
      assetId: payload.assetId || payload.asset_id || `asset_${crypto.randomUUID()}`,
      captureProfileId: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
      images: signedPrimaryImages,
      requestedFields: [...recognitionRequestedFields],
      options: {
        run_ocr: true,
        run_visual_embeddings: queryVisualVectorPreflightEnabled(process.env, providerOptions)
      }
    }));
    const evidenceDocument = recognitionResponseToEvidenceDocument(response, {
      images: signedImages
    });

    if (!hasRecognitionEvidence(evidenceDocument)) {
      return {
        result: null,
        evidenceDocument,
        response,
        signedImages
      };
    }

    const baseResult = withRequestMetadata({
      title: "",
      final_title: "",
      rendered_title: "",
      model_title_suggestion: "",
      title_render_source: "recognition_worker_identity_preflight",
      confidence: "LOW",
      reason: "Recognition worker produced grounded OCR evidence before vision provider selection.",
      fields: resolvedFieldsToLegacyFields(evidenceDocument.resolved),
      resolved: evidenceDocument.resolved,
      evidence: evidenceDocument.evidence,
      unresolved: evidenceDocument.unresolved || [],
      source: "recognition_worker",
      provider: "recognition_worker",
      route: "RECOGNITION_WORKER_PREFLIGHT",
      route_reason: "Attempted local OCR/slab identity resolution before the selected vision provider.",
      recognition_preflight: evidenceDocument.recognition || null,
      visual_features: response.visual_features || {},
      usage: {
        provider_calls: 0,
        retrieval_calls: 0,
        recognition_worker_calls: response.unavailable ? 0 : 1,
        latency_ms: Number(response.processing?.latency_ms || 0),
        estimated_cost_usd: 0,
        resolution_rounds: 0
      },
      resolution_trace: evidenceDocument.resolution_trace || [],
      evidence_schema_version: evidenceDocument.schema_version
    }, payload);
    const gated = applyIdentityResolutionGate(baseResult, {
      maxLength: payload.maxTitleLength || maxFallbackTitleLength,
      providerId: "recognition_worker"
    });

    return {
      result: gated.identity_resolution_status === identityStatuses.ABSTAIN ? null : gated,
      evidenceDocument,
      response,
      gated,
      signedImages
    };
  } catch (error) {
    return {
      result: null,
      evidenceDocument: null,
      signedImages: null,
      error: safeRecognitionError(error)
    };
  }
}

function shouldDeferVectorUntilProviderObservation({
  lazyDecision = {},
  providerOptions = {},
  env = process.env
} = {}) {
  const catalogAssistEnabled = optionFlag(providerOptions, "enable_catalog_assist", false) === true;
  const vectorAssistEnabled = optionFlag(providerOptions, "enable_vector_assist", false) === true;
  if (!catalogAssistEnabled && !vectorAssistEnabled) return false;

  // A prompt-safe candidate is still only a hypothesis until it survives the
  // current provider observation. Re-query/rebind after observation unless the
  // exact-anchor lazy gate has already proved a unique strong identity. This
  // keeps stale pre-provider Top-K results from suppressing convergence.
  if (lazyDecision.skip === true) return false;
  return true;
}

function fieldHasValueForRetrieval(value) {
  if (Array.isArray(value)) return value.some(fieldHasValueForRetrieval);
  if (typeof value === "boolean") return value === true;
  return normalizeStringOrNull(value) !== null;
}

function serialDenominatorForRetrieval(value) {
  const text = normalizeStringOrNull(value);
  if (!text) return null;
  return text.match(/\/\s*0*(\d{1,6})\b/)?.[1] || null;
}

function retrievalAnchorSummary(fields = {}) {
  const normalized = normalizeFields(fields || {});
  const players = Array.isArray(normalized.players)
    ? normalized.players
    : normalized.player
      ? [normalized.player]
      : [];
  const anchors = [];
  if (fieldHasValueForRetrieval(normalized.collector_number || normalized.checklist_code || normalized.card_number)) anchors.push("printed_code");
  if (fieldHasValueForRetrieval(normalized.year)) anchors.push("year");
  if (fieldHasValueForRetrieval(normalized.product || normalized.set || normalized.manufacturer || normalized.brand)) anchors.push("product");
  if (players.some(fieldHasValueForRetrieval) || fieldHasValueForRetrieval(normalized.character)) anchors.push("subject");
  if (fieldHasValueForRetrieval(normalized.expected_serial_denominator || serialDenominatorForRetrieval(normalized.serial_number))) anchors.push("serial_denominator");
  return {
    anchors: [...new Set(anchors)],
    count: [...new Set(anchors)].length,
    has_printed_code: anchors.includes("printed_code")
  };
}

function retrievalFieldsHavePrePromptVectorAnchor(fields = {}) {
  const summary = retrievalAnchorSummary(fields);
  return summary.has_printed_code || summary.count >= 2;
}

function retrievalFieldsFromProviderObservation(result = {}, fallback = {}) {
  return mergeCurrentFieldsForTitleAssist(
    fallback,
    result.fields,
    result.raw_provider_fields,
    result.resolved,
    result.resolved_fields
  );
}

function withoutAutomaticVectorAssist(providerOptions = {}) {
  return {
    ...providerOptions,
    enable_vector_assist: false,
    enable_query_visual_embeddings: false,
    enable_vector_retrieval: false,
    enable_stored_visual_features: false,
    vector_retrieval_mode: "off"
  };
}

function forceRetrievalApplicationResolutionEnabled(providerOptions = {}) {
  return optionFlag(providerOptions, "force_retrieval_application_resolution", false);
}

function retrievalApplicationAblationArm(providerOptions = {}) {
  if (String(providerOptions.evaluation_profile || "").trim() !== "retrieval_application_ablation_v1") {
    return "";
  }
  return forceRetrievalApplicationResolutionEnabled(providerOptions) ? "ON" : "OFF";
}

function shouldReturnAssistShadowSingleModelDraft({
  assistShadowOnly = false,
  forceRetrievalApplicationResolution = false
} = {}) {
  return assistShadowOnly === true && forceRetrievalApplicationResolution !== true;
}

function strategyReplayOutputSnapshot(result = null) {
  if (!result || typeof result !== "object") return null;
  return {
    final_title: String(result.final_title || result.title || "").replace(/\s+/g, " ").trim(),
    resolved_fields: result.resolved_fields || result.resolved || result.fields || {},
    route: result.route || null,
    title_render_source: result.title_render_source || null
  };
}

export function effectiveAssistShadowOnly({
  assistEnabled = false,
  catalogContext = null,
  vectorContext = null
} = {}) {
  if (assistEnabled !== true) return false;
  const promptCandidateCount = (context = null) => {
    if (!context || typeof context !== "object") return 0;
    const eligibility = context.catalog_assist_eligibility
      || context.vector_assist_eligibility
      || context.assistPacket?.vector_retrieval?.assist_filter
      || null;
    if (eligibility && typeof eligibility === "object") {
      const ids = Array.isArray(eligibility.prompt_candidate_ids)
        ? eligibility.prompt_candidate_ids.filter(Boolean)
        : [];
      return Math.max(ids.length, Number(eligibility.prompt_candidate_count || 0));
    }
    // Backward compatibility for older context producers that predate the
    // explicit candidate-count contract. New contexts must use eligibility.
    return context.promptPacket === true ? 1 : 0;
  };
  return promptCandidateCount(catalogContext) + promptCandidateCount(vectorContext) === 0;
}

export function preingestionOcrScopeFromPayload(payload = {}) {
  return {
    tenantId: String(payload.tenant_id || payload.tenantId || "").trim(),
    assetId: String(payload.asset_id || payload.assetId || "").trim(),
    bundleId: String(payload.preingestion_bundle_id || payload.preingestionBundleId || "").trim()
  };
}

async function createOpenAiTitle(payload, selection, {
  recognitionEvidenceDocument: initialRecognitionEvidenceDocument = null,
  recognitionPreflightPromise = null,
  signedImages: reusableSignedImages = null,
  timingContext = null,
  visualFeatures = {},
  requestContext = null
} = {}) {
  let recognitionEvidenceDocument = initialRecognitionEvidenceDocument;
  let recognitionPreflightError = null;
  const preingestionOcrScope = preingestionOcrScopeFromPayload(payload);
  const preingestionBundleId = preingestionOcrScope.bundleId;
  let latestPreingestionOcrState = null;
  const preingestionOcrRendezvousPromise = preingestionBundleId
    ? waitForPreingestionOcrEvidence({
      ...preingestionOcrScope,
      bundleId: preingestionBundleId,
      // OCR starts during pre-ingestion and runs in parallel with the provider.
      // Do not hold a provider capacity slot for a full extra 30 seconds when
      // no verified hard-text evidence has arrived; late patches remain stored
      // for the next request and the title safely omits an unverified numerator.
      timeoutMs: positiveIntegerFromEnv(process.env, "PREINGESTION_OCR_RENDEZVOUS_TIMEOUT_MS", 22_000),
      pollMs: positiveIntegerFromEnv(process.env, "PREINGESTION_OCR_RENDEZVOUS_POLL_MS", 400),
      env: process.env,
      fetchImpl: globalThis.fetch,
      triggerSweep: true,
      onState: (state) => {
        latestPreingestionOcrState = state;
      }
    }).catch((error) => ({
      status: "ERROR",
      terminal: false,
      job_count: 0,
      patch_count: 0,
      serial_patch_count: 0,
      reason: String(error?.message || "preingestion_ocr_rendezvous_failed").slice(0, 180)
    }))
    : Promise.resolve({ status: "NOT_REQUESTED", terminal: false, job_count: 0, patch_count: 0, serial_patch_count: 0 });
  const providerOptions = providerOptionsFromPayload(payload);
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const openSetContext = {
    providerOptions,
    mode: payload.provider_eval_mode || payload.eval_mode || payload.mode || "",
    sourceFeedbackId: payload.source_feedback_id || payload.sourceFeedbackId || null,
    maxLength: maxTitleLength
  };
  const resolvedForRetrieval = resolvedForRetrievalFromPayload(payload, providerOptions, recognitionEvidenceDocument);
  const catalogStageRequestId = payload.request_id
    || payload.requestId
    || payload.asset_id
    || payload.assetId
    || preingestionBundleId
    || crypto.randomUUID();
  const signedImagesPromise = reusableSignedImages && typeof reusableSignedImages.then === "function"
    ? reusableSignedImages
    : Array.isArray(reusableSignedImages) && reusableSignedImages.length
      ? Promise.resolve(reusableSignedImages)
      : imagesWithSignedReadUrls(
      payload.images || [],
      timingContext,
      payload.tenant_id || payload.tenantId || ""
      );
  const catalogContextPromise = prepareCatalogCandidateContext({
    resolvedForRetrieval,
    providerOptions,
    excludeSourceFeedbackIds: [payload.source_feedback_id || payload.sourceFeedbackId].filter(Boolean),
    timingContext,
    stageRequestId: catalogStageRequestId,
    stagePhase: "pre_provider"
  });

  let signedImages;
  try {
    signedImages = await signedImagesPromise;
  } catch (error) {
    await catalogContextPromise.catch(() => null);
    throw error;
  }

  const baseInitialPayload = primaryPayloadForProvider({
    ...payload,
    images: signedImages
  });
  const earlyCatalog = await waitForPromiseWithin(
    catalogContextPromise,
    catalogFastLaneBudgetMs(process.env, providerOptions)
  );
  let catalogContext = earlyCatalog.settled ? earlyCatalog.value : null;
  const lazyDecision = catalogContext
    ? shouldSkipVectorForCatalogContext({
      catalogContext,
      resolvedForRetrieval,
      providerOptions,
      env: process.env
    })
    : { skip: false, reason: "catalog_fast_lane_budget_elapsed" };
  if (catalogContext) {
    catalogContext = {
      ...catalogContext,
      exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
        catalogContext,
        resolvedForRetrieval,
        providerOptions,
        env: process.env,
        lazyDecision
      })
    };
  }
  const deferVectorUntilProviderObservation = shouldDeferVectorUntilProviderObservation({
    catalogContext,
    lazyDecision,
    resolvedForRetrieval,
    providerOptions,
    env: process.env
  });
  let vectorWarmContextSnapshot = null;
  let vectorWarmWorkerSnapshot = null;
  const vectorContextWarmupPromise = deferVectorUntilProviderObservation && !lazyDecision.skip
    ? timeAsync(
      timingContext,
      "vector_retrieval_overlap_ms",
      () => prepareVectorCandidateContext({
        initialPayload: baseInitialPayload,
        signedImages,
        visualFeatures,
        resolvedForRetrieval,
        providerOptions: vectorEmbeddingWarmupOptions(providerOptions, process.env),
        timingContext,
        onWorkerResult: (workerResult) => {
          vectorWarmWorkerSnapshot = workerResult;
        }
      })
    ).then((context) => {
      vectorWarmContextSnapshot = context;
      vectorWarmWorkerSnapshot = context?.worker || vectorWarmWorkerSnapshot;
      return context;
    }).catch((error) => {
      const config = vectorRetrievalConfig(process.env, providerOptions);
      const packet = vectorRetrievalUnavailablePacket(
        "VECTOR_RETRIEVAL_ERROR",
        "vector_retrieval_overlap_error"
      );
      const context = {
        mode: config.mode,
        visualFeatures,
        packet,
        assistPacket: emptyVectorCandidatePacket("vector_retrieval_overlap_error"),
        retrieval: null,
        promptPacket: false,
        worker: vectorWarmWorkerSnapshot || {
          status: "VECTOR_RETRIEVAL_ERROR",
          reason: String(error?.code || "vector_retrieval_overlap_error").slice(0, 120),
          features: []
        }
      };
      vectorWarmContextSnapshot = context;
      return context;
    })
    : null;
  const vectorContextPromise = lazyDecision.skip
    ? Promise.resolve(skippedVectorCandidateContext({
      reason: "vector_lazy_strong_catalog_anchor",
      visualFeatures,
      env: process.env,
      providerOptions,
      skip: lazyDecision
    }))
    : deferVectorUntilProviderObservation
      ? null
      : prepareVectorCandidateContext({
      initialPayload: baseInitialPayload,
      signedImages,
      visualFeatures,
      resolvedForRetrieval,
      providerOptions,
      timingContext
    });
  let vectorContext = null;
  if (deferVectorUntilProviderObservation) {
    catalogContext = catalogContext || null;
  } else {
    const [finalCatalogContext, earlyVectorContext] = await Promise.all([
      catalogContext ? Promise.resolve(catalogContext) : catalogContextPromise,
      vectorContextPromise
    ]);
    catalogContext = finalCatalogContext;
    vectorContext = earlyVectorContext;
  }
  const strongCatalogCandidate = catalogStrongCandidateForVectorLazy(catalogContext || {}, resolvedForRetrieval);
  const promptCandidatePacket = strongCatalogCandidate && catalogContext.promptPacket
    ? catalogContext.assistPacket
    : vectorContext?.promptPacket
      ? vectorContext.assistPacket
      : catalogContext?.promptPacket
        ? catalogContext.assistPacket
        : null;
  const assistEnabled = optionFlag(providerOptions, "enable_catalog_assist", false) === true
    || optionFlag(providerOptions, "enable_vector_assist", false) === true;
  const assistShadowOnly = assistEnabled && !promptCandidatePacket;
  const initialPayload = {
    ...baseInitialPayload
  };
  if (promptCandidatePacket) initialPayload.vectorCandidatePacket = promptCandidatePacket;
  const prompt = await buildInitialProviderPrompt(initialPayload, maxTitleLength);
  const ultraFastL2 = ultraFastL2Enabled(initialPayload, process.env);
  const providerPromptMode = ultraFastL2
    ? "v4_ultra_fast_l2"
    : compactL2PromptEnabled(initialPayload, process.env)
      ? "v4_compact_l2"
      : fastInitialProviderPromptEnabled(initialPayload, process.env)
        ? "fast_initial"
        : "full_listing";
  const providerImageDetail = ultraFastL2 ? ultraFastImageDetail(providerOptions) : "high";
  const ultraSparseTransport = ultraFastL2 && optionFlag(
    providerOptions,
    "v4_ultra_sparse_transport",
    envFlag(process.env, "ENABLE_V4_ULTRA_SPARSE_TRANSPORT", false)
  );
  const providerResponseProfile = ultraSparseTransport
    ? "compact_sparse_v2"
    : ["v4_compact_l2", "v4_ultra_fast_l2"].includes(providerPromptMode)
      ? "compact_sparse_v1"
      : "standard";
  const providerResult = await runTimedProviderCall(visionProviderIds.OPENAI_LEGACY, timingContext, () => analyzeCardEvidenceWithOpenAiEmergency({
    images: initialPayload.images,
    prompt,
    shardKey: initialPayload.recognition_session_id || initialPayload.asset_id || initialPayload.assetId || "",
    preferredKeySlot: initialPayload.openai_preferred_key_slot || initialPayload.provider_key_slot_hint || null,
    modelOverride: providerModelOverrideFromOptions(providerOptions),
    responseProfile: providerResponseProfile,
    includeVectorDecision: Boolean(promptCandidatePacket),
    imageDetail: providerImageDetail,
    textVerbosity: ultraFastL2 ? ultraFastTextVerbosity(providerOptions) : null,
    serviceTier: ultraFastL2 ? ultraFastServiceTier(providerOptions) : null,
    requestContext: openAiRequestContextFromPayload(initialPayload, {
      providerCallPurpose: "full_l2",
      titleStage: providerOptions.v4_title_stage_target || initialPayload.v4_title_stage_target || ""
    })
  }));
  let providerResultWithEvidence = timeSync(timingContext, "renderer_ms", () => ({
    ...withProviderMetadata(
      withEvidenceCompatibility(
        withRequestMetadata(normalizeAiResult(providerResult.parsed, maxTitleLength, visionProviderIds.OPENAI_LEGACY), initialPayload),
        providerResult.parsed,
        initialPayload
      ),
      providerResult,
      selection
    ),
    provider_prompt_mode: providerPromptMode,
    provider_prompt_chars: prompt.length,
    provider_input_image_count: Array.isArray(initialPayload.images) ? initialPayload.images.length : 0,
    provider_image_detail: providerResult.image_detail || "high",
    provider_text_verbosity: providerResult.text_verbosity || null,
    provider_requested_service_tier: providerResult.requested_service_tier || null,
    provider_service_tier: providerResult.service_tier || null
  }));
  // The provider lease protects only the scarce GPT call. Recognition-worker
  // evidence still joins before the title is finalized, but must not keep a
  // provider slot idle after that call has already completed.
  let providerCapacityStageHandoffPromise = null;
  let providerCapacityHandoffOverlapStartedAt = null;
  if (canOverlapProviderCapacityHandoffAfterInitialCall({ assistShadowOnly })
    && providerDoneCapacityHandoffEnabled(initialPayload, process.env)) {
    providerCapacityHandoffOverlapStartedAt = nowMs();
    addTiming(timingContext, "provider_capacity_handoff_overlap_started_count", 1);
    providerCapacityStageHandoffPromise = handoffProviderCapacityAfterStage(
      initialPayload,
      requestContext,
      timingContext
    );
  }
  if (recognitionPreflightPromise) {
    const recognitionJoinStartedAt = nowMs();
    const recognitionPreflight = await recognitionPreflightPromise;
    addTiming(timingContext, "recognition_preflight_join_wait_ms", nowMs() - recognitionJoinStartedAt);
    recognitionEvidenceDocument = recognitionPreflight?.evidenceDocument || recognitionEvidenceDocument;
    recognitionPreflightError = recognitionPreflight?.error || null;
  }
  providerResultWithEvidence = withRecognitionEvidence(
    providerResultWithEvidence,
    recognitionEvidenceDocument,
    initialPayload
  );
  if (recognitionPreflightError) {
    providerResultWithEvidence = {
      ...providerResultWithEvidence,
      recognition_preflight_error: recognitionPreflightError
    };
  }
  let preingestionRetrievalRefresh = null;
  let preingestionRetrievalAnchorFields = [];
  let providerResolvedForRetrieval = null;
  if (deferVectorUntilProviderObservation) {
    if (preingestionBundleId) {
      preingestionRetrievalRefresh = await refreshPreIngestionEvidencePatches(initialPayload, {
        timingContext,
        fetchImpl: globalThis.fetch,
        timingKey: "preingestion_retrieval_anchor_refresh_ms"
      }).catch((error) => ({
        refreshed: false,
        reason: String(error?.message || "preingestion_retrieval_refresh_failed").slice(0, 160),
        patch_count: Array.isArray(initialPayload.preingestion_evidence_patches)
          ? initialPayload.preingestion_evidence_patches.length
          : 0,
        added_patch_count: 0
      }));
    }
    const confirmedRetrievalFields = confirmedPreingestionRetrievalFields(initialPayload);
    preingestionRetrievalAnchorFields = Object.keys(confirmedRetrievalFields);
    providerResolvedForRetrieval = mergeCurrentFieldsForTitleAssist(
      retrievalFieldsFromProviderObservation(providerResultWithEvidence, resolvedForRetrieval),
      confirmedRetrievalFields
    );
    const lateCatalogPromise = prepareCatalogCandidateContext({
      resolvedForRetrieval: providerResolvedForRetrieval,
      providerOptions,
      excludeSourceFeedbackIds: [payload.source_feedback_id || payload.sourceFeedbackId].filter(Boolean),
      timingContext,
      stageRequestId: catalogStageRequestId,
      stagePhase: "post_provider"
    }).catch(() => null);
    const startLateVectorLookup = async () => {
      try {
        const warmedContext = vectorContextWarmupPromise
          ? await vectorContextWarmupPromise
          : null;
        if (warmedContext) {
          return rebindVectorCandidateContextToFields(
            warmedContext,
            providerResolvedForRetrieval,
            { env: process.env, providerOptions }
          );
        }
        const context = await prepareVectorCandidateContext({
          initialPayload: baseInitialPayload,
          signedImages,
          visualFeatures,
          resolvedForRetrieval: providerResolvedForRetrieval,
          providerOptions,
          timingContext
        });
        return context ? { ...context, retrieval_phase: "provider_observation_vector_lookup" } : null;
      } catch (error) {
        const config = vectorRetrievalConfig(process.env, providerOptions);
        const packet = vectorRetrievalUnavailablePacket(
          "VECTOR_RETRIEVAL_ERROR",
          "post_observation_vector_lookup_failed"
        );
        return {
          mode: config.mode,
          visualFeatures,
          packet,
          assistPacket: emptyVectorCandidatePacket("post_observation_vector_lookup_failed"),
          retrieval: null,
          promptPacket: false,
          retrieval_phase: "provider_observation_vector_lookup",
          worker: {
            status: "VECTOR_RETRIEVAL_ERROR",
            reason: String(error?.code || "post_observation_vector_lookup_failed").slice(0, 120),
            features: []
          }
        };
      }
    };
    const hedgeEnabled = optionFlag(
      providerOptions,
      "enable_post_observation_retrieval_hedge",
      envFlag(process.env, "ENABLE_POST_OBSERVATION_RETRIEVAL_HEDGE", true)
    ) === true;
    const deadlineEnabled = postObservationRetrievalDeadlineEnabled(process.env, providerOptions);
    const baseCriticalPathBudgetMs = postObservationRetrievalCriticalPathBudgetMs(process.env, providerOptions);
    const providerRetrievalAnchors = retrievalAnchorSummary(providerResolvedForRetrieval);
    const exactAnchorCatalogBudgetMs = providerRetrievalAnchors.has_printed_code
      ? postObservationExactAnchorCatalogBudgetMs(process.env, providerOptions)
      : 0;
    const hasStructuredIdentityAnchor = providerRetrievalAnchors.anchors.includes("subject")
      && providerRetrievalAnchors.anchors.includes("product");
    const structuredAnchorCatalogBudgetMs = hasStructuredIdentityAnchor
      ? postObservationStructuredAnchorCatalogBudgetMs(process.env, providerOptions)
      : 0;
    const criticalPathBudgetMs = Math.max(
      baseCriticalPathBudgetMs,
      exactAnchorCatalogBudgetMs,
      structuredAnchorCatalogBudgetMs
    );
    if (exactAnchorCatalogBudgetMs > baseCriticalPathBudgetMs) {
      addTiming(timingContext, "post_observation_exact_anchor_budget_used_count", 1);
      addTiming(timingContext, "post_observation_exact_anchor_budget_ms", exactAnchorCatalogBudgetMs);
    }
    if (structuredAnchorCatalogBudgetMs > baseCriticalPathBudgetMs) {
      addTiming(timingContext, "post_observation_structured_anchor_budget_used_count", 1);
      addTiming(timingContext, "post_observation_structured_anchor_budget_ms", structuredAnchorCatalogBudgetMs);
    }
    const deadlineStartedAt = nowMs();
    const remainingDeadlineMs = () => Math.max(0, criticalPathBudgetMs - (nowMs() - deadlineStartedAt));
    const hedgeWaitStartedAt = nowMs();
    const catalogHeadStartMs = deadlineEnabled
      ? Math.min(postObservationCatalogVectorHedgeMs(process.env, providerOptions), criticalPathBudgetMs)
      : postObservationCatalogVectorHedgeMs(process.env, providerOptions);
    const lateCatalogRace = hedgeEnabled || deadlineEnabled
      ? await waitForPromiseWithin(
        lateCatalogPromise,
        catalogHeadStartMs
      )
      : { settled: true, value: await lateCatalogPromise };
    addTiming(
      timingContext,
      "post_observation_catalog_vector_hedge_wait_ms",
      nowMs() - hedgeWaitStartedAt
    );
    let lateCatalogContext = lateCatalogRace.settled ? lateCatalogRace.value : null;
    let hedgedVectorContext = null;
    let lateVectorPromise = null;
    if (lateCatalogRace.settled) {
      addTiming(timingContext, "post_observation_catalog_settled_within_budget_count", 1);
    }
    if (!lateCatalogRace.settled || !catalogStrongCandidateForVectorLazy(lateCatalogContext || {}, providerResolvedForRetrieval)) {
      lateVectorPromise = startLateVectorLookup();
    }
    if (deadlineEnabled) {
      const retrievalEntries = [];
      if (!lateCatalogRace.settled) {
        retrievalEntries.push({ key: "catalog", promise: lateCatalogPromise });
      }
      if (lateVectorPromise) {
        retrievalEntries.push({ key: "vector", promise: lateVectorPromise });
      }
      let boundedRetrieval = {
        settled: {},
        settled_keys: [],
        pending_keys: retrievalEntries.map((entry) => entry.key),
        pending_promises: retrievalEntries.map((entry) => entry.promise)
      };
      if (retrievalEntries.length && remainingDeadlineMs() > 0) {
        boundedRetrieval = await timeAsync(
          timingContext,
          "post_observation_catalog_vector_overlap_ms",
          () => collectPromiseEntriesWithinBudget(retrievalEntries, remainingDeadlineMs())
        );
      }
      if (boundedRetrieval.settled_keys.includes("catalog")) {
        lateCatalogContext = boundedRetrieval.settled.catalog;
        addTiming(timingContext, "post_observation_catalog_settled_within_budget_count", 1);
      }
      if (boundedRetrieval.settled_keys.includes("vector")) {
        hedgedVectorContext = boundedRetrieval.settled.vector;
        addTiming(timingContext, "post_observation_vector_settled_within_budget_count", 1);
      }
      const pendingPromises = boundedRetrieval.pending_promises || [];
      if (pendingPromises.length) {
        addTiming(timingContext, "post_observation_retrieval_deferred_count", pendingPromises.length);
        scheduleBackgroundCompletion(Promise.allSettled(pendingPromises));
      }
      addTiming(
        timingContext,
        "post_observation_retrieval_deadline_ms",
        Math.min(nowMs() - deadlineStartedAt, criticalPathBudgetMs)
      );
    } else if (!lateCatalogRace.settled) {
      [lateCatalogContext, hedgedVectorContext] = await timeAsync(
        timingContext,
        "post_observation_catalog_vector_overlap_ms",
        () => Promise.all([lateCatalogPromise, lateVectorPromise || startLateVectorLookup()])
      );
    } else if (lateVectorPromise) {
      hedgedVectorContext = await lateVectorPromise;
    }
    const lateStrongCatalogCandidate = lateCatalogContext
      ? catalogStrongCandidateForVectorLazy(lateCatalogContext, providerResolvedForRetrieval)
      : null;
    if (lateStrongCatalogCandidate) {
      const lateLazyDecision = {
        skip: true,
        reason: "strong_catalog_anchor",
        candidate_id: lateStrongCatalogCandidate.candidate_id || lateStrongCatalogCandidate.candidate_identity_id || "",
        candidate_identity_id: lateStrongCatalogCandidate.candidate_identity_id || ""
      };
      catalogContext = {
        ...lateCatalogContext,
        retrieval_phase: "provider_observation_catalog_lookup",
        promptPacket: false,
        catalog_exact_anchor_after_provider_observation: true,
        catalog_anchor_plan: catalogAnchorPlanFromFields(providerResolvedForRetrieval, {
          phase: "provider_observation_catalog_lookup",
          eligibility: lateCatalogContext.catalog_assist_eligibility,
          retrieval: lateCatalogContext.retrieval
        }),
        exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
          catalogContext: lateCatalogContext,
          resolvedForRetrieval: providerResolvedForRetrieval,
          providerOptions,
          env: process.env,
          lazyDecision: lateLazyDecision
        })
      };
      vectorContext = skippedVectorCandidateContext({
        reason: "vector_lazy_provider_catalog_anchor",
        visualFeatures: vectorWarmContextSnapshot?.visualFeatures || visualFeatures,
        worker: vectorWarmContextSnapshot?.worker || vectorWarmWorkerSnapshot,
        env: process.env,
        providerOptions,
        skip: lateLazyDecision
      });
      if (hedgedVectorContext) {
        vectorContext = {
          ...vectorContext,
          vector_lazy_skip: {
            ...vectorContext.vector_lazy_skip,
            hedge_started: true,
            hedge_result_discarded_for_strong_catalog_anchor: true
          }
        };
      }
    } else {
      catalogContext = lateCatalogContext
        ? {
          ...lateCatalogContext,
          retrieval_phase: "provider_observation_catalog_lookup"
        }
        : catalogContext || (deadlineEnabled
          ? deferredRetrievalCandidateContext({ kind: "catalog" })
          : await catalogContextPromise.catch(() => null));
      vectorContext = hedgedVectorContext || (deadlineEnabled
        ? deferredRetrievalCandidateContext({
          kind: "vector",
          visualFeatures: vectorWarmContextSnapshot?.visualFeatures || visualFeatures,
          worker: vectorWarmContextSnapshot?.worker || vectorWarmWorkerSnapshot,
          env: process.env,
          providerOptions
        })
        : await (lateVectorPromise || startLateVectorLookup()));
    }
  }
  const preProviderCatalogRace = await waitForPromiseWithin(catalogContextPromise, 250);
  if (!preProviderCatalogRace.settled) {
    addTiming(timingContext, "catalog_pre_provider_merge_deferred_count", 1);
    scheduleBackgroundCompletion(catalogContextPromise);
  }
  catalogContext = mergeCatalogCandidateContexts(
    preProviderCatalogRace.settled ? preProviderCatalogRace.value : null,
    catalogContext
  );
  if (!catalogContext) catalogContext = await catalogContextPromise.catch(() => null);
  if (!providerResolvedForRetrieval) {
    providerResolvedForRetrieval = mergeCurrentFieldsForTitleAssist(
      retrievalFieldsFromProviderObservation(providerResultWithEvidence, resolvedForRetrieval),
      confirmedPreingestionRetrievalFields(initialPayload)
    );
  }
  catalogContext = rebindCatalogCandidateContextToFields(
    catalogContext,
    providerResolvedForRetrieval
  );
  if (catalogContext && !catalogContext.exact_anchor_fast_lane_shadow) {
    catalogContext = {
      ...catalogContext,
      exact_anchor_fast_lane_shadow: buildExactAnchorFastLaneShadow({
        catalogContext,
        resolvedForRetrieval: providerResolvedForRetrieval,
        providerOptions,
        env: process.env
      })
    };
  }
  if (!vectorContext) {
    vectorContext = await prepareVectorCandidateContext({
      initialPayload: baseInitialPayload,
      signedImages,
      visualFeatures,
      resolvedForRetrieval,
      providerOptions,
      timingContext
    });
  }
  vectorContext = {
    ...vectorContext,
    ...vectorSelfExclusionDiagnostics(baseInitialPayload, {
      queryAttempted: vectorContext?.self_exclusion_query_attempted === true
        || Boolean(vectorContext?.retrieval)
    })
  };
  const rendezvousWaitStartedAt = nowMs();
  const currentProviderFields = mergeCurrentFieldsForTitleAssist(
    providerResultWithEvidence.fields,
    providerResultWithEvidence.raw_provider_fields,
    providerResultWithEvidence.resolved,
    providerResultWithEvidence.resolved_fields
  );
  const slabLikely = captureQualityLooksLikeSlab(
    providerResultWithEvidence.capture_quality || captureQualityForPayload(payload),
    payload.images || []
  );
  const gradeOcrRescue = gradeOcrRescueDecision({
    currentFields: currentProviderFields,
    latestOcrState: latestPreingestionOcrState,
    slabLikely
  });
  const configuredOcrPostProviderWaitMs = preingestionOcrPostProviderWaitMs(process.env, providerOptions);
  const criticalOcrWait = criticalOcrRendezvousDecision({
    currentFields: currentProviderFields,
    unresolved: providerResultWithEvidence.unresolved || providerResultWithEvidence.unresolved_fields || [],
    latestOcrState: latestPreingestionOcrState,
    slabLikely,
    configuredWaitMs: configuredOcrPostProviderWaitMs,
    criticalWaitMs: Math.max(
      preingestionOcrCriticalFieldWaitMs(process.env, providerOptions),
      gradeOcrRescue.needed ? preingestionOcrGradeRescueWaitMs(process.env, providerOptions) : 0
    ),
    serialWaitMs: preingestionOcrSerialWaitMs(process.env, providerOptions)
  });
  const ocrPostProviderWaitMs = criticalOcrWait.wait_budget_ms;
  if (gradeOcrRescue.needed) {
    addTiming(timingContext, "preingestion_ocr_grade_rescue_count", 1);
  }
  if (criticalOcrWait.target_fields.length) {
    addTiming(timingContext, "preingestion_ocr_targeted_wait_count", 1);
    for (const field of criticalOcrWait.target_fields) {
      addTiming(timingContext, `preingestion_ocr_targeted_${field}_wait_count`, 1);
    }
  }
  const targetedOcrRendezvousPromise = criticalOcrWait.target_fields.length && preingestionBundleId
    ? waitForPreingestionOcrEvidence({
      ...preingestionOcrScope,
      bundleId: preingestionBundleId,
      timeoutMs: Math.max(500, ocrPostProviderWaitMs),
      pollMs: positiveIntegerFromEnv(process.env, "PREINGESTION_OCR_RENDEZVOUS_POLL_MS", 400),
      targetFields: criticalOcrWait.target_fields,
      env: process.env,
      fetchImpl: globalThis.fetch,
      // The first pre-ingestion wave may have spent this asset's single OCR
      // slot on serial/card-code work. Once provider evidence proves a slab
      // grade is missing, start that exact queued verifier instead of polling
      // an idle grade job until the rescue budget expires.
      triggerSweep: true,
      onState: (state) => {
        latestPreingestionOcrState = state;
      }
    }).catch((error) => ({
      status: "ERROR",
      terminal: false,
      target_fields: criticalOcrWait.target_fields,
      reason: String(error?.message || "targeted_preingestion_ocr_rendezvous_failed").slice(0, 180)
    }))
    : preingestionOcrRendezvousPromise;
  const boundedOcrRendezvous = await waitForPromiseWithin(
    targetedOcrRendezvousPromise,
    ocrPostProviderWaitMs > 0 ? ocrPostProviderWaitMs + 250 : 0
  );
  const preingestionOcrRendezvous = boundedOcrRendezvous.settled
    ? boundedOcrRendezvous.value
    : deferredPreingestionOcrSnapshot(initialPayload, latestPreingestionOcrState);
  if (targetedOcrRendezvousPromise !== preingestionOcrRendezvousPromise) {
    scheduleBackgroundCompletion(preingestionOcrRendezvousPromise);
  }
  if (!boundedOcrRendezvous.settled) {
    addTiming(timingContext, "preingestion_ocr_deferred_after_provider_count", 1);
    scheduleBackgroundCompletion(targetedOcrRendezvousPromise);
  }
  const rendezvousWaitMs = nowMs() - rendezvousWaitStartedAt;
  if (preingestionOcrRendezvous && typeof preingestionOcrRendezvous === "object") {
    preingestionOcrRendezvous.post_provider_wait_ms = rendezvousWaitMs;
    preingestionOcrRendezvous.grade_rescue = {
      ...gradeOcrRescue,
      wait_budget_ms: ocrPostProviderWaitMs
    };
    preingestionOcrRendezvous.critical_field_wait = criticalOcrWait;
  }
  if (preingestionOcrRendezvous?.status === "DEFERRED_AFTER_PROVIDER") {
    preingestionOcrRendezvous.waited_ms = rendezvousWaitMs;
  }
  addTiming(timingContext, "preingestion_ocr_rendezvous_wait_ms", rendezvousWaitMs);
  addTiming(timingContext, "preingestion_ocr_post_provider_budget_ms", ocrPostProviderWaitMs);
  recordNodeSpan(timingContext, {
    key: "preingestion_ocr_rendezvous_wait_ms",
    startedAtMs: rendezvousWaitStartedAt,
    durationMs: rendezvousWaitMs,
    status: ["TIMEOUT", "DEFERRED_AFTER_PROVIDER"].includes(preingestionOcrRendezvous?.status)
      ? "PARTIAL"
      : "COMPLETED",
    inputCount: preingestionOcrRendezvous?.job_count ?? null,
    outputCount: preingestionOcrRendezvous?.patch_count ?? null,
    metrics: {
      state_reads: preingestionOcrRendezvous?.state_reads ?? null,
      critical_fields_settled: preingestionOcrRendezvous?.critical_fields_settled === true,
      target_fields: criticalOcrWait.target_fields,
      target_fields_settled: preingestionOcrRendezvous?.target_fields_settled === true,
      wait_reasons: criticalOcrWait.reasons,
      ocr_signal_fields: criticalOcrWait.ocr_signal_fields,
      ocr_signal_conflicting_fields: criticalOcrWait.ocr_signal_conflicting_fields
    }
  });
  const rendezvousEvidencePatches = Array.isArray(preingestionOcrRendezvous?.evidence_patches)
    ? preingestionOcrRendezvous.evidence_patches
    : null;
  const evidenceRefreshDecision = preingestionEvidenceRefreshDecision(
    initialPayload,
    preingestionOcrRendezvous
  );
  let preingestionEvidenceRefresh;
  if (ultraFastL2 && rendezvousEvidencePatches) {
    preingestionEvidenceRefresh = timeSync(
      timingContext,
      "preingestion_evidence_refresh_ms",
      () => applyPreIngestionEvidencePatchesToPayload(initialPayload, rendezvousEvidencePatches, {
        source: "ocr_rendezvous_snapshot"
      })
    );
  } else if (evidenceRefreshDecision.skip) {
    preingestionEvidenceRefresh = {
      refreshed: false,
      reason: evidenceRefreshDecision.reason,
      patch_count: evidenceRefreshDecision.loaded_patch_count,
      raw_patch_count: evidenceRefreshDecision.loaded_patch_count,
      added_patch_count: 0
    };
  } else {
    preingestionEvidenceRefresh = await refreshPreIngestionEvidencePatches(initialPayload, {
      timingContext,
      fetchImpl: globalThis.fetch
    }).catch((error) => ({
      refreshed: false,
      reason: String(error?.message || "preingestion_evidence_refresh_failed").slice(0, 160),
      patch_count: evidenceRefreshDecision.loaded_patch_count,
      added_patch_count: 0
    }));
  }
  initialPayload.serial_numerator_verified = serialNumeratorVerificationFromPreingestion(
    initialPayload,
    preingestionOcrRendezvous
  );
  const mergedResult = withVisualFeatures(
    withVectorCandidateContext(
      withCatalogCandidateContext(
        providerResultWithEvidence,
        catalogContext
      ),
      vectorContext
    ),
    vectorContext.visualFeatures
  );
  const { evidence_patches: _rendezvousEvidencePatches, ...preingestionOcrRendezvousDiagnostics } = preingestionOcrRendezvous || {};
  mergedResult.preingestion_ocr_rendezvous = preingestionOcrRendezvousDiagnostics;
  mergedResult.preingestion_evidence_refresh = preingestionEvidenceRefresh;
  mergedResult.preingestion_retrieval_refresh = preingestionRetrievalRefresh;
  mergedResult.preingestion_retrieval_anchor_fields = preingestionRetrievalAnchorFields;
  mergedResult.serial_numerator_verified = initialPayload.serial_numerator_verified;
  let providerTerminalPathDecision = null;
  let assistShadowReplayDraft = null;
  const finalizeProviderResult = async (result, terminalPath = "unknown") => {
    const handoffJoinStartedAt = nowMs();
    const handoff = await (providerCapacityStageHandoffPromise || handoffProviderCapacityAfterStage(
      initialPayload,
      requestContext,
      timingContext
    ));
    const handoffJoinWaitMs = nowMs() - handoffJoinStartedAt;
    if (providerCapacityStageHandoffPromise) {
      addTiming(timingContext, "provider_capacity_handoff_join_wait_ms", handoffJoinWaitMs);
      addTiming(
        timingContext,
        "provider_capacity_handoff_overlap_window_ms",
        Math.max(0, nowMs() - providerCapacityHandoffOverlapStartedAt)
      );
    }
    const finalizedBeforeTerminalRecognition = withVerifiedPreingestionSlabParallel(
        withVerifiedPreingestionPrintRun(
          withOpenSetReadiness(result, { ...openSetContext, catalogContext, vectorContext }),
          initialPayload
        ),
        initialPayload
      );
    // Candidate control, identity gating, assist-shadow, and open-set guards
    // may all rebuild resolved fields after the first recognition merge. The
    // current-image worker owns hard geometry and repeated back-copyright
    // evidence, so reassert it exactly once at the terminal boundary before
    // the final deterministic render.
    const finalizedWithTerminalRecognition = finalizeTerminalRecognitionEvidence(
      finalizedBeforeTerminalRecognition,
      recognitionEvidenceDocument,
      initialPayload
    );
    const finalizedWithoutReplayTrace = {
      ...finalizedWithTerminalRecognition,
      // Difficult paths keep the lease until every focused verifier finishes.
      // Provider-terminal assist-shadow paths start this handoff immediately
      // after the first response and overlap it with retrieval/OCR/resolution.
      provider_capacity_stage_handoff: {
        ...handoff,
        overlapped_after_initial_provider: Boolean(providerCapacityStageHandoffPromise),
        overlap_window_ms: providerCapacityHandoffOverlapStartedAt === null
          ? 0
          : Math.max(0, nowMs() - providerCapacityHandoffOverlapStartedAt),
        join_wait_ms: handoffJoinWaitMs
      }
    };
    const finalized = {
      ...finalizedWithoutReplayTrace,
      strategy_replay_trace: {
        schema_version: "provider-terminal-strategy-replay-trace-v1",
        policy_decision: providerTerminalPathDecision,
        decision_input: {
          assist_enabled: assistEnabled,
          initial_prompt_candidate_present: Boolean(promptCandidatePacket),
          assist_shadow_only: assistShadowOnly,
          force_retrieval_application_resolution: forceRetrievalApplicationResolutionEnabled(providerOptions)
        },
        observed_terminal_path: terminalPath,
        observed_output: strategyReplayOutputSnapshot(finalizedWithoutReplayTrace),
        deterministic_counterfactuals: {
          [providerTerminalPathActions.RETURN_ASSIST_SHADOW]: strategyReplayOutputSnapshot(
            assistShadowReplayDraft
              ? applyOpenSetAssistShadowPresentationGuard(assistShadowReplayDraft, initialPayload)
              : null
          )
        }
      }
    };
    const ablationArm = retrievalApplicationAblationArm(providerOptions);
    if (!ablationArm) return finalized;
    return {
      ...finalized,
      retrieval_ablation_execution: {
        contract_id: "retrieval-application-ablation-v1",
        arm: ablationArm,
        terminal_path: terminalPath,
        evidence_completion_enabled: evidenceCompletionEnabled(process.env, providerOptions),
        catalog_enabled: optionFlag(providerOptions, "enable_catalog_assist", false),
        vector_enabled: optionFlag(providerOptions, "enable_vector_assist", false),
        retrieval_application_enabled: retrievalApplicationEnabled(process.env, providerOptions),
        force_retrieval_application_resolution: forceRetrievalApplicationResolutionEnabled(providerOptions),
        retrieval_application_present: finalized.retrieval_application != null,
        retrieval_application_owns_candidate_application: finalized.retrieval_application?.owns_candidate_application === true
      }
    };
  };
  const fastPathResult = timeSync(timingContext, "resolver_ms", () => tryProviderFastPath(
    mergedResult,
    initialPayload,
    visionProviderIds.OPENAI_LEGACY,
    {
      catalogContext,
      vectorContext,
      env: process.env
    }
  ));
  if (fastPathResult) return finalizeProviderResult(fastPathResult, "provider_fast_path");
  const forceRetrievalApplicationResolution = forceRetrievalApplicationResolutionEnabled(providerOptions);
  // Shadow-only must reflect the ACTUAL candidate supply, not just whether a
  // packet was selected: when catalog or vector eligibility carries prompt
  // candidates, assist application runs instead of silently shadowing.
  const finalAssistShadowOnly = effectiveAssistShadowOnly({
    assistEnabled,
    catalogContext,
    vectorContext
  });
  providerTerminalPathDecision = v4ProductionStrategy.provider_terminal.plan_after_provider({
    assistShadowOnly: finalAssistShadowOnly,
    forceRetrievalApplicationResolution
  });
  const assistShadowEvidenceCompletionEnabled = optionFlag(
    providerOptions,
    "enable_assist_shadow_evidence_completion",
    envFlag(process.env, "ENABLE_ASSIST_SHADOW_EVIDENCE_COMPLETION", false)
  );
  if (finalAssistShadowOnly && assistShadowEvidenceCompletionEnabled !== true) {
    assistShadowReplayDraft = singleModelDraftPath(
      mergedResult,
      initialPayload,
      visionProviderIds.OPENAI_LEGACY,
      {
        reason: "assist_shadow_no_prompt_safe_candidates",
        allowWhenEvidenceCompletion: true,
        assistShadowOnly: true,
        catalogContext,
        vectorContext,
        env: process.env
      }
    );
  }
  if (providerTerminalPathDecision.action === providerTerminalPathActions.RETURN_ASSIST_SHADOW) {
    const shadowProviderOptions = vectorContext.vector_lazy_skip?.skipped === true
      ? withoutAutomaticVectorAssist(providerOptions)
      : providerOptions;
    const shadowResult = await withEvidenceCompletionShadow(mergedResult, initialPayload, {
      timingContext,
      visualFeatures: vectorContext.visualFeatures,
      providerOptions: shadowProviderOptions,
      catalogContext,
      vectorContext,
      preparedDraft: assistShadowReplayDraft,
      providerId: visionProviderIds.OPENAI_LEGACY
    });
    return finalizeProviderResult(shadowResult, "assist_shadow");
  }
  const allowAssistShadowSingleModelDraft = shouldReturnAssistShadowSingleModelDraft({
    assistShadowOnly: finalAssistShadowOnly,
    forceRetrievalApplicationResolution
  });
  const singleModelResult = timeSync(timingContext, "resolver_ms", () => singleModelDraftPath(
    mergedResult,
    initialPayload,
    visionProviderIds.OPENAI_LEGACY,
    {
      reason: allowAssistShadowSingleModelDraft
        ? "assist_shadow_no_prompt_safe_candidates"
        : "single_model_fast_path",
      allowWhenEvidenceCompletion: allowAssistShadowSingleModelDraft,
      assistShadowOnly: allowAssistShadowSingleModelDraft,
      catalogContext,
      vectorContext,
      env: process.env
    }
  ));
  if (singleModelResult) return finalizeProviderResult(singleModelResult, "single_model_draft");

  const completedResult = await withEvidenceCompletion(mergedResult, initialPayload, {
    timingContext,
    visualFeatures: vectorContext.visualFeatures,
    providerOptions,
    catalogContext,
    vectorContext
  });
  return finalizeProviderResult(completedResult, "evidence_completion");
}

function requestedProviderFromPayload(payload = {}) {
  return payload.provider || payload.provider_id || payload.visionProvider || payload.vision_provider || "";
}

function explicitEmergencyFromPayload(payload = {}) {
  return payload.explicitEmergency === true || payload.explicit_emergency === true;
}

export const __listingCopilotTitleTestHooks = {
  applyOpenSetAssistShadowPresentationGuard,
  withEvidenceCompatibility,
  buildInitialProviderPrompt,
  applyPreIngestionBundleToPayload,
  confirmedPreingestionRetrievalFields,
  refreshPreIngestionEvidencePatches,
  applySafeRetrievalTitleAssist,
  boundedPayloadImagesFromImages,
  buildExactAnchorFastLaneShadow,
  catalogCandidateContextCacheKey,
  catalogCandidateHasStrongAnchor,
  catalogStrongCandidateForVectorLazy,
  collectPromiseEntriesWithinBudget,
  configuredMaxPayloadImages,
  finalizeDeterministicPresentation,
  finalizeTerminalRecognitionEvidence,
  finalResolvedFieldsForPresentation,
  forceRetrievalApplicationResolutionEnabled,
  effectiveAssistShadowOnly,
  retrievalApplicationAblationArm,
  shouldReturnAssistShadowSingleModelDraft,
  singleModelDraftPath,
  withEvidenceCompletionShadow,
  narrowSurfaceColorFromOpenSetParallel,
  openSetAssistShadowGuardReason,
  preingestionEvidenceRefreshDecision,
  preingestionEvidenceDocumentFromPayload,
  providerOptionsFromPayload,
  canOverlapProviderCapacityHandoffAfterInitialCall,
  providerDoneCapacityHandoffEnabled,
  postObservationRetrievalCriticalPathBudgetMs,
  postObservationRetrievalDeadlineEnabled,
  preingestionOcrPostProviderWaitMs,
  deferredPreingestionOcrSnapshot,
  deferredRetrievalCandidateContext,
  mergeCatalogCandidateContexts,
  rebindCatalogCandidateContextToFields,
  rebindVectorCandidateContextToFields,
  retrievalAnchorSummary,
  retrievalFieldsHavePrePromptVectorAnchor,
  serialNumeratorVerificationFromPreingestion,
  vectorSelfExclusionDiagnostics,
  scaffoldTitleConflictsWithDirectEvidence,
  shouldDeferVectorUntilProviderObservation,
  shouldSkipVectorForCatalogContext,
  withVerifiedPreingestionSlabParallel,
  withVerifiedPreingestionPrintRun,
  withRecognitionEvidence
};

async function createProviderTitle(payload, {
  recognitionEvidenceDocument = null,
  recognitionPreflightPromise = null,
  signedImages = null,
  timingContext = null,
  visualFeatures = {},
  requestContext = null
} = {}) {
  const requestedProvider = requestedProviderFromPayload(payload);
  const explicitEmergency = explicitEmergencyFromPayload(payload);
  const primaryImages = primaryImagesFromImages(payload.images || []);

  if (!requestedProvider && openAiKeyPoolSize(process.env) < 1) {
    return fallbackResult(payload);
  }

  const selection = selectVisionProvider({
    requestedProvider,
    explicitEmergency,
    images: primaryImages
  });

  return createOpenAiTitle(payload, selection, {
    recognitionEvidenceDocument,
    recognitionPreflightPromise,
    signedImages,
    timingContext,
    visualFeatures,
    requestContext
  });
}

// The recognition core owns the production data path. HTTP endpoints are
// transport adapters only; the retired route intentionally exports no
// recognition implementation.
export async function runNativeV4Recognition({
  payload: inputPayload = {},
  requestContext = null
} = {}) {
  const payload = inputPayload && typeof inputPayload === "object" && !Array.isArray(inputPayload)
    ? inputPayload
    : {};
  const timingContext = createTimingContext(payload);

  if ((payload.preingestion_bundle_id || payload.preingestionBundleId) && payload.preingestion_bundle_used !== true) {
    try {
      await applyPreIngestionBundleToPayload(payload, {
        timingContext,
        fetchImpl: globalThis.fetch,
        preserveExistingImages: payload.v4_preserve_canonical_images_on_bundle_load === true
      });
    } catch (error) {
      payload.preingestion_bundle_used = false;
      payload.preingestion_bundle_status = "bundle_load_error";
      payload.preingestion_summary = {
        bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || null,
        status: "bundle_load_error",
        reason: String(error.message || "bundle_load_error").slice(0, 180)
      };
      if (!Array.isArray(payload.images) || payload.images.length === 0) {
        return {
          statusCode: 400,
          body: {
            ok: false,
            code: "preingestion_bundle_load_failed",
            message: payload.preingestion_summary.reason
          }
        };
      }
    }
  }

  const payloadImages = Array.isArray(payload.images) ? payload.images : [];
  const maxPayloadImages = configuredMaxPayloadImages(process.env);
  const imageBatch = boundedPayloadImagesFromImages(payloadImages, { maxImages: maxPayloadImages });
  if (!imageBatch.ok) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        code: "invalid_image_payload",
        message: "系统没有读到可用于识别的卡片原图，请重新上传卡片图片或两图配对图片。"
      }
    };
  }
  payload.images = imageBatch.images;
  if (imageBatch.deferred_image_count > 0) {
    payload.deferred_image_count = imageBatch.deferred_image_count;
    payload.image_batching = {
      mode: "bounded_current_batch",
      deferred_image_count: imageBatch.deferred_image_count
    };
  }

  try {
    const preProviderRescanResult = timeSync(timingContext, "image_quality_check_ms", () => createPreProviderRescanResult(payload));
    const [approvedMemoryResult, identityCacheResult] = await Promise.all([
      timeAsync(timingContext, "approved_memory_lookup_ms", () => createApprovedMemoryTitle(payload)),
      timeAsync(timingContext, "identity_cache_lookup_ms", () => createIdentityCacheTitle(payload))
    ]);

    if (approvedMemoryResult) return buildListingResult(200, approvedMemoryResult, timingContext, payload);
    if (identityCacheResult) return buildListingResult(200, identityCacheResult, timingContext, payload);
    if (preProviderRescanResult) return buildListingResult(200, preProviderRescanResult, timingContext, payload);

    const inFlightCacheKey = await createIdentityInFlightKey(payload);
    const result = await runWithInFlightIdentityRequest({
      cacheKey: inFlightCacheKey,
      run: async () => {
        const providerOptions = providerOptionsFromPayload(payload);
        const sharedSignedImagesPromise = imagesWithSignedReadUrls(
          payload.images || [],
          timingContext,
          payload.tenant_id || payload.tenantId || ""
        );
        const recognitionPreflightPromise = createRecognitionIdentityPreflight(payload, {
          timingContext,
          providerOptions,
          signedImagesPromise: sharedSignedImagesPromise
        });
        const recognitionFastLaneRace = await waitForPromiseWithin(
          recognitionPreflightPromise,
          positiveIntegerFromEnv(process.env, "RECOGNITION_WORKER_FAST_LANE_BUDGET_MS", 50)
        );
        if (recognitionFastLaneRace.settled && recognitionFastLaneRace.value?.result) {
          return timeAsync(timingContext, "identity_cache_write_ms", () => withIdentityCacheWrite(
            recognitionFastLaneRace.value.result,
            payload
          ));
        }
        const storedVisualFeatures = evidenceCompletionEnabled(process.env, providerOptions)
          && storedVisualFeatureLookupEnabled(process.env, providerOptions)
          ? await timeAsync(timingContext, "stored_visual_feature_lookup_ms", () => lookupStoredVisualFeaturesForImages({
            images: payload.images || [],
            env: process.env
          }))
          : {};

        const providerResult = await createProviderTitle(payload, {
          recognitionPreflightPromise,
          signedImages: sharedSignedImagesPromise,
          timingContext,
          visualFeatures: storedVisualFeatures,
          requestContext
        });

        return timeAsync(timingContext, "identity_cache_write_ms", () => withIdentityCacheWrite(providerResult, payload));
      }
    });

    return buildListingResult(200, result, timingContext, payload);
  } catch (error) {
    const message = safeProviderErrorMessage(error);

    return buildListingResult(200, {
      title: "",
      confidence: "FAILED",
      reason: message,
      fields: defaultFields,
      unresolved: ["api"],
      capture_profile_id: payload.captureProfileId || payload.capture_profile_id || defaultCaptureProfileId,
      capture_quality: captureQualityForPayload(payload),
      source: "error",
      provider: error.provider || requestedProviderFromPayload(payload) || null,
      provider_error_code: error.code || "api_error",
      provider_error_type: error.code || "api_error",
      provider_error_details: safeProviderDiagnostics(error.details),
      provider_token_diagnostics: error.details?.token_diagnostics || null,
      provider_initial_token_diagnostics: error.details?.initial_token_diagnostics || null,
      provider_rate_limit_diagnostics: error.details?.rate_limit_diagnostics || null,
      provider_initial_rate_limit_diagnostics: error.details?.initial_rate_limit_diagnostics || null,
      provider_truncation_retry_attempted: error.details?.truncation_retry_attempted === true,
      provider_truncation_retry_attempts: Number(error.details?.truncation_retry_attempts || 0)
    }, timingContext, payload);
  }
}
