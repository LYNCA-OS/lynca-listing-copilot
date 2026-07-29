#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  buildOpenAiProviderRequestIdentity,
  openAiProviderRequestIdentitySchemaVersion
} from "../lib/listing/providers/provider-request-identity.mjs";

const images = [
  { role: "front_original", content_sha256: "a".repeat(64) },
  { role: "back_original", content_sha256: "b".repeat(64) }
];
const input = {
  model: "gpt-5-mini",
  strictPrompt: "Exact prompt bytes\nwith a second line.",
  images,
  imageDetail: "high",
  responseProfile: "standard",
  includeVectorDecision: false,
  requestedServiceTier: null,
  maxOutputTokens: 128000,
  modelControls: { reasoning: { effort: "minimal" } },
  textOptions: { verbosity: "medium", format: { type: "json_schema", strict: true } }
};

const first = buildOpenAiProviderRequestIdentity(input);
const repeated = buildOpenAiProviderRequestIdentity(structuredClone(input));
assert.deepEqual(repeated, first);
assert.equal(first.schema_version, openAiProviderRequestIdentitySchemaVersion);
assert.equal(first.status, "COMPLETE");
assert.equal(first.provider_prompt_utf8_bytes, Buffer.byteLength(input.strictPrompt, "utf8"));
assert.equal(first.provider_input_image_count, 2);
assert.equal(first.provider_image_manifest_complete, true);
assert.match(first.provider_prompt_sha256, /^[0-9a-f]{64}$/);
assert.match(first.provider_ordered_image_content_sha256, /^[0-9a-f]{64}$/);
assert.match(first.provider_request_controls_sha256, /^[0-9a-f]{64}$/);
assert.match(first.provider_request_fingerprint, /^[0-9a-f]{64}$/);

const changedPrompt = buildOpenAiProviderRequestIdentity({ ...input, strictPrompt: `${input.strictPrompt} ` });
assert.notEqual(changedPrompt.provider_prompt_sha256, first.provider_prompt_sha256);
assert.notEqual(changedPrompt.provider_request_fingerprint, first.provider_request_fingerprint);

const reversedImages = buildOpenAiProviderRequestIdentity({ ...input, images: [...images].reverse() });
assert.notEqual(reversedImages.provider_ordered_image_content_sha256, first.provider_ordered_image_content_sha256);
assert.notEqual(reversedImages.provider_request_fingerprint, first.provider_request_fingerprint);

const changedControls = buildOpenAiProviderRequestIdentity({
  ...input,
  modelControls: { reasoning: { effort: "low" } }
});
assert.notEqual(changedControls.provider_request_controls_sha256, first.provider_request_controls_sha256);
assert.notEqual(changedControls.provider_request_fingerprint, first.provider_request_fingerprint);

const dataUrl = buildOpenAiProviderRequestIdentity({
  ...input,
  images: [{ dataUrl: "data:image/jpeg;base64,AAAA" }]
});
assert.equal(dataUrl.status, "COMPLETE");
assert.match(dataUrl.provider_ordered_image_content_sha256, /^[0-9a-f]{64}$/);

const staleDeclaredDataUrl = buildOpenAiProviderRequestIdentity({
  ...input,
  images: [{
    dataUrl: "data:image/jpeg;base64,AAAA",
    content_sha256: "f".repeat(64)
  }]
});
assert.equal(staleDeclaredDataUrl.status, "PARTIAL");
assert.equal(staleDeclaredDataUrl.provider_image_manifest_complete, false);
assert.equal(staleDeclaredDataUrl.provider_image_declared_content_mismatch_count, 1);
assert.equal(staleDeclaredDataUrl.provider_ordered_image_content_sha256, null);
assert.equal(staleDeclaredDataUrl.provider_request_fingerprint, null);

const unverifiedRemote = buildOpenAiProviderRequestIdentity({
  ...input,
  images: [{ signedUrl: "https://example.invalid/signed?token=secret" }]
});
assert.equal(unverifiedRemote.status, "PARTIAL");
assert.equal(unverifiedRemote.provider_image_manifest_complete, false);
assert.equal(unverifiedRemote.provider_ordered_image_content_sha256, null);
assert.equal(unverifiedRemote.provider_request_fingerprint, null);
assert.equal(JSON.stringify(first).includes(input.strictPrompt), false);
assert.equal(JSON.stringify(unverifiedRemote).includes("token=secret"), false);

console.log("provider request identity tests passed");
