// The complete thin CSM application boundary for one already-persisted asset.
//
// Asset upload/session creation stay application-owned. From that durable
// session onward this function has one straight path:
//
//   Luna observation -> canonical fields -> deterministic Composer
//     -> replayable CSM rows -> optional shadow persistence
//
// Keeping this composition here prevents the application from reimplementing
// CSM field mapping or persistence ordering. Provider and storage failures are
// distinguishable, but neither returns a usable production result: a title
// without its immutable CSM lineage is a failed attempt.

import { createHash } from "node:crypto";

import { validateAccuracyLossLedger } from "./accuracy-loss-ledger.mjs";
import { CSM_ACTIVE_MODEL_PROFILE } from "./csm-model-profile.mjs";
import {
  compileCsmModelExecution,
  validateCsmModelExecutionContract
} from "./csm-model-execution-contract.mjs";
import { sealCsmOwnerExecutionReceipt } from "./csm-owner-execution-receipt.mjs";
import { validateDefinitive502TransportRetryReceipt } from "./luna-direct-dispatcher.mjs";
import {
  finishCanonicalFields,
  runCanonicalListingPath
} from "./thin-listing-path.mjs";
import {
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  resolveExternalIdentitySupport
} from "../knowledge/csm-external-identity-support.mjs";
import {
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT,
  resolveVerifiedOriginalObservation
} from "./verified-original-observation-support.mjs";
import {
  activeVerifiedOriginalObservationReleaseId
} from "./csm-projection-activation.mjs";
import {
  buildCsmStageRows, CSM_STAGE_CONTRACT_VERSION, THIN_RESOLVER_VERSION
} from "./csm-persistence.mjs";
import { verifyReplay } from "./csm-replay.mjs";
import { writeCsmStagePacketAtomically } from "./csm-supabase-writer.mjs";
import { patchSupabaseRow } from "../../supabase-rest.mjs";

function requiredIdentity(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`missing_${name}`);
  return text;
}

export function resolveCanonicalObservation(observation, {
  externalIdentityContext = null
} = {}) {
  // The active Standard writer and verified overlay switch as one validated
  // projection state. A per-call release override could create the forbidden
  // v2+overlay mixed state before persistence, so this production boundary has
  // no partial activation seam.
  const verifiedOriginalReleaseId = activeVerifiedOriginalObservationReleaseId();
  const verifiedOriginal = verifiedOriginalReleaseId == null ? null
    : resolveVerifiedOriginalObservation(observation?.fields || {}, externalIdentityContext);
  const resolution = resolveExternalIdentitySupport(
    verifiedOriginal?.fields || observation?.fields || {}, {
    externalIdentityContext
  });
  if (verifiedOriginal && resolution.status === "APPLIED") {
    throw new TypeError("post_observation_resolution_overlap");
  }
  if (verifiedOriginal) {
    const composed = finishCanonicalFields(verifiedOriginal.fields, {
      // Raw defects remain committed inside the private observed receipt. They
      // cannot perturb the exact closed-world resolved projection or title.
      fieldDefects: []
    });
    return {
      ...composed,
      raw_length: observation.raw_length,
      observed_fields: observation.fields,
      verified_original_observation_support: verifiedOriginal.receipt,
      external_identity_support: resolution.receipt,
      resolution_contract_sha256:
        COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
      resolution_contract: COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT
    };
  }
  if (resolution.status !== "APPLIED") {
    return {
      ...observation,
      external_identity_support: resolution.receipt,
      resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
      resolution_contract: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT
    };
  }
  const composed = finishCanonicalFields(resolution.fields, {
    fieldDefects: observation.field_defects,
    verifiedExternalIdentity: true
  });
  return {
    ...composed,
    raw_length: observation.raw_length,
    // Visual observation remains immutable and separately persisted. Registry
    // support is a Resolution input; it is never relabelled as image evidence.
    observed_fields: observation.fields,
    external_identity_support: {
      ...resolution.receipt,
      field_decisions: resolution.support.field_decisions,
      source_field_map: resolution.support.source_field_map
    },
    resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
    resolution_contract: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT
  };
}

