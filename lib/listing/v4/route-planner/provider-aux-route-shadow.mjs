import { createHash } from "node:crypto";

import {
  providerOutputFieldClass,
  providerOutputFieldContract
} from "../../providers/provider-output-field-contract.mjs";
import { knowledgeFirstRoutes } from "./knowledge-first-route-policy.mjs";

export const providerAuxRoutePolicy = Object.freeze({
  schema_version: "provider-aux-route-shadow-v2",
  policy_id: "provider-auxiliary-route-policy",
  policy_version: "2026-07-29.2",
  owner: "V4_PROVIDER_AUX_ROUTE_PLANNER"
});

export const providerAuxRoutes = Object.freeze({
  FAST_DETERMINISTIC: "FAST_DETERMINISTIC",
  TARGETED_MODEL_ASSIST: "TARGETED_MODEL_ASSIST",
  FULL_PROVIDER_FALLBACK: "FULL_PROVIDER_FALLBACK"
});

const exactReplayAuthorities = new Set([
  "WRITER_FINAL_REPLAY",
  "APPROVED_IDENTITY_MEMORY",
  "AI_TERMINAL_L2_REPLAY"
]);

const fastDetailedRoutes = new Set([
  knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL,
  knowledgeFirstRoutes.DETERMINISTIC_FINAL
]);
const targetedDetailedRoutes = new Set([
  knowledgeFirstRoutes.TARGETED_VISUAL_ASSIST,
  knowledgeFirstRoutes.KNOWLEDGE_ASSIST,
  knowledgeFirstRoutes.TARGETED_VISUAL_AND_KNOWLEDGE
]);

