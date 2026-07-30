import { planSecondLookCardCode } from "../catalog/second-look-planner.mjs";
import { mergeEvidenceMaps, mergeResolvedFields } from "../pipeline/result-decoration.mjs";
import {
  executeSecondLookCardCodeShadow,
  secondLookShadowEvaluationProfileEnabled
} from "../v4/targeted-assist/second-look-shadow-executor.mjs";

export const secondLookShadowEvaluationContract = Object.freeze({
  owner: "V4_SECOND_LOOK_CARD_CODE_EVALUATION",
  schema_version: "second-look-card-code-evaluation-v1",
  production_effect: "NONE",
  title_effect: "NONE",
  resolver_effect: "PROPOSAL_ONLY",
  candidate_authority: "RESOLVER_ONLY"
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function paidProviderCalls(execution = {}) {
  const value = Number(execution?.paid_provider_calls);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function withoutPersistedModelText(value) {
  if (Array.isArray(value)) return value.map(withoutPersistedModelText);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      "raw_text",
      "visible_text",
      "observed_text",
      "provider_raw_response",
      "provider_content",
      "model_response_text"
    ].includes(key))
    .map(([key, child]) => [key, withoutPersistedModelText(child)]));
}

function titleFor(result = {}) {
  return cleanText(result.final_title || result.title || result.rendered_title);
}

function compactResolverSnapshot(result = {}) {
  return Object.freeze({
    identity_resolution_status: result.identity_resolution_status || null,
    ambiguity_status: result.ambiguity_status || null,
    resolved: object(result.resolved_fields || result.resolved || result.fields),
    publication_gate: result.publication_gate || null,
    resolver_version: result.resolver_version || result.identity_resolution_version || null,
    renderer_version: result.renderer_version || null,
    final_title: titleFor(result)
  });
}

function compactCandidateDecisionTrace(result = {}) {
  const retrieval = object(result.retrieval);
  const candidates = Array.isArray(retrieval.candidates || retrieval.results || retrieval.sources)
    ? (retrieval.candidates || retrieval.results || retrieval.sources).slice(0, 20)
    : [];
  const selectedId = cleanText(
    result.selected_candidate_id
    || result.selected_candidate_decision?.selected_candidate_id
    || retrieval.selected_candidate?.candidate_id
    || retrieval.selected_candidate?.id
  ) || null;
  return Object.freeze({
    retrieval: Object.freeze({
      query: object(retrieval.query || retrieval.query_fields || result.retrieval_query),
      top_k: Object.freeze(candidates.map((candidate, index) => Object.freeze({
        candidate_id: cleanText(candidate?.candidate_id || candidate?.id || candidate?.identity_id) || null,
        rank: Number.isFinite(Number(candidate?.rank)) ? Number(candidate.rank) : index + 1,
        source: cleanText(candidate?.source_type || candidate?.source || candidate?.provider_id) || null,
        score: Number.isFinite(Number(candidate?.score ?? candidate?.total_score))
          ? Number(candidate.score ?? candidate.total_score)
          : null,
        selected: candidate?.selected === true
          || Boolean(selectedId && selectedId === cleanText(candidate?.candidate_id || candidate?.id || candidate?.identity_id)),
        rejection_reasons: Object.freeze((Array.isArray(candidate?.rejection_reasons || candidate?.reason_codes)
          ? (candidate.rejection_reasons || candidate.reason_codes)
          : []).slice(0, 12).map(cleanText).filter(Boolean))
      })))
    }),
    selection: result.selected_candidate_decision || (selectedId ? { selected_candidate_id: selectedId } : null),
    application: result.retrieval_application || result.candidate_control_plane_trace?.retrieval_application || null,
    resolver: Object.freeze({
      identity_resolution_status: result.identity_resolution_status || null,
      resolution_trace: Object.freeze((Array.isArray(result.resolution_trace) ? result.resolution_trace : []).slice(-40)),
      publication_gate: result.publication_gate || null
    }),
    renderer: Object.freeze({
      renderer_version: result.renderer_version || null,
      rendered_fields: object(result.rendered_fields?.fields || result.rendered_fields),
      final_title: titleFor(result)
    })
  });
}

export function buildSecondLookCandidateInput(stageOneResult = {}, evidenceDocument = {}) {
  const document = object(evidenceDocument);
  return {
    ...stageOneResult,
    evidence: mergeEvidenceMaps(
      object(stageOneResult.evidence),
      object(document.evidence)
    ),
    resolved: mergeResolvedFields(
      object(stageOneResult.resolved || stageOneResult.resolved_fields || stageOneResult.fields),
      object(document.resolved)
    ),
    unresolved: [...new Set([
      ...(Array.isArray(stageOneResult.unresolved) ? stageOneResult.unresolved : []),
      ...(Array.isArray(document.unresolved) ? document.unresolved : [])
    ])],
    second_look_evidence_document: document
  };
}

