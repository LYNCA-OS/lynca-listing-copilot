import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDurableListingAssetId } from "../lib/tenant/assets.mjs";
import {
  durableSourceFingerprint,
  readVerifiedAssetCache,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function candidateId(item = {}, index = 0) {
  return String(item.asset_id || item.candidate_id || item.id || item.physical_card_id || `v4-ebay-smoke-${index + 1}`).trim();
}

export async function seedVerifiedAssetCache({
  datasetPath,
  cachePath,
  offsets = [],
  tenantId = "tenant_legacy",
  verificationSource = "external_database_audit"
} = {}) {
  if (!datasetPath || !cachePath || !offsets.length) throw new Error("dataset, cache, and offsets are required");
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const items = Array.isArray(dataset) ? dataset : dataset.items || dataset.records || [];
  const entries = await readVerifiedAssetCache(cachePath);
  const seeded = [];
  for (const offset of offsets) {
    const item = items[offset];
    if (!item) throw new Error(`dataset offset out of range: ${offset}`);
    const sourceAssetId = candidateId(item, offset);
    const clientAssetRef = `v4-smoke:${crypto.createHash("sha256").update(sourceAssetId).digest("hex").slice(0, 16)}`;
    const assetId = createDurableListingAssetId({ tenantId, clientAssetRef });
    const fingerprint = await durableSourceFingerprint(item, offset);
    const entry = {
      fingerprint,
      source_asset_id: sourceAssetId,
      source_feedback_id: String(item.source_feedback_id || item.source_record_id || "").trim() || null,
      asset_id: assetId,
      tenant_id: tenantId,
      image_generation_id: assetId,
      image_count: Math.min(2, Array.isArray(item.images) ? item.images.length : 0),
      verified_at: new Date().toISOString(),
      verification_source: verificationSource
    };
    entries.set(fingerprint, entry);
    seeded.push({ offset, source_asset_id: sourceAssetId, asset_id: assetId, fingerprint });
  }
  await writeVerifiedAssetCache(cachePath, entries);
  return { seeded, cache_entry_count: entries.size };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const offsets = argValue(process.argv, "--offsets").split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isInteger);
  seedVerifiedAssetCache({
    datasetPath: argValue(process.argv, "--dataset"),
    cachePath: argValue(process.argv, "--cache"),
    offsets,
    tenantId: argValue(process.argv, "--tenant", "tenant_legacy"),
    verificationSource: argValue(process.argv, "--verification-source", "external_database_audit")
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
