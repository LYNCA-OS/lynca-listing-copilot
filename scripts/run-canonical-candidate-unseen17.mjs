#!/usr/bin/env node

// Small, paid evaluation of the same-call canonical-plus-candidate channel.
// This runner is local-only: it reads the sealed unseen-product images from
// disk, calls the provider directly, checkpoints every completed card, and
// never writes production or Supabase state.

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  buildCanonicalCandidateV1Request,
  extractCanonicalPayload,
  finishCanonicalCandidateV1,
  CANONICAL_CANDIDATE_V1_VERSION
} from "../lib/listing/thin/canonical-candidate-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const parseJsonl = (body) => String(body).split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
const atomicWrite = async (path, value) => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
};
const mapConcurrent = async (items, limit, worker) => {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
};

const datasetPath = resolve(arg("--dataset", "/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/artifacts/smoke/unseen20.json"));
const labelsPath = resolve(arg("--labels", "/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/artifacts/smoke/unseen20-labels.jsonl"));
const outDir = resolve(arg("--out-dir", "artifacts/accuracy-unseen17-canonical-candidate-v1-2026-08-02"));
const limit = Number(arg("--limit", "17"));
const concurrency = Number(arg("--concurrency", "2"));
const model = arg("--model", "gpt-5.6-luna");
const effort = arg("--effort", "none");
const imageDetail = arg("--image-detail", "high");
const maxAttempts = Number(arg("--max-attempts", "2"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency_must_be_positive_integer");
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("max_attempts_must_be_positive_integer");
if (!['high', 'original'].includes(imageDetail)) throw new Error("image_detail_must_be_high_or_original");
const apiKey = String(process.env.OPENAI_API_KEY || "");
if (!apiKey) throw new Error("OPENAI_API_KEY_is_required");

const [datasetBody, labelsBody] = await Promise.all([
  readFile(datasetPath, "utf8"),
  readFile(labelsPath, "utf8")
]);
const dataset = JSON.parse(datasetBody);
const labels = new Map(parseJsonl(labelsBody).map((row) => [String(row.key), String(row.reviewed_title || "")]));
const items = (Array.isArray(dataset.items) ? dataset.items : []).slice(0, limit);
if (items.length !== limit) throw new Error(`dataset_count_mismatch:${items.length}/${limit}`);
if (items.some((item) => !labels.has(String(item.sealed_eval_label_ref?.key || "")))) {
  throw new Error("sealed_label_missing");
}

await mkdir(outDir, { recursive: true });
const checkpointPath = resolve(outDir, `canonical-candidate-${model}.jsonl`);
const attemptsPath = resolve(outDir, `canonical-candidate-${model}.attempts.jsonl`);
const manifestPath = resolve(outDir, `canonical-candidate-${model}.manifest.json`);
const existing = existsSync(checkpointPath) ? parseJsonl(await readFile(checkpointPath, "utf8")) : [];
const done = new Map(existing.map((row) => [row.asset_id, row]));
let appendQueue = Promise.resolve();
const appendDurable = (path, value) => {
  appendQueue = appendQueue.then(() => appendFile(path, `${JSON.stringify(value)}\n`, "utf8"));
  return appendQueue;
};

const requestFor = async (item) => {
  const images = Array.isArray(item.images) ? item.images : [];
  const dataUrls = [];
  const imageHashes = [];
  for (const image of images) {
    const localPath = String(image.local_path || image.localPath || "");
    if (!localPath) throw new Error(`local_image_missing:${item.asset_id}`);
    const bytes = await readFile(localPath);
    const contentType = String(image.content_type || image.contentType || "image/jpeg");
    dataUrls.push(`data:${contentType};base64,${bytes.toString("base64")}`);
    imageHashes.push(sha256(bytes));
  }
  return { request: buildCanonicalCandidateV1Request({
    imageUrls: dataUrls, model, effort, imageDetail
  }), imageHashes };
};

const call = async (request, assetId) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    const requestSha256 = sha256(JSON.stringify(request));
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      const body = await response.json();
      await appendDurable(attemptsPath, {
        asset_id: assetId, attempt, request_sha256: requestSha256,
        started_at: new Date(started).toISOString(), latency_ms: Date.now() - started,
        http_status: response.status, ok: response.ok && !body?.error,
        error_code: body?.error?.code || null
      });
      if (!response.ok || body?.error) throw new Error(body?.error?.message || `provider_http_${response.status}`);
      return { body, requestSha256, latencyMs: Date.now() - started, attemptCount: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(250 * attempt);
    }
  }
  throw lastError;
};

