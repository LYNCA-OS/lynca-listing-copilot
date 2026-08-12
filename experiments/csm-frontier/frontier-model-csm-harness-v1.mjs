import { createHash } from "node:crypto";

import {
  canonicalSemanticStateJson,
  COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1,
  sha256SemanticState,
  validateCollectibleSemanticStateV1
} from "./collectible-semantic-state-v1.mjs";

export const FRONTIER_MODEL_CSM_HARNESS_VERSION = "frontier-model-csm-harness-v1";
export const FRONTIER_MODEL_CSM_ENVELOPE_VERSION = "frontier-model-csm-envelope-v1";
export const FRONTIER_MODEL_CSM_AUDIT_BUNDLE_VERSION = "frontier-model-csm-audit-bundle-v1";

export const FRONTIER_MODEL_CSM_PROFILE_TARGETS = Object.freeze([
  Object.freeze({
    profile_id: "lynca-standard-name-v0.2",
    mode: "ACTIVE_REFERENCE",
    character_budget: 80
  }),
  Object.freeze({
    profile_id: "ebay-profile-v1",
    mode: "REPLAY_ONLY_REFERENCE",
    character_budget: 80
  })
]);
export const FRONTIER_MODEL_CSM_EVALUATION_PROFILE = Object.freeze({
  model: "gpt-5.6-luna",
  reasoning_effort: "low",
  image_detail: "high",
  max_output_tokens: 8_192
});

const SOURCE_KINDS = new Set([
  "ORIGINAL_IMAGE",
  "APPROVED_REGISTRY",
  "HUMAN_REVIEWED_FIELD",
  "APPROVED_REFERENCE"
]);
const SOURCE_KEYS = Object.freeze([
  "source_id", "source_kind", "content_sha256", "approval", "payload"
]);
const PROFILE_KEYS = Object.freeze(["profile_id", "mode", "character_budget"]);
const ENVELOPE_KEYS = Object.freeze([
  "schema_version", "harness_version", "execution_mode", "case_id", "provider_call_budget",
  "isolated_stage_model_calls", "source_inventory", "source_inventory_sha256",
  "profile_targets", "response_schema", "instructions"
]);
const HARNESS_INSTRUCTIONS = Object.freeze([
  "Jointly understand the collectible using every approved source in source_inventory.",
  "Return evidence-linked facts, relationships, uncertainties and a canonical projection.",
  "Canonical fields are an interoperability projection, not the limit of semantic state.",
  "Do not return chain-of-thought, private reasoning, a marketplace title or unsupported facts."
]);
const RESPONSE_SCHEMA_SHA256 = sha256SemanticState(COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1);

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, code) {
  if (!plainObject(value)
      || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(code);
  }
}

