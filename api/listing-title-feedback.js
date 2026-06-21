import { operatorIdFromRequest } from "../lib/listing-session.mjs";
import { createTitleFeedbackRecord } from "../lib/supabase-feedback.mjs";

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

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
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

  if (generatedTitle === correctedTitle) {
    sendJson(res, 200, { ok: true, skipped: true, reason: "unchanged_title" });
    return;
  }

  try {
    const record = await createTitleFeedbackRecord({
      generatedTitle,
      correctedTitle,
      operatorId: operatorIdFromRequest(req)
    });

    sendJson(res, 200, { ok: true, record });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message || "Feedback save failed." });
  }
}
