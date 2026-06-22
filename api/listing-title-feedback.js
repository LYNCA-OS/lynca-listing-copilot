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

function normalizeImage(value) {
  if (!value || typeof value !== "object") return null;

  return {
    name: String(value.name || "").trim(),
    type: String(value.type || "").trim(),
    dataUrl: String(value.dataUrl || "").trim()
  };
}

function isImageDataUrl(image) {
  return /^data:image\/[^;,]+;base64,/i.test(String(image?.dataUrl || ""));
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
  const frontImage = normalizeImage(payload.front_image);
  const backImage = normalizeImage(payload.back_image);
  const imageCount = Number(payload.image_count || 0);

  console.log("[listing-feedback] received payload", {
    hasFrontImage: Boolean(frontImage?.dataUrl),
    hasBackImage: Boolean(backImage?.dataUrl),
    frontImageIsDataUrl: isImageDataUrl(frontImage),
    backImageIsDataUrl: isImageDataUrl(backImage),
    imageCount,
    frontImageName: frontImage?.name || null,
    backImageName: backImage?.name || null,
    frontImageDataUrlLength: frontImage?.dataUrl?.length || 0,
    backImageDataUrlLength: backImage?.dataUrl?.length || 0
  });

  if (!generatedTitle || !correctedTitle) {
    sendJson(res, 400, { ok: false, message: "Generated title and corrected title are required." });
    return;
  }

  if (generatedTitle === correctedTitle) {
    sendJson(res, 200, { ok: true, skipped: true, reason: "unchanged_title" });
    return;
  }

  if (!isImageDataUrl(frontImage)) {
    console.error("[listing-feedback] missing or invalid front image", {
      hasFrontImage: Boolean(frontImage?.dataUrl),
      imageCount
    });
    sendJson(res, 400, { ok: false, message: "Front image evidence is missing or invalid." });
    return;
  }

  if (imageCount > 1 && !isImageDataUrl(backImage)) {
    console.error("[listing-feedback] missing or invalid back image", {
      hasBackImage: Boolean(backImage?.dataUrl),
      imageCount
    });
    sendJson(res, 400, { ok: false, message: "Back image evidence is missing or invalid for paired asset." });
    return;
  }

  try {
    const record = await createTitleFeedbackRecord({
      generatedTitle,
      correctedTitle,
      frontImage,
      backImage,
      operatorId: operatorIdFromRequest(req)
    });

    console.log("[listing-feedback] saved record", {
      id: record?.id || null,
      front_image_url: record?.front_image_url || null,
      back_image_url: record?.back_image_url || null
    });

    sendJson(res, 200, { ok: true, record });
  } catch (error) {
    console.error("[listing-feedback] save failed", {
      message: error.message || "Feedback save failed."
    });
    sendJson(res, 500, { ok: false, message: error.message || "Feedback save failed." });
  }
}
