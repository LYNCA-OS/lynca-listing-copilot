#!/usr/bin/env node

// Zero-provider materializer. It reads only an assets manifest, signs those
// objects once, then freezes the same URL bytes for all three arms.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "./cloud-io.mjs";
import { sha256 } from "./request-contract.mjs";
import { imageSetFingerprint } from "../../scripts/run-thin-path-eval.mjs";

const STORAGE_ORIGIN = "https://irpgnhkslrsiucybkufc.supabase.co";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 8 * 60 * 60;
const exactKeys = (value, expected) => value && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");

export function signedObjectPathname(image) {
  const object = image.object_path.split("/").map(encodeURIComponent).join("/");
  return `/storage/v1/object/sign/${encodeURIComponent(image.bucket)}/${object}`;
}

export function assertSignedUrlMatchesImage(value, image) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.hostname !== new URL(STORAGE_ORIGIN).hostname
      || url.pathname !== signedObjectPathname(image)) {
    throw new Error("assets_only_signed_url_object_mismatch");
  }
  return url;
}

export function validateAssetsOnlyManifest(manifest, {
  expectedCards = 35,
  minimumImages = 2,
  maximumImages = 2,
  schemaVersion = "residual-v3-assets-only-manifest-v1"
} = {}) {
  if (!exactKeys(manifest, ["schema_version", "assets"])
    || manifest.schema_version !== schemaVersion
    || !Array.isArray(manifest.assets) || manifest.assets.length !== expectedCards) {
    throw new Error("v3_assets_only_manifest_invalid");
  }
  const ids = new Set();
  const objects = new Set();
  for (const asset of manifest.assets) {
    if (!exactKeys(asset, ["asset_id", "image_set_sha256", "images"])
      || typeof asset.asset_id !== "string" || !asset.asset_id
      || !/^[0-9a-f]{64}$/.test(String(asset.image_set_sha256 || ""))
      || !Array.isArray(asset.images) || asset.images.length < minimumImages
      || asset.images.length > maximumImages
      || ids.has(asset.asset_id)) throw new Error("v3_assets_only_asset_invalid");
    ids.add(asset.asset_id);
    const roles = new Set();
    for (const image of asset.images) {
      if (!exactKeys(image, ["bucket", "object_path", "role"])
        || !/^[a-z0-9][a-z0-9_-]*$/.test(String(image.bucket || ""))
        || typeof image.object_path !== "string" || !image.object_path
        || image.object_path.startsWith("/") || image.object_path.includes("..")
        || !["front_original", "back_original"].includes(image.role)) {
        throw new Error("v3_assets_only_image_invalid");
      }
      const objectKey = `${image.bucket}\0${image.object_path}`;
      if (objects.has(objectKey) || roles.has(image.role)) {
        throw new Error("v3_assets_only_image_duplicate");
      }
      objects.add(objectKey);
      roles.add(image.role);
    }
    if (imageSetFingerprint({ images: asset.images }) !== asset.image_set_sha256) {
      throw new Error(`v3_assets_only_image_pairing_mismatch:${asset.asset_id}`);
    }
  }
  return manifest;
}

export function buildAssetsOnlyManifestFromDataset({ dataset, prereg }) {
  if (!Array.isArray(dataset?.items) || !Array.isArray(prereg?.cohort)
    || prereg.cohort.length !== 35) throw new Error("v3_assets_only_builder_input_invalid");
  const byId = new Map(dataset.items.map((item) => [item.asset_id, item]));
  const assets = prereg.cohort.map((card) => {
    const item = byId.get(card.asset_id);
    const images = (item?.images || []).slice(0, 2).map((image) => ({
      bucket: image.bucket, object_path: image.object_path, role: image.role
    }));
    if (!item || imageSetFingerprint(item) !== card.image_set_sha256
      || imageSetFingerprint({ images }) !== card.image_set_sha256) {
      throw new Error(`v3_assets_only_builder_pairing_mismatch:${card.asset_id}`);
    }
    return { asset_id: card.asset_id, image_set_sha256: card.image_set_sha256, images };
  });
  return validateAssetsOnlyManifest({
    schema_version: "residual-v3-assets-only-manifest-v1", assets
  });
}