function failClosedPersistence(persistence, rows, fallbackCode) {
  const code = String(persistence?.code || fallbackCode || "csm_persistence_failed");
  return Object.assign(new Error(code), {
    code,
    statusCode: Number(persistence?.statusCode || 503),
    csm_persistence: persistence,
    csm_rows: rows
  });
}

function invalidPreparedResult(detail) {
  return Object.assign(new Error("csm_prepared_result_invalid"), {
    code: "csm_prepared_result_invalid",
    statusCode: 409,
    detail: String(detail || "invalid")
  });
}

function preparedRows(prepared, tenant, session) {
  const rows = prepared?.csm_rows;
  if (!rows || typeof rows !== "object") throw invalidPreparedResult("rows_missing");
  if (rows?.resolution?.tenant_id !== tenant
      || rows?.resolution?.recognition_session_id !== session) {
    throw invalidPreparedResult("row_identity_mismatch");
  }
  const replay = verifyReplay(rows, prepared?.title);
  if (replay.ok !== true) {
    throw invalidPreparedResult(replay.problems?.[0]?.kind || "replay_failed");
  }
  return rows;
}

function latencyStageReceipt(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPreparedResult("latency_stages_ms_invalid");
  }
  const stages = {};
  for (const [name, duration] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(name)
        || typeof duration !== "number"
        || !Number.isFinite(duration)
        || duration < 0) {
      throw invalidPreparedResult("latency_stages_ms_invalid");
    }
    stages[name] = Math.round(duration);
  }
  return Object.keys(stages).length ? stages : null;
}

function optionalTextReceipt(result, key, { lowercase = false } = {}) {
  if (!Object.prototype.hasOwnProperty.call(result, key) || result[key] == null) return null;
  if (typeof result[key] !== "string") throw invalidPreparedResult(`${key}_invalid`);
  const text = result[key].trim();
  if (!text) throw invalidPreparedResult(`${key}_invalid`);
  return lowercase ? text.toLowerCase() : text;
}

function requiredTextReceipt(result, key, options = {}) {
  const value = optionalTextReceipt(result, key, options);
  if (value === null) throw invalidPreparedResult(`${key}_invalid`);
  return value;
}

function fallbackTextReceipt(value, key, { lowercase = false } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidPreparedResult(`${key}_invalid`);
  }
  const text = value.trim();
  return lowercase ? text.toLowerCase() : text;
}

function optionalIntegerReceipt(result, key, { minimum = 0, maximum = null } = {}) {
  if (!Object.prototype.hasOwnProperty.call(result, key) || result[key] == null) return null;
  const value = result[key];
  if (typeof value !== "number"
      || !Number.isSafeInteger(value)
      || value < minimum
      || (maximum !== null && value > maximum)) {
    throw invalidPreparedResult(`${key}_invalid`);
  }
  return value;
}

function optionalDurationReceipt(result, key) {
  if (!Object.prototype.hasOwnProperty.call(result, key) || result[key] == null) return null;
  const value = result[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidPreparedResult(`${key}_invalid`);
  }
  return value;
}

function validateAttestedText(result, {
  valueKey, attestedKey, requiredValue = null, lowercase = false
}) {
  const hasAttested = Object.prototype.hasOwnProperty.call(result, attestedKey);
  const attested = result?.[attestedKey];
  if (hasAttested && typeof attested !== "boolean") {
    throw invalidPreparedResult(`${attestedKey}_invalid`);
  }
  const raw = result?.[valueKey];
  if (raw != null && typeof raw !== "string") {
    throw invalidPreparedResult(`${valueKey}_invalid`);
  }
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const value = lowercase ? trimmed.toLowerCase() : trimmed;
  if (attested === true && (!value || (requiredValue && value !== requiredValue))) {
    throw invalidPreparedResult(`${valueKey}_invalid`);
  }
  if (hasAttested && attested === false && raw != null) {
    throw invalidPreparedResult(`${valueKey}_unattested_value`);
  }
  return attested === true ? value : null;
}