export async function runSecondLookEvaluationShadow({
  baselineResult = {},
  stageOneResult = {},
  images = [],
  providerOptions = {},
  traceLevel = "",
  fieldStates = {},
  unresolved = stageOneResult.unresolved || [],
  identityCriticalReason = "",
  executorContext = {},
  planOverride = null,
  executionOverride = null,
  executeShadow = executeSecondLookCardCodeShadow,
  onObservationComplete = null,
  resolveCandidate = null
} = {}) {
  const evaluationEnabled = secondLookShadowEvaluationProfileEnabled({ providerOptions, traceLevel });
  const plan = planOverride || planSecondLookCardCode({
    resolved: object(stageOneResult.resolved || stageOneResult.resolved_fields || stageOneResult.fields),
    evidence: object(stageOneResult.evidence),
    fieldStates,
    unresolved,
    images,
    evaluationEnabled,
    identityCriticalReason
  });
  const baselineSnapshot = compactResolverSnapshot(baselineResult);
  const baselineSnapshotJson = JSON.stringify(baselineSnapshot);
  const execution = executionOverride || await executeShadow({
    plan,
    images,
    knownFields: object(stageOneResult.resolved || stageOneResult.resolved_fields || stageOneResult.fields),
    providerOptions,
    traceLevel,
    ...object(executorContext)
  });
  let observationCompletionError = null;
  if (typeof onObservationComplete === "function") {
    try {
      await onObservationComplete(execution);
    } catch (error) {
      observationCompletionError = Object.freeze({
        code: cleanText(error?.code || "SECOND_LOOK_OBSERVATION_COMPLETION_FAILED"),
        message: cleanText(error?.message || "second look observation completion failed").slice(0, 180)
      });
    }
  }

  let candidateResult = null;
  let candidateStatus = "NOT_RUN";
  let candidateError = null;
  if (observationCompletionError) {
    candidateStatus = "OBSERVATION_COMPLETION_FAILED";
    candidateError = observationCompletionError;
  } else if (execution?.evidence_document && typeof resolveCandidate === "function") {
    try {
      candidateResult = await resolveCandidate(buildSecondLookCandidateInput(
        stageOneResult,
        execution.evidence_document
      ));
      candidateStatus = "COMPLETED";
    } catch (error) {
      candidateStatus = "FAILED";
      candidateError = {
        code: cleanText(error?.code || "SECOND_LOOK_CANDIDATE_RESOLUTION_FAILED"),
        message: cleanText(error?.message || "second look candidate resolution failed").slice(0, 180)
      };
    }
  } else if (execution?.evidence_document) {
    candidateStatus = "RESOLVER_CALLBACK_MISSING";
  } else if (execution?.execution_status === "SKIPPED") {
    candidateStatus = "INELIGIBLE";
  } else {
    candidateStatus = "NO_EVIDENCE";
  }

  return Object.freeze({
    ...secondLookShadowEvaluationContract,
    enabled: evaluationEnabled,
    execution_status: execution?.execution_status || "SKIPPED",
    reason_code: execution?.reason_code || null,
    execution_error: execution?.error || null,
    plan,
    provider_call_ledger: Object.freeze(Array.isArray(execution?.provider_call_ledger)
      ? [...execution.provider_call_ledger]
      : []),
    paid_provider_calls: paidProviderCalls(execution),
    retry_attempted: execution?.retry_attempted === true,
    full_provider_fallback_attempted: execution?.full_provider_fallback_attempted === true,
    evidence_document: execution?.evidence_document || null,
    observed_fields: Object.freeze(Array.isArray(execution?.observed_fields)
      ? [...execution.observed_fields]
      : []),
    response_hash: execution?.response_hash || null,
    model_id: execution?.model_id || null,
    natural_language_model_response_persisted: false,
    observation_completion_error: observationCompletionError,
    baseline_title: baselineSnapshot.final_title,
    baseline_snapshot: baselineSnapshot,
    baseline_unchanged: JSON.stringify(compactResolverSnapshot(baselineResult)) === baselineSnapshotJson,
    candidate_status: candidateStatus,
    candidate_error: candidateError,
    candidate_snapshot: candidateResult ? compactResolverSnapshot(candidateResult) : null,
    candidate_decision_trace: candidateResult
      ? withoutPersistedModelText(compactCandidateDecisionTrace(candidateResult))
      : null,
    candidate_title_delta: candidateResult
      ? titleFor(candidateResult) === baselineSnapshot.final_title ? "UNCHANGED" : "CHANGED"
      : "NOT_AVAILABLE"
  });
}