export async function signAssetsOnlyManifest(manifest, {
  fetchImpl = globalThis.fetch, serviceKey, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
  validation = undefined
} = {}) {
  validateAssetsOnlyManifest(manifest, validation);
  if (typeof fetchImpl !== "function" || !String(serviceKey || "")
    || !Number.isInteger(ttlSeconds) || ttlSeconds < DEFAULT_SIGNED_URL_TTL_SECONDS) {
    throw new Error("v3_assets_only_signing_config_invalid");
  }
  const assets = [];
  for (const asset of manifest.assets) {
    const imageUrls = [];
    for (const image of asset.images) {
      const endpoint = `${STORAGE_ORIGIN}${signedObjectPathname(image)}`;
      const response = await fetchImpl(endpoint, { method: "POST", redirect: "error",
        headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
          "content-type": "application/json" }, body: JSON.stringify({ expiresIn: ttlSeconds }) });
      if (!response?.ok) throw new Error(`v3_assets_only_signing_failed:${response?.status || 0}`);
      const result = await response.json();
      let signed = String(result?.signedURL || result?.signedUrl || "");
      if (!signed) throw new Error("v3_assets_only_signed_url_missing");
      if (signed.startsWith("/object/sign/")) signed = `/storage/v1${signed}`;
      const url = new URL(signed, STORAGE_ORIGIN);
      assertSignedUrlMatchesImage(url, image);
      imageUrls.push(url.toString());
    }
    assets.push({ asset_id: asset.asset_id, image_set_sha256: asset.image_set_sha256,
      image_urls: imageUrls });
  }
  return assets;
}

export function materializeResidualV3Payload({ prereg, assets, controlTemplate, residualTemplate,
  materializedAt = new Date().toISOString(), minimumRemainingTtlMs = 3 * 60 * 60 * 1000 }) {
  if (prereg?.cohort?.length !== 35 || !Array.isArray(assets) || assets.length !== 35) {
    throw new Error("v3_materialize_card_count_invalid");
  }
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  if (byId.size !== 35) throw new Error("v3_materialize_duplicate_asset");
  const ordered = prereg.cohort.map((card) => {
    const asset = byId.get(card.asset_id);
    if (!asset || asset.image_set_sha256 !== card.image_set_sha256
      || !Array.isArray(asset.image_urls) || asset.image_urls.length !== 2) {
      throw new Error(`v3_materialize_asset_mismatch:${card.asset_id}`);
    }
    return structuredClone(asset);
  });
  return {
    schema_version: "cloud-residual-v3-materialized-payload-v1",
    materialized_at: materializedAt,
    minimum_remaining_ttl_ms: minimumRemainingTtlMs,
    ordered_signed_urls_sha256: sha256(JSON.stringify(ordered.map((asset) => asset.image_urls))),
    control_a: { arm_id: "control_a", request_template: structuredClone(controlTemplate), assets: ordered },
    control_b: { arm_id: "control_b", request_template: structuredClone(controlTemplate), assets: ordered },
    residual_c: { arm_id: "residual_c", request_template: structuredClone(residualTemplate), assets: ordered }
  };
}

const arg = (argv, name) => { const index = argv.indexOf(name); return index < 0 ? "" : String(argv[index + 1] || ""); };
const load = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

async function main(argv = process.argv.slice(2)) {
  const required = ["--prereg", "--assets-manifest", "--control-template", "--residual-template", "--out"];
  if (required.some((name) => !arg(argv, name))) throw new Error("v3_materialize_required_path_missing");
  const assets = await signAssetsOnlyManifest(await load(arg(argv, "--assets-manifest")), {
    serviceKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  const payload = materializeResidualV3Payload({ prereg: await load(arg(argv, "--prereg")),
    assets, controlTemplate: await load(arg(argv, "--control-template")),
    residualTemplate: await load(arg(argv, "--residual-template")) });
  await writeJsonAtomic(resolve(arg(argv, "--out")), payload);
  return payload;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((payload) => { const storageSignCalls = payload.control_a.assets
    .reduce((sum, asset) => sum + asset.image_urls.length, 0);
    process.stdout.write(`${JSON.stringify({ provider_calls: 0, network_calls: storageSignCalls,
    storage_sign_calls: storageSignCalls,
    cards: payload.control_a.assets.length, ordered_signed_urls_sha256: payload.ordered_signed_urls_sha256 })}\n`);
  })
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
