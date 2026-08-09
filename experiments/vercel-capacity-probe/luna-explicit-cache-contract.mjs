import { deflateSync } from "node:zlib";

import { CSM_ACTIVE_MODEL_PROFILE } from "../../lib/listing/thin/csm-model-profile.mjs";
import { CSM_OPENAI_RESPONSES_ADAPTER } from "../../lib/listing/thin/csm-provider-adapter.mjs";
import {
  experimentalCacheKey,
  LUNA_EXPLICIT_CACHE_POLICY,
  LUNA_EXPLICIT_CACHE_STEPS,
  validateLunaExplicitCacheScreenRequests,
  withExplicitCacheTransport
} from "./luna-explicit-cache-wire-contract.mjs";

export {
  assertCacheOnlyTransportDelta,
  LUNA_EXPLICIT_CACHE_POLICY,
  LUNA_EXPLICIT_CACHE_SCREEN_VERSION,
  LUNA_EXPLICIT_CACHE_STEPS,
  normalizeCachePreviewIdentity,
  preflightReceiptSha256,
  sha256,
  stripExplicitCacheTransport
} from "./luna-explicit-cache-wire-contract.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function syntheticCardPng({ background, accent }) {
  const width = 96;
  const height = 128;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 3);
    pixels[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const border = x < 5 || x >= width - 5 || y < 5 || y >= height - 5;
      const stripe = !border && y >= 44 && y < 72;
      const color = border ? [24, 24, 24] : stripe ? accent : background;
      const offset = rowOffset + 1 + x * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const SYNTHETIC_FIXTURES = Object.freeze({
  "synthetic-card-a": `data:image/png;base64,${syntheticCardPng({
    background: [226, 236, 250],
    accent: [33, 91, 176]
  }).toString("base64")}`,
  "synthetic-card-b": `data:image/png;base64,${syntheticCardPng({
    background: [249, 232, 221],
    accent: [184, 58, 45]
  }).toString("base64")}`
});

function productionRequest(imageUrl) {
  const request = CSM_OPENAI_RESPONSES_ADAPTER.buildRequest({
    imageUrls: [imageUrl],
    model: CSM_ACTIVE_MODEL_PROFILE.model,
    effort: CSM_ACTIVE_MODEL_PROFILE.reasoning_effort,
    imageDetail: CSM_ACTIVE_MODEL_PROFILE.image_detail,
    maxOutputTokens: CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
  });
  const content = request?.input?.[0]?.content;
  if (request?.model !== LUNA_EXPLICIT_CACHE_POLICY.model
      || request?.reasoning?.effort !== CSM_ACTIVE_MODEL_PROFILE.reasoning_effort
      || request?.max_output_tokens !== CSM_ACTIVE_MODEL_PROFILE.max_output_tokens
      || request?.text?.format?.type !== "json_schema"
      || request?.text?.format?.strict !== true
      || !Array.isArray(content) || content.length !== 2
      || content[0]?.type !== "input_text" || typeof content[0]?.text !== "string"
      || content[1]?.type !== "input_image"
      || content[1]?.detail !== CSM_ACTIVE_MODEL_PROFILE.image_detail) {
    throw new Error("production_request_contract_invalid");
  }
  return request;
}

export function buildLunaExplicitCacheScreenPlan(runId) {
  const cacheKey = experimentalCacheKey(runId);
  const entries = LUNA_EXPLICIT_CACHE_STEPS.map((step) => {
    const imageUrl = SYNTHETIC_FIXTURES[step.fixture_id];
    if (!imageUrl) throw new Error("synthetic_fixture_missing");
    return {
      id: step.id,
      request: withExplicitCacheTransport(productionRequest(imageUrl), cacheKey)
    };
  });
  return validateLunaExplicitCacheScreenRequests(runId, entries);
}