function clone(value) {
  return JSON.parse(canonicalSemanticStateJson(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateSource(source, index) {
  exactKeys(source, SOURCE_KEYS, `frontier_harness_source_shape:${index}`);
  if (!/^src_[a-zA-Z0-9._:-]{1,120}$/.test(source.source_id)) {
    throw new TypeError(`frontier_harness_source_id:${index}`);
  }
  if (!SOURCE_KINDS.has(source.source_kind)) {
    throw new TypeError(`frontier_harness_source_kind:${index}`);
  }
  if (!/^[0-9a-f]{64}$/.test(source.content_sha256)) {
    throw new TypeError(`frontier_harness_source_sha256:${index}`);
  }
  if (source.approval !== "APPROVED_FOR_EVALUATION") {
    throw new TypeError(`frontier_harness_source_not_approved:${index}`);
  }
  if (!plainObject(source.payload)) throw new TypeError(`frontier_harness_source_payload:${index}`);
  if (source.source_kind === "ORIGINAL_IMAGE") {
    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/]+={0,2})$/
      .exec(String(source.payload.image_ref || ""));
    if (!match) throw new TypeError(`frontier_harness_original_image_ref:${index}`);
    let decoded;
    try {
      decoded = Buffer.from(match[2], "base64");
    } catch {
      throw new TypeError(`frontier_harness_original_image_ref:${index}`);
    }
    if (!decoded.length || decoded.toString("base64") !== match[2]) {
      throw new TypeError(`frontier_harness_original_image_ref:${index}`);
    }
    const decodedSha256 = createHash("sha256").update(decoded).digest("hex");
    if (decodedSha256 !== source.content_sha256) {
      throw new TypeError(`frontier_harness_source_content_mismatch:${index}`);
    }
    if (source.payload.image_sha256 !== source.content_sha256) {
      throw new TypeError(`frontier_harness_source_payload_hash_mismatch:${index}`);
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(source.payload, "image_ref")) {
    throw new TypeError(`frontier_harness_nonimage_image_ref:${index}`);
  }
  if (sha256SemanticState(source.payload) !== source.content_sha256) {
    throw new TypeError(`frontier_harness_source_content_mismatch:${index}`);
  }
}

function validateProfileTarget(target, index) {
  exactKeys(target, PROFILE_KEYS, `frontier_harness_profile_shape:${index}`);
  if (typeof target.profile_id !== "string" || !target.profile_id.trim()
      || target.profile_id !== target.profile_id.trim()) {
    throw new TypeError(`frontier_harness_profile_id:${index}`);
  }
  if (!["ACTIVE_REFERENCE", "EVALUATION_REFERENCE", "REPLAY_ONLY_REFERENCE"]
    .includes(target.mode)) {
    throw new TypeError(`frontier_harness_profile_mode:${index}`);
  }
  if (!Number.isSafeInteger(target.character_budget)
      || target.character_budget < 1 || target.character_budget > 500) {
    throw new TypeError(`frontier_harness_profile_budget:${index}`);
  }
}

function validateEnvelope(envelope) {
  exactKeys(envelope, ENVELOPE_KEYS, "frontier_harness_envelope_shape");
  if (envelope.schema_version !== FRONTIER_MODEL_CSM_ENVELOPE_VERSION
      || envelope.harness_version !== FRONTIER_MODEL_CSM_HARNESS_VERSION
      || envelope.execution_mode !== "EVALUATION_ONLY_NO_NETWORK"
      || envelope.provider_call_budget !== 1
      || envelope.isolated_stage_model_calls !== 0
      || !/^[a-zA-Z0-9._:-]{1,120}$/.test(String(envelope.case_id || ""))) {
    throw new TypeError("frontier_harness_envelope_invalid");
  }
  if (!Array.isArray(envelope.source_inventory) || !envelope.source_inventory.length) {
    throw new TypeError("frontier_harness_sources_required");
  }
  const sourceIds = new Set();
  envelope.source_inventory.forEach((source, index) => {
    validateSource(source, index);
    if (sourceIds.has(source.source_id)) {
      throw new TypeError(`frontier_harness_duplicate_source:${index}`);
    }
    sourceIds.add(source.source_id);
  });
  if (sha256SemanticState(envelope.source_inventory) !== envelope.source_inventory_sha256) {
    throw new TypeError("frontier_harness_inventory_drift");
  }
  if (!Array.isArray(envelope.profile_targets) || envelope.profile_targets.length < 2) {
    throw new TypeError("frontier_harness_profile_targets_required");
  }
  envelope.profile_targets.forEach(validateProfileTarget);
  const profileIds = new Set(envelope.profile_targets.map((target) => target.profile_id));
  if (!profileIds.has("lynca-standard-name-v0.2") || !profileIds.has("ebay-profile-v1")) {
    throw new TypeError("frontier_harness_profile_family_incomplete");
  }
  if (sha256SemanticState(envelope.response_schema) !== RESPONSE_SCHEMA_SHA256) {
    throw new TypeError("frontier_harness_response_schema_drift");
  }
  if (!Array.isArray(envelope.instructions)
      || envelope.instructions.join("\0") !== HARNESS_INSTRUCTIONS.join("\0")) {
    throw new TypeError("frontier_harness_instruction_drift");
  }
  return [...sourceIds];
}

/**
 * Build inert input for one future frontier-model evaluation. It performs no
 * I/O and exposes no dispatch function. Every admitted source is present in
 * the inventory; unapproved evidence cannot be smuggled in as prompt prose.
 */
export function buildFrontierModelCsmEnvelope({
  caseId,
  sources,
  profileTargets = FRONTIER_MODEL_CSM_PROFILE_TARGETS
} = {}) {
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(String(caseId || ""))) {
    throw new TypeError("frontier_harness_case_id");
  }
  if (!Array.isArray(sources) || !sources.length) {
    throw new TypeError("frontier_harness_sources_required");
  }
  const sourceIds = new Set();
  sources.forEach((source, index) => {
    validateSource(source, index);
    if (sourceIds.has(source.source_id)) {
      throw new TypeError(`frontier_harness_duplicate_source:${index}`);
    }
    sourceIds.add(source.source_id);
  });
  if (!Array.isArray(profileTargets) || profileTargets.length < 2) {
    throw new TypeError("frontier_harness_profile_targets_required");
  }
  profileTargets.forEach(validateProfileTarget);
  const profileIds = new Set(profileTargets.map((target) => target.profile_id));
  if (!profileIds.has("lynca-standard-name-v0.2") || !profileIds.has("ebay-profile-v1")) {
    throw new TypeError("frontier_harness_profile_family_incomplete");
  }

  const sourceInventory = deepFreeze(clone(sources));
  const sourceInventorySha256 = sha256SemanticState(sourceInventory);
  return Object.freeze({
    schema_version: FRONTIER_MODEL_CSM_ENVELOPE_VERSION,
    harness_version: FRONTIER_MODEL_CSM_HARNESS_VERSION,
    execution_mode: "EVALUATION_ONLY_NO_NETWORK",
    case_id: String(caseId),
    provider_call_budget: 1,
    isolated_stage_model_calls: 0,
    source_inventory: sourceInventory,
    source_inventory_sha256: sourceInventorySha256,
    profile_targets: deepFreeze(clone(profileTargets)),
    response_schema: COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1,
    instructions: HARNESS_INSTRUCTIONS
  });
}

/**
 * Materialize one pure Responses API body. This is intentionally only a body
 * builder: there is no client, fetch, retry loop, web tool or dispatcher in
 * the experiment package.
 */
export function buildFrontierModelCsmRequest(envelope) {
  validateEnvelope(envelope);
  const originalImages = envelope.source_inventory.filter((source) => (
    source.source_kind === "ORIGINAL_IMAGE"
  ));
  if (!originalImages.length) throw new TypeError("frontier_harness_original_image_required");
  for (const [index, source] of originalImages.entries()) {
    if (typeof source.payload.image_ref !== "string" || !source.payload.image_ref.trim()
        || source.payload.image_ref !== source.payload.image_ref.trim()) {
      throw new TypeError(`frontier_harness_original_image_ref:${index}`);
    }
  }
  const inventoryJson = canonicalSemanticStateJson({
    source_inventory: envelope.source_inventory,
    source_inventory_sha256: envelope.source_inventory_sha256
  });
  const prompt = [
    ...envelope.instructions,
    "Every byte of the approved content-addressed inventory follows. Use no source outside it.",
    `APPROVED_EVIDENCE_INVENTORY_JSON=${inventoryJson}`
  ].join("\n");
  return deepFreeze({
    model: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.model,
    max_output_tokens: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.max_output_tokens,
    reasoning: { effort: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.reasoning_effort },
    text: {
      format: {
        type: "json_schema",
        name: "collectible_semantic_state_v1",
        strict: true,
        schema: COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1
      }
    },
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...originalImages.map((source) => ({
          type: "input_image",
          image_url: source.payload.image_ref,
          detail: FRONTIER_MODEL_CSM_EVALUATION_PROFILE.image_detail
        }))
      ]
    }]
  });
}

