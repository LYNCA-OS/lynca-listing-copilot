import { recognitionBenchmarkProfileIds } from "../../evaluation/recognition-benchmark-profile.mjs";
import { providerPayloadToEvidenceDocument } from "../../evidence/provider-evidence-normalizer.mjs";
import { safeProviderErrorMessage } from "../../providers/provider-errors.mjs";
import {
  runTargetedVisualObservation,
  targetedVisualObservationContract
} from "./targeted-visual-observation.mjs";

export const secondLookShadowExecutionContract = Object.freeze({
  owner: "V4_SECOND_LOOK_CARD_CODE_SHADOW_EXECUTOR",
  schema_version: "second-look-card-code-shadow-v1",
  executor_version: "second-look-card-code-shadow-executor-v1",
  production_default: "OFF",
  production_effect: "NONE",
  title_effect: "NONE",
  resolver_effect: "PROPOSAL_ONLY",
  retry_policy: "FORBIDDEN",
  full_provider_fallback: "FORBIDDEN",
  world_knowledge_paid_calls: "FORBIDDEN",
  max_paid_calls: 1,
  timeout_ms: 3_500
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const forbiddenPersistedModelTextKeys = new Set([
  "raw_text",
  "visible_text",
  "observed_text",
  "provider_raw_response",
  "provider_content",
  "model_response_text",
  "text"
]);

function withoutModelNaturalLanguage(value) {
  if (Array.isArray(value)) return value.map(withoutModelNaturalLanguage);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !forbiddenPersistedModelTextKeys.has(key))
    .map(([key, child]) => [key, withoutModelNaturalLanguage(child)]));
}

function persistedEvidenceDocument(document = {}) {
  return deepFreeze(withoutModelNaturalLanguage(object(document)));
}

function benchmarkProfile(providerOptions = {}) {
  return cleanText(
    providerOptions.recognition_benchmark_profile
    || providerOptions.recognitionBenchmarkProfile
  ).toLowerCase();
}

export function secondLookShadowEvaluationProfileEnabled({
  providerOptions = {},
  traceLevel = ""
} = {}) {
  return benchmarkProfile(providerOptions) === recognitionBenchmarkProfileIds.COLD_SECOND_LOOK_SHADOW
    && cleanText(traceLevel || providerOptions.trace_level).toLowerCase() === "evaluation"
    && providerOptions.enable_second_look_shadow_candidate === true
    && providerOptions.enable_targeted_visual_assist_candidate !== true
    && providerOptions.enable_world_knowledge_assist_candidate !== true;
}

function evidenceSources(document = {}) {
  return Object.values(object(document.evidence)).flatMap((field) => [
    ...(Array.isArray(field?.sources) ? field.sources : []),
    ...(Array.isArray(field?.candidates)
      ? field.candidates.flatMap((candidate) => Array.isArray(candidate?.sources) ? candidate.sources : [])
      : [])
  ]);
}

function assertReviewOnlyVisionEvidence(document = {}) {
  for (const field of Object.values(object(document.evidence))) {
    if (field?.status !== "REVIEW") throw new Error("second_look_evidence_must_remain_review_only");
  }
  for (const source of evidenceSources(document)) {
    if (cleanText(source?.source_type || source?.source).toUpperCase() !== "VISION_MODEL") {
      throw new Error("second_look_evidence_source_must_be_vision_model");
    }
    if (source?.direct_observation === true || source?.directly_observed === true) {
      throw new Error("second_look_evidence_cannot_be_direct_truth");
    }
  }
  return document;
}

