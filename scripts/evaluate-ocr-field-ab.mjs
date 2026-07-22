#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPaddleOcrClient } from "../lib/listing/ocr/paddle-ocr-client.mjs";

const reviewedLabelSource = "HUMAN_REVIEWED_FIELD";
const requiredCropCount = 300;

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const match = argv.find((arg) => arg.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function canonical(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function logChoose(n, k) {
  let total = 0;
  for (let index = 1; index <= k; index += 1) {
    total += Math.log(n - k + index) - Math.log(index);
  }
  return total;
}

function twoSidedBinomialPValue(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let k = 0; k <= tail; k += 1) {
    probability += Math.exp(logChoose(n, k) - n * Math.log(2));
  }
  return Math.min(1, probability * 2);
}

function expectedField(crop) {
  return String(crop.field || crop.crop_type || "").trim();
}

function predictedValue(result, crop) {
  const field = expectedField(crop);
  const normalized = result?.normalized_fields || {};
  if (normalized[field] !== undefined && normalized[field] !== null && normalized[field] !== "") {
    return normalized[field];
  }
  return result?.raw_text || "";
}

function targetHit(result, crop) {
  if (!result || result.error_type || result.status === "UNAVAILABLE") return false;
  const expected = canonical(crop.expected_value);
  if (!expected) return false;
  const direct = canonical(predictedValue(result, crop));
  const raw = canonical(result.raw_text);
  return direct === expected || raw.includes(expected);
}

async function runPool(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

function publicResult(result, hit) {
  return {
    status: result?.status || (result?.error_type ? "ERROR" : "UNKNOWN"),
    error_type: result?.error_type || null,
    raw_text: result?.raw_text || "",
    normalized_fields: result?.normalized_fields || {},
    confidence: result?.confidence ?? null,
    latency_ms: Number.isFinite(Number(result?.latency_ms)) ? Number(result.latency_ms) : null,
    target_hit: hit
  };
}

export async function evaluateOcrFieldAb({
  payload,
  env = process.env,
  concurrency = 2,
  limit = requiredCropCount,
  client = createPaddleOcrClient({ env })
} = {}) {
  const allCrops = Array.isArray(payload) ? payload : payload?.crops || [];
  const crops = allCrops.slice(0, limit);
  const reviewedCount = crops.filter((crop) => crop.label_source === reviewedLabelSource).length;
  const results = await runPool(crops, concurrency, async (crop, index) => {
    const baseRequest = {
      request_id: crop.crop_id || `ocr-ab-${index + 1}`,
      image_url: crop.image_url,
      crop_type: crop.crop_type,
      crop_box: crop.crop_box || null,
      expected_pattern: crop.field || crop.crop_type,
      metadata: { ...(crop.metadata || {}), ocr_ab_cohort: payload?.cohort_id || null }
    };
    const order = index % 2 === 0 ? ["google_vision", "paddle"] : ["paddle", "google_vision"];
    const byBackend = {};
    for (const backend of order) {
      try {
        byBackend[backend] = await client.verifyCrop({ ...baseRequest, ocr_backend: backend });
      } catch (error) {
        byBackend[backend] = { status: "ERROR", error_type: error?.code || "ocr_ab_error", raw_text: "", normalized_fields: {}, latency_ms: null };
      }
    }
    const visionHit = targetHit(byBackend.google_vision, crop);
    const paddleHit = targetHit(byBackend.paddle, crop);
    return {
      crop_id: baseRequest.request_id,
      crop_type: crop.crop_type,
      field: expectedField(crop),
      label_source: crop.label_source || null,
      expected_value: crop.expected_value,
      call_order: order,
      google_vision: publicResult(byBackend.google_vision, visionHit),
      paddle: publicResult(byBackend.paddle, paddleHit)
    };
  });

  const paired = results.filter((row) => row.label_source === reviewedLabelSource);
  const paddleWins = paired.filter((row) => row.paddle.target_hit && !row.google_vision.target_hit).length;
  const visionWins = paired.filter((row) => row.google_vision.target_hit && !row.paddle.target_hit).length;
  const bothCorrect = paired.filter((row) => row.google_vision.target_hit && row.paddle.target_hit).length;
  const bothWrong = paired.filter((row) => !row.google_vision.target_hit && !row.paddle.target_hit).length;
  const pValue = twoSidedBinomialPValue(paddleWins, visionWins);
  const backendMetrics = (backend) => {
    const rows = paired.map((row) => row[backend]);
    const latencies = rows.map((row) => row.latency_ms).filter(Number.isFinite);
    return {
      target_hit_count: rows.filter((row) => row.target_hit).length,
      target_hit_rate: rows.length ? rows.filter((row) => row.target_hit).length / rows.length : null,
      unavailable_or_error_count: rows.filter((row) => ["UNAVAILABLE", "ERROR"].includes(row.status)).length,
      latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) }
    };
  };
  const vision = backendMetrics("google_vision");
  const paddle = backendMetrics("paddle");
  const completeReviewedCohort = crops.length === requiredCropCount && reviewedCount === requiredCropCount;
  const latencyGate = Number.isFinite(paddle.latency_ms.p95)
    && Number.isFinite(vision.latency_ms.p95)
    && paddle.latency_ms.p95 <= Math.max(2_000, vision.latency_ms.p95 * 2);
  const qualityGate = completeReviewedCohort
    && paddleWins > visionWins
    && pValue < 0.05
    && paddle.unavailable_or_error_count <= vision.unavailable_or_error_count;
  const switchEligible = qualityGate && latencyGate;

  return {
    schema_version: "ocr-field-paired-ab-v1",
    generated_at: new Date().toISOString(),
    cohort_id: payload?.cohort_id || null,
    crop_count: crops.length,
    reviewed_field_label_count: reviewedCount,
    primary_backend_during_test: "google_vision",
    shadow_backend_during_test: "paddle",
    metrics: {
      google_vision: vision,
      paddle,
      paired: { paddle_wins: paddleWins, google_vision_wins: visionWins, both_correct: bothCorrect, both_wrong: bothWrong, two_sided_p_value: pValue }
    },
    gates: {
      required_crop_count: requiredCropCount,
      complete_reviewed_cohort: completeReviewedCohort,
      statistically_significant_quality_win: qualityGate,
      latency_within_budget: latencyGate,
      switch_primary_eligible: switchEligible
    },
    decision: switchEligible ? "SWITCH_PADDLE_PRIMARY" : "KEEP_GOOGLE_VISION_PRIMARY",
    records: results
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputPath = argValue(argv, "--input");
  const outPath = argValue(argv, "--out", "data/eval/ocr-field-ab/paired-300.json");
  if (!inputPath) throw new Error("--input is required");
  const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const report = await evaluateOcrFieldAb({
    payload,
    concurrency: positiveInteger(argValue(argv, "--concurrency"), 2),
    limit: positiveInteger(argValue(argv, "--limit"), requiredCropCount)
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: outPath, decision: report.decision, metrics: report.metrics, gates: report.gates }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