function validateDurableProviderReceipt(result = {}, {
  provider: fallbackProvider,
  model: fallbackModel,
  effort: fallbackEffort,
  imageDetail: fallbackImageDetail,
  promptVersion: fallbackPromptVersion = null
} = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw invalidPreparedResult("result_invalid");
  }
  const status = validateAttestedText(result, {
    valueKey: "provider_response_status",
    attestedKey: "provider_response_status_attested",
    requiredValue: "completed",
    lowercase: true
  });
  if (Object.prototype.hasOwnProperty.call(result, "provider_response_incomplete")
      && typeof result.provider_response_incomplete !== "boolean") {
    throw invalidPreparedResult("provider_response_incomplete_invalid");
  }
  if (result.provider_response_incomplete === true) {
    throw invalidPreparedResult("provider_response_incomplete");
  }
  const servedModel = validateAttestedText(result, {
    valueKey: "served_model",
    attestedKey: "served_model_attested"
  });
  const servedEffort = validateAttestedText(result, {
    valueKey: "served_effort",
    attestedKey: "served_effort_attested",
    lowercase: true
  });
  if (Object.prototype.hasOwnProperty.call(result, "served_effort_conflict")
      && typeof result.served_effort_conflict !== "boolean") {
    throw invalidPreparedResult("served_effort_conflict_invalid");
  }
  if (result.served_effort_conflict === true
      && (result.served_effort_attested === true || result.served_effort != null)) {
    throw invalidPreparedResult("served_effort_conflict_inconsistent");
  }
  const executionKeys = [
    "model_profile_id", "provider_adapter_version", "request_builder_version",
    "response_parser_version",
    "execution_contract_sha256", "execution_contract"
  ];
  // Historical JSON serializers sometimes materialized absent optional
  // columns as null. All-null still means “no receipt”; any non-null member
  // starts the exact all-or-nothing contract below.
  const hasExecutionReceipt = executionKeys.some((key) => result[key] != null);
  let executionContract = null;
  let executionContractSha256 = null;
  let modelProfileId = null;
  let providerAdapterVersion = null;
  let requestBuilderVersion = null;
  let responseParserVersion = null;
  let optimizationPackId = null;
  let optimizationPackSha256 = null;
  if (hasExecutionReceipt) {
    if (!executionKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(result, key) && result[key] != null
    ))) {
      throw invalidPreparedResult("execution_receipt_incomplete");
    }
    modelProfileId = requiredTextReceipt(result, "model_profile_id");
    providerAdapterVersion = requiredTextReceipt(result, "provider_adapter_version");
    requestBuilderVersion = requiredTextReceipt(result, "request_builder_version");
    responseParserVersion = requiredTextReceipt(result, "response_parser_version");
    executionContractSha256 = requiredTextReceipt(result, "execution_contract_sha256");
    if (!/^[0-9a-f]{64}$/.test(executionContractSha256)) {
      throw invalidPreparedResult("execution_contract_sha256_invalid");
    }
    try {
      executionContract = validateCsmModelExecutionContract(result.execution_contract, {
        expectedSha256: executionContractSha256
      });
    } catch {
      throw invalidPreparedResult("execution_receipt_invalid");
    }
    if (modelProfileId !== executionContract.model_profile_id
        || providerAdapterVersion !== executionContract.provider_adapter_version
        || requestBuilderVersion !== executionContract.request_builder_version
        || responseParserVersion !== executionContract.response_parser_version) {
      throw invalidPreparedResult("execution_receipt_mismatch");
    }
    const hasOptimizationPackId = Object.prototype.hasOwnProperty.call(
      result,
      "optimization_pack_id"
    );
    const hasOptimizationPackSha256 = Object.prototype.hasOwnProperty.call(
      result,
      "optimization_pack_sha256"
    );
    if (!hasOptimizationPackId || !hasOptimizationPackSha256) {
      throw invalidPreparedResult("optimization_pack_receipt_incomplete");
    }
    optimizationPackId = optionalTextReceipt(result, "optimization_pack_id");
    optimizationPackSha256 = optionalTextReceipt(result, "optimization_pack_sha256");
    if (optimizationPackId !== executionContract.optimization_pack_id
        || optimizationPackSha256 !== executionContract.optimization_pack_sha256) {
      throw invalidPreparedResult("optimization_pack_receipt_mismatch");
    }
  }

  const provider = hasExecutionReceipt
    ? requiredTextReceipt(result, "provider", { lowercase: true })
    : optionalTextReceipt(result, "provider", { lowercase: true })
      || fallbackTextReceipt(fallbackProvider, "provider", { lowercase: true });
  const requestedModelField = optionalTextReceipt(result, "requested_model");
  const modelField = optionalTextReceipt(result, "model");
  if (requestedModelField && modelField && requestedModelField !== modelField) {
    throw invalidPreparedResult("requested_model_mismatch");
  }
  const requestedModel = hasExecutionReceipt
    ? requiredTextReceipt(result, "requested_model")
    : requestedModelField || modelField || fallbackTextReceipt(fallbackModel, "model");
  const requestedEffort = hasExecutionReceipt
    ? requiredTextReceipt(result, "requested_effort", { lowercase: true })
    : optionalTextReceipt(result, "requested_effort", { lowercase: true })
      || fallbackTextReceipt(fallbackEffort, "requested_effort", { lowercase: true });
  const imageDetail = hasExecutionReceipt
    ? requiredTextReceipt(result, "image_detail", { lowercase: true })
    : optionalTextReceipt(result, "image_detail", { lowercase: true })
      || fallbackTextReceipt(fallbackImageDetail, "image_detail", { lowercase: true });
  const promptVersion = hasExecutionReceipt
    ? requiredTextReceipt(result, "prompt_version")
    : optionalTextReceipt(result, "prompt_version")
      || (fallbackPromptVersion == null
        ? null
        : fallbackTextReceipt(fallbackPromptVersion, "prompt_version"));
  const maxOutputTokens = optionalIntegerReceipt(result, "max_output_tokens", { minimum: 1 });

  if (hasExecutionReceipt
      && (modelField !== executionContract.model
        || provider !== executionContract.provider
        || requestedModel !== executionContract.model
        || requestedEffort !== executionContract.requested_effort
        || imageDetail !== executionContract.image_detail
        || promptVersion !== executionContract.semantic_prompt_version
        || maxOutputTokens !== executionContract.max_output_tokens)) {
    throw invalidPreparedResult("execution_request_mismatch");
  }

  const inputTokens = optionalIntegerReceipt(result, "input_tokens");
  const cachedInputTokens = optionalIntegerReceipt(result, "cached_input_tokens");
  const outputTokens = optionalIntegerReceipt(result, "output_tokens");
  const reasoningTokens = optionalIntegerReceipt(result, "reasoning_tokens");
  const providerTotalTokens = optionalIntegerReceipt(result, "total_tokens");
  if (inputTokens !== null && outputTokens !== null
      && !Number.isSafeInteger(inputTokens + outputTokens)) {
    throw invalidPreparedResult("total_tokens_invalid");
  }
  const summedTotalTokens = inputTokens !== null && outputTokens !== null
    && Number.isSafeInteger(inputTokens + outputTokens)
    ? inputTokens + outputTokens
    : null;
  let providerTransportRetryReceipt = null;
  if (Object.prototype.hasOwnProperty.call(result, "provider_transport_retry_receipt")) {
    try {
      providerTransportRetryReceipt = validateDefinitive502TransportRetryReceipt(
        result.provider_transport_retry_receipt
      );
    } catch {
      throw invalidPreparedResult("provider_transport_retry_receipt_invalid");
    }
  }
  const providerAttemptNumber = optionalIntegerReceipt(result, "provider_attempt_number", {
    minimum: 1
  });
  const providerRetryCount = optionalIntegerReceipt(result, "provider_retry_count");
  if (providerTransportRetryReceipt !== null
      && (providerAttemptNumber !== 2 || providerRetryCount !== 1)) {
    throw invalidPreparedResult("provider_transport_retry_tuple_invalid");
  }

  return Object.freeze({
    provider,
    requested_model: requestedModel,
    requested_effort: requestedEffort,
    image_detail: imageDetail,
    prompt_version: promptVersion,
    max_output_tokens: maxOutputTokens,
    served_model: servedModel,
    served_model_attested: servedModel !== null,
    served_effort: servedEffort,
    served_effort_attested: servedEffort !== null,
    served_effort_conflict: Object.prototype.hasOwnProperty.call(
      result, "served_effort_conflict"
    ) ? result.served_effort_conflict : null,
    provider_response_status: status,
    provider_response_status_attested: status !== null,
    provider_response_incomplete: Object.prototype.hasOwnProperty.call(
      result, "provider_response_incomplete"
    ) ? result.provider_response_incomplete : null,
    provider_http_status: optionalIntegerReceipt(result, "provider_http_status", {
      minimum: 100,
      maximum: 599
    }),
    provider_response_id: optionalTextReceipt(result, "provider_response_id"),
    provider_request_id: optionalTextReceipt(result, "provider_request_id"),
    provider_client_request_id: optionalTextReceipt(result, "provider_client_request_id"),
    provider_attempt_number: providerAttemptNumber,
    provider_retry_count: providerRetryCount,
    provider_transport_retry_receipt: providerTransportRetryReceipt,
    latency_ms: optionalDurationReceipt(result, "latency_ms"),
    latency_stages_ms: latencyStageReceipt(result.latency_stages_ms),
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: providerTotalTokens ?? summedTotalTokens,
    total_tokens_source: providerTotalTokens !== null
      ? "provider"
      : summedTotalTokens !== null ? "input_plus_output" : null,
    model_profile_id: modelProfileId,
    optimization_pack_id: optimizationPackId,
    optimization_pack_sha256: optimizationPackSha256,
    provider_adapter_version: providerAdapterVersion,
    request_builder_version: requestBuilderVersion,
    response_parser_version: responseParserVersion,
    execution_contract_sha256: executionContractSha256,
    execution_contract: executionContract
  });
}

