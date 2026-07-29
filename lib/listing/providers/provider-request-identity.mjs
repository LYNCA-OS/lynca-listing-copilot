import crypto from "node:crypto";

export const openAiProviderRequestIdentitySchemaVersion = "openai-provider-request-identity-v1";

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dataUrlContentSha256(value = "") {
  const match = String(value || "").match(/^data:([^,]*?),(.*)$/s);
  if (!match) return null;
  try {
    const bytes = /;base64(?:;|$)/i.test(match[1])
      ? Buffer.from(match[2], "base64")
      : Buffer.from(decodeURIComponent(match[2]), "utf8");
    return sha256Bytes(bytes);
  } catch {
    return null;
  }
}

function declaredImageContentSha256(image = {}) {
  const declared = String(image.contentSha256 || image.content_sha256 || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(declared) ? declared : null;
}

function selectedImageTransport(image = {}) {
  return image.dataUrl || image.signedUrl || image.signed_url || image.url || image.imageUrl || "";
}

function stableImageContentIdentity(image = {}) {
  const selected = String(selectedImageTransport(image));
  const declared = declaredImageContentSha256(image);
  if (selected.startsWith("data:")) {
    const actual = dataUrlContentSha256(selected);
    return {
      content_sha256: actual,
      declared_content_mismatch: Boolean(actual && declared && actual !== declared)
    };
  }
  return {
    content_sha256: declared,
    declared_content_mismatch: false
  };
}

function imageRole(image = {}) {
  return String(
    image.storageRole
    || image.storage_role
    || image.role
    || image.capture_angle
    || ""
  ).trim().toLowerCase() || null;
}

function providerImageManifest(images = [], detail = "high") {
  const rows = images.map((image, index) => {
    const contentIdentity = stableImageContentIdentity(image);
    return {
      index,
      role: imageRole(image),
      content_sha256: contentIdentity.content_sha256,
      declared_content_mismatch: contentIdentity.declared_content_mismatch,
      derived: image?.derived === true,
      detail
    };
  });
  const declaredMismatchCount = rows.filter((row) => row.declared_content_mismatch).length;
  const complete = rows.length > 0
    && declaredMismatchCount === 0
    && rows.every((row) => /^[0-9a-f]{64}$/.test(row.content_sha256 || ""));
  return {
    count: rows.length,
    complete,
    declared_mismatch_count: declaredMismatchCount,
    ordered_content_sha256: complete ? sha256Bytes(JSON.stringify(rows)) : null
  };
}

export function buildOpenAiProviderRequestIdentity({
  model,
  strictPrompt,
  images,
  imageDetail,
  responseProfile,
  includeVectorDecision,
  requestedServiceTier,
  maxOutputTokens,
  modelControls,
  textOptions
}) {
  const promptBytes = Buffer.from(String(strictPrompt || ""), "utf8");
  const imageManifest = providerImageManifest(images, imageDetail);
  const controls = {
    model_controls: modelControls,
    text_options: textOptions,
    response_profile: responseProfile,
    include_vector_decision: includeVectorDecision === true,
    image_detail: imageDetail,
    requested_service_tier: requestedServiceTier,
    max_output_tokens: maxOutputTokens
  };
  const controlsSha256 = sha256Bytes(JSON.stringify(controls));
  const base = {
    schema_version: openAiProviderRequestIdentitySchemaVersion,
    status: imageManifest.complete ? "COMPLETE" : "PARTIAL",
    requested_model_id: model,
    provider_prompt_sha256: sha256Bytes(promptBytes),
    provider_prompt_utf8_bytes: promptBytes.byteLength,
    provider_input_image_count: imageManifest.count,
    provider_ordered_image_content_sha256: imageManifest.ordered_content_sha256,
    provider_image_manifest_complete: imageManifest.complete,
    provider_image_declared_content_mismatch_count: imageManifest.declared_mismatch_count,
    provider_request_controls_sha256: controlsSha256,
    response_profile: responseProfile,
    image_detail: imageDetail,
    requested_service_tier: requestedServiceTier,
    max_output_tokens: maxOutputTokens,
    reasoning_effort: modelControls?.reasoning?.effort || null,
    temperature: Number.isFinite(Number(modelControls?.temperature)) ? Number(modelControls.temperature) : null,
    text_verbosity: textOptions?.verbosity || null
  };
  return {
    ...base,
    provider_request_fingerprint: imageManifest.complete
      ? sha256Bytes(JSON.stringify(base))
      : null
  };
}
