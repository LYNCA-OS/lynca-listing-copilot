import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  evaluateGoldenSemAccuracy,
  normalizeGoldenSemValue
} from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { goldenSemLaunchFields } from "../lib/listing/evaluation/golden-sem-release.mjs";
import { productProxyComparisonKey } from "../lib/listing/csm/product-semantics.mjs";

export const retrievalAblationCriticalFields = Object.freeze([
  "subject",
  "product",
  "set",
  "card_number",
  "print_finish",
  "numerical_rarity",
  "grading_info"
]);

const retrievalApplicationReplaySchemaVersion = "retrieval-application-replay-v1";
const sha256FingerprintPattern = /^sha256:[a-f0-9]{64}$/;

export const retrievalCausalInvalidReasons = Object.freeze({
  RETRIEVAL_PROMPT_CONTEXT_NOT_EXPLICITLY_DISABLED: "retrieval_prompt_context_not_explicitly_disabled",
  EXCLUSION_CONFIRMED_NOT_TRUE: "exclusion_confirmed_not_true",
  RETURNED_SELF_CANDIDATE_COUNT_POSITIVE: "returned_self_candidate_count_positive",
  SAME_CARD_EXCLUSION_EVIDENCE_MISSING: "same_card_exclusion_evidence_missing"
});

const criticalFieldDisplayNames = Object.freeze({
  subject: "subject",
  product: "product",
  set: "set",
  card_number: "card_number",
  print_finish: "parallel",
  numerical_rarity: "numerical_rarity",
  grading_info: "grade"
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return Number.isFinite(value) || typeof value !== "number" ? value : null;
  return Object.fromEntries(Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableJsonValue(value[key])]));
}

