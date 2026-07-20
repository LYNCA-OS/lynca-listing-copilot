#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  durableSourceFingerprint,
  readVerifiedAssetCache,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";

function cleanText(value) {
  return String(value || "").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function itemsOf(dataset = {}) {
  return Array.isArray(dataset) ? dataset : dataset.items || [];
}

export async function seedVerifiedAssetCacheFromReport({
  datasetPath,
  reportPath,
  cachePath,
  limit = 10,
  allowOrderFallback = false
} = {}) {
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  const datasetItems = itemsOf(dataset);
  const itemBySource = new Map(datasetItems
    .map((item) => [cleanText(item.source_feedback_id), item])
    .filter(([key]) => key));
  const itemByLabel = new Map(datasetItems
    .map((item) => [cleanText(item.sealed_eval_label_ref?.key || item.source_record?.sealed_eval_label_key), item])
    .filter(([key]) => key));
  const results = (report.results || []).slice(0, Math.max(1, Number(limit) || 10));
  const items = results.map((result, index) => (
    itemBySource.get(cleanText(result.source_feedback_id))
    || itemByLabel.get(cleanText(result.sealed_label_key))
    || (allowOrderFallback ? datasetItems[index] : null)
  ));
  if (!results.length || items.some((item) => !item)) {
    throw new Error("report result cannot be mapped to its source dataset item");
  }
  const entries = await readVerifiedAssetCache(cachePath);
  const resolvedReportPath = resolve(reportPath);
  const reseededSourceIds = new Set(results.map((result) => cleanText(result.source_feedback_id)).filter(Boolean));
  // Reseeding the same report is idempotent and also repairs entries created
  // by an older mapper. Never leave a stale source->asset association behind.
  for (const [fingerprint, entry] of entries) {
    if (
      cleanText(entry?.seeded_from_report) === resolvedReportPath
      || reseededSourceIds.has(cleanText(entry?.source_feedback_id))
    ) entries.delete(fingerprint);
  }
  let seeded = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = results[index];
    if (!result || result.ok !== true || result.writer_ready !== true) {
      throw new Error(`verified result missing for source item: ${cleanText(item.source_feedback_id) || index + 1}`);
    }
    const fingerprint = await durableSourceFingerprint(item, index);
    entries.set(fingerprint, {
      fingerprint,
      source_asset_id: cleanText(item.asset_id || item.physical_card_id),
      source_feedback_id: cleanText(item.source_feedback_id) || null,
      asset_id: cleanText(result.asset_id),
      tenant_id: cleanText(result.tenant_id || result.expected_tenant_id),
      image_generation_id: cleanText(result.asset_id),
      image_count: (item.images || []).slice(0, 2).length,
      verified_at: cleanText(report.generated_at) || new Date().toISOString(),
      seeded_from_report: resolvedReportPath
    });
    seeded += 1;
  }
  await writeVerifiedAssetCache(cachePath, entries);
  return { seeded_count: seeded, total_entry_count: entries.size, cache_path: resolve(cachePath) };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await seedVerifiedAssetCacheFromReport({
    datasetPath: argValue(argv, "--dataset"),
    reportPath: argValue(argv, "--report"),
    cachePath: argValue(argv, "--cache", ".local/launch-gate/verified-assets-v1.json"),
    limit: Number(argValue(argv, "--limit", "10")),
    allowOrderFallback: argv.includes("--allow-order-fallback")
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Seed verified asset cache failed: ${error.message}`);
    process.exitCode = 1;
  });
}
