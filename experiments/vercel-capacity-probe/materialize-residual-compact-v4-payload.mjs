#!/usr/bin/env node

// Storage-only materializer. It reuses the v3 signer and freezes the exact
// signed URL bytes shared by both compact-v4 arms.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeJsonAtomic } from "./cloud-io.mjs";
import { assertSignedUrlMatchesImage, signAssetsOnlyManifest } from
  "./materialize-residual-v3-payload.mjs";
import { sha256 } from "./request-contract.mjs";

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_BYTE_RECEIPT_CONCURRENCY = 8;
const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};
const load = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

export async function attachCompactV4ImageByteReceipts({ manifest, signedAssets,
  fetchImpl = globalThis.fetch, concurrency = DEFAULT_BYTE_RECEIPT_CONCURRENCY }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("compact_v4_byte_receipt_concurrency_invalid");
  }
  const physicalById = new Map(manifest.assets.map((asset) => [asset.asset_id, asset]));
  const assetContexts = signedAssets.map((asset) => {
    const physical = physicalById.get(asset.asset_id);
    if (!physical || physical.image_set_sha256 !== asset.image_set_sha256
        || physical.images.length !== asset.image_urls.length) {
      throw new Error(`compact_v4_byte_receipt_pairing_invalid:${asset.asset_id}`);
    }
    return { asset, physical, imageReceipts: new Array(physical.images.length) };
  });
  const imageJobs = assetContexts.flatMap((context) =>
    context.physical.images.map((image, imageIndex) => ({ context, image, imageIndex })));
  await mapConcurrent(imageJobs, concurrency, async ({ context, image, imageIndex }) => {
    const url = assertSignedUrlMatchesImage(context.asset.image_urls[imageIndex], image);
    const response = await fetchImpl(url, { method: "GET", redirect: "error" });
    if (!response?.ok || typeof response.arrayBuffer !== "function") {
      throw new Error(
        `compact_v4_byte_receipt_fetch_failed:${context.asset.asset_id}:${imageIndex + 1}`
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length) {
      throw new Error(`compact_v4_byte_receipt_empty:${context.asset.asset_id}:${imageIndex + 1}`);
    }
    context.imageReceipts[imageIndex] = { role: image.role, bucket: image.bucket,
      object_path: image.object_path, content_sha256: sha256(content),
      byte_length: content.length };
  });
  return assetContexts.map(({ asset, imageReceipts }) => ({
    ...structuredClone(asset), image_receipts: imageReceipts
  }));
}

export async function materializeResidualCompactV4Payload({ prereg, manifest,
  labelRefReceipt, controlTemplate, treatmentTemplate, serviceKey,
  fetchImpl = globalThis.fetch, ttlSeconds = DEFAULT_TTL_SECONDS,
  materializedAt = new Date().toISOString() }) {
  if (prereg?.schema_version !== "model-residual-compact-v4-cloud-prereg-v1"
      || labelRefReceipt?.schema_version !== "residual-compact-v4-label-ref-receipt-v1"
      || labelRefReceipt.sealed_label_bytes_read !== false) {
    throw new Error("compact_v4_materialize_input_invalid");
  }
  const signed = await signAssetsOnlyManifest(manifest, { serviceKey, fetchImpl, ttlSeconds,
    validation: { expectedCards: 70, minimumImages: 1, maximumImages: 2,
      schemaVersion: "residual-compact-v4-assets-only-manifest-v1" } });
  const verified = await attachCompactV4ImageByteReceipts({ manifest, signedAssets: signed,
    fetchImpl });
  const byId = new Map(verified.map((asset) => [asset.asset_id, asset]));
  const ordered = prereg.confirmatory_70.asset_ids.map((assetId) => byId.get(assetId));
  if (byId.size !== 70 || ordered.some((asset) => !asset)) {
    throw new Error("compact_v4_materialize_cohort_mismatch");
  }
  const sharedAssets = ordered.map((asset) => structuredClone(asset));
  return {
    schema_version: "cloud-residual-compact-v4-materialized-payload-v1",
    materialized_at: materializedAt,
    minimum_remaining_ttl_ms: 3 * 60 * 60 * 1000,
    prereg_sha256: sha256(JSON.stringify(prereg)),
    physical_manifest_sha256: sha256(JSON.stringify(manifest)),
    label_ref_receipt_sha256: sha256(JSON.stringify(labelRefReceipt)),
    ordered_signed_urls_sha256: sha256(JSON.stringify(sharedAssets.map((asset) => asset.image_urls))),
    materialization_byte_receipts_sha256: sha256(JSON.stringify(sharedAssets.map((asset) => ({
      asset_id: asset.asset_id, image_receipts: asset.image_receipts
    })))),
    control: { arm_id: "compact_v4_control", request_template: structuredClone(controlTemplate),
      assets: structuredClone(sharedAssets) },
    treatment: { arm_id: "compact_v4_treatment",
      request_template: structuredClone(treatmentTemplate), assets: structuredClone(sharedAssets) }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const required = ["--prereg", "--assets-manifest", "--label-ref-receipt",
    "--control-template", "--treatment-template", "--out"];
  if (required.some((name) => !arg(argv, name))) {
    throw new Error("compact_v4_materialize_required_path_missing");
  }
  const payload = await materializeResidualCompactV4Payload({
    prereg: await load(arg(argv, "--prereg")),
    manifest: await load(arg(argv, "--assets-manifest")),
    labelRefReceipt: await load(arg(argv, "--label-ref-receipt")),
    controlTemplate: await load(arg(argv, "--control-template")),
    treatmentTemplate: await load(arg(argv, "--treatment-template")),
    serviceKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  await writeJsonAtomic(resolve(arg(argv, "--out")), payload);
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((payload) => process.stdout.write(`${JSON.stringify({ provider_calls: 0,
    storage_sign_calls: payload.control.assets.reduce((sum, asset) =>
      sum + asset.image_urls.length, 0), storage_read_calls: payload.control.assets.reduce(
      (sum, asset) => sum + asset.image_urls.length, 0), cards: payload.control.assets.length,
    ordered_signed_urls_sha256: payload.ordered_signed_urls_sha256 })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
