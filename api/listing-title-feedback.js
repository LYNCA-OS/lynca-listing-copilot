import { enforceApiRateLimit } from "../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../lib/listing-session.mjs";
import { normalizeTitle } from "../lib/listing/feedback/review-records.mjs";
import {
  createListingReviewRecord,
  listingFeedbackRetentionEnabled
} from "../lib/supabase-feedback.mjs";

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

  if (!enforceApiRateLimit(req, res, {
    scope: "listing_feedback",
    limit: 120,
    windowMs: 60_000,
    message: "Too many feedback requests. Please try again shortly."
  })) return;

  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  const generatedTitle = normalizeTitle(payload.generated_title);
  const correctedTitle = normalizeTitle(payload.corrected_title);

  if (!generatedTitle || !correctedTitle) {
    sendJson(res, 400, { ok: false, message: "Generated title and corrected title are required." });
    return;
  }

  try {
    const record = await createListingReviewRecord({
      payload: {
        ...payload,
        generated_title: generatedTitle,
        corrected_title: correctedTitle
      },
      operatorId: operatorIdFromRequest(req)
    });

    sendJson(res, 200, {
      ok: true,
      record,
      review_outcome: record.review?.review_outcome,
      retention_enabled: listingFeedbackRetentionEnabled(),
      retention_skipped: record.retained === false,
      retention_reason: record.reason || null,
      legacy_feedback_saved: Boolean(record.legacy_feedback && record.retained !== false)
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message || "Feedback save failed." });
  }
}
