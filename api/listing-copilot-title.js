import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cookieName = "lynca_metaverse_session";
const defaultModel = "gpt-4.1-mini";
const maxFallbackTitleLength = 80;
const promptRoot = join(process.cwd(), "prompts");
const promptFiles = [
  "listing-intelligence-v1.md",
  "examples/sports.md",
  "examples/pokemon.md",
  "examples/marvel.md",
  "examples/sketch.md",
  "examples/redemption.md"
];
let promptCache;

const defaultFields = {
  year: null,
  brand: null,
  product: null,
  set: null,
  subset: null,
  insert: null,
  parallel: null,
  player: null,
  character: null,
  artist: null,
  team: null,
  card_number: null,
  serial_number: null,
  grade_company: null,
  grade: null,
  auto: false,
  relic: false,
  patch: false,
  sketch: false,
  redemption: false,
  one_of_one: false
};

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return ["", ""];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key, value]) => key && value)
  );
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

function normalizeTitle(title, maxLength) {
  const normalized = String(title || "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function compactFileName(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolutionHints(resolutionMap) {
  return Object.entries(resolutionMap || {})
    .map(([code, label]) => `${code}: ${label}`)
    .join("\n");
}

function findResolutionLabel(text, resolutionMap) {
  const upperText = text.toUpperCase();
  const match = Object.entries(resolutionMap || {}).find(([code]) => upperText.includes(code.toUpperCase()));
  return match ? match : [];
}

async function loadPrompt() {
  if (promptCache) return promptCache;

  const sections = await Promise.all(promptFiles.map(async (file) => {
    const content = await readFile(join(promptRoot, file), "utf8");
    return `--- ${file} ---\n${content.trim()}`;
  }));

  promptCache = sections.join("\n\n");
  return promptCache;
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeStringOrNull(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeFields(fields = {}) {
  return {
    year: normalizeStringOrNull(fields.year),
    brand: normalizeStringOrNull(fields.brand),
    product: normalizeStringOrNull(fields.product),
    set: normalizeStringOrNull(fields.set),
    subset: normalizeStringOrNull(fields.subset),
    insert: normalizeStringOrNull(fields.insert),
    parallel: normalizeStringOrNull(fields.parallel),
    player: normalizeStringOrNull(fields.player),
    character: normalizeStringOrNull(fields.character),
    artist: normalizeStringOrNull(fields.artist),
    team: normalizeStringOrNull(fields.team),
    card_number: normalizeStringOrNull(fields.card_number),
    serial_number: normalizeStringOrNull(fields.serial_number),
    grade_company: normalizeStringOrNull(fields.grade_company),
    grade: normalizeStringOrNull(fields.grade),
    auto: normalizeBoolean(fields.auto),
    relic: normalizeBoolean(fields.relic),
    patch: normalizeBoolean(fields.patch),
    sketch: normalizeBoolean(fields.sketch),
    redemption: normalizeBoolean(fields.redemption),
    one_of_one: normalizeBoolean(fields.one_of_one)
  };
}

function normalizeUnresolved(unresolved, fields = {}) {
  const candidates = Array.isArray(unresolved)
    ? unresolved
    : Array.isArray(fields.unresolvedFields)
      ? fields.unresolvedFields
      : [];

  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function fallbackResult(payload) {
  const firstImage = payload.images?.[0] || {};
  const sourceName = compactFileName(firstImage.name);
  const [code, resolvedLabel] = findResolutionLabel(firstImage.name, payload.resolutionMap);
  const titleParts = [sourceName];

  if (resolvedLabel && !sourceName.toLowerCase().includes(String(resolvedLabel).toLowerCase())) {
    titleParts.push(resolvedLabel);
  }

  const title = normalizeTitle(titleParts.filter(Boolean).join(" "), payload.maxTitleLength || maxFallbackTitleLength);

  return {
    title,
    confidence: title ? "MEDIUM" : "FAILED",
    reason: title
      ? "Fallback result from filename because OPENAI_API_KEY is not configured."
      : "No usable filename or AI configuration.",
    fields: {
      ...defaultFields,
      insert: resolvedLabel || null,
      card_number: code || null
    },
    unresolved: ["image identification", "market wording"],
    source: "fallback"
  };
}

function parseOpenAiText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function safeJsonParse(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

function normalizeAiResult(result, maxTitleLength) {
  const confidenceMap = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    UNSURE: "MEDIUM",
    LOW: "LOW",
    FAILED: "FAILED"
  };
  const confidence = confidenceMap[String(result.confidence || "").toUpperCase()] || "MEDIUM";
  const fields = normalizeFields(result.fields);

  return {
    title: normalizeTitle(result.title, maxTitleLength),
    confidence,
    reason: String(result.reason || "").slice(0, 240),
    fields,
    unresolved: normalizeUnresolved(result.unresolved, result.fields),
    source: "openai"
  };
}

async function createOpenAiTitle(payload) {
  const maxTitleLength = payload.maxTitleLength || maxFallbackTitleLength;
  const intelligencePrompt = await loadPrompt();
  const imageInputs = payload.images.map((image, index) => ({
    type: "input_image",
    image_url: image.dataUrl,
    detail: index === 0 ? "high" : "low"
  }));

  const prompt = [
    intelligencePrompt,
    `Runtime title limit: ${maxTitleLength} characters.`,
    "Return only valid JSON. Do not wrap the response in Markdown.",
    "Resolution hints:",
    resolutionHints(payload.resolutionMap) || "None",
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name)
    }),
    "Required JSON shape:",
    JSON.stringify({
      title: "",
      confidence: "HIGH | MEDIUM | LOW | FAILED",
      reason: "",
      fields: defaultFields,
      unresolved: []
    })
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_LISTING_MODEL || defaultModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            ...imageInputs
          ]
        }
      ],
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${message.slice(0, 180)}`);
  }

  const data = await response.json();
  const parsed = safeJsonParse(parseOpenAiText(data));
  return normalizeAiResult(parsed, maxTitleLength);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const authenticated = isValidSession(cookies[cookieName], process.env.METAVERSE_AUTH_SECRET);

  if (!authenticated) {
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

  if (!Array.isArray(payload.images) || payload.images.length < 1 || payload.images.length > 2) {
    sendJson(res, 400, { ok: false, message: "Expected one or two card images." });
    return;
  }

  try {
    const result = process.env.OPENAI_API_KEY
      ? await createOpenAiTitle(payload)
      : fallbackResult(payload);

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      title: "",
      confidence: "FAILED",
      reason: error.message,
      fields: defaultFields,
      unresolved: ["api"],
      source: "error"
    });
  }
}
