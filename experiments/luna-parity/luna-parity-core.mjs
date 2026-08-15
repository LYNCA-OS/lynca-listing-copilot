import { createHash } from "node:crypto";

import {
  buildThinTitleRequest,
  extractProviderTitle,
  finishCanonicalTitle,
  finishThinTitle
} from "../../lib/listing/thin/thin-listing-path.mjs";
import { resolveCsmProviderAdapter } from
  "../../lib/listing/thin/csm-provider-adapter.mjs";
import {
  compileCsmModelExecution,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
} from "../../lib/listing/thin/csm-model-execution-contract.mjs";
import {
  CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
  CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA
} from "../../lib/listing/thin/captured-production-e1ae-assets.mjs";
import { activeWriterProjectionContract } from
  "../../lib/listing/thin/csm-projection-activation.mjs";

export const LUNA_PARITY_MODEL = "gpt-5.6-luna";
export const LUNA_PARITY_EFFORT = "low";
export const LUNA_PARITY_MAX_OUTPUT_TOKENS = 8192;
export const LUNA_PARITY_BOUNDARY = "single-card-front-back-v1";

export const DIRECT_SINGLE_CARD_TITLE_PROMPT =
  "Inspect all supplied images as one trading card, normally the front and back of the same physical card. "
  + "Write the most accurate eBay listing title supported by the images. Use at most 80 characters; preserve the card identity and any exact printed serial, card number, or grade before lower-value detail. "
  + "Reply with the title only—no explanation, quotes, or label.";

const ACTIVE_WRITER = activeWriterProjectionContract();
const ACTIVE_ADAPTER = resolveCsmProviderAdapter("openai", {
  requestBuilderVersion: ACTIVE_WRITER.canonical_fields.request_builder_version
});

function activeRuntimeArm(fixedImageDetail = "high") {
  return Object.freeze({
    canonical: true,
    evalVersion: "active-runtime-captured-writer-v1",
    frontierParity: LUNA_PARITY_BOUNDARY,
    minimumImages: 1,
    providerMaxAttempts: 1,
    responseSchemaName: "canonical_card_fields",
    responseSchema: CAPTURED_E1AE_CANONICAL_FIELDS_SCHEMA,
    prompt: CAPTURED_E1AE_CANONICAL_FIELDS_PROMPT,
    imageDetail: fixedImageDetail,
    effort: LUNA_PARITY_EFFORT,
    maxOutputTokens: LUNA_PARITY_MAX_OUTPUT_TOKENS,
    buildRequest: ({ imageUrls = [], model = LUNA_PARITY_MODEL }) => {
      if (ACTIVE_WRITER.web_search_tools_enabled) {
        throw new Error("active_runtime_frontier_baseline_requires_tools_off");
      }
      return compileCsmModelExecution({
        imageUrls,
        model,
        requestedEffort: LUNA_PARITY_EFFORT,
        imageDetail: fixedImageDetail,
        maxOutputTokens: LUNA_PARITY_MAX_OUTPUT_TOKENS,
        transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
        writerContract: ACTIVE_WRITER
      }).provider_request.wire_request;
    },
    extract: (body, { request = null } = {}) => {
      const parsed = ACTIVE_ADAPTER.parseResponse(body, { request });
      if (!parsed.ok) {
        throw new Error(parsed.failure_code || "active_runtime_provider_incomplete");
      }
      return parsed.raw_output;
    },
    finish: (payload) => finishCanonicalTitle(payload, {
      writerContract: ACTIVE_WRITER
    })
  });
}

function directTitleArm(fixedImageDetail = "high") {
  return Object.freeze({
    canonical: false,
    evalVersion: "direct-single-card-title-v1",
    frontierParity: LUNA_PARITY_BOUNDARY,
    minimumImages: 1,
    providerMaxAttempts: 1,
    prompt: DIRECT_SINGLE_CARD_TITLE_PROMPT,
    imageDetail: fixedImageDetail,
    effort: LUNA_PARITY_EFFORT,
    maxOutputTokens: LUNA_PARITY_MAX_OUTPUT_TOKENS,
    buildRequest: ({ imageUrls = [], model = LUNA_PARITY_MODEL }) => {
      const request = buildThinTitleRequest({
        imageUrls,
        model,
        effort: LUNA_PARITY_EFFORT,
        maxOutputTokens: LUNA_PARITY_MAX_OUTPUT_TOKENS
      });
      request.input[0].content[0].text = DIRECT_SINGLE_CARD_TITLE_PROMPT;
      for (const part of request.input[0].content) {
        if (part.type === "input_image") part.detail = fixedImageDetail;
      }
      return request;
    },
    extract: extractProviderTitle,
    finish: (payload) => finishThinTitle(payload, { compose: false })
  });
}

export const LUNA_PARITY_ARM_SPECS = Object.freeze({
  runtime_active_high_low: activeRuntimeArm("high"),
  runtime_active_high_low_repeat: activeRuntimeArm("high"),
  // This is only a Responses API detail-hint probe. It does not replace
  // readability-derived bytes with original image bytes.
  runtime_active_detail_original_low: activeRuntimeArm("original"),
  lynca_csm_direct_title_high_low: directTitleArm("high")
});

export function lunaParityArm(key) {
  const spec = LUNA_PARITY_ARM_SPECS[key];
  if (!spec) throw new Error(`luna_parity_arm_unknown:${key}`);
  return { key, ...spec };
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function normalizedRequestSha256(request) {
  let imageIndex = 0;
  const normalized = JSON.parse(JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `image-${imageIndex}`;
    }
    return value;
  }));
  return sha256(JSON.stringify(normalized));
}

export function imageTransportSha256(imageUrls = []) {
  return sha256(JSON.stringify(imageUrls));
}

export function assertLunaParityRequest({ arm, request, imageUrls }) {
  const images = (request?.input?.[0]?.content || [])
    .filter(({ type }) => type === "input_image");
  const forbidden = [
    "tools", "tool_choice", "max_tool_calls", "include",
    "temperature", "top_p", "seed"
  ];
  if (request?.model !== LUNA_PARITY_MODEL
      || request?.reasoning?.effort !== LUNA_PARITY_EFFORT
      || request?.max_output_tokens !== LUNA_PARITY_MAX_OUTPUT_TOKENS
      || images.length !== imageUrls.length
      || images.some((image, index) => image.image_url !== imageUrls[index]
        || image.detail !== arm.imageDetail)
      || forbidden.some((key) => Object.hasOwn(request || {}, key))) {
    throw new Error(`luna_parity_request_contract_mismatch:${arm.key}`);
  }
  return request;
}

export function servedEffort(body = {}) {
  const top = typeof body.reasoning_effort === "string" ? body.reasoning_effort : null;
  const nested = typeof body.reasoning?.effort === "string" ? body.reasoning.effort : null;
  return top && nested && top !== nested ? null : top || nested;
}

export function parseLunaParityResponse({ arm, body, request }) {
  if (!body || body.status !== "completed" || body.error || body.incomplete_details
      || body.model !== LUNA_PARITY_MODEL
      || servedEffort(body) !== LUNA_PARITY_EFFORT
      || typeof body.id !== "string" || !body.id.trim()) {
    throw new Error(`luna_parity_provider_receipt_invalid:${arm.key}`);
  }
  const rawOutput = arm.extract(body, { request });
  const finished = arm.finish(rawOutput);
  if (typeof finished?.title !== "string" || !finished.title.trim()
      || finished.title.length > 80) {
    throw new Error(`luna_parity_title_invalid:${arm.key}`);
  }
  return { rawOutput, finished };
}
