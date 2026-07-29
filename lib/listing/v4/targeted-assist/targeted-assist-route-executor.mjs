import { safeProviderErrorMessage } from "../../providers/provider-errors.mjs";
import { visionProviderIds } from "../../providers/provider-contract.mjs";
import { providerAuxRoutes } from "../route-planner/provider-aux-route-shadow.mjs";
import {
  runTargetedVisualObservation,
  targetedVisualObservationContract
} from "./targeted-visual-observation.mjs";

export const coldTargetedAssistBenchmarkProfile = "cold_targeted_assist_benchmark";

export const targetedAssistExecutionContract = Object.freeze({
  owner: "V4_TARGETED_ASSIST_ROUTE_EXECUTOR",
  executor_version: "targeted-assist-route-executor-v1",
  production_default: "OFF",
  world_knowledge_paid_calls: "DISABLED",
  full_provider_role: "AUXILIARY_FALLBACK_ONLY"
});

const paidFailureCodes = new Set([
  "PROVIDER_TIMEOUT",
  "NETWORK_ERROR",
  "timeout",
  "network_error",
  "rate_limited",
  "upstream_error",
  "http_error",
  "bad_request",
  "auth_error",
  "empty_response",
  "schema_validation_failed"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function addNullable(left, right) {
  const values = [left, right].filter((value) => Number.isFinite(Number(value)));
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}

export function mergeObservationProviderUsage(first = null, second = null) {
  const left = object(first);
  const right = object(second);
  return {
    ...(Object.keys(right).length ? right : left),
    provider_calls: finite(left.provider_calls) + finite(right.provider_calls),
    retrieval_calls: finite(left.retrieval_calls) + finite(right.retrieval_calls),
    latency_ms: finite(left.latency_ms) + finite(right.latency_ms),
    estimated_cost_usd: Number((finite(left.estimated_cost_usd) + finite(right.estimated_cost_usd)).toFixed(6)),
    cost_configured: left.cost_configured === true || right.cost_configured === true,
    input_tokens: addNullable(left.input_tokens, right.input_tokens),
    output_tokens: addNullable(left.output_tokens, right.output_tokens),
    prompt_tokens: addNullable(left.prompt_tokens, right.prompt_tokens),
    completion_tokens: addNullable(left.completion_tokens, right.completion_tokens),
    total_tokens: addNullable(left.total_tokens, right.total_tokens),
    image_count: finite(left.image_count) + finite(right.image_count)
  };
}

function benchmarkProfile(providerOptions = {}) {
  return cleanText(
    providerOptions.recognition_benchmark_profile
    || providerOptions.recognitionBenchmarkProfile
  ).toLowerCase();
}

export function targetedAssistCandidateEnabled({
  providerOptions = {},
  traceLevel = "",
  routeDecision = null
} = {}) {
  const route = object(routeDecision);
  const visualTargets = Array.isArray(route.visual_field_targets)
    ? route.visual_field_targets.filter((field) => cleanText(field))
    : [];
  const visualBasis = new Set(["TARGETED_VISUAL_ASSIST", "TARGETED_VISUAL_AND_KNOWLEDGE"]);
  return targetedAssistEvaluationProfileEnabled({ providerOptions, traceLevel })
    && route.route === providerAuxRoutes.TARGETED_MODEL_ASSIST
    // v1 has only the visual executor. Mixed routes may still run because the
    // ordinary downstream catalog/retrieval chain consumes the newly observed
    // literal fields; no world-knowledge call or derived field is injected.
    // A knowledge-only route has no legitimate visual task and fails closed.
    && visualBasis.has(route.basis)
    && visualTargets.length > 0
    && route.input_class === "NOVEL_IMAGE"
    && route.trace_completeness === "COMPLETE"
    && route.source_availability === "COMPLETE"
    && finite(route.provider_derived_field_count) === 0
    && finite(route.post_cutoff_evidence_count) === 0;
}

export function targetedAssistEvaluationProfileEnabled({
  providerOptions = {},
  traceLevel = ""
} = {}) {
  return benchmarkProfile(providerOptions) === coldTargetedAssistBenchmarkProfile
    && cleanText(traceLevel || providerOptions.trace_level).toLowerCase() === "evaluation"
    && providerOptions.enable_targeted_visual_assist_candidate === true
    && providerOptions.enable_world_knowledge_assist_candidate !== true;
}

function stageLedger(logicalStage, result = null, {
  startedAt,
  completedAt,
  status = "COMPLETED",
  reasonCode = null,
  fallback = false,
  paidCallsOverride = null
} = {}) {
  const usage = object(result?.usage);
  const paidCalls = paidCallsOverride === null
    ? Math.max(0, Math.trunc(finite(usage.provider_calls)))
    : Math.max(0, Math.trunc(finite(paidCallsOverride)));
  return Object.freeze({
    logical_stage: logicalStage,
    attempt: 1,
    started_at: startedAt,
    completed_at: completedAt,
    latency_ms: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    provider_calls: paidCalls,
    input_tokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
    output_tokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
    total_tokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
    image_count: Number.isFinite(Number(usage.image_count)) ? Number(usage.image_count) : null,
    model_id: result?.model_id || usage.model_id || null,
    prompt_revision: result?.prompt_version
      || result?.targeted_visual_observation?.prompt_version
      || (logicalStage === "TARGETED_VISUAL_OBSERVATION" ? targetedVisualObservationContract.prompt_version : null),
    schema_revision: result?.schema_version
      || result?.targeted_visual_observation?.schema_version
      || (logicalStage === "TARGETED_VISUAL_OBSERVATION" ? targetedVisualObservationContract.schema_version : null),
    status,
    reason_code: cleanText(reasonCode) || null,
    fallback
  });
}

function failedStageLedger(stage, error, startedAt, completedAt) {
  const code = cleanText(error?.code || "TARGETED_VISUAL_FAILED");
  return stageLedger(stage, null, {
    startedAt,
    completedAt,
    status: "FAILED",
    reasonCode: code,
    paidCallsOverride: error?.provider_call_attempted === true || paidFailureCodes.has(code) ? 1 : 0
  });
}

async function callWithLedger(stage, call, { fallback = false } = {}) {
  const startedAt = new Date().toISOString();
  try {
    const result = await call();
    const completedAt = new Date().toISOString();
    return {
      result,
      ledger: stageLedger(stage, result, { startedAt, completedAt, fallback })
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    error.provider_call_ledger_entry = failedStageLedger(stage, error, startedAt, completedAt);
    throw error;
  }
}

function fallbackReasonFromTargeted(result = null, error = null) {
  if (error) return cleanText(error.code || "TARGETED_VISUAL_FAILED");
  return cleanText(result?.targeted_visual_observation?.safety?.reason || "TARGETED_VISUAL_UNSAFE");
}

function executionSnapshot({
  enabled,
  routeDecision,
  finalObservationOwner = null,
  fallbackReasonCode = null,
  targetedError = null,
  ledger = []
} = {}) {
  return Object.freeze({
    ...targetedAssistExecutionContract,
    enabled: enabled === true,
    route: routeDecision?.route || null,
    final_observation_owner: finalObservationOwner,
    fallback_reason_code: cleanText(fallbackReasonCode) || null,
    targeted_error: targetedError
      ? {
          code: cleanText(targetedError.code || "TARGETED_VISUAL_FAILED"),
          message: safeProviderErrorMessage(targetedError)
        }
      : null,
    // A top-level provider_slot_timing belongs only to the final observation
    // result. Evaluation and failure accounting must use this typed ledger for
    // the complete targeted -> fallback sequence.
    provider_timing_authority: "PROVIDER_CALL_LEDGER",
    provider_call_ledger: Object.freeze([...ledger])
  });
}

function usageFromLedger(ledger = []) {
  return ledger.reduce((usage, entry) => mergeObservationProviderUsage(usage, {
    provider_calls: entry?.provider_calls,
    latency_ms: entry?.latency_ms,
    input_tokens: entry?.input_tokens,
    output_tokens: entry?.output_tokens,
    total_tokens: entry?.total_tokens,
    image_count: entry?.image_count
  }), null);
}

function attachExecutionFailure(error, execution) {
  const failure = error && typeof error === "object"
    ? error
    : Object.assign(new Error(cleanText(error) || "provider observation failed"), {
        code: "PROVIDER_OBSERVATION_FAILED"
      });
  failure.targeted_assist_execution = execution;
  failure.provider_call_ledger = execution.provider_call_ledger;
  failure.provider_usage = usageFromLedger(execution.provider_call_ledger);
  return failure;
}

function abortErrorFromSignal(signal) {
  const reason = signal?.reason;
  if (reason && typeof reason === "object") return reason;
  return Object.assign(new Error(cleanText(reason) || "Provider execution was aborted before fallback."), {
    code: "PROVIDER_EXECUTION_ABORTED",
    retryable: false
  });
}

function assertProviderExecutionActive(signal) {
  if (signal?.aborted === true) throw abortErrorFromSignal(signal);
}

/**
 * Chooses only the observation executor. Both paths return the same canonical
 * provider payload and therefore rejoin the existing normalization, retrieval,
 * candidate, Resolver, and Renderer chain exactly once.
 */
export async function executeTargetedAssistObservationRoute({
  images = [],
  routeDecision = null,
  providerOptions = {},
  traceLevel = "",
  shardKey = "",
  preferredKeySlot = null,
  modelOverride = "",
  requestContext = {},
  signal = requestContext?.signal || null,
  runProviderStage = async (work) => work(),
  runFullProvider,
  runTargetedProvider = runTargetedVisualObservation,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof runFullProvider !== "function") throw new TypeError("runFullProvider is required");
  assertProviderExecutionActive(signal);
  const useTargeted = targetedAssistCandidateEnabled({ providerOptions, traceLevel, routeDecision });
  const ledger = [];

  if (!useTargeted) {
    try {
      const full = await callWithLedger(
        "FULL_PROVIDER_OBSERVATION",
        () => runProviderStage(runFullProvider),
        { fallback: false }
      );
      ledger.push(full.ledger);
      return {
        result: full.result,
        execution: executionSnapshot({
          enabled: false,
          routeDecision,
          finalObservationOwner: "FULL_PROVIDER_OBSERVATION",
          ledger
        })
      };
    } catch (error) {
      ledger.push(error.provider_call_ledger_entry || failedStageLedger(
        "FULL_PROVIDER_OBSERVATION",
        error,
        new Date().toISOString(),
        new Date().toISOString()
      ));
      throw attachExecutionFailure(error, executionSnapshot({
        enabled: false,
        routeDecision,
        ledger
      }));
    }
  }

  const targetFields = Array.isArray(routeDecision?.visual_field_targets)
    ? routeDecision.visual_field_targets
    : [];
  const requiredTargets = Array.isArray(routeDecision?.visual_requirement_targets)
    ? routeDecision.visual_requirement_targets
    : targetFields;
  let targeted = null;
  let targetedError = null;
  try {
    targeted = await callWithLedger(
      "TARGETED_VISUAL_OBSERVATION",
      () => runProviderStage(() => runTargetedProvider({
        images,
        targetFields,
        requiredTargets,
        // Raw pre-ingestion `resolved` may contain unsourced or conflicted
        // convenience values. Only the route owner's PUBLISHABLE projection
        // may satisfy a missing visual requirement.
        knownFields: object(routeDecision?.publishable_known_fields),
        imagePolicy: routeDecision?.image_policy,
        shardKey,
        preferredKeySlot,
        modelOverride,
        env,
        fetchImpl,
        requestContext: {
          ...object(requestContext),
          provider_call_purpose: "targeted_visual_observation"
        },
        signal
      }))
    );
    ledger.push(targeted.ledger);
  } catch (error) {
    targetedError = error;
    ledger.push(error.provider_call_ledger_entry || failedStageLedger(
      "TARGETED_VISUAL_OBSERVATION",
      error,
      new Date().toISOString(),
      new Date().toISOString()
    ));
  }

  if (targeted?.result?.targeted_visual_observation?.safety?.safe === true) {
    return {
      result: targeted.result,
      execution: executionSnapshot({
        enabled: true,
        routeDecision,
        finalObservationOwner: "TARGETED_VISUAL_OBSERVATION",
        ledger
      })
    };
  }

  const fallbackReason = fallbackReasonFromTargeted(targeted?.result, targetedError);
  if (signal?.aborted === true) {
    throw attachExecutionFailure(abortErrorFromSignal(signal), executionSnapshot({
      enabled: true,
      routeDecision,
      fallbackReasonCode: "PARENT_SIGNAL_ABORTED",
      targetedError,
      ledger
    }));
  }
  let full;
  try {
    full = await callWithLedger(
      "FULL_PROVIDER_OBSERVATION",
      () => runProviderStage(runFullProvider),
      { fallback: true }
    );
  } catch (error) {
    ledger.push(error.provider_call_ledger_entry || failedStageLedger(
      "FULL_PROVIDER_OBSERVATION",
      error,
      new Date().toISOString(),
      new Date().toISOString()
    ));
    throw attachExecutionFailure(error, executionSnapshot({
      enabled: true,
      routeDecision,
      fallbackReasonCode: fallbackReason,
      targetedError,
      ledger
    }));
  }
  ledger.push(full.ledger);
  const attemptedUsage = targeted?.result?.usage || {
    provider_calls: ledger[0]?.provider_calls || 0,
    latency_ms: ledger[0]?.latency_ms || 0,
    input_tokens: ledger[0]?.input_tokens ?? null,
    output_tokens: ledger[0]?.output_tokens ?? null,
    total_tokens: ledger[0]?.total_tokens ?? null,
    image_count: ledger[0]?.image_count ?? 0
  };
  return {
    result: {
      ...full.result,
      usage: mergeObservationProviderUsage(attemptedUsage, full.result?.usage),
      fallback_provider_id: full.result?.provider || visionProviderIds.OPENAI_LEGACY,
      fallback_reason: fallbackReason
    },
    execution: executionSnapshot({
      enabled: true,
      routeDecision,
      finalObservationOwner: "FULL_PROVIDER_OBSERVATION",
      fallbackReasonCode: fallbackReason,
      targetedError,
      ledger
    })
  };
}

export const __targetedAssistRouteExecutorTestHooks = Object.freeze({
  benchmarkProfile,
  failedStageLedger,
  paidFailureCodes,
  stageLedger,
  usageFromLedger
});
