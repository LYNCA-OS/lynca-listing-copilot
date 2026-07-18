import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import uploadUrlHandler from "../api/listing-image-upload-url.js";
import verifyUploadHandler from "../api/listing-image-verify-upload.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";
import {
  buildListingImageObjectPath,
  assertTenantListingImageObjectPath,
  createListingImageVerificationToken,
  createListingImageSignedReadUrl,
  createListingImageSignedUpload,
  deleteListingImageObject,
  validateListingImageUpload,
  verifyListingImageVerificationToken,
  verifyListingImageUploadedObject
} from "../lib/listing/storage/supabase-image-storage.mjs";
import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  LISTING_IMAGE_BUCKET: "listing-card-images",
  LISTING_IMAGE_SIGNED_URL_TTL_SECONDS: "600",
  METAVERSE_AUTH_SECRET: "test-secret"
};

const jpegSignatureHex = "ffd8ffe000104a464946000101000001";
const pngSignatureHex = "89504e470d0a1a0a0000000d49484452";
const webpSignatureHex = "52494646100000005745425056503820";
const heicSignatureHex = "00000018667479706865696300000000686569636d696631";
const pngVerificationBytes = Buffer.concat([
  Buffer.from("89504e470d0a1a0a0000000d49484452000004b0000003840802000000", "hex"),
  Buffer.alloc(96)
]);
const jpegUploadSha256 = "a".repeat(64);
const pngVerificationSha256 = crypto.createHash("sha256").update(pngVerificationBytes).digest("hex");
const tenantId = "tenant_legacy";
const durableAssetId = "asset_11111111-1111-4111-8111-111111111111";

