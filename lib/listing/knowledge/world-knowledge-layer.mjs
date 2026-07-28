import { createHash } from "node:crypto";

import { optionFlag, envFlag } from "../pipeline/flags.mjs";
import { providerOptionsFromPayload, valuePresent } from "../pipeline/provider-options.mjs";
import { readOnlyProviderResponseProfile } from "../providers/provider-output-field-contract.mjs";

export const worldKnowledgeShadowAssistVersion = "world-knowledge-shadow-assist-v1";
export const worldKnowledgeObservationContract = readOnlyProviderResponseProfile;

const shadowInputFields = Object.freeze([
  "year",
  "manufacturer",
  "set",
  "insert",
  "players",
  "card_name",
  "collector_number",
  "checklist_code",
  "tcg_card_number",
  "language"
]);

export const worldKnowledgeShadowAssistContract = Object.freeze({
  schema_version: worldKnowledgeShadowAssistVersion,
  mode: "POST_OBSERVATION_SHADOW_ONLY",
  observation_contract: worldKnowledgeObservationContract,
  target_fields: Object.freeze(["team", "product"]),
  allowed_input_fields: shadowInputFields,
  paid_provider_call_allowed: false,
  resolver_access: "DENIED",
  title_access: "DENIED"
});

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function compactObservedFields(result = {}) {
  const source = result.raw_provider_fields;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(shadowInputFields
    .filter((field) => valuePresent(source[field]))
    .map((field) => [field, source[field]]));
}

function compactUnresolved(result = {}) {
  return (Array.isArray(result.unresolved) ? result.unresolved : [])
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 20);
}

export function worldKnowledgeShadowAssistRequested(payload = {}, env = process.env) {
  const options = providerOptionsFromPayload(payload, env);
  const requested = optionFlag(
    options,
    "v4_world_knowledge_proposals",
    envFlag(env, "ENABLE_V4_WORLD_KNOWLEDGE_PROPOSALS", false)
  ) === true;
  const readOnlyObservation = optionFlag(
    options,
    "v4_read_only_provider_contract",
    envFlag(env, "ENABLE_V4_READ_ONLY_PROVIDER_CONTRACT", false)
  ) === true;
  return requested
    && readOnlyObservation
    && cleanText(options.recognition_benchmark_profile) === "cold_algorithm_benchmark"
    && cleanText(options.trace_level) === "evaluation";
}

export function buildWorldKnowledgeShadowAssistInput(result = {}) {
  const observation = Object.freeze({
    schema_version: worldKnowledgeObservationContract,
    fields: Object.freeze(compactObservedFields(result)),
    unresolved: Object.freeze(compactUnresolved(result))
  });
  const inputHash = createHash("sha256").update(stableJson(observation)).digest("hex");
  return Object.freeze({
    schema_version: worldKnowledgeShadowAssistVersion,
    mode: worldKnowledgeShadowAssistContract.mode,
    requested: true,
    execution_status: "NOT_RUN",
    execution_reason: "separate_shadow_provider_not_implemented",
    paid_provider_calls: 0,
    resolver_effect: "NONE",
    title_effect: "NONE",
    input_hash: inputHash,
    input: observation,
    output: null
  });
}

export function attachWorldKnowledgeShadowAssistInput(result = {}, { requested = false } = {}) {
  if (requested !== true) return result;
  return {
    ...result,
    world_knowledge_shadow_assist: buildWorldKnowledgeShadowAssistInput(result)
  };
}
