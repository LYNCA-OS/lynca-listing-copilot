import { createHash } from "node:crypto";

import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA,
  buildCanonicalFieldsRequest,
  CANONICAL_FIELDS_PROMPT,
  CANONICAL_FIELDS_SCHEMA,
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
export const CAPTURED_E1AE_CANONICAL_RESPONSE_PARSER_VERSION =
  "canonical-output-v2-strict-observed-or-null";
export const CAPTURED_E1AE_CANONICAL_REQUEST_BUILDER_VERSION =
  "canonical-fields-request-v1";
export const FUTURE_CANONICAL_RESPONSE_PARSER_VERSION =
  "canonical-output-v5-web-receipt-outcome";
export const FUTURE_CANONICAL_REQUEST_BUILDER_VERSION =
  "canonical-fields-web-request-v2";
// Backward-facing exports describe the active captured writer. The forward
// adapter remains executable through the versioned resolver below.
export const CSM_CANONICAL_RESPONSE_PARSER_VERSION =
  CAPTURED_E1AE_CANONICAL_RESPONSE_PARSER_VERSION;
export const CSM_CANONICAL_REQUEST_BUILDER_VERSION =
  CAPTURED_E1AE_CANONICAL_REQUEST_BUILDER_VERSION;

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

export const CSM_OPENAI_RESPONSES_FUTURE_ADAPTER_CONTRACT = deepFreeze({
  ...CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  request_builder_version: FUTURE_CANONICAL_REQUEST_BUILDER_VERSION,
  response_parser_version: FUTURE_CANONICAL_RESPONSE_PARSER_VERSION
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
  "samplingParameters",
  "webSearchToolsEnabled"
]);

function compileOpenAiCanonicalRequest(options = {}, {
  contract = CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  defaults = null
} = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some((key) => !OPENAI_CANONICAL_REQUEST_OPTION_KEYS.has(key))) {
    throw new TypeError("openai_request_option_unsupported");
  }
  const { samplingParameters = "omit", ...requestedInput } = options;
  if (samplingParameters !== "omit") {
    throw new TypeError("openai_sampling_parameters_must_be_omitted");
  }
  const input = {
    ...(defaults || {}),
    ...requestedInput
  };
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
    adapter_id: contract.id,
    request_builder_version: contract.request_builder_version,
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

function parseCapturedE1aeResponse(body = {}) {
  const response = providerResponseAttestation(body);
  const effort = providerReasoningEffortReceipt(body);
  const usage = providerUsageReceipt(body);
  const explicitIncomplete = (response.provider_response_status_attested
    && response.provider_response_status !== "completed")
    || response.provider_response_incomplete;
  return {
    ok: !explicitIncomplete,
    failure_code: explicitIncomplete ? "provider_response_incomplete" : null,
    raw_output: explicitIncomplete ? "" : extractCanonicalPayload(body),
    receipt: { ...response, ...effort, ...usage }
  };
}

function parseFutureResponse(body = {}, { request = null } = {}) {
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

function openAiResponsesAdapter({ contract, requestDefaults, parseResponse }) {
  return Object.freeze({
    provider: "openai",
    contract,

    configured(env = process.env) {
      return Boolean(String(env?.[contract.transport.api_key_env] || "").trim());
    },

    buildRequest(input) {
      return compileOpenAiCanonicalRequest(input, {
        contract,
        defaults: requestDefaults
      }).wire_request;
    },

    // Compile once, then use this same frozen request for both the durable
    // execution receipt and the paid dispatch.
    compileRequest(input) {
      return compileOpenAiCanonicalRequest(input, {
        contract,
        defaults: requestDefaults
      });
    },

    createCaller(options = {}) {
      const caller = openAiCallerOptions(options);
      const transport = contract.transport;
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

    parseResponse
  });
}

/** The exact captured Production writer; active by default. */
export const CSM_OPENAI_RESPONSES_ADAPTER = openAiResponsesAdapter({
  contract: CSM_OPENAI_RESPONSES_ADAPTER_CONTRACT,
  requestDefaults: {
    prompt: CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
    schema: CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA,
    webSearchToolsEnabled: false
  },
  parseResponse: parseCapturedE1aeResponse
});

/** Forward writer kept executable for the one-step activation child. */
export const CSM_OPENAI_RESPONSES_FUTURE_ADAPTER = openAiResponsesAdapter({
  contract: CSM_OPENAI_RESPONSES_FUTURE_ADAPTER_CONTRACT,
  requestDefaults: {
    prompt: CANONICAL_FIELDS_PROMPT,
    schema: CANONICAL_FIELDS_SCHEMA,
    webSearchToolsEnabled: true
  },
  parseResponse: parseFutureResponse
});

const providerAdapters = Object.freeze({
  openai: Object.freeze({
    [CAPTURED_E1AE_CANONICAL_REQUEST_BUILDER_VERSION]: CSM_OPENAI_RESPONSES_ADAPTER,
    [FUTURE_CANONICAL_REQUEST_BUILDER_VERSION]: CSM_OPENAI_RESPONSES_FUTURE_ADAPTER
  })
});

export function resolveCsmProviderAdapter(provider, {
  requestBuilderVersion = CSM_CANONICAL_REQUEST_BUILDER_VERSION
} = {}) {
  const key = String(provider || "").trim().toLowerCase();
  const adapter = providerAdapters[key]?.[requestBuilderVersion];
  if (!adapter) {
    throw new TypeError(`unsupported_csm_provider_adapter:${key || "missing"}:${requestBuilderVersion}`);
  }
  return adapter;
}