function tenantAwareFetch(storageFetch, { verificationFetch = null } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/tenant_members") {
      return new Response(JSON.stringify([{
        tenant_id: tenantId,
        user_id: "user_legacy",
        role: "OWNER",
        status: "ACTIVE",
        disabled_at: null,
        user: {
          id: "user_legacy",
          email: "legacy@example.test",
          status: "ACTIVE",
          session_version: 1,
          disabled_at: null,
          auth_user_id: null
        },
        tenant: {
          id: tenantId,
          name: "Legacy tenant",
          plan: "pilot",
          status: "ACTIVE",
          disabled_at: null
        }
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (["/rest/v1/production_events", "/rest/v1/request_logs"].includes(url.pathname)) {
      return new Response("", { status: 201 });
    }
    if (url.pathname === "/rest/v1/listing_assets") {
      const assetId = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
      return new Response(JSON.stringify(assetId ? [{
        tenant_id: tenantId,
        id: assetId
      }] : []), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/rest/v1/listing_image_verifications") {
      if (typeof verificationFetch === "function") return verificationFetch(input, init);
      const body = init.body ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify([body]), { status: 201, headers: { "content-type": "application/json" } });
    }
    return storageFetch(input, init);
  };
}

function objectResponse(bytes, headers = {}) {
  return {
    ok: true,
    status: 206,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || "";
      }
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

assert.deepEqual(validateListingImageUpload({
  contentType: "image/jpeg",
  size: 123,
  width: 1200,
  height: 900,
  signatureHex: jpegSignatureHex
}), {
  content_type: "image/jpeg",
  size: 123,
  width: 1200,
  height: 900,
  signature_validated: true
});
assert.throws(
  () => validateListingImageUpload({ contentType: "text/html", size: 123 }),
  /Unsupported image MIME type/
);
assert.throws(
  () => validateListingImageUpload({ contentType: "image/jpeg", size: 123, height: 900, signatureHex: jpegSignatureHex }),
  /Image width is required/
);
assert.throws(
  () => validateListingImageUpload({ contentType: "image/jpeg", size: 123, width: 1200, signatureHex: jpegSignatureHex }),
  /Image height is required/
);
assert.throws(
  () => validateListingImageUpload({ contentType: "image/jpeg", size: 123, width: 1200, height: 900 }),
  /Image file signature is required/
);
assert.throws(
  () => validateListingImageUpload({
    contentType: "image/png",
    size: 123,
    width: 1200,
    height: 900,
    signatureHex: jpegSignatureHex
  }),
  /Image file signature does not match MIME type/
);
assert.equal(
  validateListingImageUpload({
    contentType: "image/webp",
    size: 123,
    width: 1200,
    height: 900,
    signatureHex: webpSignatureHex
  }).signature_validated,
  true
);
assert.equal(
  validateListingImageUpload({
    contentType: "image/heic",
    size: 123,
    width: 1200,
    height: 900,
    signatureHex: heicSignatureHex
  }).signature_validated,
  true
);
assert.equal(
  validateListingImageUpload({
    contentType: "image/png",
    size: 123,
    width: 1200,
    height: 900,
    signatureBytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  }).signature_validated,
  true
);

const objectPath = buildListingImageObjectPath({
  tenantId,
  assetId: "../Asset 1",
  imageId: "Front Image",
  role: "front_original",
  fileName: "Card.JPG",
  contentType: "image/jpeg",
  now: new Date("2026-06-22T08:00:00Z")
});
assert.equal(objectPath, "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-image.jpg");
assert.equal(assertTenantListingImageObjectPath(objectPath, tenantId), objectPath);
assert.throws(
  () => assertTenantListingImageObjectPath(objectPath, "tenant_other"),
  /different tenant/
);

let uploadRequest;
const upload = await createListingImageSignedUpload({
  tenantId,
  assetId: "asset-1",
  imageId: "front-1",
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  size: 1000,
  width: 1200,
  height: 900,
  signatureHex: jpegSignatureHex,
  contentSha256: jpegUploadSha256,
  env,
  now: new Date("2026-06-22T08:00:00Z"),
  fetchImpl: async (url, init) => {
    uploadRequest = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        url: "/object/upload/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.jpg?token=signed"
      })
    };
  }
});

assert.match(uploadRequest.url, /\/storage\/v1\/object\/upload\/sign\/listing-card-images\//);
assert.equal(uploadRequest.init.method, "POST");
assert.equal(uploadRequest.init.headers.apikey, "test-service-role");
assert.equal(uploadRequest.init.headers.authorization, undefined);
assert.equal(
  supabaseServiceHeaders("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature").authorization,
  "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature"
);
assert.equal(upload.tenant_id, tenantId);
assert.equal(upload.object_path, "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.jpg");
assert.equal(upload.width, 1200);
assert.equal(upload.height, 900);
assert.equal(upload.content_sha256, jpegUploadSha256);
assert.equal(upload.signature_validated, true);
assert.equal(
  upload.signed_upload_url,
  "https://example.supabase.co/storage/v1/object/upload/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.jpg?token=signed"
);
let transientUploadCalls = 0;
const transientUpload = await createListingImageSignedUpload({
  tenantId,
  assetId: "asset-transient",
  imageId: "front-transient",
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  size: 1000,
  width: 1200,
  height: 900,
  signatureHex: jpegSignatureHex,
  env,
  now: new Date("2026-06-22T08:00:00Z"),
  fetchImpl: async () => {
    transientUploadCalls += 1;
    if (transientUploadCalls === 1) {
      return { ok: false, status: 503, text: async () => "temporarily unavailable" };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        url: "/object/upload/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/asset-transient/front_original-front-transient.jpg?token=signed"
      })
    };
  }
});
assert.equal(transientUploadCalls, 2);
assert.match(transientUpload.signed_upload_url, /token=signed/);
await assert.rejects(
  () => createListingImageSignedUpload({
    tenantId,
    assetId: "asset-1",
    imageId: "too-wide",
    role: "front_original",
    fileName: "front.jpg",
    contentType: "image/jpeg",
    size: 1000,
    width: 12001,
    height: 900,
    signatureHex: jpegSignatureHex,
    env,
    fetchImpl: async () => ({})
  }),
  /Image exceeds max dimension/
);
await assert.rejects(
  () => createListingImageSignedUpload({
    tenantId,
    assetId: "asset-1",
    imageId: "too-large",
    role: "front_original",
    fileName: "front.jpg",
    contentType: "image/jpeg",
    size: 25 * 1024 * 1024 + 1,
    width: 1200,
    height: 900,
    signatureHex: jpegSignatureHex,
    env,
    fetchImpl: async () => ({})
  }),
  /Image exceeds max upload size/
);
await assert.rejects(
  () => createListingImageSignedUpload({
    tenantId,
    assetId: "asset-1",
    imageId: "too-many-pixels",
    role: "front_original",
    fileName: "front.jpg",
    contentType: "image/jpeg",
    size: 1000,
    width: 10000,
    height: 6000,
    signatureHex: jpegSignatureHex,
    env: {
      ...env,
      LISTING_IMAGE_MAX_TOTAL_PIXELS: "50000000"
    },
    fetchImpl: async () => ({})
  }),
  /Image exceeds max pixel area/
);

