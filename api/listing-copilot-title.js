import crypto from "node:crypto";

const cookieName = "lynca_metaverse_session";
const defaultModel = "gpt-4.1-mini";
const maxFallbackTitleLength = 80;

function parseCookies(header) {
  return Object.fromEntries(String(header || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key, value]) => key && value));
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function isValidSession(cookie, secret) {
  if (!cookie || !secret) return false;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload, secret)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeTitle(title, maxLength) {
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function compactFileName(name) {
  return String(name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function resolutionHints(resolutionMap) {
  return Object.entries(resolutionMap || {}).map(([code, label]) => `${code}: ${label}`).join("\n");
}

function findResolutionLabel(text, resolutionMap) {
  const upperText = String(text || "").toUpperCase();
  const match = Object.entries(resolutionMap || {}).find(([code]) => upperText.includes(code.toUpperCase()));
  return match ? match : [];
}

function fallbackResult(payload) {
  const firstImage = payload.images?.[0] || {};
  const sourceName = compactFileName(firstImage.name);
  const [code, resolvedLabel] = findResolutionLabel(firstImage.name, payload.resolutionMap);
  const titleParts = [sourceName];
  if (resolvedLabel && !sourceName.toLowerCase().includes(String(resolvedLabel).toLowerCase())) titleParts.push(resolvedLabel);
  const title = normalizeTitle(titleParts.filter(Boolean).join(" "), payload.maxTitleLength || maxFallbackTitleLength);
  return {
    title,
    confidence: title ? "UNSURE" : "FAILED",
    reason: title ? "Fallback result from filename because OPENAI_API_KEY is not configured." : "No usable filename or AI configuration.",
    fields: {
      playerOrCharacter: "",
      year: "",
      brandSet: "",
      subsetInsert: resolvedLabel || "",
      cardNumberCode: code || "",
      serialNumber: "",
      specialStatus: "",
      unresolvedFields: ["image identification", "market wording"]
    },
    source: "fallback"
  };
}

function parseOpenAiText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap((item) => item.content || []).map((content) => content.text || "").filter(Boolean).join("\n");
}

function safeJsonParse(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function normalizeAiResult(result, maxTitleLength) {
  const confidence = ["HIGH", "UNSURE", "FAILED"].includes(result.confidence) ? result.confidence : "UNSURE";
  return {
    title: normalizeTitle(result.title, maxTitleLength),
    confidence,
    reason: String(result.reason || "").slice(0, 240),
    fields: {
      playerOrCharacter: result.fields?.playerOrCharacter || "",
      year: result.fields?.year || "",
      brandSet: result.fields?.brandSet || "",
      subsetInsert: result.fields?.subsetInsert || "",
      cardNumberCode: result.fields?.cardNumberCode || "",
      serialNumber: result.fields?.serialNumber || "",
      specialStatus: result.fields?.specialStatus || "",
      unresolvedFields: Array.isArray(result.fields?.unresolvedFields) ? result.fields.unresolvedFields : []
    },
    source: "openai"
  };
}

async function createOpenAiTitle(payload) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const imageInputs = payload.images.map((image, index) => ({ type: "input_image", image_url: image.dataUrl, detail: index === 0 ? "high" : "low" }));
  const prompt = [
    "You are a Metaverse Cards listing specialist creating eBay-ready trading card titles.",
    `Return only valid JSON. Title must be max ${maxTitleLength} characters.`,
    "Confidence rules: HIGH means ready for eBay listing; UNSURE means key info is mostly complete but market terms, parallel, insert, or card code need review; FAILED means lot, multi-card group, too blurry, or unsafe to identify.",
    "Preserve market-relevant collector terms: player/character/artist, year, brand/set, insert, parallel, serial number, grade, auto, relic, patch, sketch, card number/code.",
    "Do not over-normalize collector terminology.",
    "Resolution hints:",
    resolutionHints(payload.resolutionMap) || "None",
    "JSON schema:",
    "{\"title\":\"string\",\"confidence\":\"HIGH|UNSURE|FAILED\",\"reason\":\"string\",\"fields\":{\"playerOrCharacter\":\"string\",\"year\":\"string\",\"brandSet\":\"string\",\"subsetInsert\":\"string\",\"cardNumberCode\":\"string\",\"serialNumber\":\"string\",\"specialStatus\":\"string\",\"unresolvedFields\":[\"string\"]}}"
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_LISTING_MODEL || defaultModel, input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...imageInputs] }], max_output_tokens: 900 })
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${(await response.text()).slice(0, 180)}`);
  return normalizeAiResult(safeJsonParse(parseOpenAiText(await response.json())), maxTitleLength);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "Method not allowed" });
  const cookies = parseCookies(req.headers.cookie);
  if (!isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET)) return sendJson(res, 401, { ok: false, message: "Unauthorized" });
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { ok: false, message: "Invalid request." }); }
  if (!Array.isArray(payload.images) || payload.images.length < 1 || payload.images.length > 2) return sendJson(res, 400, { ok: false, message: "Expected one or two card images." });
  try {
    sendJson(res, 200, process.env.OPENAI_API_KEY ? await createOpenAiTitle(payload) : fallbackResult(payload));
  } catch (error) {
    sendJson(res, 200, { title: "", confidence: "FAILED", reason: error.message, fields: { playerOrCharacter: "", year: "", brandSet: "", subsetInsert: "", cardNumberCode: "", serialNumber: "", specialStatus: "", unresolvedFields: ["api"] }, source: "error" });
  }
}