function ledgerRow({
  startedAt,
  completedAt,
  result = null,
  error = null,
  timeoutMs,
  status = null,
  reasonCode = null,
  callAttempted = null
}) {
  const usage = object(result?.usage || error?.provider_usage);
  const attemptedKnown = typeof callAttempted === "boolean"
    || result !== null
    || typeof error?.provider_call_attempted === "boolean";
  const providerCallAttempted = typeof callAttempted === "boolean"
    ? callAttempted
    : result !== null || error?.provider_call_attempted === true;
  const reportedCalls = finiteOrNull(usage.provider_calls);
  const providerCalls = attemptedKnown
    ? providerCallAttempted
      ? Math.max(1, Math.min(1, Math.trunc(reportedCalls ?? 1)))
      : 0
    : null;
  const resolvedStatus = status || (error ? "FAILED" : "COMPLETED");
  return Object.freeze({
    logical_stage: "TARGETED_SECOND_LOOK_CARD_CODE",
    attempt: 1,
    started_at: startedAt,
    completed_at: completedAt,
    latency_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    timeout_ms: timeoutMs,
    provider_calls: providerCalls,
    input_tokens: finiteOrNull(usage.input_tokens),
    output_tokens: finiteOrNull(usage.output_tokens),
    total_tokens: finiteOrNull(usage.total_tokens),
    image_count: finiteOrNull(usage.image_count),
    model_id: result?.model_id || usage.model_id || null,
    prompt_revision: targetedVisualObservationContract.prompt_version,
    schema_revision: targetedVisualObservationContract.schema_version,
    status: resolvedStatus,
    reason_code: reasonCode || (error ? cleanText(error.code || "TARGETED_SECOND_LOOK_FAILED") : null),
    fallback: false,
    call_attempted: providerCallAttempted,
    accounting_complete: attemptedKnown,
    estimated_cost_usd: finiteOrNull(usage.estimated_cost_usd),
    cost_configured: typeof usage.cost_configured === "boolean" ? usage.cost_configured : null
  });
}

function skippedExecution(plan = null, reasonCode = "SECOND_LOOK_NOT_ELIGIBLE") {
  const timestamp = new Date().toISOString();
  const timeoutMs = Math.max(250, Math.min(
    secondLookShadowExecutionContract.timeout_ms,
    Number(plan?.timeout_ms || secondLookShadowExecutionContract.timeout_ms)
  ));
  return Object.freeze({
    ...secondLookShadowExecutionContract,
    enabled: false,
    execution_status: "SKIPPED",
    reason_code: reasonCode,
    plan,
    provider_call_ledger: Object.freeze([ledgerRow({
      startedAt: timestamp,
      completedAt: timestamp,
      timeoutMs,
      status: "SKIPPED",
      reasonCode,
      callAttempted: false
    })]),
    paid_provider_calls: 0,
    retry_attempted: false,
    full_provider_fallback_attempted: false,
    evidence_document: null,
    observed_fields: Object.freeze([])
  });
}

