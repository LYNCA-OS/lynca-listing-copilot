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

export function buildDataIdentitySnapshot({
  payload = {},
  tenantId = "",
  userId = "",
  operatorId = ""
} = {}) {
  const clientAssetRef = cleanText(payload.asset_id || payload.assetId) || null;
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
    asset_id: stableAssetId || clientAssetRef,
    stable_asset_id: stableAssetId,
    client_asset_ref: clientAssetRef,
    asset_fingerprint: fingerprint,
    asset_identity_status: stableAssetId ? fingerprintStatus : clientAssetRef ? "CLIENT_REF_ONLY" : "MISSING",
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
    asset_id: cleanText(session.stable_asset_id || stored.stable_asset_id || session.asset_id || stored.asset_id) || null,
    stable_asset_id: cleanText(session.stable_asset_id || stored.stable_asset_id) || null,
    client_asset_ref: cleanText(session.client_asset_ref || stored.client_asset_ref || session.asset_id) || null,
    asset_fingerprint: cleanText(session.asset_fingerprint || stored.asset_fingerprint) || null,
    asset_identity_status: cleanText(stored.asset_identity_status)
      || (session.asset_fingerprint ? "FINGERPRINT_UNVERIFIED" : session.asset_id ? "CLIENT_REF_ONLY" : "MISSING"),
    tenant_identity_source: cleanText(stored.tenant_identity_source) || "SESSION_SNAPSHOT",
    user_identity_source: cleanText(stored.user_identity_source) || "SESSION_SNAPSHOT"
  };
}
