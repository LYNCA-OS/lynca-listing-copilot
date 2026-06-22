#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const preferredCandidateIds = [
  "learn-0016",
  "learn-0020",
  "learn-0046",
  "learn-0011",
  "learn-0068",
  "learn-0009",
  "learn-0073",
  "learn-0102",
  "learn-0124",
  "learn-0007",
  "learn-0021"
];

const repoRoot = process.cwd();
const candidatesPath = path.join(repoRoot, "data/learning/review-candidates-2026-06-22.json");
const outputDir = path.join(repoRoot, "data/learning/visual-review-001");
const imageDir = path.join(outputDir, "images");
const reportPath = path.join(repoRoot, "docs/v2/visual-review-report-001.md");
const resultsPath = path.join(outputDir, "visual-review-results-001.json");

await loadDotEnv(path.join(repoRoot, ".env.local"));

const openAiKey = process.env.OPENAI_API_KEY;
if (!openAiKey) {
  throw new Error("OPENAI_API_KEY is required.");
}

await fs.mkdir(imageDir, { recursive: true });

const reviewData = JSON.parse(await fs.readFile(candidatesPath, "utf8"));
const candidates = preferredCandidateIds
  .map((id) => reviewData.candidates.find((candidate) => candidate.candidate_id === id))
  .filter(Boolean);

const results = [];
let downloadedImages = 0;

for (const candidate of candidates) {
  console.log(`Reviewing ${candidate.candidate_id}: ${candidate.pattern_label}`);
  const example = candidate.examples?.[0];
  if (!example?.front_image_url) {
    results.push({
      candidate_id: candidate.candidate_id,
      error: "Missing representative front_image_url."
    });
    continue;
  }

  try {
    const candidateSlug = `${candidate.candidate_id}-${slug(candidate.pattern_label)}`;
    const front = await downloadImage(example.front_image_url, path.join(imageDir, `${candidateSlug}-front`));
    downloadedImages += 1;
    const images = [
      {
        side: "front",
        url: example.front_image_url,
        local_path: front.localPath,
        data_url: front.dataUrl
      }
    ];

    if (example.back_image_url) {
      const back = await downloadImage(example.back_image_url, path.join(imageDir, `${candidateSlug}-back`));
      downloadedImages += 1;
      images.push({
        side: "back",
        url: example.back_image_url,
        local_path: back.localPath,
        data_url: back.dataUrl
      });
    }

    const review = await runVisionReview({
      candidate,
      example,
      images
    });

    results.push({
      candidate_id: candidate.candidate_id,
      pattern_label: candidate.pattern_label,
      likely_change_types: candidate.likely_change_types,
      feedback_id: example.feedback_id,
      generated_title: example.generated_title,
      corrected_title: example.corrected_title,
      front_image_url: example.front_image_url,
      back_image_url: example.back_image_url || "",
      downloaded_images: images.map(({ side, url, local_path }) => ({ side, url, local_path })),
      ...normalizeReview(review)
    });
    await writeIncrementalResults();
  } catch (error) {
    console.warn(`Review failed for ${candidate.candidate_id}: ${error.message}`);
    results.push({
      candidate_id: candidate.candidate_id,
      pattern_label: candidate.pattern_label,
      likely_change_types: candidate.likely_change_types,
      feedback_id: example.feedback_id,
      generated_title: example.generated_title,
      corrected_title: example.corrected_title,
      front_image_url: example.front_image_url,
      back_image_url: example.back_image_url || "",
      downloaded_images: [],
      visual_evidence_summary: `Prototype review failed: ${error.message}`,
      visual_confidence: "Low",
      visually_supported: false,
      visually_uncertain: true,
      text_only: false,
      needs_external_checklist: false,
      collectible_knowledge: "",
      caveats: ["Network or API failure during prototype review."]
    });
    await writeIncrementalResults();
  }
}

const output = {
  schema_version: "visual-review-prototype-001",
  generated_at: new Date().toISOString(),
  source_candidates: candidatesPath,
  reviewed_candidate_count: results.length,
  downloaded_image_count: downloadedImages,
  results
};