export async function executeSecondLookCardCodeShadow({
  plan = null,
  images = [],
  knownFields = {},
  providerOptions = {},
  traceLevel = "",
  shardKey = "",
  preferredKeySlot = null,
  modelOverride = "",
  requestContext = {},
  signal = requestContext?.signal || null,
  runProviderStage = async (work) => work(),
  runTargetedProvider = runTargetedVisualObservation,
  now = Date.now,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const enabled = secondLookShadowEvaluationProfileEnabled({ providerOptions, traceLevel });
  if (!enabled) return skippedExecution(plan, "SECOND_LOOK_EVALUATION_PROFILE_DISABLED");
  if (!plan || plan.should_run !== true || plan.decision_status !== "ELIGIBLE") {
    return skippedExecution(plan, cleanText(plan?.reason_code) || "SECOND_LOOK_NOT_ELIGIBLE");
  }
  if (!Array.isArray(plan.target_fields) || plan.target_fields.length !== 1 || plan.target_fields[0] !== "card_number_or_code") {
    return skippedExecution(plan, "SECOND_LOOK_TARGET_CONTRACT_INVALID");
  }

  const timeoutMs = Math.max(250, Math.min(
    secondLookShadowExecutionContract.timeout_ms,
    Number(plan.timeout_ms || secondLookShadowExecutionContract.timeout_ms)
  ));
  const startedAtMs = now();
  const deadlineAtMs = startedAtMs + timeoutMs;
  const startedAt = new Date(startedAtMs).toISOString();
  let result = null;
  try {
    result = await runProviderStage(() => {
      const remainingTimeoutMs = Math.floor(deadlineAtMs - now());
      if (remainingTimeoutMs < 250) {
        throw Object.assign(new Error("Second-look total deadline expired before Provider transport."), {
          code: "SECOND_LOOK_TOTAL_DEADLINE_EXCEEDED",
          retryable: false,
          provider_call_attempted: false
        });
      }
      return runTargetedProvider({
        images,
        targetFields: plan.target_fields,
        requiredTargets: plan.required_targets,
        imagePolicy: plan.image_policy,
        knownFields: object(knownFields),
        shardKey,
        preferredKeySlot,
        modelOverride,
        timeoutMs: Math.min(timeoutMs, remainingTimeoutMs),
        env,
        fetchImpl,
        signal,
        requestContext: {
          ...object(requestContext),
          provider_call_purpose: "targeted_second_look_card_code",
          provider_http_request_budget: 1,
          provider_http_retry_policy: "FORBIDDEN",
          provider_local_capacity_policy: "FAIL_IF_BUSY"
        }
      });
    });
    const completedAt = new Date(now()).toISOString();
    const ledger = Object.freeze([ledgerRow({ startedAt, completedAt, result, timeoutMs })]);
    const evidenceDocument = persistedEvidenceDocument(assertReviewOnlyVisionEvidence(
      providerPayloadToEvidenceDocument(result.parsed, {
        images,
        preserveReviewOnlyCodeProposals: true
      })
    ));
    return Object.freeze({
      ...secondLookShadowExecutionContract,
      enabled: true,
      execution_status: result.parsed?.recognition_status === "ABSTAIN" ? "ABSTAINED" : "COMPLETED",
      reason_code: result.targeted_visual_observation?.safety?.reason || null,
      plan,
      provider_call_ledger: ledger,
      paid_provider_calls: ledger[0].provider_calls,
      retry_attempted: false,
      full_provider_fallback_attempted: false,
      evidence_document: evidenceDocument,
      observed_fields: Object.freeze(Object.keys(object(evidenceDocument.evidence)).sort()),
      response_hash: result.response_hash || null,
      model_id: result.model_id || null,
      input_image_count: Number(result.targeted_visual_observation?.input_image_count || 0),
      safety: result.targeted_visual_observation?.safety || null,
      natural_language_model_response_persisted: false
    });
  } catch (error) {
    const completedAt = new Date(now()).toISOString();
    const reasonCode = cleanText(error?.code || "TARGETED_SECOND_LOOK_FAILED");
    const skippedWithoutCall = error?.provider_call_attempted === false && [
      "PROVIDER_LOCAL_CAPACITY_BUSY",
      "SECOND_LOOK_TOTAL_DEADLINE_EXCEEDED"
    ].includes(reasonCode);
    const ledger = Object.freeze([ledgerRow({
      startedAt,
      completedAt,
      result,
      error,
      timeoutMs,
      status: skippedWithoutCall ? "SKIPPED" : "FAILED"
    })]);
    return Object.freeze({
      ...secondLookShadowExecutionContract,
      enabled: true,
      execution_status: skippedWithoutCall ? "SKIPPED" : "FAILED",
      reason_code: reasonCode,
      error: Object.freeze({
        code: reasonCode,
        message: safeProviderErrorMessage(error)
      }),
      plan,
      provider_call_ledger: ledger,
      paid_provider_calls: ledger[0].provider_calls,
      retry_attempted: false,
      full_provider_fallback_attempted: false,
      evidence_document: null,
      observed_fields: Object.freeze([]),
      response_hash: result?.response_hash || error?.provider_response_hash || null,
      model_id: result?.model_id || error?.provider_model_id || null,
      natural_language_model_response_persisted: false
    });
  }
}

export const __secondLookShadowExecutorTestHooks = Object.freeze({
  assertReviewOnlyVisionEvidence,
  benchmarkProfile,
  evidenceSources,
  ledgerRow,
  persistedEvidenceDocument
});
