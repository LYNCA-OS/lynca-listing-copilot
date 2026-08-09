#!/usr/bin/env node

// Storage-only, zero-provider revalidation. It reads signed image bytes after
// the model run, compares them with materialization-time receipts, and stores
// hashes/lengths only; original bytes are never persisted.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeJsonAtomic } from "../experiments/vercel-capacity-probe/cloud-io.mjs";
import { sha256 } from "../experiments/vercel-capacity-probe/request-contract.mjs";

export async function reverifyCompactV4AssetBytes({ payload, fetchImpl = globalThis.fetch,
  verifiedAt = new Date().toISOString() }) {
  if (payload?.schema_version !== "cloud-residual-compact-v4-materialized-payload-v1"
      || JSON.stringify(payload.control?.assets) !== JSON.stringify(payload.treatment?.assets)
      || !Array.isArray(payload.control?.assets) || payload.control.assets.length !== 70) {
    throw new Error("compact_v4_reverify_payload_invalid");
  }
  const images = [];
  for (const asset of payload.control.assets) {
    if (!Array.isArray(asset.image_urls) || !Array.isArray(asset.image_receipts)
        || asset.image_urls.length !== asset.image_receipts.length) {
      throw new Error(`compact_v4_reverify_asset_invalid:${asset.asset_id}`);
    }
    for (const [index, url] of asset.image_urls.entries()) {
      const response = await fetchImpl(url, { method: "GET", redirect: "error" });
      if (!response?.ok || typeof response.arrayBuffer !== "function") {
        throw new Error(`compact_v4_reverify_fetch_failed:${asset.asset_id}:${index + 1}`);
      }
      const content = Buffer.from(await response.arrayBuffer());
      const expected = asset.image_receipts[index];
      const contentSha256 = sha256(content);
      if (!content.length || contentSha256 !== expected.content_sha256
          || content.length !== expected.byte_length) {
        throw new Error(`compact_v4_reverify_byte_mismatch:${asset.asset_id}:${index + 1}`);
      }
      images.push({ asset_id: asset.asset_id, slot: index + 1, role: expected.role,
        content_sha256: contentSha256, byte_length: content.length });
    }
  }
  if (images.length !== 139) throw new Error("compact_v4_reverify_image_count_invalid");
  return {
    schema_version: "residual-compact-v4-postrun-byte-reverify-v1",
    verified_at: verifiedAt,
    provider_calls: 0,
    storage_read_calls: images.length,
    payload_sha256: sha256(JSON.stringify(payload)),
    materialization_byte_receipts_sha256: payload.materialization_byte_receipts_sha256,
    all_match: true,
    images_sha256: sha256(JSON.stringify(images)),
    images
  };
}

const arg = (argv, name) => {
  const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || "");
};

export async function main(argv = process.argv.slice(2)) {
  if (!arg(argv, "--payload") || !arg(argv, "--out")) {
    throw new Error("compact_v4_reverify_required_path_missing");
  }
  const payload = JSON.parse(await readFile(resolve(arg(argv, "--payload")), "utf8"));
  const receipt = await reverifyCompactV4AssetBytes({ payload });
  await writeJsonAtomic(resolve(arg(argv, "--out")), receipt);
  return receipt;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((receipt) => process.stdout.write(`${JSON.stringify({
    provider_calls: receipt.provider_calls, storage_read_calls: receipt.storage_read_calls,
    all_match: receipt.all_match, images_sha256: receipt.images_sha256 })}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
