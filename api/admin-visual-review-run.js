import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionFromRequest } from "../lib/listing-session.mjs";
import { isPlatformAdminRequest } from "../lib/platform-admin-auth.mjs";

const reportFilename = "visual-review-report-001b.md";
const maxCandidates = 5;
const preferredCandidateIds = [
  "learn-0016",
  "learn-0020",
  "learn-0046",
  "learn-0011",
  "learn-0068"
];
const fallbackCandidates = [
  {
    candidate_id: "learn-0016",
    pattern_label: "Chrome -> Sapphire",
    likely_change_types: ["product", "set", "insert", "parallel", "player_subject", "auto_relic_patch"],
    examples: [{
      feedback_id: "4fa7153f-46c0-422a-946f-08874260eea8",
      generated_title: "2025 Bowman Chrome Caleb Wilson 1st Auto 1/1",
      corrected_title: "2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC",
      front_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/front.jpg",
      back_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/89a399e3-f5a6-4853-b18c-d625e541c9cd/back.jpg"
    }]
  },
  {
    candidate_id: "learn-0020",
    pattern_label: "Sapphire",
    likely_change_types: ["set", "parallel", "player_subject"],
    examples: [{
      feedback_id: "602f87e7-7372-4c5b-8115-00c0c91a4b08",
      generated_title: "2020 Topps Chrome Gavin Lux RC Red Refractor Auto 3/5 PSA 9",
      corrected_title: "2020 Topps Chrome Sapphire Gavin Lux RC Red Refractor Auto 3/5 PSA 9",
      front_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2be3a6ba-3c15-4635-adec-9c734ca44a17/front.jpg",
      back_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/2be3a6ba-3c15-4635-adec-9c734ca44a17/back.jpg"
    }]
  },
  {
    candidate_id: "learn-0046",
    pattern_label: "Shimmer -> Sapphire",
    likely_change_types: ["set", "parallel", "player_subject"],
    examples: [{
      feedback_id: "a3b3eb3c-c982-4033-ba51-172d561c1a4b",
      generated_title: "2026 Bowman Chrome Parks Harper 1st Bowman Orange Shimmer 18/25",
      corrected_title: "2026 Bowman Chrome Sapphire Edition Parks Harper 1st Bowman Orange Sapphire 18/25",
      front_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/front.jpg",
      back_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/d2ef69ea-9ac9-468d-b38e-6d85e3291918/back.jpg"
    }]
  },
  {
    candidate_id: "learn-0011",
    pattern_label: "2025 -> 2026",
    likely_change_types: ["set", "insert", "parallel", "serial", "player_subject"],
    examples: [{
      feedback_id: "11485f06-22f8-4d96-a6d0-8eefabffda6a",
      generated_title: "2025 Topps Chrome WWE Penta Orange Refractor 25/25",
      corrected_title: "2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP",
      front_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg",
      back_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg"
    }]
  },
  {
    candidate_id: "learn-0068",
    pattern_label: "Cosmic",
    likely_change_types: ["set", "insert", "serial", "player_subject"],
    examples: [{
      feedback_id: "11485f06-22f8-4d96-a6d0-8eefabffda6a",
      generated_title: "2025 Topps Chrome WWE Penta Orange Refractor 25/25",
      corrected_title: "2026 Topps Cosmic Chrome WWE Penta Orange Refractor 25/25 Star Fractor SSP",
      front_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/front.jpg",
      back_image_url: "https://osrrujmpxxiefppjfgpd.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/c55cef2d-b224-4838-be31-5b9602582beb/back.jpg"
    }]
  }
];

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendMarkdown(res, markdown) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${reportFilename}"`);
  res.end(markdown);
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

function normalizeUser(value) {
  return String(value || "").trim().toLowerCase();
}

function configuredAdmins() {
  return String(process.env.VISUAL_REVIEW_ADMIN_USERS || "")
    .split(",")
    .map(normalizeUser)
    .filter(Boolean);
}