let readRequest;
const readUrl = await createListingImageSignedReadUrl({
  objectPath: upload.object_path,
  env,
  fetchImpl: async (url, init) => {
    readRequest = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        signedURL: "/object/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.jpg?token=read"
      })
    };
  }
});

assert.match(readRequest.url, /\/storage\/v1\/object\/sign\/listing-card-images\//);
assert.equal(JSON.parse(readRequest.init.body).expiresIn, 600);
assert.equal(
  readUrl,
  "https://example.supabase.co/storage/v1/object/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.jpg?token=read"
);
assert.rejects(
  () => createListingImageSignedReadUrl({ objectPath: "../secret.jpg", env, fetchImpl: async () => ({}) }),
  /Invalid listing image object path/
);

let verifyRequest;
const verification = await verifyListingImageUploadedObject({
  tenantId,
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  contentSha256: pngVerificationSha256,
  env,
  fetchImpl: async (url, init) => {
    verifyRequest = { url, init };
    return objectResponse(pngVerificationBytes, {
      "content-type": "image/png",
      "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
    });
  }
});
assert.match(verifyRequest.url, /\/storage\/v1\/object\/listing-card-images\//);
assert.equal(verifyRequest.init.method, "GET");
assert.equal(verifyRequest.init.headers.apikey, "test-service-role");
assert.equal(verifyRequest.init.headers.authorization, undefined);
assert.equal(verifyRequest.init.headers.range, undefined, "durable upload verification must read the complete object");
assert.equal(verification.object_verified, true);
assert.equal(verification.dimension_source, "object_bytes");
assert.equal(verification.width, 1200);
assert.equal(verification.height, 900);
assert.equal(verification.content_sha256, pngVerificationSha256);
assert.equal(verification.content_hash_verified, true);
let transientVerificationCalls = 0;
const transientVerification = await verifyListingImageUploadedObject({
  tenantId,
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  env,
  fetchImpl: async () => {
    transientVerificationCalls += 1;
    if (transientVerificationCalls === 1) {
      return { ok: false, status: 503, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return objectResponse(pngVerificationBytes, {
      "content-type": "image/png",
      "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
    });
  }
});
assert.equal(transientVerificationCalls, 2);
assert.equal(transientVerification.object_verified, true);
let eventualVisibilityCalls = 0;
const eventualVisibilityVerification = await verifyListingImageUploadedObject({
  tenantId,
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  env,
  fetchImpl: async () => {
    eventualVisibilityCalls += 1;
    if (eventualVisibilityCalls === 1) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return objectResponse(pngVerificationBytes, {
      "content-type": "image/png",
      "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
    });
  }
});
assert.equal(eventualVisibilityCalls, 2);
assert.equal(eventualVisibilityVerification.object_verified, true);
assert.equal(typeof verification.verification_token, "string");
assert.ok(verification.verification_token.length > 40);
const verifiedTokenPayload = verifyListingImageVerificationToken({
  token: verification.verification_token,
  objectPath: verification.object_path,
  bucket: verification.bucket,
  contentType: verification.content_type,
  size: verification.size,
  width: verification.width,
  height: verification.height,
  env
});
assert.deepEqual(
  verifiedTokenPayload,
  {
    tenant_id: tenantId,
    object_path: verification.object_path,
    bucket: verification.bucket,
    content_type: verification.content_type,
    size: verification.size,
    width: verification.width,
    height: verification.height,
    verified_at: verifiedTokenPayload.verified_at
  }
);
assert.throws(
  () => verifyListingImageVerificationToken({
    token: verification.verification_token,
    objectPath: verification.object_path,
    bucket: verification.bucket,
    contentType: verification.content_type,
    size: verification.size + 1,
    width: verification.width,
    height: verification.height,
    env
  }),
  /does not match image metadata/
);
const expiredToken = createListingImageVerificationToken({
  objectPath: verification.object_path,
  bucket: verification.bucket,
  contentType: verification.content_type,
  size: verification.size,
  width: verification.width,
  height: verification.height,
  env,
  now: new Date("2026-06-22T08:00:00Z")
});
assert.throws(
  () => verifyListingImageVerificationToken({
    token: expiredToken,
    objectPath: verification.object_path,
    bucket: verification.bucket,
    contentType: verification.content_type,
    size: verification.size,
    width: verification.width,
    height: verification.height,
    env,
    now: new Date("2026-06-22T11:00:01Z")
  }),
  /expired/
);
await assert.rejects(
  () => verifyListingImageUploadedObject({
    tenantId,
    objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
    contentType: "image/png",
    size: pngVerificationBytes.length + 1,
    width: 1200,
    height: 900,
    signatureHex: pngSignatureHex,
    env,
    fetchImpl: async () => objectResponse(pngVerificationBytes, {
      "content-type": "image/png",
      "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
    })
  }),
  /Uploaded image size does not match expected size/
);
await assert.rejects(
  () => verifyListingImageUploadedObject({
    tenantId,
    objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
    contentType: "image/png",
    size: pngVerificationBytes.length,
    width: 1201,
    height: 900,
    signatureHex: pngSignatureHex,
    env,
    fetchImpl: async () => objectResponse(pngVerificationBytes, {
      "content-type": "image/png",
      "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
    })
  }),
  /Uploaded image dimensions do not match expected dimensions/
);

let deleteRequest;
const deleteResult = await deleteListingImageObject({
  tenantId,
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front-1.png",
  env,
  fetchImpl: async (url, init) => {
    deleteRequest = { url, init };
    return {
      ok: true,
      status: 200,
      text: async () => ""
    };
  }
});
assert.match(deleteRequest.url, /\/storage\/v1\/object\/listing-card-images\//);
assert.equal(deleteRequest.init.method, "DELETE");
assert.equal(deleteRequest.init.headers.apikey, "test-service-role");
assert.equal(deleteRequest.init.headers.authorization, undefined);
assert.equal(deleteResult.deleted, true);
await assert.rejects(
  () => deleteListingImageObject({
    objectPath: "../secret.png",
    env,
    fetchImpl: async () => ({})
  }),
  /Invalid listing image object path/
);

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
Object.assign(process.env, env);
globalThis.fetch = tenantAwareFetch(async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    url: `/object/upload/sign/listing-card-images/tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.jpg?token=signed`
  })
}));

function sessionCookie() {
  const token = createListingSessionToken({
    userId: "user_legacy",
    tenantId,
    email: "legacy@example.test",
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `${cookieName}=${token}`;
}

async function callUploadApi(body) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = uploadUrlHandler(req, res);
  await new Promise((resolve) => setTimeout(resolve, 0));
  req.emit("data", JSON.stringify(body));
  req.emit("end");
  await promise;
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

async function callVerifyApi(body) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = verifyUploadHandler(req, res);
  await new Promise((resolve) => setTimeout(resolve, 0));
  req.emit("data", JSON.stringify(body));
  req.emit("end");
  await promise;
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

const apiResponse = await callUploadApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  size: 2000,
  width: 1200,
  height: 900,
  signatureHex: jpegSignatureHex,
  contentSha256: jpegUploadSha256
});
assert.equal(apiResponse.statusCode, 200);
assert.equal(apiResponse.body.ok, true);
assert.match(apiResponse.body.upload.object_path, new RegExp(`^tenants/tenant_legacy/listing-assets/\\d{4}-\\d{2}-\\d{2}/${durableAssetId}/`));
assert.equal(apiResponse.body.upload.content_sha256, jpegUploadSha256);
assert.doesNotMatch(JSON.stringify(apiResponse.body), /test-service-role/);
assert.doesNotMatch(JSON.stringify(apiResponse.body), new RegExp(jpegSignatureHex));

const rejectedApiResponse = await callUploadApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  size: 2000,
  width: 1200,
  height: 900
});
assert.equal(rejectedApiResponse.statusCode, 400);
assert.match(rejectedApiResponse.body.message, /Image file signature is required/);