function responseHash(state) {
  return sha256SemanticState({ model_response: state });
}

/**
 * Produce two independently consumable audit views from the same response.
 * Their shared response hash proves there were no hidden Recognition and
 * Identity Resolution calls.
 */
export function auditFrontierModelCsmResponse(envelope, modelResponse) {
  const sourceIds = validateEnvelope(envelope);
  const state = validateCollectibleSemanticStateV1(modelResponse, {
    sourceIds,
    sourceInventorySha256: envelope.source_inventory_sha256
  });
  const modelResponseSha256 = responseHash(state);
  const semanticStateSha256 = sha256SemanticState(state);
  const conflictedFactIds = state.facts
    .filter((fact) => fact.status === "CONFLICTED")
    .map((fact) => fact.fact_id);
  const selectedFactIds = state.facts
    .filter((fact) => fact.status === "SUPPORTED" && fact.canonical_path)
    .map((fact) => fact.fact_id);

  return Object.freeze({
    schema_version: FRONTIER_MODEL_CSM_AUDIT_BUNDLE_VERSION,
    harness_version: FRONTIER_MODEL_CSM_HARNESS_VERSION,
    case_id: envelope.case_id,
    model_response_sha256: modelResponseSha256,
    semantic_state_sha256: semanticStateSha256,
    provider_call_budget: 1,
    isolated_stage_model_calls: 0,
    profile_targets: envelope.profile_targets,
    semantic_state: state,
    recognition_audit_view: Object.freeze({
      schema_version: "frontier-model-recognition-audit-view-v1",
      model_response_sha256: modelResponseSha256,
      source_inventory_sha256: envelope.source_inventory_sha256,
      approved_source_ids: Object.freeze([...sourceIds]),
      evidence_linked_fact_ids: Object.freeze(state.facts.map((fact) => fact.fact_id)),
      conflicted_fact_ids: Object.freeze(conflictedFactIds)
    }),
    identity_resolution_audit_view: Object.freeze({
      schema_version: "frontier-model-identity-resolution-audit-view-v1",
      model_response_sha256: modelResponseSha256,
      canonical_projection_sha256: sha256SemanticState(state.canonical_projection),
      selected_fact_ids: Object.freeze(selectedFactIds),
      conflicted_fact_ids: Object.freeze(conflictedFactIds),
      unresolved_uncertainty_ids: Object.freeze(
        state.uncertainties.map((row) => row.uncertainty_id)
      )
    })
  });
}

/**
 * Recompute the complete audit bundle from its governed envelope and semantic
 * state. Callers never get to supply hashes or derived audit views as facts.
 */
export function validateFrontierModelCsmAuditBundle(envelope, auditBundle) {
  if (!plainObject(auditBundle) || !plainObject(auditBundle.semantic_state)) {
    throw new TypeError("frontier_harness_audit_bundle_invalid");
  }
  const recomputed = auditFrontierModelCsmResponse(envelope, auditBundle.semantic_state);
  if (canonicalSemanticStateJson(auditBundle) !== canonicalSemanticStateJson(recomputed)) {
    throw new TypeError("frontier_harness_audit_bundle_drift");
  }
  return recomputed;
}