function csmSessionPatch({ rows, result, receipt }) {
  const accuracyLossLedger = result.accuracy_loss_ledger
    ? validateAccuracyLossLedger(result.accuracy_loss_ledger, { result })
    : null;
  // A durable provider checkpoint can outlive a deployment. Its CSM rows are
  // the authority for downstream executable versions; stamping today's
  // Composer onto a recovered v1 packet would make owner_versions disagree
  // with the title and destroy the audit trail even though no new model call
  // occurred.
  const contractVersion = rows.output?.contract_version || CSM_STAGE_CONTRACT_VERSION;
  const resolverVersion = rows.resolution?.resolver_version || THIN_RESOLVER_VERSION;
  const composerVersion = String(rows.output?.composer_version || "").trim();
  const marketplaceProfileVersion = String(
    rows.output?.marketplace_profile_version || ""
  ).trim();
  if (!composerVersion || !marketplaceProfileVersion) {
    throw invalidPreparedResult("composition_version_missing");
  }
  const requestedModel = receipt.requested_model;
  const requestedEffort = receipt.requested_effort;
  const executedImageDetail = receipt.image_detail;
  const executedPromptVersion = receipt.prompt_version;
  const pipelineFingerprint = createHash("sha256").update(JSON.stringify({
    contract: contractVersion, model: requestedModel, effort: requestedEffort,
    imageDetail: executedImageDetail,
    resolver: resolverVersion, composer: composerVersion,
    marketplaceProfile: marketplaceProfileVersion,
    requestBuilder: receipt.request_builder_version,
    responseParser: receipt.response_parser_version
  })).digest("hex");
  return {
    csm_contract_version: contractVersion,
    csm_registry_release_id: rows.resolution.registry_release_id,
    csm_grammar: rows.resolution.grammar,
    csm_grammar_confidence: (result.fields.low_confidence || []).includes("grammar") ? 0.5 : 0.8,
    recognition_pipeline_fingerprint: pipelineFingerprint,
    csm_owner_versions: sealCsmOwnerExecutionReceipt({
      provider: receipt.provider,
      // Legacy readers consume model/effort as requested configuration. Keep
      // them stable and persist served receipts separately.
      model: requestedModel,
      requested_model: requestedModel,
      served_model: receipt.served_model,
      served_model_attested: receipt.served_model_attested,
      effort: requestedEffort,
      reasoning_effort: receipt.served_effort,
      reasoning_effort_attested: receipt.served_effort_attested,
      provider_response_status: receipt.provider_response_status,
      provider_response_status_attested: receipt.provider_response_status_attested,
      provider_response_incomplete: receipt.provider_response_incomplete,
      served_effort_conflict: receipt.served_effort_conflict,
      provider_http_status: receipt.provider_http_status,
      model_profile_id: receipt.model_profile_id,
      optimization_pack_id: receipt.optimization_pack_id,
      optimization_pack_sha256: receipt.optimization_pack_sha256,
      account_scope: receipt.execution_contract?.account_scope || null,
      provider_adapter_version: receipt.provider_adapter_version,
      request_builder_version: receipt.request_builder_version,
      response_parser_version: receipt.response_parser_version,
      execution_contract_sha256: receipt.execution_contract_sha256,
      execution_contract: receipt.execution_contract,
      image_detail: executedImageDetail,
      prompt_version: executedPromptVersion || null,
      max_output_tokens: receipt.max_output_tokens,
      provider_response_id: receipt.provider_response_id,
      provider_request_id: receipt.provider_request_id,
      provider_client_request_id: receipt.provider_client_request_id,
      provider_attempt_number: receipt.provider_attempt_number,
      provider_retry_count: receipt.provider_retry_count,
      provider_transport_retry_receipt: receipt.provider_transport_retry_receipt,
      latency_ms: receipt.latency_ms,
      latency_stages_ms: receipt.latency_stages_ms,
      input_tokens: receipt.input_tokens,
      cached_input_tokens: receipt.cached_input_tokens,
      output_tokens: receipt.output_tokens,
      reasoning_tokens: receipt.reasoning_tokens,
      total_tokens: receipt.total_tokens,
      total_tokens_source: receipt.total_tokens_source,
      resolver: resolverVersion,
      composer: composerVersion,
      marketplace_profile: marketplaceProfileVersion,
      accuracy_loss_ledger_version: accuracyLossLedger?.version || null,
      accuracy_loss_ledger_sha256: accuracyLossLedger?.ledger_sha256 || null
    }),
    csm_recognition_stage_status: "COMPLETE",
    csm_resolution_stage_status: "COMPLETE",
    csm_composition_stage_status: "COMPLETE",
    ...rows.session_hashes
  };
}