function fingerprintValue(value) {
  const canonical = JSON.stringify(stableJsonValue(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function providerObservation(row = {}) {
  const candidates = [
    ["raw_provider_fields", row.raw_provider_fields],
    ["provider_fields", row.provider_fields],
    ["breakpoints.raw_provider_fields", row.breakpoints?.raw_provider_fields],
    ["provider_observation", row.provider_observation],
    ["provider_result.raw_provider_fields", row.provider_result?.raw_provider_fields],
    ["provider_result.provider_fields", row.provider_result?.provider_fields],
    ["provider_result.fields", row.provider_result?.fields],
    ["provider_result.observation", row.provider_result?.observation],
    ["provider_result.visual_observation", row.provider_result?.visual_observation],
    ["provider_result", row.provider_result]
  ];
  const match = candidates.find(([, value]) => value !== null && value !== undefined && value !== "");
  if (!match) return { source: "missing", fingerprint: null };
  const [source, value] = match;
  return {
    source,
    fingerprint: fingerprintValue(value)
  };
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerInputTokens(row = {}) {
  const candidates = [
    row.input_tokens,
    row.provider_token_diagnostics?.input_tokens,
    row.provider_token_diagnostics?.prompt_tokens,
    row.provider_result?.input_tokens,
    row.provider_result?.token_diagnostics?.input_tokens,
    row.provider_result?.token_diagnostics?.prompt_tokens,
    row.provider_usage?.input_tokens,
    row.provider_usage?.prompt_tokens,
    row.usage?.input_tokens,
    row.usage?.prompt_tokens
  ];
  for (const value of candidates) {
    const parsed = finiteNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function providerObservationPair(off = {}, on = {}) {
  const disabled = providerObservation(off);
  const enabled = providerObservation(on);
  const disabledInputTokens = providerInputTokens(off);
  const enabledInputTokens = providerInputTokens(on);
  const status = !disabled.fingerprint || !enabled.fingerprint
    ? "MISSING"
    : disabled.fingerprint === enabled.fingerprint
      ? "SAME"
      : "MISMATCH";
  return {
    status,
    retrieval_disabled: { ...disabled, input_tokens: disabledInputTokens },
    retrieval_enabled: { ...enabled, input_tokens: enabledInputTokens },
    input_tokens_same: disabledInputTokens !== null
      && enabledInputTokens !== null
      && disabledInputTokens === enabledInputTokens
  };
}

function rowsFromReport(report = {}) {
  for (const key of ["results", "items", "records", "cards"]) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function rowId(row = {}) {
  return cleanText(
    row.item_id
    || row.query_card_id
    || row.card_id
    || row.asset_id
    || row.source_feedback_id
    || row.candidate_id
  ).toLowerCase();
}

function rowMap(report = {}) {
  return new Map(rowsFromReport(report).map((row) => [rowId(row), row]).filter(([id]) => Boolean(id)));
}

function explicitBooleanValues(...values) {
  return values.filter((value) => typeof value === "boolean");
}

function retrievalPromptContextEvidence(row = {}) {
  const enabledValues = explicitBooleanValues(
    row.retrieval_prompt_context_enabled,
    row.provider_result?.retrieval_prompt_context_enabled,
    row.response?.retrieval_prompt_context_enabled,
    row.data?.retrieval_prompt_context_enabled
  );
  const usedValues = explicitBooleanValues(
    row.retrieval_prompt_context_used,
    row.provider_result?.retrieval_prompt_context_used,
    row.response?.retrieval_prompt_context_used,
    row.data?.retrieval_prompt_context_used
  );
  return {
    enabled: enabledValues.length === 1 ? enabledValues[0] : null,
    enabled_observations: enabledValues,
    used: usedValues.some((value) => value === true),
    explicitly_disabled: enabledValues.length > 0
      && enabledValues.every((value) => value === false)
      && !usedValues.some((value) => value === true)
  };
}

function exclusionObservationFromRow(row = {}) {
  return [
    row.exclusion_observation,
    row.provider_result?.exclusion_observation,
    row.response?.exclusion_observation,
    row.data?.exclusion_observation
  ].find(isRecord) || null;
}

function requestedExclusionIdentifierCount(identifiers = {}) {
  if (!isRecord(identifiers)) return 0;
  const values = [
    identifiers.source_feedback_id,
    identifiers.asset_id,
    identifiers.physical_card_id,
    identifiers.physical_instance_group_id,
    ...(Array.isArray(identifiers.image_ids) ? identifiers.image_ids : []),
    ...(Array.isArray(identifiers.object_paths) ? identifiers.object_paths : []),
    ...(Array.isArray(identifiers.content_sha256) ? identifiers.content_sha256 : [])
  ];
  return values.filter((value) => cleanText(value)).length;
}

function selfExclusionEvidence(row = {}) {
  const observation = exclusionObservationFromRow(row);
  const confirmedValues = explicitBooleanValues(
    row.exclusion_confirmed,
    observation?.exclusion_confirmed,
    observation?.confirmed,
    observation?.catalog?.confirmed,
    observation?.vector?.confirmed
  );
  const returnedCounts = [
    row.returned_self_candidate_count,
    observation?.returned_self_candidate_count,
    observation?.catalog?.returned_self_candidate_count,
    observation?.vector?.returned_self_candidate_count
  ].map(finiteNumberOrNull).filter((value) => value !== null);
  const returnedSelfCandidateCount = returnedCounts.length
    ? Math.max(...returnedCounts)
    : null;
  const requestedIdentifiers = observation?.requested_identifiers;
  const requestedIdentifierCount = requestedExclusionIdentifierCount(requestedIdentifiers);
  const rowRequested = explicitBooleanValues(row.exclusion_requested);
  const observationRequested = explicitBooleanValues(
    observation?.exclusion_requested,
    observation?.requested
  );
  const expectedChannels = ["catalog", "vector"];
  const channelEvidencePresent = expectedChannels.every((channelName) => {
    const channel = observation?.[channelName];
    return isRecord(channel)
      && channel.enabled === true
      && channel.requested === true
      && typeof channel.confirmed === "boolean"
      && finiteNumberOrNull(channel.returned_self_candidate_count) !== null;
  });
  const evidenceDeclarations = explicitBooleanValues(
    row.same_card_exclusion_evidence_present,
    observation?.same_card_exclusion_evidence_present,
    observation?.same_card_exclusion_evidence?.present
  );
  const sameCardExclusionEvidencePresent = isRecord(observation)
    && rowRequested.length > 0
    && rowRequested.every((value) => value === true)
    && observationRequested.length > 0
    && observationRequested.every((value) => value === true)
    && requestedIdentifierCount > 0
    && returnedCounts.length > 0
    && channelEvidencePresent
    && !evidenceDeclarations.some((value) => value === false);
  return {
    exclusion_confirmed: confirmedValues.length > 0
      && confirmedValues.every((value) => value === true),
    exclusion_confirmed_observations: confirmedValues,
    returned_self_candidate_count: returnedSelfCandidateCount,
    same_card_exclusion_evidence_present: sameCardExclusionEvidencePresent,
    requested_identifier_count: requestedIdentifierCount,
    expected_channels: expectedChannels,
    observation_present: isRecord(observation)
  };
}

function causalInputIsolation(offReport = {}, onReport = {}, datasetIds = []) {
  const offRows = rowMap(offReport);
  const onRows = rowMap(onReport);
  const perCard = datasetIds.map((itemId) => {
    const offPromptContext = retrievalPromptContextEvidence(offRows.get(itemId) || {});
    const onPromptContext = retrievalPromptContextEvidence(onRows.get(itemId) || {});
    const exclusion = selfExclusionEvidence(onRows.get(itemId) || {});
    const invalidReasons = [];
    if (!offPromptContext.explicitly_disabled || !onPromptContext.explicitly_disabled) {
      invalidReasons.push(retrievalCausalInvalidReasons.RETRIEVAL_PROMPT_CONTEXT_NOT_EXPLICITLY_DISABLED);
    }
    if (exclusion.exclusion_confirmed !== true) {
      invalidReasons.push(retrievalCausalInvalidReasons.EXCLUSION_CONFIRMED_NOT_TRUE);
    }
    if (Number(exclusion.returned_self_candidate_count || 0) > 0) {
      invalidReasons.push(retrievalCausalInvalidReasons.RETURNED_SELF_CANDIDATE_COUNT_POSITIVE);
    }
    if (exclusion.same_card_exclusion_evidence_present !== true) {
      invalidReasons.push(retrievalCausalInvalidReasons.SAME_CARD_EXCLUSION_EVIDENCE_MISSING);
    }
    return {
      item_id: itemId,
      valid: invalidReasons.length === 0,
      invalid_reasons: invalidReasons,
      retrieval_prompt_context: {
        retrieval_disabled: offPromptContext,
        retrieval_enabled: onPromptContext
      },
      self_exclusion: exclusion
    };
  });
  const invalidReasons = [...new Set(perCard.flatMap((row) => row.invalid_reasons))];
  const invalidReasonItemIds = Object.fromEntries(invalidReasons.map((reason) => [
    reason,
    perCard.filter((row) => row.invalid_reasons.includes(reason)).map((row) => row.item_id)
  ]));
  return {
    valid: datasetIds.length > 0 && perCard.every((row) => row.valid),
    invalid_reasons: invalidReasons,
    invalid_item_ids: perCard.filter((row) => !row.valid).map((row) => row.item_id),
    invalid_reason_item_ids: invalidReasonItemIds,
    per_card: perCard
  };
}

function replayFromRow(row = {}) {
  return [
    row.retrieval_application_replay,
    row.provider_result?.retrieval_application_replay,
    row.response?.retrieval_application_replay,
    row.data?.retrieval_application_replay
  ].find(isRecord) || null;
}

function exactZero(value) {
  return value !== null && value !== undefined && value !== "" && Number(value) === 0;
}

function replayArmProof(replay = {}, armName = "", sharedInputFingerprint = "") {
  const arm = replay?.arms?.[armName];
  const projection = arm?.semantic_projection;
  const application = projection?.retrieval_application;
  const inputFingerprint = cleanText(arm?.input_fingerprint);
  const semanticFingerprint = cleanText(arm?.semantic_fingerprint);
  const expectedEnabled = armName === "on";
  const projectionPresent = isRecord(projection);
  const semanticFingerprintValid = projectionPresent
    && sha256FingerprintPattern.test(semanticFingerprint)
    && fingerprintValue(projection) === semanticFingerprint;
  const applicationStateValid = isRecord(application)
    && application.enabled === expectedEnabled
    && (expectedEnabled
      ? application.resolver_consumed === true
      : application.resolver_consumed === false
        && exactZero(application.identity_evidence_count)
        && exactZero(application.actual_application_count)
        && Array.isArray(application.actual_applied_fields)
        && application.actual_applied_fields.length === 0);
  const inputFingerprintValid = sha256FingerprintPattern.test(inputFingerprint)
    && inputFingerprint === sharedInputFingerprint;
  return {
    arm: armName.toUpperCase(),
    input_fingerprint: inputFingerprint || null,
    input_fingerprint_valid: inputFingerprintValid,
    semantic_fingerprint: semanticFingerprint || null,
    semantic_projection_present: projectionPresent,
    semantic_fingerprint_valid: semanticFingerprintValid,
    application_state_valid: applicationStateValid,
    valid: inputFingerprintValid && semanticFingerprintValid && applicationStateValid
  };
}

function replayProofForRow(row = {}) {
  const replay = replayFromRow(row);
  const sharedInputFingerprint = cleanText(replay?.shared?.fingerprints?.replay_input);
  const schemaValid = replay?.schema_version === retrievalApplicationReplaySchemaVersion;
  const sharedInputFingerprintValid = sha256FingerprintPattern.test(sharedInputFingerprint);
  const off = replayArmProof(replay || {}, "off", sharedInputFingerprint);
  const on = replayArmProof(replay || {}, "on", sharedInputFingerprint);
  const semanticArmsDistinct = Boolean(
    off.semantic_fingerprint
    && on.semantic_fingerprint
    && off.semantic_fingerprint !== on.semantic_fingerprint
  );
  const armProofValid = off.valid && on.valid && semanticArmsDistinct;
  return {
    item_id: rowId(row),
    replay_present: Boolean(replay),
    schema_version: replay?.schema_version || null,
    schema_valid: schemaValid,
    shared_input_fingerprint: sharedInputFingerprint || null,
    matching_nonempty_input_fingerprint: sharedInputFingerprintValid
      && off.input_fingerprint_valid
      && on.input_fingerprint_valid,
    semantic_arms_distinct: semanticArmsDistinct,
    arm_proof_valid: armProofValid,
    arms: { off, on },
    valid: Boolean(replay)
      && schemaValid
      && sharedInputFingerprintValid
      && armProofValid
  };
}

function replayProofSummary(report = {}, datasetIds = []) {
  const sourceRows = rowsFromReport(report);
  const rowsById = new Map();
  for (const row of sourceRows) {
    const id = rowId(row);
    if (!id) continue;
    if (!rowsById.has(id)) rowsById.set(id, []);
    rowsById.get(id).push(row);
  }
  const perCard = datasetIds.map((id) => {
    const matches = rowsById.get(id) || [];
    const proof = matches.length ? replayProofForRow(matches[0]) : {
      item_id: id,
      replay_present: false,
      schema_version: null,
      schema_valid: false,
      shared_input_fingerprint: null,
      matching_nonempty_input_fingerprint: false,
      semantic_arms_distinct: false,
      arm_proof_valid: false,
      arms: null,
      valid: false
    };
    return {
      ...proof,
      item_id: id,
      occurrence_count: matches.length,
      technical_failure: matches.some((row) => row.technical_failure === true),
      valid: matches.length === 1
        && proof.valid === true
        && matches[0].technical_failure !== true
    };
  });
  const schemaValidCount = perCard.filter((proof) => proof.schema_valid).length;
  const inputFingerprintValidCount = perCard
    .filter((proof) => proof.matching_nonempty_input_fingerprint).length;
  const armProofValidCount = perCard.filter((proof) => proof.arm_proof_valid).length;
  const technicalFailureItemIds = perCard.filter((proof) => proof.technical_failure).map((proof) => proof.item_id);
  const missingItemIds = perCard.filter((proof) => proof.occurrence_count === 0).map((proof) => proof.item_id);
  const duplicateItemIds = perCard.filter((proof) => proof.occurrence_count > 1).map((proof) => proof.item_id);
  const invalidItemIds = perCard.filter((proof) => !proof.valid).map((proof) => proof.item_id);
  const expectedCardCount = datasetIds.length;
  return {
    expected_schema_version: retrievalApplicationReplaySchemaVersion,
    source_result_count: sourceRows.length,
    dataset_card_count: expectedCardCount,
    replay_present_count: perCard.filter((proof) => proof.replay_present).length,
    schema_valid_count: schemaValidCount,
    matching_nonempty_input_fingerprint_count: inputFingerprintValidCount,
    arm_proof_valid_count: armProofValidCount,
    valid_card_count: perCard.filter((proof) => proof.valid).length,
    schema_valid: expectedCardCount > 0 && schemaValidCount === expectedCardCount,
    input_fingerprints_valid: expectedCardCount > 0
      && inputFingerprintValidCount === expectedCardCount,
    arm_proof_valid: expectedCardCount > 0 && armProofValidCount === expectedCardCount,
    technical_failure_count: technicalFailureItemIds.length,
    technical_failure_item_ids: technicalFailureItemIds,
    missing_item_ids: missingItemIds,
    duplicate_item_ids: duplicateItemIds,
    invalid_item_ids: invalidItemIds,
    per_card: perCard,
    valid: expectedCardCount > 0 && invalidItemIds.length === 0
  };
}

function replayApplicationProjection(application) {
  if (!isRecord(application)) return null;
  return {
    ...application,
    decisions: (Array.isArray(application.decisions) ? application.decisions : []).map((decision) => ({
      ...decision,
      resolver_value: decision.resolver_value ?? decision.final_value ?? null
    }))
  };
}

function replayArmRow(row = {}, armName = "") {
  const replay = replayFromRow(row) || {};
  const projection = replay?.arms?.[armName]?.semantic_projection || {};
  const oppositeProjection = replay?.arms?.[armName === "off" ? "on" : "off"]?.semantic_projection || {};
  const application = replayApplicationProjection(projection.retrieval_application);
  const title = projection.final_title ?? projection.rendered_title ?? "";
  const oppositeTitle = oppositeProjection.final_title ?? oppositeProjection.rendered_title ?? "";
  const titleChanged = cleanText(title) !== cleanText(oppositeTitle);
  const directFieldSources = replay?.shared?.projection?.direct_observation?.field_sources || {};
  const proof = replayProofForRow(row);
  return {
    ...row,
    item_id: row.item_id || rowId(row),
    title,
    final_title: title,
    rendered_title: projection.rendered_title ?? title,
    resolved_fields: projection.resolved_fields || {},
    unresolved: Array.isArray(projection.unresolved) ? projection.unresolved : [],
    identity_resolution: projection.identity_resolution || null,
    raw_provider_fields: row.raw_provider_fields
      ?? directFieldSources.raw_provider_fields
      ?? directFieldSources.provider_fields
      ?? null,
    retrieval_application: application ? {
      ...application,
      title_changed: armName === "on" ? titleChanged : false,
      title_before: armName === "on" ? oppositeTitle : title,
      title_after: title
    } : null,
    retrieval_evidence_isolation: projection.retrieval_evidence_isolation || null,
    retrieval_application_replay_proof: {
      schema_version: proof.schema_version,
      schema_valid: proof.schema_valid,
      shared_input_fingerprint: proof.shared_input_fingerprint,
      arm: armName.toUpperCase(),
      arm_proof: proof.arms?.[armName] || null,
      valid: proof.valid
    },
    retrieval_ablation_execution: {
      contract_id: retrievalApplicationReplaySchemaVersion,
      arm: armName.toUpperCase(),
      terminal_path: "single_observation_replay",
      replay_input_fingerprint: proof.shared_input_fingerprint,
      arm_semantic_fingerprint: proof.arms?.[armName]?.semantic_fingerprint || null,
      arm_proof_valid: proof.arms?.[armName]?.valid === true
    }
  };
}

export function splitRetrievalApplicationReplayReport(report = {}) {
  const buildArmReport = (armName) => ({
    ...report,
    experiment_contract: {
      contract_id: retrievalApplicationReplaySchemaVersion,
      arm: armName.toUpperCase(),
      comparison_mode: "SINGLE_OBSERVATION_REPLAY",
      single_observation_deterministic_replay: true
    },
    results: rowsFromReport(report).map((row) => replayArmRow(row, armName))
  });
  const off = buildArmReport("off");
  const on = buildArmReport("on");
  return {
    off,
    on,
    retrievalDisabledReport: off,
    retrievalEnabledReport: on
  };
}

function finalTitle(row = {}) {
  return cleanText(row.final_title || row.title || row.l2_status?.title || row.l2_status?.final_title);
}

function retrievalApplication(row = {}) {
  return row.retrieval_application
    || row.l2_candidate_debug?.retrieval_application
    || row.candidate_control_plane_trace?.retrieval_application
    || row.l2_status?.candidate_control_plane_trace?.retrieval_application
    || null;
}

function rate(correct, total) {
  return total > 0 ? Number((correct / total).toFixed(6)) : null;
}

function criticalAccuracy(accuracyReport = {}, fields = retrievalAblationCriticalFields) {
  const perField = accuracyReport.metrics?.per_field_exact_accuracy || {};
  const totals = fields.reduce((summary, field) => {
    summary.correct += Number(perField[field]?.correct || 0);
    summary.total += Number(perField[field]?.total || 0);
    return summary;
  }, { correct: 0, total: 0 });
  return {
    ...totals,
    rate: rate(totals.correct, totals.total),
    fields: Object.fromEntries(fields.map((field) => [criticalFieldDisplayNames[field] || field, {
      sem_field: field,
      ...(perField[field] || {
        correct: 0,
        total: 0,
        accuracy: null
      })
    }]))
  };
}

function cardExactMap(accuracyReport = {}) {
  return new Map((accuracyReport.cards || []).map((card) => [cleanText(card.item_id).toLowerCase(), card.card_exact]));
}

function accuracyCardMap(accuracyReport = {}) {
  return new Map((accuracyReport.cards || []).map((card) => [cleanText(card.item_id).toLowerCase(), card]));
}

function applicationDecisions(application = {}) {
  return Array.isArray(application?.decisions) ? application.decisions : [];
}

function semFieldForDecision(row = {}) {
  const field = cleanText(row.resolver_field || row.field).toLowerCase();
  if (["player", "players", "character", "subject", "subjects"].includes(field)) return "subject";
  if (["collector_number", "checklist_code", "tcg_card_number", "card_number"].includes(field)) return "card_number";
  if (["parallel", "parallel_exact", "surface_color", "product_finish", "print_finish"].includes(field)) return "print_finish";
  if (["grade", "grade_company", "card_grade", "auto_grade", "grade_type", "grading_info"].includes(field)) return "grading_info";
  if (["serial_number", "print_run_number", "numerical_rarity"].includes(field)) return "numerical_rarity";
  return goldenSemLaunchFields.includes(field) ? field : null;
}

function sourceLane(row = {}) {
  const lane = cleanText(row.candidate_lane).toLowerCase();
  if (lane) return lane;
  return /vector/i.test(cleanText(row.source || row.source_type)) ? "vector" : "catalog";
}

function candidateValueForSemDecision(row = {}, semField = "", accuracyField = {}) {
  const field = cleanText(row.resolver_field || row.field).toLowerCase();
  const value = row.candidate_value;
  if (semField !== "grading_info") return value;
  const groundTruth = accuracyField.ground_truth;
  if (!groundTruth || typeof groundTruth !== "object" || Array.isArray(groundTruth)) return value;
  const gradeFieldMap = {
    grade_company: "company",
    card_grade: "card_grade",
    grade: "card_grade",
    auto_grade: "auto_grade",
    grade_type: "grade_type"
  };
  const targetField = gradeFieldMap[field];
  return targetField ? { [targetField]: value } : value;
}

function expectedValueForSemDecision(row = {}, semField = "", accuracyField = {}) {
  if (semField !== "grading_info") return accuracyField.ground_truth;
  const field = cleanText(row.resolver_field || row.field).toLowerCase();
  const groundTruth = accuracyField.ground_truth;
  if (!groundTruth || typeof groundTruth !== "object" || Array.isArray(groundTruth)) return groundTruth;
  const gradeFieldMap = {
    grade_company: "company",
    card_grade: "card_grade",
    grade: "card_grade",
    auto_grade: "auto_grade",
    grade_type: "grade_type"
  };
  const targetField = gradeFieldMap[field];
  return targetField ? { [targetField]: groundTruth[targetField] } : groundTruth;
}

function fieldDecisionAudit(application = {}, accuracyCard = {}) {
  return applicationDecisions(application).map((row) => {
    const semField = semFieldForDecision(row);
    const accuracyField = semField ? accuracyCard?.fields?.[semField] || {} : {};
    const excluded = !semField || accuracyField.excluded_from_denominator === true;
    const candidateValue = excluded ? null : candidateValueForSemDecision(row, semField, accuracyField);
    const expectedValue = excluded ? null : expectedValueForSemDecision(row, semField, accuracyField);
    const normalizeForAudit = accuracyField.comparison_policy === "TITLE_PROXY_PRODUCT_HIERARCHY"
      && semField === "product"
      ? productProxyComparisonKey
      : (value) => normalizeGoldenSemValue(semField, value);
    const normalizedCandidate = excluded ? null : normalizeForAudit(candidateValue);
    const normalizedExpected = excluded ? null : normalizeForAudit(expectedValue);
    const normalizedResolver = excluded ? null : normalizeForAudit(row.resolver_value);
    const candidateCorrect = excluded ? null : normalizedCandidate === normalizedExpected;
    const resolverCorrect = excluded ? null : normalizedResolver === normalizedExpected;
    const applied = row.applied_to_final === true;
    const supported = row.supported_final === true;
    const eligibleForApplication = row.decision !== "REJECT";
    return {
      candidate_id: row.candidate_id || null,
      candidate_lane: sourceLane(row),
      field: row.field || null,
      resolver_field: row.resolver_field || row.field || null,
      sem_field: semField,
      candidate_value: row.candidate_value ?? null,
      resolver_value: row.resolver_value ?? null,
      ground_truth: excluded ? null : accuracyField.ground_truth,
      candidate_correct: candidateCorrect,
      resolver_correct: resolverCorrect,
      decision: row.decision || null,
      reason: row.reason || "unspecified",
      applied_to_final: applied,
      supported_final: supported,
      candidate_correct_but_not_applied: candidateCorrect === true
        && eligibleForApplication
        && !applied
        && !supported
        && resolverCorrect !== true
        && accuracyField.is_correct !== true,
      candidate_correct_resolver_already_correct_but_not_rendered: candidateCorrect === true
        && resolverCorrect === true
        && accuracyField.is_correct !== true,
      candidate_wrong_but_applied: candidateCorrect === false && applied,
      candidate_wrong_but_supported: candidateCorrect === false && supported,
      candidate_wrong_but_influential: candidateCorrect === false && (applied || supported)
    };
  });
}

function fieldDelta(offCard = {}, onCard = {}, application = {}) {
  const improvedFields = [];
  const regressedFields = [];
  const changedFields = [];
  const fieldComparisons = {};
  for (const field of goldenSemLaunchFields) {
    const offField = offCard.fields?.[field] || {};
    const onField = onCard.fields?.[field] || {};
    if (offField.excluded_from_denominator || onField.excluded_from_denominator) continue;
    const offCorrect = offField.is_correct === true;
    const onCorrect = onField.is_correct === true;
    const predictionChanged = offField.normalized_prediction !== onField.normalized_prediction;
    if (predictionChanged) changedFields.push(field);
    if (!offCorrect && onCorrect) improvedFields.push(field);
    if (offCorrect && !onCorrect) regressedFields.push(field);
    fieldComparisons[field] = {
      ground_truth: onField.ground_truth,
      retrieval_off_prediction: offField.prediction,
      retrieval_on_prediction: onField.prediction,
      retrieval_off_correct: offField.is_correct ?? null,
      retrieval_on_correct: onField.is_correct ?? null,
      prediction_changed: predictionChanged
    };
  }
  const relevantDecisions = applicationDecisions(application).filter((row) => {
    const semField = semFieldForDecision(row);
    return Boolean(semField && changedFields.includes(semField));
  });
  const appliedDecisions = relevantDecisions.filter((row) => row.applied_to_final === true);
  const supportingDecisions = relevantDecisions.filter((row) => row.supported_final === true);
  const contextDecisions = relevantDecisions.filter((row) => row.decision !== "REJECT");
  const sources = [...new Set(appliedDecisions.map(sourceLane).filter(Boolean))];
  const supportingSources = [...new Set(supportingDecisions.map(sourceLane).filter(Boolean))];
  const contextSources = [...new Set(contextDecisions.map(sourceLane).filter(Boolean))];
  const candidateIds = [...new Set(appliedDecisions.map((row) => cleanText(row.candidate_id)).filter(Boolean))];
  const outcome = improvedFields.length && regressedFields.length
    ? "MIXED"
    : improvedFields.length
      ? "IMPROVED"
      : regressedFields.length
        ? "REGRESSED"
        : "NO_CHANGE";
  return {
    outcome,
    improved_fields: improvedFields,
    regressed_fields: regressedFields,
    changed_fields: changedFields,
    source: sources,
    supporting_source: supportingSources,
    candidate_context_source: contextSources,
    candidate_ids: candidateIds,
    attribution: appliedDecisions.length
      ? "FIELD_APPLICATION"
      : changedFields.length && contextDecisions.length
        ? "RETRIEVAL_CONTEXT_OR_MODEL_VARIANCE"
        : "NONE",
    field_comparisons: fieldComparisons
  };
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rawRetrievedCandidateCount(row = {}) {
  const catalog = numeric(row.catalog_activation_funnel?.raw_candidate_count, numeric(row.catalog_candidate_count));
  const vector = numeric(row.vector_activation_funnel?.raw_candidate_count, numeric(row.vector_raw_candidate_count));
  return catalog + vector;
}

function decisionEligibleCandidateCount(row = {}, application = {}) {
  if (numeric(row.decision_eligible_candidate_count) > 0) return numeric(row.decision_eligible_candidate_count);
  const ids = new Set(applicationDecisions(application)
    .filter((decision) => decision.reason !== "candidate_not_decision_eligible" && decision.reason !== "retrieval_application_disabled")
    .map((decision) => cleanText(decision.candidate_id))
    .filter(Boolean));
  return ids.size;
}

function applicationFunnel(perCard = []) {
  const totals = perCard.reduce((summary, row) => {
    const application = row.retrieval_application || {};
    const decisions = applicationDecisions(application);
    const retrieved = row.retrieved_candidate_count;
    const eligible = row.eligible_candidate_count;
    const fieldRows = numeric(application.field_evidence_count, decisions.length);
    const resolverEvidence = numeric(
      application.identity_evidence_count,
      decisions.filter((decision) => ["APPLY", "SUPPORT"].includes(decision.decision)).length
    );
    const applyDecisions = decisions.filter((decision) => decision.decision === "APPLY").length;
    const supportDecisions = decisions.filter((decision) => decision.decision === "SUPPORT").length;
    const actualApplied = numeric(application.actual_application_count, row.candidate_application_count);
    const isolation = row.retrieval_evidence_isolation || {};
    const auditRows = Array.isArray(row.field_decision_audit) ? row.field_decision_audit : [];
    summary.retrieved_candidate_count += retrieved;
    summary.eligible_candidate_count += eligible;
    summary.field_decision_row_count += fieldRows;
    summary.resolver_evidence_row_count += resolverEvidence;
    summary.apply_decision_count += applyDecisions;
    summary.support_decision_count += supportDecisions;
    summary.actual_applied_field_count += actualApplied;
    summary.blocked_raw_candidate_evidence_count += numeric(isolation.blocked_raw_candidate_evidence_count);
    summary.candidate_correct_but_not_applied += auditRows.filter((item) => item.candidate_correct_but_not_applied).length;
    summary.candidate_correct_resolver_already_correct_but_not_rendered += auditRows
      .filter((item) => item.candidate_correct_resolver_already_correct_but_not_rendered).length;
    summary.candidate_wrong_but_applied += auditRows.filter((item) => item.candidate_wrong_but_applied).length;
    summary.candidate_wrong_but_supported += auditRows.filter((item) => item.candidate_wrong_but_supported).length;
    summary.candidate_wrong_but_influential += auditRows.filter((item) => item.candidate_wrong_but_influential).length;
    if (retrieved > 0) summary.cards_with_retrieval += 1;
    if (eligible > 0) summary.cards_with_eligible_candidates += 1;
    if (fieldRows > 0) summary.cards_with_field_decisions += 1;
    if (resolverEvidence > 0) summary.cards_with_resolver_evidence += 1;
    if (cleanText(application.selected_candidate_id)) summary.cards_with_selected_candidate += 1;
    if (cleanText(application.low_margin_candidate_id)) summary.cards_with_low_margin_candidate += 1;
    if (applyDecisions > 0) summary.cards_with_apply_decision += 1;
    if (actualApplied > 0) summary.cards_with_resolved_change += 1;
    if (row.arm_title_changed) summary.cards_with_arm_title_delta += 1;
    if (row.application_title_changed) summary.cards_with_application_title_change += 1;
    for (const decision of decisions.filter((item) => item.applied_to_final === true)) {
      const lane = sourceLane(decision);
      summary.applied_fields_by_source[lane] = numeric(summary.applied_fields_by_source[lane]) + 1;
    }
    for (const decision of decisions) {
      const field = cleanText(decision.resolver_field || decision.field).toLowerCase() || "unknown";
      const action = cleanText(decision.decision).toUpperCase() || "UNKNOWN";
      const reason = cleanText(decision.reason) || "unspecified";
      if (!summary.field_decision_counts[field]) {
        summary.field_decision_counts[field] = { APPLY: 0, SUPPORT: 0, BLOCK: 0, REJECT: 0, UNKNOWN: 0 };
      }
      summary.field_decision_counts[field][action] = numeric(summary.field_decision_counts[field][action]) + 1;
      summary.decision_reason_counts[reason] = numeric(summary.decision_reason_counts[reason]) + 1;
      if (action === "BLOCK") {
        summary.blocked_by_reason[reason] = numeric(summary.blocked_by_reason[reason]) + 1;
      } else if (action === "REJECT") {
        summary.rejected_by_reason[reason] = numeric(summary.rejected_by_reason[reason]) + 1;
      }
    }
    for (const audit of auditRows) {
      const field = cleanText(audit.sem_field || audit.resolver_field || audit.field).toLowerCase() || "unknown";
      summary.field_accuracy_decision_audit[field] ||= {
        candidate_correct_but_not_applied: 0,
        candidate_correct_resolver_already_correct_but_not_rendered: 0,
        candidate_wrong_but_applied: 0,
        candidate_wrong_but_supported: 0,
        candidate_wrong_but_influential: 0,
        correct_candidate_supported_final: 0,
        correct_candidate_applied: 0
      };
      if (audit.candidate_correct_but_not_applied) {
        summary.field_accuracy_decision_audit[field].candidate_correct_but_not_applied += 1;
      }
      if (audit.candidate_correct_resolver_already_correct_but_not_rendered) {
        summary.field_accuracy_decision_audit[field].candidate_correct_resolver_already_correct_but_not_rendered += 1;
      }
      if (audit.candidate_wrong_but_applied) {
        summary.field_accuracy_decision_audit[field].candidate_wrong_but_applied += 1;
      }
      if (audit.candidate_wrong_but_supported) {
        summary.field_accuracy_decision_audit[field].candidate_wrong_but_supported += 1;
      }
      if (audit.candidate_wrong_but_influential) {
        summary.field_accuracy_decision_audit[field].candidate_wrong_but_influential += 1;
      }
      if (audit.candidate_correct === true && audit.supported_final === true) {
        summary.field_accuracy_decision_audit[field].correct_candidate_supported_final += 1;
      }
      if (audit.candidate_correct === true && audit.applied_to_final === true) {
        summary.field_accuracy_decision_audit[field].correct_candidate_applied += 1;
      }
    }
    return summary;
  }, {
    card_count: perCard.length,
    retrieved_candidate_count: 0,
    eligible_candidate_count: 0,
    field_decision_row_count: 0,
    resolver_evidence_row_count: 0,
    apply_decision_count: 0,
    support_decision_count: 0,
    actual_applied_field_count: 0,
    blocked_raw_candidate_evidence_count: 0,
    candidate_correct_but_not_applied: 0,
    candidate_correct_resolver_already_correct_but_not_rendered: 0,
    candidate_wrong_but_applied: 0,
    candidate_wrong_but_supported: 0,
    candidate_wrong_but_influential: 0,
    cards_with_retrieval: 0,
    cards_with_eligible_candidates: 0,
    cards_with_field_decisions: 0,
    cards_with_resolver_evidence: 0,
    cards_with_selected_candidate: 0,
    cards_with_low_margin_candidate: 0,
    cards_with_apply_decision: 0,
    cards_with_resolved_change: 0,
    cards_with_arm_title_delta: 0,
    cards_with_application_title_change: 0,
    applied_fields_by_source: {},
    field_decision_counts: {},
    decision_reason_counts: {},
    blocked_by_reason: {},
    rejected_by_reason: {},
    field_accuracy_decision_audit: {}
  });
  const uniqueCardFieldCount = (predicate) => new Set(perCard.flatMap((row) => (
    (row.field_decision_audit || [])
      .filter(predicate)
      .map((audit) => `${row.item_id}:${audit.sem_field || audit.resolver_field || audit.field || "unknown"}`)
  ))).size;
  return {
    ...totals,
    unique_card_field_candidate_correct_but_not_applied: uniqueCardFieldCount(
      (audit) => audit.candidate_correct_but_not_applied === true
    ),
    unique_card_field_candidate_wrong_but_applied: uniqueCardFieldCount(
      (audit) => audit.candidate_wrong_but_applied === true
    ),
    unique_card_field_candidate_wrong_but_supported: uniqueCardFieldCount(
      (audit) => audit.candidate_wrong_but_supported === true
    ),
    unique_card_field_candidate_wrong_but_influential: uniqueCardFieldCount(
      (audit) => audit.candidate_wrong_but_influential === true
    ),
    retrieval_card_rate: rate(totals.cards_with_retrieval, totals.card_count),
    eligible_from_retrieved_rate: rate(totals.eligible_candidate_count, totals.retrieved_candidate_count),
    resolver_evidence_from_eligible_rate: rate(totals.resolver_evidence_row_count, totals.field_decision_row_count),
    selected_candidate_card_rate: rate(totals.cards_with_selected_candidate, totals.card_count),
    low_margin_candidate_card_rate: rate(totals.cards_with_low_margin_candidate, totals.card_count),
    candidate_application_rate: rate(totals.cards_with_resolved_change, totals.cards_with_eligible_candidates),
    apply_realization_rate: rate(totals.actual_applied_field_count, totals.apply_decision_count),
    resolved_change_card_rate: rate(totals.cards_with_resolved_change, totals.card_count),
    arm_title_delta_card_rate: rate(totals.cards_with_arm_title_delta, totals.card_count),
    application_title_change_card_rate: rate(totals.cards_with_application_title_change, totals.card_count)
  };
}

function modelIds(report = {}) {
  return [...new Set([
    cleanText(report.cloud_preflight?.default_model),
    ...rowsFromReport(report).map((row) => cleanText(row.model_id))
  ].filter(Boolean))].sort();
}

function deploymentSha(report = {}) {
  return cleanText(
    report.cloud_preflight?.deployment?.git_commit_sha
    || report.cloud_preflight?.git_commit_sha
    || report.deployment?.git_commit_sha
  );
}

function runtimeIsolation(offReport = {}, onReport = {}) {
  const offRows = rowsFromReport(offReport);
  const onRows = rowsFromReport(onReport);
  const technicalFailureIds = (rows = []) => rows
    .filter((row) => row.technical_failure === true)
    .map(rowId)
    .filter(Boolean);
  const offRetrievalLeakRows = offRows.filter((row) => {
    const providers = Array.isArray(row.retrieval_providers_used) ? row.retrieval_providers_used : [];
    return rawRetrievedCandidateCount(row) > 0
      || numeric(row.catalog_prompt_candidate_count) > 0
      || numeric(row.vector_prompt_candidate_count) > 0
      || providers.length > 0
      || row.catalog_prompt_assist_used === true
      || row.vector_prompt_assist_used === true
      || row.retrieval_application?.enabled === true;
  });
  const offExternalRows = offRows.filter((row) => row.external_retrieval_used === true);
  const onExternalRows = onRows.filter((row) => row.external_retrieval_used === true);
  const offTechnicalFailureIds = technicalFailureIds(offRows);
  const onTechnicalFailureIds = technicalFailureIds(onRows);
  const executionTraceValid = (row = {}, expectedArm = "") => {
    const trace = row.retrieval_ablation_execution;
    if (!trace || trace.contract_id !== "retrieval-application-ablation-v1" || trace.arm !== expectedArm) return false;
    if (expectedArm === "OFF") {
      return trace.terminal_path === "evidence_completion"
        && trace.evidence_completion_enabled === true
        && trace.evidence_completion_retrieval_disabled === true
        && trace.catalog_enabled === false
        && trace.vector_enabled === false
        && trace.retrieval_application_enabled === false
        && trace.force_retrieval_application_resolution === false
        && trace.retrieval_application_present === false;
    }
    return trace.terminal_path === "evidence_completion"
      && trace.evidence_completion_enabled === true
      && trace.evidence_completion_retrieval_disabled !== true
      && trace.catalog_enabled === true
      && trace.vector_enabled === true
      && trace.retrieval_application_enabled === true
      && trace.force_retrieval_application_resolution === true
      && trace.retrieval_application_present === true
      && trace.retrieval_application_owns_candidate_application === true;
  };
  const offExecutionMismatchRows = offRows.filter((row) => !executionTraceValid(row, "OFF"));
  const onExecutionMismatchRows = onRows.filter((row) => !executionTraceValid(row, "ON"));
  const onApplicationBypassRows = onRows.filter((row) => {
    if (numeric(row.decision_eligible_candidate_count) < 1) return false;
    return applicationDecisions(retrievalApplication(row)).length < 1;
  });
  const onEvidenceIsolationMismatchRows = onRows.filter((row) => {
    if (row.retrieval_application?.owns_candidate_application !== true) return false;
    return row.retrieval_evidence_isolation?.enabled !== true;
  });
  return {
    valid: offRetrievalLeakRows.length === 0
      && offExternalRows.length === 0
      && onExternalRows.length === 0
      && offTechnicalFailureIds.length === 0
      && onTechnicalFailureIds.length === 0
      && offExecutionMismatchRows.length === 0
      && onExecutionMismatchRows.length === 0
      && onApplicationBypassRows.length === 0
      && onEvidenceIsolationMismatchRows.length === 0,
    retrieval_off_leak_count: offRetrievalLeakRows.length,
    retrieval_off_leak_item_ids: offRetrievalLeakRows.map(rowId).filter(Boolean),
    retrieval_off_external_retrieval_count: offExternalRows.length,
    retrieval_on_external_retrieval_count: onExternalRows.length,
    retrieval_off_technical_failure_count: offTechnicalFailureIds.length,
    retrieval_on_technical_failure_count: onTechnicalFailureIds.length,
    retrieval_off_technical_failure_item_ids: offTechnicalFailureIds,
    retrieval_on_technical_failure_item_ids: onTechnicalFailureIds,
    retrieval_off_execution_mismatch_count: offExecutionMismatchRows.length,
    retrieval_on_execution_mismatch_count: onExecutionMismatchRows.length,
    retrieval_off_execution_mismatch_item_ids: offExecutionMismatchRows.map(rowId).filter(Boolean),
    retrieval_on_execution_mismatch_item_ids: onExecutionMismatchRows.map(rowId).filter(Boolean),
    retrieval_on_application_bypass_count: onApplicationBypassRows.length,
    retrieval_on_application_bypass_item_ids: onApplicationBypassRows.map(rowId).filter(Boolean),
    retrieval_on_evidence_isolation_mismatch_count: onEvidenceIsolationMismatchRows.length,
    retrieval_on_evidence_isolation_mismatch_item_ids: onEvidenceIsolationMismatchRows.map(rowId).filter(Boolean)
  };
}

function experimentValidity(offReport = {}, onReport = {}, { replayProof = null } = {}) {
  const off = offReport.experiment_contract || {};
  const on = onReport.experiment_contract || {};
  const offModels = modelIds(offReport);
  const onModels = modelIds(onReport);
  const offSha = deploymentSha(offReport);
  const onSha = deploymentSha(onReport);
  const replayMode = Boolean(replayProof);
  const replayClaimed = off.single_observation_deterministic_replay === true
    && on.single_observation_deterministic_replay === true;
  const runtime = replayMode ? {
    mode: "SINGLE_OBSERVATION_REPLAY",
    valid: replayProof.valid === true,
    technical_failure_count: replayProof.technical_failure_count,
    technical_failure_item_ids: replayProof.technical_failure_item_ids,
    invalid_proof_item_ids: replayProof.invalid_item_ids
  } : runtimeIsolation(offReport, onReport);
  return {
    comparison_mode: replayMode ? "SINGLE_OBSERVATION_REPLAY" : "PAIRED_CLOUD_REPORTS",
    contract_present: replayMode
      ? replayProof.schema_valid === true
      : off.contract_id === "retrieval-application-ablation-v1"
        && on.contract_id === "retrieval-application-ablation-v1",
    arm_assignment_valid: replayMode
      ? replayProof.arm_proof_valid === true
      : off.arm === "OFF" && on.arm === "ON",
    shared_pipeline_valid: replayMode
      ? replayProof.input_fingerprints_valid === true
      : off.provider_id === on.provider_id
        && off.single_model_fast === false
        && on.single_model_fast === false
        && off.evidence_completion_enabled === true
        && on.evidence_completion_enabled === true
        && off.evidence_completion_retrieval_disabled === true
        && on.evidence_completion_retrieval_disabled !== true
        && off.external_retrieval_enabled === false
        && on.external_retrieval_enabled === false
        && off.identity_result_cache_disabled === true
        && on.identity_result_cache_disabled === true
        && off.approved_identity_memory_disabled === true
        && on.approved_identity_memory_disabled === true
        && off.corrected_title_hint_sent_to_cloud === false
        && on.corrected_title_hint_sent_to_cloud === false,
    retrieval_axis_valid: replayMode
      ? replayProof.arm_proof_valid === true
      : off.catalog_enabled === false
        && off.vector_enabled === false
        && off.retrieval_application_enabled === false
        && off.retrieval_application_resolution_forced !== true
        && on.catalog_enabled === true
        && on.vector_enabled === true
        && on.retrieval_application_enabled === true
        && on.retrieval_application_resolution_forced === true,
    same_base_url: cleanText(offReport.base_url) === cleanText(onReport.base_url),
    same_model_ids: replayMode
      ? true
      : offModels.length > 0 && JSON.stringify(offModels) === JSON.stringify(onModels),
    retrieval_off_model_ids: offModels,
    retrieval_on_model_ids: onModels,
    same_deployment_sha: offSha && onSha ? offSha === onSha : null,
    retrieval_off_deployment_sha: offSha || null,
    retrieval_on_deployment_sha: onSha || null,
    single_observation_deterministic_replay_claimed: replayClaimed,
    single_observation_deterministic_replay: replayMode && replayProof.valid === true,
    replay_proof_valid: replayMode ? replayProof.valid === true : null,
    runtime_isolation: runtime
  };
}

function accuracyEvidence(dataset = {}, offAccuracy = {}, onAccuracy = {}) {
  const truthClass = cleanText(
    dataset.evaluation_truth_policy?.field_ground_truth_class
    || offAccuracy.source?.field_ground_truth_class
    || onAccuracy.source?.field_ground_truth_class
    || "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
  ).toUpperCase();
  const formal = truthClass === "HUMAN_REVIEWED_FIELD_GROUND_TRUTH";
  return {
    field_ground_truth_class: truthClass,
    formal_sem_accuracy_measured: formal,
    formal_launch_gate_eligible: formal
      && offAccuracy.scope?.launch_gate_eligible !== false
      && onAccuracy.scope?.launch_gate_eligible !== false,
    metric_label: formal ? "SEM_ACCURACY" : "TITLE_DERIVED_SEM_PROXY_ACCURACY",
    limitations: Array.isArray(dataset.evaluation_truth_policy?.limitations)
      ? dataset.evaluation_truth_policy.limitations
      : []
  };
}

function roundedDelta(onValue, offValue) {
  if (!Number.isFinite(Number(onValue)) || !Number.isFinite(Number(offValue))) return null;
  return Number((Number(onValue) - Number(offValue)).toFixed(6));
}

function operationalMetrics(report = {}) {
  return {
    provider_success_count: numeric(report.provider_success_count),
    provider_success_rate: report.provider_success_rate ?? null,
    technical_failure_count: numeric(report.technical_failure_count),
    provider_error_count: numeric(report.provider_error_count),
    provider_error_recovered_count: numeric(report.provider_error_recovered_count),
    evaluated_cards_per_minute: report.evaluated_cards_per_minute ?? null,
    per_card_latency_ms: report.per_card_latency_ms || null,
    usage_totals: report.usage_totals || {}
  };
}

export function evaluateRetrievalApplicationAblation({
  dataset = {},
  retrievalDisabledReport = {},
  retrievalEnabledReport = {},
  retrievalApplicationReplayReport = null,
  retrievalReplayReport = null,
  replayReport = null
} = {}) {
  const replaySourceReport = [
    retrievalApplicationReplayReport,
    retrievalReplayReport,
    replayReport
  ].find(isRecord) || null;
  if (replaySourceReport) {
    const split = splitRetrievalApplicationReplayReport(replaySourceReport);
    retrievalDisabledReport = split.retrievalDisabledReport;
    retrievalEnabledReport = split.retrievalEnabledReport;
  }
  const offAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalDisabledReport });
  const onAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalEnabledReport });
  const offCritical = criticalAccuracy(offAccuracy);
  const onCritical = criticalAccuracy(onAccuracy);
  const offRows = rowMap(retrievalDisabledReport);
  const onRows = rowMap(retrievalEnabledReport);
  const datasetIds = (Array.isArray(dataset.items) ? dataset.items : [])
    .map((item) => rowId(item))
    .filter(Boolean);
  const pairedIds = datasetIds.filter((id) => offRows.has(id) && onRows.has(id));
  const offExact = cardExactMap(offAccuracy);
  const onExact = cardExactMap(onAccuracy);
  const offCards = accuracyCardMap(offAccuracy);
  const onCards = accuracyCardMap(onAccuracy);
  const observedPerCard = pairedIds.map((id) => {
    const off = offRows.get(id);
    const on = onRows.get(id);
    const application = retrievalApplication(on);
    const appliedFields = Array.isArray(application?.actual_applied_fields)
      ? application.actual_applied_fields
      : [];
    const offCardExact = offExact.get(id) ?? null;
    const onCardExact = onExact.get(id) ?? null;
    const retrievalDelta = fieldDelta(offCards.get(id), onCards.get(id), application);
    const decisionAudit = fieldDecisionAudit(application, onCards.get(id));
    const armTitleChanged = finalTitle(off) !== finalTitle(on);
    const applicationTitleChanged = application?.title_changed === true;
    const observationPair = providerObservationPair(off, on);
    return {
      item_id: id,
      retrieval_disabled_title: finalTitle(off),
      retrieval_enabled_title: finalTitle(on),
      title_changed: armTitleChanged,
      arm_title_changed: armTitleChanged,
      application_title_changed: applicationTitleChanged,
      application_title_before: cleanText(application?.title_before),
      application_title_after: cleanText(application?.title_after),
      candidate_application_count: Number(application?.actual_application_count || appliedFields.length || 0),
      applied_fields: appliedFields,
      field_decision_counts: application?.decision_counts || {},
      retrieved_candidate_count: rawRetrievedCandidateCount(on),
      eligible_candidate_count: decisionEligibleCandidateCount(on, application),
      retrieval_application: application,
      retrieval_evidence_isolation: on.retrieval_evidence_isolation || null,
      field_decision_audit: decisionAudit,
      retrieval_delta: retrievalDelta,
      provider_observation_fingerprint: {
        retrieval_disabled: observationPair.retrieval_disabled.fingerprint,
        retrieval_enabled: observationPair.retrieval_enabled.fingerprint
      },
      provider_observation_source: {
        retrieval_disabled: observationPair.retrieval_disabled.source,
        retrieval_enabled: observationPair.retrieval_enabled.source
      },
      provider_observation_pairing: observationPair.status,
      provider_input_tokens: {
        retrieval_disabled: observationPair.retrieval_disabled.input_tokens,
        retrieval_enabled: observationPair.retrieval_enabled.input_tokens,
        same: observationPair.input_tokens_same
      },
      sem_card_exact_off: offCardExact,
      sem_card_exact_on: onCardExact,
      outcome: offCardExact === false && onCardExact === true
        ? "RECOVERY"
        : offCardExact === true && onCardExact === false
          ? "REGRESSION"
          : "NO_CHANGE"
    };
  });
  const candidateApplicationCount = observedPerCard.reduce((sum, row) => sum + row.candidate_application_count, 0);
  const armTitleDeltaCount = observedPerCard.filter((row) => row.arm_title_changed).length;
  const applicationTitleChangeCount = observedPerCard.filter((row) => row.application_title_changed).length;
  const recoveryCount = observedPerCard.filter((row) => row.outcome === "RECOVERY").length;
  const regressionCount = observedPerCard.filter((row) => row.outcome === "REGRESSION").length;
  const offSemField = offAccuracy.metrics?.sem_field_exact_accuracy || {};
  const onSemField = onAccuracy.metrics?.sem_field_exact_accuracy || {};
  const offSemCard = offAccuracy.metrics?.sem_card_exact_accuracy || {};
  const onSemCard = onAccuracy.metrics?.sem_card_exact_accuracy || {};
  const replayProof = replaySourceReport ? replayProofSummary(replaySourceReport, datasetIds) : null;
  const experiment = experimentValidity(retrievalDisabledReport, retrievalEnabledReport, { replayProof });
  const evidence = accuracyEvidence(dataset, offAccuracy, onAccuracy);
  const pairedComplete = pairedIds.length > 0 && pairedIds.length === datasetIds.length;
  const inputIsolation = causalInputIsolation(retrievalDisabledReport, retrievalEnabledReport, datasetIds);
  const providerObservationPairing = {
    same_count: observedPerCard.filter((row) => row.provider_observation_pairing === "SAME").length,
    mismatch_count: observedPerCard.filter((row) => row.provider_observation_pairing === "MISMATCH").length,
    missing_count: observedPerCard.filter((row) => row.provider_observation_pairing === "MISSING").length,
    mismatch_item_ids: observedPerCard
      .filter((row) => row.provider_observation_pairing === "MISMATCH")
      .map((row) => row.item_id),
    input_token_same_count: observedPerCard.filter((row) => row.provider_input_tokens.same).length,
    single_observation_deterministic_replay_claimed: experiment.single_observation_deterministic_replay_claimed,
    single_observation_deterministic_replay: experiment.single_observation_deterministic_replay,
    replay_proof_valid: replayProof ? replayProof.valid === true : null
  };
  const sameProviderObservations = pairedComplete
    && providerObservationPairing.same_count === pairedIds.length
    && providerObservationPairing.mismatch_count === 0
    && providerObservationPairing.missing_count === 0;
  providerObservationPairing.causal_requirement_satisfied = sameProviderObservations
    || experiment.single_observation_deterministic_replay;
  const causalInvalidReasons = [...new Set([
    ...(!pairedComplete ? ["same_card_cohort_incomplete"] : []),
    ...(!experiment.contract_present ? ["experiment_contract_invalid"] : []),
    ...(!experiment.arm_assignment_valid ? ["arm_assignment_invalid"] : []),
    ...(!experiment.shared_pipeline_valid ? ["shared_pipeline_invalid"] : []),
    ...(!experiment.retrieval_axis_valid ? ["retrieval_axis_invalid"] : []),
    ...(!experiment.same_base_url ? ["base_url_mismatch"] : []),
    ...(!experiment.same_model_ids ? ["model_ids_mismatch_or_missing"] : []),
    ...(experiment.same_deployment_sha === false ? ["deployment_sha_mismatch"] : []),
    ...(!experiment.runtime_isolation.valid ? ["runtime_isolation_invalid"] : []),
    ...(!providerObservationPairing.causal_requirement_satisfied
      ? ["provider_observation_pairing_invalid"]
      : []),
    ...inputIsolation.invalid_reasons
  ])];
  const causalValid = causalInvalidReasons.length === 0;
  const inputIsolationById = new Map(inputIsolation.per_card.map((row) => [row.item_id, row]));
  const perCard = observedPerCard.map((row) => {
    const observedOutcome = row.outcome;
    const observedFieldOutcome = row.retrieval_delta.outcome;
    const unattributed = !causalValid && observedOutcome !== "NO_CHANGE";
    const fieldUnattributed = !causalValid && observedFieldOutcome !== "NO_CHANGE";
    return {
      ...row,
      causal_input_isolation: inputIsolationById.get(row.item_id) || null,
      observed_outcome: observedOutcome,
      outcome: unattributed ? "OBSERVED_UNATTRIBUTED" : observedOutcome,
      retrieval_delta: {
        ...row.retrieval_delta,
        observed_outcome: observedFieldOutcome,
        outcome: fieldUnattributed ? "OBSERVED_UNATTRIBUTED" : observedFieldOutcome,
        attribution: fieldUnattributed ? "OBSERVED_UNATTRIBUTED" : row.retrieval_delta.attribution
      }
    };
  });
  const funnel = applicationFunnel(perCard);
  const observedAccuracyDelta = {
    sem_card_exact_accuracy: roundedDelta(onSemCard.rate, offSemCard.rate),
    sem_field_accuracy: roundedDelta(onSemField.rate, offSemField.rate),
    critical_field_accuracy: roundedDelta(onCritical.rate, offCritical.rate)
  };

  return {
    schema_version: "retrieval-application-ablation-v1",
    generated_at: new Date().toISOString(),
    comparison_mode: experiment.comparison_mode,
    causal_valid: causalValid,
    causal_invalid_reasons: causalInvalidReasons,
    accuracy_evidence: evidence,
    provider_observation_pairing: providerObservationPairing,
    cohort: {
      dataset_item_count: datasetIds.length,
      retrieval_disabled_result_count: offRows.size,
      retrieval_enabled_result_count: onRows.size,
      paired_card_count: pairedIds.length,
      same_card_cohort_complete: pairedIds.length === datasetIds.length,
      missing_from_disabled: datasetIds.filter((id) => !offRows.has(id)),
      missing_from_enabled: datasetIds.filter((id) => !onRows.has(id))
    },
    metrics: {
      retrieval_disabled: {
        sem_card_exact_accuracy: offSemCard,
        sem_field_accuracy: offSemField,
        critical_field_accuracy: offCritical,
        per_field_exact_accuracy: offAccuracy.metrics?.per_field_exact_accuracy || {},
        operations: operationalMetrics(retrievalDisabledReport)
      },
      retrieval_enabled: {
        sem_card_exact_accuracy: onSemCard,
        sem_field_accuracy: onSemField,
        critical_field_accuracy: onCritical,
        per_field_exact_accuracy: onAccuracy.metrics?.per_field_exact_accuracy || {},
        operations: operationalMetrics(retrievalEnabledReport),
        candidate_application_count: candidateApplicationCount,
        title_change_count: armTitleDeltaCount,
        arm_title_delta_count: armTitleDeltaCount,
        application_title_change_count: applicationTitleChangeCount,
        candidate_correct_but_not_applied: funnel.candidate_correct_but_not_applied,
        candidate_wrong_but_applied: funnel.candidate_wrong_but_applied,
        blocked_by_reason: funnel.blocked_by_reason,
        application_funnel: funnel
      },
      delta: {
        sem_card_exact_accuracy: causalValid ? observedAccuracyDelta.sem_card_exact_accuracy : null,
        sem_field_accuracy: causalValid ? observedAccuracyDelta.sem_field_accuracy : null,
        critical_field_accuracy: causalValid ? observedAccuracyDelta.critical_field_accuracy : null,
        retrieval_recovery_count: causalValid ? recoveryCount : null,
        retrieval_regression_count: causalValid ? regressionCount : null,
        net_benefit: causalValid ? recoveryCount - regressionCount : null,
        observed_unattributed: causalValid ? null : {
          ...observedAccuracyDelta,
          recovery_count: recoveryCount,
          regression_count: regressionCount,
          net_difference: recoveryCount - regressionCount
        }
      }
    },
    per_card: perCard,
    validity: {
      causal_valid: causalValid,
      causal_comparison_valid: causalValid,
      invalid_reasons: causalInvalidReasons,
      causal_invalid_reasons: causalInvalidReasons,
      experiment,
      replay: replayProof,
      causal_input_isolation: inputIsolation,
      requirements: replayProof ? [
        "same card cohort",
        `${retrievalApplicationReplaySchemaVersion} on every card`,
        "matching non-empty replay input fingerprint across OFF and ON on every card",
        "self-consistent semantic fingerprint and OFF/ON application-state proof on every card",
        "retrieval prompt context explicitly disabled on every card",
        "same-card retrieval exclusion confirmed with zero returned self candidates",
        "per-card catalog and vector exclusion evidence present",
        evidence.formal_sem_accuracy_measured
          ? "field-level reviewed ground truth"
          : "reviewed-title-derived SEM proxy isolated from recognition"
      ] : [
        "same card cohort",
        "same deployment and model",
        "same prompt core",
        "same provider observation",
        "only retrieval enablement differs",
        "retrieval prompt context explicitly disabled in both arms",
        "same-card retrieval exclusion confirmed with zero returned self candidates",
        "per-card catalog and vector exclusion evidence present",
        evidence.formal_sem_accuracy_measured
          ? "field-level reviewed ground truth"
          : "reviewed-title-derived SEM proxy isolated from recognition"
      ]
    }
  };
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    options[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const replayPath = args.replay
    || args["replay-report"]
    || args["retrieval-application-replay"]
    || args.report;
  if (!args.dataset || (!replayPath && (!args.off || !args.on))) {
    throw new Error("Usage: node scripts/evaluate-retrieval-application-ablation.mjs --dataset <golden-sem.json> (--replay <cloud-replay.json> | --off <retrieval-off.json> --on <retrieval-on.json>) [--out <report.json>]");
  }
  const dataset = await readJson(args.dataset);
  const report = replayPath
    ? evaluateRetrievalApplicationAblation({
      dataset,
      retrievalApplicationReplayReport: await readJson(replayPath)
    })
    : evaluateRetrievalApplicationAblation({
      dataset,
      retrievalDisabledReport: await readJson(args.off),
      retrievalEnabledReport: await readJson(args.on)
    });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), output);
  }
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
