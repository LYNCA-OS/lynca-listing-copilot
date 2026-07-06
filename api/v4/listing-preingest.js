import v2PreingestHandler from "../listing-preingest.js";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { persistV4PreingestionBundle } from "../../lib/listing/v4/session/session-store.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const v2Response = await callJsonHandler(v2PreingestHandler, {
    method: "POST",
    headers: req.headers,
    payload: {
      ...payload,
      v4_preingestion: true
    }
  });
  const body = v2Response.body || {};
  const bundleId = body.bundle_id || payload.preingestion_bundle_id || payload.preingestionBundleId || "";
  const v4Persistence = bundleId
    ? await persistV4PreingestionBundle({
      bundleId,
      assetId: payload.asset_id || payload.assetId || null,
      bundle: body,
      summary: body.preprocessing_summary || {}
    })
    : { saved: false, error: "missing_bundle_id" };

  sendJson(res, v2Response.statusCode || 200, withV4Version({
    ...body,
    ok: body.ok !== false && v2Response.statusCode >= 200 && v2Response.statusCode < 300,
    v4_preingestion_bundle_id: bundleId || null,
    v4_persistence: { preingestion_bundle: v4Persistence }
  }));
}