globalThis.fetch = tenantAwareFetch(async () => objectResponse(pngVerificationBytes, {
  "content-type": "image/png",
  "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
}));
const verifyApiResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: `tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.png`,
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  contentSha256: pngVerificationSha256
});
assert.equal(verifyApiResponse.statusCode, 200);
assert.equal(verifyApiResponse.body.ok, true);
assert.equal(verifyApiResponse.body.verification.object_verified, true);
assert.equal(verifyApiResponse.body.verification.dimension_source, "object_bytes");
assert.equal(verifyApiResponse.body.verification.content_sha256, pngVerificationSha256);
assert.equal(verifyApiResponse.body.verification.content_hash_verified, true);
assert.doesNotMatch(JSON.stringify(verifyApiResponse.body), /test-service-role/);
assert.doesNotMatch(JSON.stringify(verifyApiResponse.body), new RegExp(pngSignatureHex));

const crossAssetStorageCalls = [];
globalThis.fetch = tenantAwareFetch(async (url, init = {}) => {
  crossAssetStorageCalls.push({ url: String(url), method: init.method || "GET" });
  return objectResponse(pngVerificationBytes, {
    "content-type": "image/png",
    "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
  });
});
const crossAssetVerifyResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-other/front_original-front-api.png",
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  contentSha256: pngVerificationSha256
});
assert.equal(crossAssetVerifyResponse.statusCode, 400);
assert.match(crossAssetVerifyResponse.body.message, /does not match asset_id/);
assert.equal(crossAssetStorageCalls.length, 0, "cross-asset paths must fail before object reads or deletion");