const providerDerivedSourcePattern = /(provider|openai|gpt|vision_model|post_observation)/i;
const visualTargetExpansions = Object.freeze({
  card_name_or_insert_or_code: Object.freeze([
    "card_name",
    "insert",
    "set",
    "collector_number",
    "checklist_code",
    "tcg_card_number",
    "card_number"
  ])
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timestampMs(value) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstProviderCallStartedAt(rows = [], fallback = null) {
  const starts = array(rows)
    .filter((row) => Number(row?.provider_calls || 0) > 0)
    .map((row) => ({ value: cleanText(row?.started_at), ms: timestampMs(row?.started_at) }))
    .filter((row) => row.value && row.ms !== null)
    .sort((left, right) => left.ms - right.ms);
  if (starts.length) return starts[0].value;
  return timestampMs(fallback) === null ? null : cleanText(fallback);
}

export function expandProviderAuxVisualFieldTargets(values = []) {
  const expanded = [...new Set(array(values)
    .map(cleanText)
    .filter(Boolean)
    .flatMap((field) => visualTargetExpansions[field] || [field]))];
  const invalid = expanded.filter((field) => (
    providerOutputFieldContract[field]?.classification !== providerOutputFieldClass.READ
  ));
  if (invalid.length) {
    throw new Error(`provider auxiliary visual target must be READ: ${invalid.join(",")}`);
  }
  return Object.freeze(expanded);
}

function providerAuxVisualRequirementTargets(values = []) {
  const requirements = [...new Set(array(values).map(cleanText).filter(Boolean))];
  // Expansion is the single READ-contract validator. Keep the original group
  // names as requirements so `card_name_or_insert_or_code` remains an OR
  // condition instead of silently becoming seven mandatory fields.
  expandProviderAuxVisualFieldTargets(requirements);
  return Object.freeze(requirements);
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function providerAuxRouteReplayInputHash(value) {
  return sha256(value);
}

function sourceRows(evidenceDocument = {}) {
  return Object.values(object(evidenceDocument.evidence)).flatMap((entry) => {
    const row = object(entry);
    return [
      ...array(row.sources),
      ...array(row.candidates).flatMap((candidate) => array(candidate?.sources))
    ].filter((source) => source && typeof source === "object" && !Array.isArray(source));
  });
}

function sourceAvailableAt(source = {}) {
  return cleanText(
    source.available_at
    || source.observed_at
    || source.captured_at
    || source.completed_at
  ) || null;
}

function evidenceAvailability(evidenceDocument = {}, cutoffAt = null) {
  const evidenceFields = Object.keys(object(evidenceDocument.evidence)).sort();
  const sources = sourceRows(evidenceDocument);
  const cutoffMs = Date.parse(String(cutoffAt || ""));
  const timestamped = sources
    .map((source) => sourceAvailableAt(source))
    .filter(Boolean);
  const postCutoff = Number.isFinite(cutoffMs)
    ? timestamped.filter((value) => Date.parse(value) > cutoffMs).length
    : null;
  return Object.freeze({
    evidence_field_count: evidenceFields.length,
    evidence_availability_proof: Number.isFinite(cutoffMs) ? "RUNTIME_INPUT_FREEZE" : "MISSING",
    evidence_availability_manifest: Object.freeze(evidenceFields.map((field) => Object.freeze({
      field,
      available_at: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : null
    }))),
    source_count: sources.length,
    source_timestamp_count: timestamped.length,
    source_timestamp_coverage: sources.length ? timestamped.length / sources.length : 1,
    provider_derived_field_count: Object.values(object(evidenceDocument.evidence)).filter((entry) => {
      const sourcesForField = [
        ...array(entry?.sources),
        ...array(entry?.candidates).flatMap((candidate) => array(candidate?.sources))
      ];
      return sourcesForField.some((source) => providerDerivedSourcePattern.test(
        cleanText(source?.source_type || source?.source)
      ));
    }).length,
    post_cutoff_evidence_count: postCutoff
  });
}

function effectiveKnowledgeTargets(decision = {}) {
  const explicit = array(decision.knowledge_field_targets).map(cleanText).filter(Boolean);
  const reasons = new Set(array(decision.reason_codes).map(cleanText));
  if (!reasons.has("FORWARD_ENUMERATION_REQUIRED")) return explicit;
  const snapshot = object(decision.evidence_snapshot);
  return [...new Set([
    ...explicit,
    ...["product", "team"].filter((field) => !cleanText(snapshot[field]))
  ])];
}

function targetFields(decision = {}) {
  return [...new Set([
    ...expandProviderAuxVisualFieldTargets(decision.visual_field_targets),
    ...effectiveKnowledgeTargets(decision)
  ].map(cleanText).filter(Boolean))];
}

function publishableKnownFields(decision = {}) {
  const snapshot = object(decision.evidence_snapshot);
  const states = object(snapshot.field_states);
  return Object.freeze(Object.fromEntries(Object.keys(states).flatMap((field) => {
    const value = snapshot[field];
    const present = Array.isArray(value)
      ? value.some((item) => cleanText(item))
      : typeof value === "boolean"
        ? value === true
        : Boolean(cleanText(value));
    return states[field] === "PUBLISHABLE"
      && present
      && providerOutputFieldContract[field]?.classification === providerOutputFieldClass.READ
      ? [[field, clone(value)]]
      : [];
  })));
}

function terminalDisposition(decision = {}, usableImageCount = 0) {
  const reasons = new Set(array(decision.reason_codes).map(cleanText));
  if (reasons.has("PRE_PROVIDER_RESCAN_REQUIRED")) return "TARGETED_RESCAN";
  if (Number(usableImageCount || 0) < 1 || reasons.has("NO_USABLE_IMAGE")) return "WRITER_REVIEW";
  return null;
}

function coarseRoute(decision = {}, usableImageCount = 0) {
  const detailedRoute = cleanText(decision.route);
  const disposition = terminalDisposition(decision, usableImageCount);
  if (disposition) return null;
  if (fastDetailedRoutes.has(detailedRoute)) return providerAuxRoutes.FAST_DETERMINISTIC;
  if (targetedDetailedRoutes.has(detailedRoute)) return providerAuxRoutes.TARGETED_MODEL_ASSIST;
  // A pre-Provider conflict is not yet a writer-review verdict. The existing
  // full-card observer may still arbitrate current-image/OCR disagreement;
  // Resolver remains the only component allowed to accept the result.
  return providerAuxRoutes.FULL_PROVIDER_FALLBACK;
}

function assistSequence(route, decision = {}) {
  const visualTargets = expandProviderAuxVisualFieldTargets(decision.visual_field_targets);
  const visualRequirements = providerAuxVisualRequirementTargets(decision.visual_field_targets);
  const knowledgeTargets = effectiveKnowledgeTargets(decision);
  if (route === providerAuxRoutes.FAST_DETERMINISTIC) return Object.freeze([]);
  if (route === providerAuxRoutes.FULL_PROVIDER_FALLBACK) {
    return Object.freeze([Object.freeze({
      stage: "FULL_PROVIDER_OBSERVATION",
      condition: "TARGETED_OR_DETERMINISTIC_ROUTE_NOT_SAFE",
      target_fields: Object.freeze([]),
      image_access: "FULL_CARD",
      max_paid_calls: 1,
      executor_status: "AVAILABLE_AS_CURRENT_DEFAULT",
      resolver_effect: "PROPOSAL_ONLY"
    })]);
  }

  const stages = [];
  if (visualTargets.length) {
    stages.push(Object.freeze({
      stage: "TARGETED_VISUAL_OBSERVATION",
      condition: "VISIBLE_FIELDS_REMAIN_UNKNOWN",
      target_fields: Object.freeze(visualTargets),
      required_targets: visualRequirements,
      image_access: cleanText(decision.image_policy) || "RELEVANT_CROPS_ONLY",
      max_paid_calls: 1,
      executor_status: "EVALUATION_ONLY",
      resolver_effect: "PROPOSAL_ONLY"
    }));
  }
  if (visualTargets.length && knowledgeTargets.length) {
    stages.push(Object.freeze({
      stage: "RECOMPUTE_CONSTRAINTS",
      condition: "AFTER_TARGETED_VISUAL_OBSERVATION",
      target_fields: Object.freeze(knowledgeTargets),
      image_access: "DENIED",
      max_paid_calls: 0,
      executor_status: "PURE_POLICY_AVAILABLE",
      resolver_effect: "NONE"
    }));
  }
  if (knowledgeTargets.length) {
    stages.push(Object.freeze({
      stage: "WORLD_KNOWLEDGE_ASSIST",
      condition: visualTargets.length
        ? "KNOWLEDGE_FIELDS_STILL_UNKNOWN_AFTER_RECOMPUTE"
        : "KNOWLEDGE_FIELDS_REMAIN_UNKNOWN",
      target_fields: Object.freeze(knowledgeTargets),
      image_access: "DENIED",
      max_paid_calls: 1,
      executor_status: "AVAILABLE_SEPARATE_EVALUATION_ONLY",
      resolver_effect: "NONE",
      title_effect: "NONE"
    }));
  }
  return Object.freeze(stages);
}

function inputClass(decision = {}) {
  return exactReplayAuthorities.has(cleanText(decision.higher_authority_route))
    ? "EXACT_REPLAY"
    : "NOVEL_IMAGE";
}

export function planProviderAuxRouteShadow({
  knowledgeFirstDecision = {},
  evidenceDocument = {},
  forwardEnumerationTrace = [],
  usableImageCount = 0,
  exactAnchorShadow = null,
  higherAuthorityRoute = "",
  decisionEvidenceCutoffAt = null,
  routeDecidedAt = null,
  includeReplayInput = false
} = {}) {
  const route = coarseRoute(knowledgeFirstDecision, usableImageCount);
  const disposition = terminalDisposition(knowledgeFirstDecision, usableImageCount);
  const frozenEvidenceDocument = deepFreeze(clone(evidenceDocument));
  const frozenForwardEnumerationTrace = deepFreeze(clone(array(forwardEnumerationTrace)));
  const normalizedInput = Object.freeze({
    evidence_document: frozenEvidenceDocument,
    forward_enumeration_trace: frozenForwardEnumerationTrace,
    usable_image_count: Number(usableImageCount || 0),
    exact_anchor_shadow: exactAnchorShadow && typeof exactAnchorShadow === "object"
      ? {
          evaluated: exactAnchorShadow.evaluated === true,
          eligible: exactAnchorShadow.eligible === true,
          reason: cleanText(exactAnchorShadow.reason) || null
        }
      : null,
    higher_authority_route: cleanText(higherAuthorityRoute) || null
  });
  const availability = evidenceAvailability(frozenEvidenceDocument, decisionEvidenceCutoffAt);
  const replayInput = Object.freeze({
    ...normalizedInput,
    evidence_availability_manifest: availability.evidence_availability_manifest
  });
  const snapshotHash = providerAuxRouteReplayInputHash(replayInput);
  const stages = assistSequence(route, knowledgeFirstDecision);
  const initialCallBudget = stages[0]?.max_paid_calls || 0;
  const conditionalCallBudget = stages.slice(1)
    .reduce((sum, stage) => sum + Number(stage.max_paid_calls || 0), 0);
  const timestampsPresent = Boolean(cleanText(decisionEvidenceCutoffAt) && cleanText(routeDecidedAt));
  const traceComplete = timestampsPresent && includeReplayInput;
  const sourceAvailabilityComplete = availability.evidence_availability_proof === "RUNTIME_INPUT_FREEZE"
    && availability.post_cutoff_evidence_count === 0;

  return Object.freeze({
    ...providerAuxRoutePolicy,
    route,
    decision_status: route ? "ELIGIBLE" : disposition ? "INELIGIBLE" : "UNDECIDABLE",
    input_class: inputClass({ ...knowledgeFirstDecision, higher_authority_route: higherAuthorityRoute || knowledgeFirstDecision.higher_authority_route }),
    basis: cleanText(knowledgeFirstDecision.route) || null,
    reason_codes: Object.freeze(array(knowledgeFirstDecision.reason_codes).map(cleanText).filter(Boolean)),
    target_fields: Object.freeze(targetFields(knowledgeFirstDecision)),
    visual_field_targets: expandProviderAuxVisualFieldTargets(knowledgeFirstDecision.visual_field_targets),
    visual_requirement_targets: providerAuxVisualRequirementTargets(knowledgeFirstDecision.visual_field_targets),
    knowledge_field_targets: Object.freeze(effectiveKnowledgeTargets(knowledgeFirstDecision)),
    publishable_known_fields: publishableKnownFields(knowledgeFirstDecision),
    image_policy: route === providerAuxRoutes.FULL_PROVIDER_FALLBACK
      ? "FULL_CARD"
      : route === providerAuxRoutes.TARGETED_MODEL_ASSIST
        ? cleanText(knowledgeFirstDecision.image_policy) || "NONE"
        : "NONE",
    initial_model_call_budget: initialCallBudget,
    conditional_model_call_budget: conditionalCallBudget,
    max_model_call_budget: initialCallBudget + conditionalCallBudget,
    assist_sequence: stages,
    targeted_executor_status: route === providerAuxRoutes.TARGETED_MODEL_ASSIST
      ? "EVALUATION_ONLY"
      : "NOT_REQUIRED",
    full_provider_role: "AUXILIARY_FALLBACK_ONLY",
    terminal_disposition: disposition,
    decision_evidence_cutoff_at: cleanText(decisionEvidenceCutoffAt) || null,
    route_decided_at: cleanText(routeDecidedAt) || null,
    preprovider_snapshot_hash: snapshotHash,
    route_input_hash: sha256({
      policy_version: providerAuxRoutePolicy.policy_version,
      preprovider_snapshot_hash: snapshotHash
    }),
    trace_completeness: traceComplete ? "COMPLETE" : "PARTIAL",
    source_availability: sourceAvailabilityComplete ? "COMPLETE" : "PARTIAL",
    ...availability,
    decision_frozen_before_provider: null,
    activation_eligible: false,
    activation_blockers: Object.freeze([
      "SHADOW_ONLY",
      ...(route === providerAuxRoutes.TARGETED_MODEL_ASSIST ? ["TARGETED_EXECUTOR_EVALUATION_ONLY"] : []),
      ...(!traceComplete ? ["REPLAY_INPUT_OR_TIMESTAMPS_MISSING"] : []),
      ...(!sourceAvailabilityComplete ? ["EVIDENCE_AVAILABILITY_PROOF_INCOMPLETE"] : []),
      ...(availability.provider_derived_field_count ? ["PROVIDER_DERIVED_INPUT_FORBIDDEN"] : []),
      ...(availability.post_cutoff_evidence_count ? ["POST_CUTOFF_EVIDENCE_FORBIDDEN"] : [])
    ]),
    production_effect: "SHADOW_ONLY",
    resolver_effect: "NONE",
    title_effect: "NONE",
    cache_effect: "NONE",
    replay_input: includeReplayInput ? replayInput : null
  });
}

export function withObservedProviderAuxRoute(shadow = null, {
  providerCalls = null,
  providerCallSkipped = null,
  targetedAssistExecution = null,
  providerCallLedger = null,
  providerStartedAt = null
} = {}) {
  if (!shadow || typeof shadow !== "object" || Array.isArray(shadow)) return null;
  const calls = providerCalls === null || providerCalls === undefined || providerCalls === ""
    ? null
    : Number.isFinite(Number(providerCalls))
      ? Math.max(0, Math.trunc(Number(providerCalls)))
      : null;
  const skipped = typeof providerCallSkipped === "boolean"
    ? providerCallSkipped
    : calls === null
      ? null
      : calls === 0;
  const execution = targetedAssistExecution && typeof targetedAssistExecution === "object"
    ? targetedAssistExecution
    : null;
  const ledger = Array.isArray(providerCallLedger)
    ? providerCallLedger
    : array(execution?.provider_call_ledger);
  const firstProviderStartedAt = firstProviderCallStartedAt(ledger, providerStartedAt);
  const decisionEvidenceCutoffMs = timestampMs(shadow.decision_evidence_cutoff_at);
  const routeDecidedMs = timestampMs(shadow.route_decided_at);
  const firstProviderStartedMs = timestampMs(firstProviderStartedAt);
  const decisionFrozenBeforeProvider = decisionEvidenceCutoffMs !== null
    && routeDecidedMs !== null
    && firstProviderStartedMs !== null
      ? decisionEvidenceCutoffMs <= routeDecidedMs && routeDecidedMs <= firstProviderStartedMs
      : null;
  const stageCalls = (stage) => ledger
    .filter((row) => cleanText(row?.logical_stage) === stage)
    .reduce((sum, row) => sum + Math.max(0, Number(row?.provider_calls || 0)), 0);
  const finalOwner = cleanText(execution?.final_observation_owner);
  return Object.freeze({
    ...shadow,
    observed_production_action: finalOwner === "TARGETED_VISUAL_OBSERVATION"
      ? "RUN_TARGETED_VISUAL_PROVIDER"
      : finalOwner === "FULL_PROVIDER_OBSERVATION"
        ? "RUN_FULL_PROVIDER"
        : calls === null
      ? "UNKNOWN"
      : calls > 0
        ? "RUN_FULL_PROVIDER"
        : "RETURN_WITHOUT_PROVIDER",
    observed_provider_calls: calls,
    observed_provider_call_skipped: skipped,
    observed_targeted_visual_provider_calls: execution ? stageCalls("TARGETED_VISUAL_OBSERVATION") : null,
    observed_world_knowledge_provider_calls: execution ? stageCalls("WORLD_KNOWLEDGE_ASSIST") : null,
    observed_full_provider_calls: execution ? stageCalls("FULL_PROVIDER_OBSERVATION") : null,
    observed_final_observation_owner: finalOwner || null,
    observed_fallback_reason_code: cleanText(execution?.fallback_reason_code) || null,
    first_provider_call_started_at: firstProviderStartedAt,
    decision_frozen_before_provider: decisionFrozenBeforeProvider
  });
}