await mapConcurrent(items.filter((item) => !done.has(item.asset_id)), concurrency, async (item) => {
  const reference = labels.get(String(item.sealed_eval_label_ref.key));
  const { request, imageHashes } = await requestFor(item);
  const result = await call(request, item.asset_id);
  const payload = extractCanonicalPayload(result.body);
  const finished = finishCanonicalCandidateV1(payload);
  const quality = score(reference, finished.title);
  const row = {
    asset_id: item.asset_id,
    arm: CANONICAL_CANDIDATE_V1_VERSION,
    image_detail: imageDetail,
    title: finished.title,
    raw_title: payload,
    reference,
    f1: quality.f1,
    recall: quality.recall,
    precision: quality.precision,
    fields: finished.fields,
    candidate_facts: finished.candidate_facts,
    candidate_hypotheses: finished.candidate_hypotheses,
    candidate_defects: finished.candidate_defects,
    candidate_unreadable_regions: finished.candidate_unreadable_regions,
    field_defects: finished.field_defects,
    latency_ms: result.latencyMs,
    input_tokens: result.body?.usage?.input_tokens ?? null,
    output_tokens: result.body?.usage?.output_tokens ?? null,
    total_tokens: result.body?.usage?.total_tokens ?? null,
    request_sha256: result.requestSha256,
    image_hashes: imageHashes,
    request_attempt_count: result.attemptCount,
    model,
    requested_effort: effort,
    served_effort: result.body?.reasoning?.effort ?? effort,
    authority: "evaluation_only",
    production_promoted: false
  };
  await appendDurable(checkpointPath, row);
  done.set(row.asset_id, row);
  process.stderr.write(`  ${done.size}/${items.length} ${row.asset_id}: F1 ${row.f1.toFixed(3)} (${row.candidate_facts.length} facts)\n`);
});
await appendQueue;

const rows = items.map((item) => done.get(item.asset_id)).filter(Boolean);
if (rows.length !== items.length) throw new Error(`checkpoint_incomplete:${rows.length}/${items.length}`);
const summary = {
  schema_version: "canonical-candidate-unseen17-v1",
  authority: "evaluation_only",
  production_promoted: false,
  source: { dataset: datasetPath, labels: labelsPath, cards: rows.length },
  arm: CANONICAL_CANDIDATE_V1_VERSION,
  cards: rows.length,
  f1: mean(rows.map((row) => row.f1)),
  recall: mean(rows.map((row) => row.recall)),
  precision: mean(rows.map((row) => row.precision)),
  median_latency_ms: median(rows.map((row) => row.latency_ms)),
  median_input_tokens: median(rows.map((row) => row.input_tokens || 0)),
  median_output_tokens: median(rows.map((row) => row.output_tokens || 0)),
  candidate_fact_cards: rows.filter((row) => row.candidate_facts.length).length,
  candidate_hypothesis_cards: rows.filter((row) => row.candidate_hypotheses.length).length,
  candidate_defect_cards: rows.filter((row) => row.candidate_defects.length).length
};
await atomicWrite(manifestPath, `${JSON.stringify({
  schema_version: "canonical-candidate-unseen17-manifest-v1",
  run_version: CANONICAL_CANDIDATE_V1_VERSION,
  model, effort, imageDetail, limit, concurrency,
  dataset_sha256: sha256(datasetBody), labels_sha256: sha256(labelsBody),
  checkpoint_rows: rows.length, completed_at: new Date().toISOString(), summary
}, null, 2)}\n`);
await atomicWrite(resolve(outDir, `canonical-candidate-${model}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
