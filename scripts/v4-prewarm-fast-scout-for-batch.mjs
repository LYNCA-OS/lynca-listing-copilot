#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function numberArg(name, fallback) {
  const value = Number(arg(name, ""));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.records)) return value.records;
  if (Array.isArray(value?.cards)) return value.cards;
  if (Array.isArray(value?.assets)) return value.assets;
  return [];
}

function imagesFor(record = {}) {
  const candidates = [
    record.images,
    record.asset_images,
    record.asset?.images,
    record.payload?.images,
    record.query?.images
  ].find(Array.isArray);
  return candidates || [];
}

function payloadFor(record = {}, index = 0) {
  return {
    asset_id: record.asset_id || record.assetId || record.id || record.item_id || `batch_asset_${index + 1}`,
    source_record_id: record.source_record_id || record.item_id || record.ebay_item_id || record.id || null,
    maxTitleLength: record.maxTitleLength || 80,
    images: imagesFor(record)
  };
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const batchPath = arg("batch");
const baseUrl = arg("base-url", process.env.V4_BASE_URL || process.env.VERCEL_URL || "");
const limit = numberArg("limit", 10);
const concurrency = numberArg("concurrency", 1);
const bypassSecret = arg("bypass-secret", process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "");
const sessionToken = arg("session-token", process.env.LYNCA_SESSION_TOKEN || process.env.LISTING_SESSION_TOKEN || "");

if (!batchPath || !baseUrl) {
  console.error("Usage: node scripts/v4-prewarm-fast-scout-for-batch.mjs --batch=data.json --base-url=https://deployment.vercel.app --limit=5 --concurrency=1");
  process.exit(1);
}

const raw = JSON.parse(await fs.readFile(path.resolve(batchPath), "utf8"));
const records = pickArray(raw).slice(0, limit);
const endpoint = `${baseUrl.replace(/\/$/, "")}/api/v4/listing-job-prewarm`;
const headers = {};
if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;
if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;

const startedAt = Date.now();
const results = await runPool(records, concurrency, async (record, index) => {
  const payload = payloadFor(record, index);
  if (!payload.images.length) {
    return { index, ok: false, status: 0, error: "missing_images", asset_id: payload.asset_id };
  }
  const itemStartedAt = Date.now();
  const response = await postJson(endpoint, {
    assets: [payload],
    create_l2_jobs: false,
    autokick_workers: true
  }, headers);
  return {
    index,
    asset_id: payload.asset_id,
    ok: response.ok && response.body?.ok !== false,
    status: response.status,
    latency_ms: Date.now() - itemStartedAt,
    queued_count: Number(response.body?.queued_count || 0),
    reused_count: Number(response.body?.reused_count || 0),
    prewarm_batch_id: response.body?.prewarm_batch_id || null,
    recognition_session_id: response.body?.sessions?.[0]?.recognition_session_id || null,
    input_image_count: response.body?.input_image_count || payload.images.length,
    error: response.body?.message || response.body?.error_type || null
  };
});

const success = results.filter((entry) => entry.ok).length;
const report = {
  generated_at: new Date().toISOString(),
  endpoint,
  limit: records.length,
  concurrency,
  prewarm_count: records.length,
  prewarm_success_count: success,
  prewarm_error_count: results.length - success,
  queued_count: results.reduce((sum, entry) => sum + entry.queued_count, 0),
  reused_count: results.reduce((sum, entry) => sum + entry.reused_count, 0),
  average_prewarmer_latency: results.length
    ? Math.round(results.reduce((sum, entry) => sum + Number(entry.latency_ms || 0), 0) / results.length)
    : null,
  wall_ms: Date.now() - startedAt,
  results
};

console.log(JSON.stringify(report, null, 2));