const durableFailureStorageCalls = [];
globalThis.fetch = tenantAwareFetch(async (url, init = {}) => {
  durableFailureStorageCalls.push({ url: String(url), method: init.method || "GET" });
  if (init.method === "DELETE") {
    return {
      ok: true,
      status: 200,
      text: async () => ""
    };
  }
  return objectResponse(pngVerificationBytes, {
    "content-type": "image/png",
    "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
  });
}, {
  verificationFetch: async () => new Response("verification store unavailable", { status: 503 })
});
const durableFailureVerifyResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: `tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.png`,
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex,
  contentSha256: pngVerificationSha256
});
assert.equal(durableFailureVerifyResponse.statusCode, 503);
assert.equal(durableFailureVerifyResponse.body.ok, false);
assert.equal(durableFailureVerifyResponse.body.retryable, true);
assert.equal(durableFailureVerifyResponse.body.code, "verification_record_write_failed");
assert.equal(durableFailureVerifyResponse.body.cleanup.attempted, true);
assert.equal(durableFailureVerifyResponse.body.cleanup.deleted, true);
assert.equal(durableFailureStorageCalls.some((call) => call.method === "DELETE"), true);

const cleanupCalls = [];
globalThis.fetch = tenantAwareFetch(async (url, init) => {
  cleanupCalls.push({ url, init });
  if (init.method === "DELETE") {
    return {
      ok: true,
      status: 200,
      text: async () => ""
    };
  }

  return objectResponse(pngVerificationBytes, {
    "content-type": "image/png",
    "content-range": `bytes 0-${pngVerificationBytes.length - 1}/${pngVerificationBytes.length}`
  });
});
const rejectedVerifyApiResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: `tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.png`,
  contentType: "image/png",
  size: pngVerificationBytes.length + 1,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex
});
assert.equal(rejectedVerifyApiResponse.statusCode, 400);
assert.match(rejectedVerifyApiResponse.body.message, /Uploaded image size does not match expected size/);
assert.equal(rejectedVerifyApiResponse.body.cleanup.attempted, true);
assert.equal(rejectedVerifyApiResponse.body.cleanup.deleted, true);
assert.equal(cleanupCalls.some((call) => call.init.method === "DELETE"), true);
assert.doesNotMatch(JSON.stringify(rejectedVerifyApiResponse.body), /test-service-role/);
assert.doesNotMatch(JSON.stringify(rejectedVerifyApiResponse.body), new RegExp(pngSignatureHex));