// Paid boundary only: produce the deterministic result and its complete CSM
// packet, but do not write it.  The provider authority can durably settle this
// value before the fallible persistence call starts.
export async function prepareCanonicalListingPath({
  tenantId,
  recognitionSessionId,
  imageUrls,
  provider = CSM_ACTIVE_MODEL_PROFILE.provider,
  imageDetail = CSM_ACTIVE_MODEL_PROFILE.image_detail,
  model = CSM_ACTIVE_MODEL_PROFILE.model,
  effort = CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
  maxOutputTokens = CSM_ACTIVE_MODEL_PROFILE.max_output_tokens,
  transportProfile,
  registryReleaseId,
  callProvider,
  promptVersion = null,
  providerClientRequestId = null,
  externalIdentityContext = null,
  createdAt = null
} = {}) {
  const tenant = requiredIdentity(tenantId, "tenant_id");
  const session = requiredIdentity(recognitionSessionId, "recognition_session_id");
  if (typeof callProvider !== "function") throw new Error("missing_call_provider");

  // Resolve and freeze paid-execution identity before entering the provider
  // boundary. Invalid requested types must not consume a model call and leave
  // behind a checkpoint that cannot later prove what was requested.
  const compiledExecution = compileCsmModelExecution({
    imageUrls,
    provider,
    model,
    requestedEffort: effort,
    imageDetail,
    maxOutputTokens,
    transportProfile,
    ...(promptVersion ? { semanticPromptVersion: promptVersion } : {})
  });
  const executionContract = compiledExecution.execution_contract;
  const result = await runCanonicalListingPath({
    compiledRequest: compiledExecution.provider_request,
    provider: executionContract.provider,
    model: executionContract.model,
    effort: executionContract.requested_effort,
    imageDetail: executionContract.image_detail,
    maxOutputTokens: executionContract.max_output_tokens,
    providerClientRequestId,
    // Server-owned verified original identity is used only after observation;
    // it is intentionally absent from the provider request wire.
    resolveObservation: (observation) => resolveCanonicalObservation(observation, {
      externalIdentityContext
    }),
    callProvider
  });
  const rows = buildCsmStageRows({
    tenantId: tenant,
    recognitionSessionId: session,
    fields: result.fields,
    observedFields: result.observed_fields || result.fields,
    externalIdentitySupport: result.external_identity_support,
    verifiedOriginalObservationSupport: result.verified_original_observation_support,
    // `finishCanonicalTitle` exposes public `*_brackets` names while the CSM
    // row builder consumes the Composer's compact internal names. Map the
    // projection ledger explicitly: JSON silently drops undefined values, so
    // passing the public result through used to persist only `truncated`.
    composed: {
      grammar: result.grammar,
      brackets: result.brackets,
      bracket_text: result.bracket_text,
      dropped: result.dropped_brackets,
      suppressed: result.suppressed_brackets,
      restored: result.restored_brackets,
      truncated: result.truncated,
      // The composition receipt COS-42's inspector reads. Same trap as the
      // names above: these arrive under public names and JSON drops what is
      // undefined, so a missing entry here is invisible until an operator opens
      // a card and finds the trace empty.
      input_empty_fields: result.input_empty_fields,
      normalization_reasons: result.normalization_reasons,
      character_budget: result.character_budget,
      length: result.length,
      composer_version: result.composer_version,
      marketplace_profile_version: result.marketplace_profile_version,
      canonical_naming_trace: result.canonical_naming_trace,
      canonical_naming_publishable: result.canonical_naming_publishable,
      publication_coverage: result.publication_coverage,
      lot_quantity_unresolved: result.lot_quantity_unresolved,
      lot_single_card: result.lot_single_card,
      lot_unshared_attributes: result.lot_unshared_attributes,
      lot_publishable: result.lot_publishable,
      lot_publication_failure_code: result.lot_publication_failure_code
    },
    founderBetaWebReceipt: result.founder_beta_web_receipt,
    setCardNameRelationReceipt: result.set_card_name_relation_receipt,
    title: result.title,
    registryReleaseId: result.external_identity_support?.status === "APPLIED"
      ? EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID
      : registryReleaseId,
    createdAt
  });
  return {
    ...result,
    prompt_version: executionContract.semantic_prompt_version,
    max_output_tokens: executionContract.max_output_tokens,
    model_profile_id: executionContract.model_profile_id,
    provider_adapter_version: executionContract.provider_adapter_version,
    request_builder_version: executionContract.request_builder_version,
    response_parser_version: executionContract.response_parser_version,
    optimization_pack_id: executionContract.optimization_pack_id,
    optimization_pack_sha256: executionContract.optimization_pack_sha256,
    execution_contract_sha256: compiledExecution.execution_contract_sha256,
    execution_contract: executionContract,
    csm_rows: rows
  };
}