await fs.writeFile(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(reportPath, renderMarkdown(output));

console.log(`Reviewed candidates: ${results.length}`);
console.log(`Downloaded images: ${downloadedImages}`);
console.log(`Results: ${path.relative(repoRoot, resultsPath)}`);
console.log(`Report: ${path.relative(repoRoot, reportPath)}`);

async function loadDotEnv(filePath) {
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function writeIncrementalResults() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "visual-review-results-001.partial.json"), `${JSON.stringify({
    schema_version: "visual-review-prototype-001-partial",
    generated_at: new Date().toISOString(),
    reviewed_candidate_count: results.length,
    downloaded_image_count: downloadedImages,
    results
  }, null, 2)}\n`);
}

async function downloadImage(url, outputBasePath) {
  const response = await fetchWithRetry(url, {
    headers: storageReadHeaders(url),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Image download failed: ${response.status} ${message.slice(0, 160)}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const extension = extensionForContentType(contentType);
  const buffer = Buffer.from(await response.arrayBuffer());
  const localPath = `${outputBasePath}.${extension}`;
  await fs.writeFile(localPath, buffer);

  return {
    contentType,
    localPath,
    dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`
  };
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(1000 * attempt);
      }
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageReadHeaders(url) {
  const headers = {};
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceRoleKey && url.startsWith(supabaseUrl)) {
    headers.apikey = serviceRoleKey;
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }

  return headers;
}

function extensionForContentType(contentType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif"
  }[String(contentType || "").toLowerCase().split(";")[0]] || "jpg";
}

async function runVisionReview({ candidate, example, images }) {
  const prompt = [
    "You are performing a visual evidence audit for collectible card listing feedback.",
    "Use the images only as evidence. Do not assume the corrected title is right.",
    "",
    "Question:",
    "What visual evidence supports the corrected title versus the generated title?",
    "",
    "Generated title:",
    example.generated_title,
    "",
    "Corrected title:",
    example.corrected_title,
    "",
    "Candidate context:",
    JSON.stringify({
      candidate_id: candidate.candidate_id,
      pattern_label: candidate.pattern_label,
      likely_change_types: candidate.likely_change_types,
      feedback_id: example.feedback_id
    }),
    "",
    "Return only valid JSON with this exact shape:",
    JSON.stringify({
      visual_evidence_summary: "",
      visual_confidence: "High | Medium | Low",
      visually_supported: false,
      visually_uncertain: false,
      text_only: false,
      needs_external_checklist: false,
      collectible_knowledge: "",
      caveats: []
    })
  ].join("\n");

  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openAiKey}`,
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
              image_url: image.data_url,
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
    throw new Error(`OpenAI vision review failed: ${response.status} ${message.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = parseOpenAiText(data);
  return JSON.parse(stripJsonFence(text));
}

function parseOpenAiText(data) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

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
    visual_evidence_summary: String(review.visual_evidence_summary || "").trim(),
    visual_confidence: normalizeConfidence(review.visual_confidence),
    visually_supported: Boolean(review.visually_supported),
    visually_uncertain: Boolean(review.visually_uncertain),
    text_only: Boolean(review.text_only),
    needs_external_checklist: Boolean(review.needs_external_checklist),
    collectible_knowledge: String(review.collectible_knowledge || "").trim(),
    caveats: Array.isArray(review.caveats) ? review.caveats.map(String) : []
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

function slug(value) {
  return String(value || "candidate")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "candidate";
}

function renderMarkdown(output) {
  const lines = [];
  const counts = output.results.reduce((acc, result) => {
    acc[result.visual_confidence] = (acc[result.visual_confidence] || 0) + 1;
    if (result.visually_supported) acc.visually_supported += 1;
    if (result.visually_uncertain) acc.visually_uncertain += 1;
    if (result.text_only) acc.text_only += 1;
    if (result.needs_external_checklist) acc.needs_external_checklist += 1;
    return acc;
  }, {
    High: 0,
    Medium: 0,
    Low: 0,
    visually_supported: 0,
    visually_uncertain: 0,
    text_only: 0,
    needs_external_checklist: 0,
    failed_reviews: 0
  });
  counts.failed_reviews = output.results.filter((result) => /^Prototype review failed:/i.test(result.visual_evidence_summary || "")).length;

  lines.push("# Visual Review Prototype #001 Report");
  lines.push("");
  lines.push("Status: Prototype Evidence Review, No Installation");
  lines.push(`Generated: ${output.generated_at}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Runtime code was not modified.");
  lines.push("- Registry data was not modified.");
  lines.push("- Resolver logic was not modified.");
  lines.push("- Prompts were not modified.");
  lines.push("- No upgrades were deployed or installed.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Reviewed candidates: ${output.reviewed_candidate_count}`);
  lines.push(`- Downloaded images: ${output.downloaded_image_count}`);
  lines.push(`- High confidence: ${counts.High}`);
  lines.push(`- Medium confidence: ${counts.Medium}`);
  lines.push(`- Low confidence: ${counts.Low}`);
  lines.push(`- Visually supported: ${counts.visually_supported}`);
  lines.push(`- Visually uncertain: ${counts.visually_uncertain}`);
  lines.push(`- Text only: ${counts.text_only}`);
  lines.push(`- Needs external checklist: ${counts.needs_external_checklist}`);
  lines.push(`- Failed GPT Vision reviews: ${counts.failed_reviews}`);
  lines.push("");
  lines.push("## Finding");
  lines.push("");
  if (counts.failed_reviews === output.results.length) {
    lines.push("The prototype successfully downloaded representative front/back images, but GPT Vision review did not complete because every OpenAI request failed at the network layer. This run does not validate visual collectible knowledge yet. It validates the first half of the prototype: candidate selection, authenticated image download, local evidence packaging, and failure-safe reporting.");
  } else {
    lines.push("Actual visual review produced usable collectible evidence for at least part of the sample. Successful reviews should be treated as verification inputs, not automatic upgrade decisions.");
  }
  lines.push("");
  lines.push("## Reviewed Candidates");
  lines.push("");

  for (const result of output.results) {
    lines.push(`### ${result.candidate_id}: ${result.pattern_label}`);
    lines.push("");
    lines.push(`Feedback ID: \`${result.feedback_id}\``);
    lines.push("");
    lines.push("Generated title:");
    lines.push("");
    lines.push(`> ${result.generated_title}`);
    lines.push("");
    lines.push("Corrected title:");
    lines.push("");
    lines.push(`> ${result.corrected_title}`);
    lines.push("");
    lines.push(`Front image URL: ${result.front_image_url || "Not provided"}`);
    lines.push(`Back image URL: ${result.back_image_url || "Not provided"}`);
    lines.push("");
    lines.push(`Visual confidence: ${result.visual_confidence}`);
    lines.push("");
    lines.push("| Outcome | Value |");
    lines.push("| --- | --- |");
    lines.push(`| visually_supported | ${result.visually_supported ? "Yes" : "No"} |`);
    lines.push(`| visually_uncertain | ${result.visually_uncertain ? "Yes" : "No"} |`);
    lines.push(`| text_only | ${result.text_only ? "Yes" : "No"} |`);
    lines.push(`| needs_external_checklist | ${result.needs_external_checklist ? "Yes" : "No"} |`);
    lines.push("");
    lines.push("Visual evidence summary:");
    lines.push("");
    lines.push(result.visual_evidence_summary || "No summary returned.");
    lines.push("");
    if (result.collectible_knowledge) {
      lines.push("Collectible knowledge:");
      lines.push("");
      lines.push(result.collectible_knowledge);
      lines.push("");
    }
    if (result.caveats?.length) {
      lines.push("Caveats:");
      lines.push("");
      for (const caveat of result.caveats) {
        lines.push(`- ${caveat}`);
      }
      lines.push("");
    }
  }

  lines.push("## Prototype Conclusion");
  lines.push("");
  if (counts.failed_reviews === output.results.length) {
    lines.push("Visual Review Prototype #001 did not reach the GPT Vision analysis stage successfully. No visual concept was verified. The next safe step is to rerun the same downloaded-image sample when OpenAI API connectivity is available.");
  } else {
    lines.push("Visual review produces useful collectible knowledge, but it should be treated as a verification layer, not an automatic upgrade path. The next safe step is to use these reviewed examples to define a small set of human-approved test case candidates, not to mutate registry, resolver, or prompt behavior.");
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}