const transientApiCalls = [];
globalThis.fetch = tenantAwareFetch(async (url, init = {}) => {
  transientApiCalls.push({ url: String(url), method: init.method || "GET" });
  return {
    ok: false,
    status: 503,
    headers: { get: () => "" },
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => "temporarily unavailable"
  };
});
const retryableVerifyApiResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: `tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.png`,
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex
});
assert.equal(
  transientApiCalls.filter((call) => call.method === "GET" && call.url.includes("/storage/v1/object/")).length,
  4,
  "storage verification should use the bounded server-side consistency window"
);
assert.equal(retryableVerifyApiResponse.statusCode, 503);
assert.equal(retryableVerifyApiResponse.body.retryable, true);
assert.equal(retryableVerifyApiResponse.body.cleanup.attempted, false);
assert.equal(retryableVerifyApiResponse.body.cleanup.preserved_for_retry, true);

const readIndeterminateCalls = [];
globalThis.fetch = tenantAwareFetch(async (url, init = {}) => {
  readIndeterminateCalls.push({ url: String(url), method: init.method || "GET" });
  return {
    ok: false,
    status: 400,
    headers: { get: () => "" },
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => "object is not readable yet"
  };
});
const readIndeterminateVerifyApiResponse = await callVerifyApi({
  assetId: durableAssetId,
  imageId: "front-api",
  role: "front_original",
  objectPath: `tenants/tenant_legacy/listing-assets/2026-06-22/${durableAssetId}/front_original-front-api.png`,
  contentType: "image/png",
  size: pngVerificationBytes.length,
  width: 1200,
  height: 900,
  signatureHex: pngSignatureHex
});
assert.equal(
  readIndeterminateCalls.filter((call) => call.method === "GET" && call.url.includes("/storage/v1/object/")).length,
  4,
  "a validated post-PUT path returning 400 should exhaust the consistency window"
);
assert.equal(readIndeterminateVerifyApiResponse.statusCode, 503);
assert.equal(readIndeterminateVerifyApiResponse.body.retryable, true);
assert.equal(readIndeterminateVerifyApiResponse.body.code, "SUPABASE_STORAGE_OBJECT_READ_INDETERMINATE");
assert.equal(readIndeterminateVerifyApiResponse.body.cleanup.attempted, false);
assert.equal(readIndeterminateVerifyApiResponse.body.cleanup.preserved_for_retry, true);

Object.keys(process.env).forEach((key) => {
  if (!(key in originalEnv)) delete process.env[key];
});
Object.assign(process.env, originalEnv);
globalThis.fetch = originalFetch;

console.log("storage signed URL tests passed");