// Storage boundary only: validate that the durable provider checkpoint still
// replays exactly, then write the already-built rows.  There is deliberately no
// callProvider/image URL parameter here, so a persistence resume cannot cross
// the paid boundary by construction.
export async function persistPreparedCanonicalListingPath({
  tenantId,
  recognitionSessionId,
  prepared,
  provider = CSM_ACTIVE_MODEL_PROFILE.provider,
  imageDetail = CSM_ACTIVE_MODEL_PROFILE.image_detail,
  model = CSM_ACTIVE_MODEL_PROFILE.model,
  effort = CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
  promptVersion = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  patchSession = patchSupabaseRow,
  writeRows = writeCsmStagePacketAtomically,
  writerOptions = {}
} = {}) {
  const tenant = requiredIdentity(tenantId, "tenant_id");
  const session = requiredIdentity(recognitionSessionId, "recognition_session_id");
  const receipt = validateDurableProviderReceipt(prepared, {
    provider,
    model,
    effort,
    imageDetail,
    promptVersion: promptVersion || prepared?.prompt_version
  });
  const rows = preparedRows(prepared, tenant, session);
  const sessionPatch = csmSessionPatch({
    rows, result: prepared, receipt
  });
  const persistence = await writeRows(rows, {
    env, fetchImpl, sessionPatch, ...writerOptions
  });

  if (!persistence.ok) {
    // In particular, an immutable-session conflict must never reach the
    // COMPLETE patch below. Returning the deterministic title here would give
    // the API usable-200 semantics for an unpersisted result.
    throw failClosedPersistence(persistence, rows, "csm_stage_write_failed");
  }

  if (!persistence.skipped && !persistence.replayed && persistence.session?.saved !== true) {
    // Compatibility seam for offline/non-atomic transports. Production uses
    // the additive RPC above, which commits rows and this marker together.
    const sessionWrite = await patchSession({
      table: "v4_recognition_sessions",
      id: session,
      // Preserve the attempt fence across the child-write -> COMPLETE gap.
      // If anything changed a reserved hash, this conditional patch matches
      // zero rows and the application stays failed closed.
      match: { tenant_id: tenant, ...rows.session_hashes },
      requireMatch: true,
      patch: sessionPatch,
      env,
      fetchImpl
    });
    if (!sessionWrite.saved) {
      throw failClosedPersistence({
        ...persistence,
        ok: false,
        code: "csm_session_stage_patch_failed",
        statusCode: 503,
        failedTable: "v4_recognition_sessions",
        error: sessionWrite.error || "csm_session_stage_patch_failed"
      }, rows, "csm_session_stage_patch_failed");
    }
    persistence.session = { saved: true };
  }

  // A fresh atomic commit (or the guarded compatibility PATCH above) proves
  // these exact receipt bytes were saved. An exact replay deliberately writes
  // nothing, so without an additional DB read it cannot claim that today's
  // computed receipt metadata exists on a historical session. Keep the old
  // owner fields for compatibility but withhold the read-after-write proof.
  const {
    owner_execution_receipt_version: _unprovenReceiptVersion,
    owner_execution_receipt_sha256: _unprovenReceiptSha256,
    ...ownerVersionsWithoutDurableProof
  } = sessionPatch.csm_owner_versions;
  const durableOwnerVersions = !persistence.skipped
    && persistence.replayed !== true
    && persistence.session?.saved === true
    ? sessionPatch.csm_owner_versions
    : ownerVersionsWithoutDurableProof;

  return {
    ...prepared,
    csm_rows: rows,
    csm_contract_version: sessionPatch.csm_contract_version,
    csm_owner_versions: durableOwnerVersions,
    csm_persistence: persistence
  };
}

export async function runPersistedCanonicalListingPath(options = {}) {
  const prepared = await prepareCanonicalListingPath(options);
  return persistPreparedCanonicalListingPath({
    ...options,
    prepared
  });
}
