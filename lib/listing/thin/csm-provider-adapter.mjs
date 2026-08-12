import { createHash } from "node:crypto";

import {
  buildCanonicalFieldsRequest,
  extractCanonicalPayload,
  stripCanonicalFieldSources
} from "./canonical-fields.mjs";
import {
  providerReasoningEffortReceipt,
  providerResponseAttestation,
  providerUsageReceipt
} from "./provider-response-attestation.mjs";
import { auditFounderBetaCanonicalPayload } from "./csm-forward-reader-bridge.mjs";
import {
  CARD_NAME_PREDICATE,
  SET_CARD_NAME_RELATION_CONTRACT_VERSION,
  SET_MEMBERSHIP_PREDICATE,
  validateSetCardNameRelationReceipt
} from "./set-card-name-contract.mjs";

export const CSM_OPENAI_RESPONSES_ADAPTER_VERSION = "openai-responses-v1";
export const CSM_CANONICAL_RESPONSE_PARSER_VERSION =
  "canonical-output-v3-web-receipt";
export const CSM_CANONICAL_REQUEST_BUILDER_VERSION = "canonical-fields-web-request-v1";

const CSM_OPENAI_RESPONSES_TRANSPORT = Object.freeze({
  endpoint: "https://api.openai.com/v1/responses",
  method: "POST",
  api_key_env: "OPENAI_API_KEY",
  authorization_scheme: "Bearer",
  content_type: "application/json",
  client_request_id_header: "x-client-request-id",
  store: true,
  metadata_keys: Object.freeze({
    operation_sha256: "lynca_operation_sha256",
    payload_sha256: "lynca_payload_sha256",
    attempt: "lynca_attempt"
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT = deepFreeze({
  id: CSM_OPENAI_RESPONSES_ADAPTER_VERSION,
  provider: "openai",
  request_builder_version: CSM_CANONICAL_REQUEST_BUILDER_VERSION,
  response_parser_version: CSM_CANONICAL_RESPONSE_PARSER_VERSION,
  transport: CSM_OPENAI_RESPONSES_TRANSPORT,
  completion_receipt: {
    status_path: "status",
    incomplete_details_path: "incomplete_details",
    missing_status_policy: "unknown_compatible",
    explicit_non_completed_policy: "definitive_failure"
  },
  served_model_receipt: {
    path: "model",
    required: false,
    missing_policy: "null"
  },
  served_effort_receipt: {
    accepted_paths: ["reasoning_effort", "reasoning.effort"],
    required: false,
    conflict_policy: "null",
    missing_policy: "null",
    attested_when_present: true
  },
  usage_receipt: {
    input_tokens: "usage.input_tokens",
    cached_input_tokens: "usage.input_tokens_details.cached_tokens",
    output_tokens: "usage.output_tokens",
    reasoning_tokens: "usage.output_tokens_details.reasoning_tokens",
    total_tokens: "usage.total_tokens"
  }
});

function requiredTransportText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw Object.assign(new Error(`missing_${name}`), { statusCode: 400 });
  return text;
}

const OPENAI_CANONICAL_REQUEST_OPTION_KEYS = new Set([
  "imageUrls",
  "model",
  "effort",
  "imageDetail",
  "maxOutputTokens",
  "prompt",
  "schema",
  "samplingParameters"
]);

function compileOpenAiCanonicalRequest(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some((key) => !OPENAI_CANONICAL_REQUEST_OPTION_KEYS.has(key))) {
    throw new TypeError("openai_request_option_unsupported");
  }
  const { samplingParameters = "omit", ...input } = options;
  if (samplingParameters !== "omit") {
    throw new TypeError("openai_sampling_parameters_must_be_omitted");
  }
  // Clone before freezing so compile owns an immutable wire snapshot without
  // freezing an evaluation caller's mutable schema object as a side effect.
  const wireRequest = structuredClone(buildCanonicalFieldsRequest(input));
  if (["temperature", "top_p", "seed"].some((key) => Object.hasOwn(wireRequest, key))) {
    throw new TypeError("openai_sampling_parameter_present");
  }
  const prompt = wireRequest?.input?.[0]?.content?.[0]?.text;
  const schema = wireRequest?.text?.format?.schema;
  if (typeof prompt !== "string" || !prompt.trim() || !schema || typeof schema !== "object") {
    throw new TypeError("openai_canonical_request_receipt_invalid");
  }
  return deepFreeze({
    provider: "openai",
    adapter_id: CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.id,
    request_builder_version: CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.request_builder_version,
    model: wireRequest.model,
    requested_effort: wireRequest?.reasoning?.effort,
    image_detail: input.imageDetail,
    max_output_tokens: wireRequest.max_output_tokens,
    sampling_parameters: "omit",
    rendered_prompt: prompt,
    schema,
    wire_request: wireRequest
  });
}

function openAiCallerOptions({
  env = process.env,
  fetchImpl = globalThis.fetch,
  operationKey,
  payloadHash,
  attempt,
  clientRequestId,
  timeoutMs
}) {
  const transport = CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.transport;
  const apiKey = String(env?.[transport.api_key_env] || "").trim();
  if (!apiKey) throw new Error("openai_api_key_unconfigured");
  const operation = requiredTransportText(operationKey, "operation_key");
  const payload = requiredTransportText(payloadHash, "payload_hash").toLowerCase();
  const attemptNumber = Number(attempt);
  const timeout = Number(timeoutMs);
  if (!/^[0-9a-f]{64}$/.test(payload)) throw new TypeError("invalid_payload_hash");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new TypeError("invalid_attempt");
  }
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new TypeError("invalid_provider_timeout_ms");
  }
  return Object.freeze({
    apiKey,
    clientRequestId: requiredTransportText(clientRequestId, "client_request_id"),
    fetchImpl,
    opaqueOperation: createHash("sha256").update(operation).digest("hex"),
    payload,
    attemptNumber,
    timeout
  });
}

