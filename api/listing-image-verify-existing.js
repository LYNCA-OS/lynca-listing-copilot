import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { cookieName, parseCookies, readSignedSession } from "../lib/listing-session.mjs";
import { verifyExistingListingImageObject } from "../lib/listing/storage/supabase-image-storage.mjs";
import { saveListingImageVerificationRecord } from "../lib/listing/storage/storage-verification-store.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = readSignedSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  if (!authenticated) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_image_verify_existing",
    limit: 120,
    windowMs: 60_000,
    message: "Too many existing image verification requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  try {
    const verification = await verifyExistingListingImageObject({
      objectPath: payload.objectPath || payload.object_path,
      bucket: payload.bucket || payload.storage_bucket
    });
    let verificationRecord = {
      saved: false,
      durable: false
    };

    try {
      verificationRecord = await saveListingImageVerificationRecord({
        verification,
        assetId: payload.assetId || payload.asset_id || null,
        imageId: payload.imageId || payload.image_id || null,
        role: payload.role || payload.storageRole || payload.storage_role || null
      });
    } catch {
      verificationRecord = {
        saved: false,
        durable: true,
        reason: "verification_record_write_failed"
      };
    }

    sendJson(res, 200, {
      ok: true,
      verification,
      verification_record: {
        saved: Boolean(verificationRecord.saved),
        durable: Boolean(verificationRecord.durable),
        reason: verificationRecord.reason || null
      }
    });
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      message: String(error.message || "Unable to verify existing image.").slice(0, 240)
    });
  }
}