function isAdminSession(req) {
  const session = getSessionFromRequest(req);
  const admins = configuredAdmins();
  return Boolean(session?.user && admins.length && admins.includes(normalizeUser(session.user)));
}

async function fetchWithRetry(url, options, attempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }

  throw lastError;
}

function storageReadHeaders(url) {
  const headers = {};
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey && String(url || "").startsWith(supabaseUrl)) {
    headers.apikey = serviceRoleKey;
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }

  return headers;
}

async function imageUrlToDataUrl(url) {
  const response = await fetchWithRetry(url, {
    headers: storageReadHeaders(url),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Image fetch failed: ${response.status} ${message.slice(0, 120)}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function runVisionReview({ candidate, example, images }) {
  const prompt = [
    "You are reviewing collectible card listing feedback using only the provided images.",
    "Do not assume the corrected title is right. Explain whether the visible card evidence supports the correction.",
    "This is a read-only visual review prototype. Do not propose runtime, registry, resolver, prompt, or learning changes.",
    "",
    `Generated Title: ${example.generated_title}`,
    `Corrected Title: ${example.corrected_title}`,
    "",
    `Candidate ID: ${candidate.candidate_id}`,
    `Candidate Label: ${candidate.pattern_label}`,
    `Likely Change Types: ${(candidate.likely_change_types || []).join(", ")}`,
    "",
    "Return only valid JSON with this exact shape:",
    JSON.stringify({
      visual_explanation: "",
      visual_confidence: "High | Medium | Low",
      visually_supported: false,
      visually_uncertain: false,
      text_only: false,
      needs_external_checklist: false
    })
  ].join("\n");

  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: process.env.OPENAI_VISUAL_REVIEW_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images.map((image) => ({
              type: "input_image",
              image_url: image.dataUrl,
              detail: image.side === "front" ? "high" : "low"
            }))
          ]
        }
      ],
      max_output_tokens: 500
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI vision review failed: ${response.status} ${message.slice(0, 160)}`);
  }

  const data = await response.json();
  return normalizeReview(JSON.parse(stripJsonFence(parseOpenAiText(data))));
}

function parseOpenAiText(data) {
  if (typeof data.output_text === "string") return data.output_text;

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeReview(review) {
  const normalized = {
    visual_explanation: String(review.visual_explanation || "").trim(),
    visual_confidence: normalizeConfidence(review.visual_confidence),
    visually_supported: Boolean(review.visually_supported),
    visually_uncertain: Boolean(review.visually_uncertain),
    text_only: Boolean(review.text_only),
    needs_external_checklist: Boolean(review.needs_external_checklist)
  };

  if (!normalized.visually_supported && !normalized.visually_uncertain && !normalized.text_only && !normalized.needs_external_checklist) {
    normalized.visually_uncertain = true;
  }

  return normalized;
}

function normalizeConfidence(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("high")) return "High";
  if (text.includes("medium")) return "Medium";
  return "Low";
}

function renderMarkdown({ generatedAt, results }) {
  const lines = [
    "# Visual Review Report 001b",
    "",
    `Generated: ${generatedAt}`,
    "Scope: Vercel-side, admin-only, manual trigger, 5 candidates.",
    "",
    "No runtime title generation changes. No registry updates. No resolver updates. No prompt updates. No auto-learning.",
    "",
    "## Candidates",
    ""
  ];

  for (const result of results) {
    lines.push(`### ${result.candidate_id}: ${result.pattern_label}`);
    lines.push("");
    lines.push(`Feedback ID: \`${result.feedback_id}\``);
    lines.push("");
    lines.push("Generated Title");
    lines.push("");
    lines.push(`> ${result.generated_title}`);
    lines.push("");
    lines.push("Corrected Title");
    lines.push("");
    lines.push(`> ${result.corrected_title}`);
    lines.push("");
    lines.push("Visual Explanation");
    lines.push("");
    lines.push(result.visual_explanation || "No visual explanation returned.");
    lines.push("");
    lines.push(`Visual Confidence: ${result.visual_confidence}`);
    lines.push("");
    lines.push("| Flag | Value |");
    lines.push("| --- | --- |");
    lines.push(`| visually_supported | ${result.visually_supported ? "true" : "false"} |`);
    lines.push(`| visually_uncertain | ${result.visually_uncertain ? "true" : "false"} |`);
    lines.push(`| text_only | ${result.text_only ? "true" : "false"} |`);
    lines.push(`| needs_external_checklist | ${result.needs_external_checklist ? "true" : "false"} |`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function loadCandidates() {
  try {
    const data = JSON.parse(await readFile(join(process.cwd(), "data/learning/review-candidates-2026-06-22.json"), "utf8"));
    const candidates = preferredCandidateIds
      .map((id) => data.candidates.find((candidate) => candidate.candidate_id === id))
      .filter(Boolean)
      .slice(0, maxCandidates);

    if (candidates.length === maxCandidates) return candidates;
  } catch {
    // The Vercel bundle may not include local review artifacts; keep this prototype self-contained.
  }

  return fallbackCandidates.slice(0, maxCandidates);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!isPlatformAdminRequest(req)) {
    sendJson(res, 403, { ok: false, message: "Admin visual review access is not configured or this session is not allowed." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 500, { ok: false, message: "OPENAI_API_KEY is required for visual review." });
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(await readBody(req) || "{}");
  } catch {
    sendJson(res, 400, { ok: false, message: "Invalid request." });
    return;
  }

  if (payload.confirm !== "RUN_VISUAL_REVIEW_001B") {
    sendJson(res, 400, { ok: false, message: "Manual trigger confirmation is required." });
    return;
  }

  const candidates = await loadCandidates();
  const results = [];

  for (const candidate of candidates) {
    const example = candidate.examples?.[0];
    if (!example?.front_image_url) {
      results.push({
        candidate_id: candidate.candidate_id,
        pattern_label: candidate.pattern_label,
        feedback_id: example?.feedback_id || "",
        generated_title: example?.generated_title || "",
        corrected_title: example?.corrected_title || "",
        visual_explanation: "Visual review skipped because the candidate has no front image URL.",
        visual_confidence: "Low",
        visually_supported: false,
        visually_uncertain: true,
        text_only: false,
        needs_external_checklist: false
      });
      continue;
    }

    try {
      console.log("[visual-review-001b] reviewing", {
        candidate_id: candidate.candidate_id,
        feedback_id: example.feedback_id
      });

      const images = [
        { side: "front", dataUrl: await imageUrlToDataUrl(example.front_image_url) }
      ];

      if (example.back_image_url) {
        images.push({ side: "back", dataUrl: await imageUrlToDataUrl(example.back_image_url) });
      }

      results.push({
        candidate_id: candidate.candidate_id,
        pattern_label: candidate.pattern_label,
        feedback_id: example.feedback_id,
        generated_title: example.generated_title,
        corrected_title: example.corrected_title,
        ...await runVisionReview({ candidate, example, images })
      });
    } catch (error) {
      console.error("[visual-review-001b] candidate failed", {
        candidate_id: candidate.candidate_id,
        feedback_id: example.feedback_id,
        message: error.message
      });

      results.push({
        candidate_id: candidate.candidate_id,
        pattern_label: candidate.pattern_label,
        feedback_id: example.feedback_id,
        generated_title: example.generated_title,
        corrected_title: example.corrected_title,
        visual_explanation: `Prototype review failed: ${error.message}`,
        visual_confidence: "Low",
        visually_supported: false,
        visually_uncertain: true,
        text_only: false,
        needs_external_checklist: false
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const markdown = renderMarkdown({ generatedAt, results });
  await writeFile(join("/tmp", reportFilename), markdown);

  if (String(req.headers.accept || "").includes("text/markdown") || payload.format === "markdown") {
    sendMarkdown(res, markdown);
    return;
  }

  sendJson(res, 200, {
    ok: true,
    report_filename: reportFilename,
    generated_at: generatedAt,
    reviewed_candidate_count: results.length,
    results,
    markdown
  });
}