/**
 * Executable OpenAI Responses seam. It owns request construction, endpoint,
 * authentication, dispatch envelope and response normalization; canonical
 * parsing, CSM/SEM and Composer remain model/provider independent.
 */
export const CSM_OPENAI_RESPONSES_ADAPTER = Object.freeze({
  provider: "openai",
  contract: CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,

  configured(env = process.env) {
    return Boolean(String(
      env?.[CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.transport.api_key_env] || ""
    ).trim());
  },

  buildRequest(input) {
    return compileOpenAiCanonicalRequest(input).wire_request;
  },

  // Compile once, then use this same frozen request for both the durable
  // execution receipt and the paid dispatch. This prevents prompt/schema bytes
  // from drifting between an independently built receipt and the wire body.
  compileRequest(input) {
    return compileOpenAiCanonicalRequest(input);
  },

  createCaller(options = {}) {
    const caller = openAiCallerOptions(options);
    const transport = CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT.transport;
    return (request) => caller.fetchImpl(transport.endpoint, {
      method: transport.method,
      signal: AbortSignal.timeout(caller.timeout),
      headers: {
        authorization: `${transport.authorization_scheme} ${caller.apiKey}`,
        "content-type": transport.content_type,
        [transport.client_request_id_header]: caller.clientRequestId
      },
      body: JSON.stringify({
        ...request,
        store: transport.store,
        metadata: {
          ...(request?.metadata && typeof request.metadata === "object" ? request.metadata : {}),
          [transport.metadata_keys.operation_sha256]: caller.opaqueOperation,
          [transport.metadata_keys.payload_sha256]: caller.payload,
          [transport.metadata_keys.attempt]: String(caller.attemptNumber)
        }
      })
    });
  },

  parseResponse(body = {}, { request = null } = {}) {
    const response = providerResponseAttestation(body);
    const effort = providerReasoningEffortReceipt(body);
    const usage = providerUsageReceipt(body);
    const explicitIncomplete = (response.provider_response_status_attested
      && response.provider_response_status !== "completed")
      || response.provider_response_incomplete;
    const rawOutputWithSources = explicitIncomplete ? "" : extractCanonicalPayload(body);
    const audited = explicitIncomplete ? null : stripCanonicalFieldSources(rawOutputWithSources);
    const imageCount = request?.input?.[0]?.content?.filter(
      (part) => part?.type === "input_image"
    ).length || 0;
    const authorityAudit = audited ? auditFounderBetaCanonicalPayload(body, {
      rawOutput: JSON.stringify(audited.payload),
      request,
      fieldSources: audited.field_sources,
      originalImageCount: imageCount
    }) : null;
    const canonicalPayload = authorityAudit?.payload || null;
    const rawOutput = canonicalPayload ? JSON.stringify(canonicalPayload) : "";
    const relationReceipt = canonicalPayload ? {
      schema_version: SET_CARD_NAME_RELATION_CONTRACT_VERSION,
      set: canonicalPayload.set ? {
        predicate: audited.set_card_name_relations?.set,
        value: canonicalPayload.set
      } : null,
      card_name: canonicalPayload.card_name ? {
        predicate: audited.set_card_name_relations?.card_name,
        value: canonicalPayload.card_name
      } : null
    } : null;
    if (relationReceipt) validateSetCardNameRelationReceipt(relationReceipt, canonicalPayload);
    return {
      ok: !explicitIncomplete,
      failure_code: explicitIncomplete ? "provider_response_incomplete" : null,
      raw_output: rawOutput,
      receipt: {
        ...response,
        ...effort,
        ...usage,
        ...(explicitIncomplete ? {} : {
          set_card_name_relation_receipt: relationReceipt,
          founder_beta_web_receipt: authorityAudit.receipt
        })
      }
    };
  }
});

const providerAdapters = Object.freeze({
  openai: CSM_OPENAI_RESPONSES_ADAPTER
});

export function resolveCsmProviderAdapter(provider) {
  const key = String(provider || "").trim().toLowerCase();
  const adapter = providerAdapters[key];
  if (!adapter) throw new TypeError(`unsupported_csm_provider:${key || "missing"}`);
  return adapter;
}
