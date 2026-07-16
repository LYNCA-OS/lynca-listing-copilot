import { payloadAssetFingerprint } from "../memory/approved-identity-memory.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assetFingerprintStatus(imagePaths = {}, fingerprint = null) {
  if (!fingerprint) return "MISSING";
  const images = [
    imagePaths.front_object_path || imagePaths.front_content_sha256
      ? { content_sha256: imagePaths.front_content_sha256 }
      : null,
    imagePaths.back_object_path || imagePaths.back_content_sha256
      ? { content_sha256: imagePaths.back_content_sha256 }
      : null,
    ...(Array.isArray(imagePaths.additional_image_paths) ? imagePaths.additional_image_paths : [])
  ].filter(Boolean);
  return images.length > 0 && images.every((image) => cleanText(image.content_sha256))
    ? "CONTENT_ADDRESSED"
    : "REFERENCE_FINGERPRINTED";
}

function imageReferences(imagePaths = {}) {
  const references = [];
  const push = (image = {}) => {
    const objectPath = cleanText(image.object_path) || null;
    const contentSha256 = cleanText(image.content_sha256).toLowerCase() || null;
    if (!objectPath && !contentSha256) return;
    references.push({
      image_id: cleanText(image.image_id) || null,
      image_role: cleanText(image.image_role || image.role) || null,
      bucket: cleanText(image.bucket) || null,
      object_path: objectPath,
      content_sha256: contentSha256,
      derived: image.derived === true,
      source_region: cleanText(image.source_region) || null
    });
  };
  push({
    image_role: "front_original",
    bucket: imagePaths.front_bucket,
    object_path: imagePaths.front_object_path,
    content_sha256: imagePaths.front_content_sha256
  });
  push({
    image_role: "back_original",
    bucket: imagePaths.back_bucket,
    object_path: imagePaths.back_object_path,
    content_sha256: imagePaths.back_content_sha256
  });
  for (const image of Array.isArray(imagePaths.additional_image_paths)
    ? imagePaths.additional_image_paths
    : []) push(image);
  return references;
}

export function buildDataIdentitySnapshot({
  payload = {},
  tenantId = "",
  userId = "",
  operatorId = ""
} = {}) {
  const canonicalAssetId = cleanText(payload.asset_id || payload.assetId) || null;
  const clientAssetRef = cleanText(payload.client_asset_ref || payload.clientAssetRef) || null;
  const fingerprintResult = payloadAssetFingerprint(payload);
  const fingerprint = fingerprintResult.asset_fingerprint || null;
  const fingerprintStatus = assetFingerprintStatus(fingerprintResult.image_paths, fingerprint);
  const stableAssetId = fingerprint
    ? `asset_${fingerprintStatus === "CONTENT_ADDRESSED" ? "content" : "reference"}_sha256_${fingerprint}`
    : null;
  return {
    schema_version: "data-identity-v1",
    tenant_id: cleanText(tenantId) || null,
    user_id: cleanText(userId || operatorId) || null,
    operator_id: cleanText(operatorId || userId) || null,
    asset_id: canonicalAssetId,
    stable_asset_id: stableAssetId,
    client_asset_ref: clientAssetRef,
    asset_fingerprint: fingerprint,
    image_references: imageReferences(fingerprintResult.image_paths),
    asset_identity_status: canonicalAssetId
      ? stableAssetId ? fingerprintStatus : "DURABLE_ASSET_ONLY"
      : "MISSING",
    tenant_identity_source: cleanText(tenantId) ? "SIGNED_AUTH_PRINCIPAL" : "MISSING",
    user_identity_source: cleanText(userId || operatorId) ? "SIGNED_AUTH_PRINCIPAL" : "MISSING"
  };
}

export function sessionDataIdentitySnapshot(session = {}) {
  const stored = session.identity_snapshot && typeof session.identity_snapshot === "object"
    ? session.identity_snapshot
    : {};
  return {
    schema_version: "data-identity-v1",
    tenant_id: cleanText(session.tenant_id || stored.tenant_id) || null,
    user_id: cleanText(session.user_id || stored.user_id || session.operator_id) || null,
    operator_id: cleanText(session.operator_id || stored.operator_id) || null,
    asset_id: cleanText(session.asset_id || stored.asset_id) || null,
    stable_asset_id: cleanText(session.stable_asset_id || stored.stable_asset_id) || null,
    client_asset_ref: cleanText(session.client_asset_ref || stored.client_asset_ref) || null,
    asset_fingerprint: cleanText(session.asset_fingerprint || stored.asset_fingerprint) || null,
    image_references: Array.isArray(stored.image_references) ? stored.image_references : [],
    asset_identity_status: cleanText(stored.asset_identity_status)
      || (session.asset_fingerprint ? "FINGERPRINT_UNVERIFIED" : session.asset_id ? "CLIENT_REF_ONLY" : "MISSING"),
    tenant_identity_source: cleanText(stored.tenant_identity_source) || "SESSION_SNAPSHOT",
    user_identity_source: cleanText(stored.user_identity_source) || "SESSION_SNAPSHOT"
  };
}
