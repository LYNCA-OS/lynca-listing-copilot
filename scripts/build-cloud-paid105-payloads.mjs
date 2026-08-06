#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  ARM_SPECS,
  imageSetFingerprint,
  requestFingerprint,
  signImageUrls
} from "./run-thin-path-eval.mjs";

const execFileAsync = promisify(execFile);
const MODEL = "gpt-5.6-luna";
const EFFORT = "none";
const IMAGE_DETAIL = "high";
const CONTROL = "thin_canonical_high";
const TREATMENT = "thin_canonical_residual_v1_high";
const PROJECT_REF = "irpgnhkslrsiucybkufc";
const EXPECTED_CARDS = 105;
const EXPIRES_IN_SECONDS = 7200;
const EXPECTED_REQUESTS = Object.freeze({
  [CONTROL]: "a1958fad777b504cf9bf216eeb13f21fed310ec00a5a4acfd0d9dddcdbdcf90a",
  [TREATMENT]: "6598ad4025185aff18a94ab3c1e36f13578c299c886ccae0ca13672ce97feda6"
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function argument(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
}

async function writeJsonAtomic(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function serviceKeyForProject(projectRef) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("supabase", [
      "projects",
      "api-keys",
      "--project-ref", projectRef,
      "--reveal",
      "--output", "json"
    ], { maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    throw new Error("supabase_api_key_lookup_failed");
  }
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    throw new Error("supabase_api_key_response_invalid");
  }
  const key = rows.find((row) => row?.name === "service_role")?.api_key
    || rows.find((row) => row?.type === "secret" && row?.name === "default")?.api_key;
  if (!String(key || "").trim()) throw new Error("supabase_secret_api_key_missing");
  return String(key).trim();
}

async function mapConcurrent(items, concurrency, mapper) {
  let cursor = 0;
  const output = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}

async function verifySignedUrl(url, fetchImpl) {
  const response = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`signed_object_head_failed:${response.status}`);
}

function requestTemplate(armKey) {
  const request = ARM_SPECS[armKey].buildRequest({
    imageUrls: [],
    model: MODEL,
    effort: EFFORT,
    imageDetail: IMAGE_DETAIL
  });
  const proof = ARM_SPECS[armKey].buildRequest({
    imageUrls: ["https://contract.invalid/front", "https://contract.invalid/back"],
    model: MODEL,
    effort: EFFORT,
    imageDetail: IMAGE_DETAIL
  });
  if (requestFingerprint(proof) !== EXPECTED_REQUESTS[armKey]) {
    throw new Error(`request_template_not_preregistered:${armKey}`);
  }
  return request;
}

export async function buildCloudPaid105Payloads({
  datasetPath,
  assetIdsPath,
  outDirectory,
  projectRef = PROJECT_REF,
  expectedCards = EXPECTED_CARDS,
  expiresIn = EXPIRES_IN_SECONDS,
  signingConcurrency = 12,
  fetchImpl = fetch,
  serviceKey = null
}) {
  if (projectRef !== PROJECT_REF) throw new Error("cloud_payload_project_ref_not_frozen");
  const [datasetBody, assetIdsBody] = await Promise.all([
    readFile(datasetPath),
    readFile(assetIdsPath)
  ]);
  const dataset = JSON.parse(datasetBody);
  const selectedIds = JSON.parse(assetIdsBody);
  if (!Array.isArray(selectedIds) || selectedIds.length !== expectedCards
      || new Set(selectedIds).size !== expectedCards) {
    throw new Error("cloud_payload_asset_ids_invalid");
  }
  const byId = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
  const items = selectedIds.map((assetId) => byId.get(assetId));
  if (items.some((item) => !item)) throw new Error("cloud_payload_asset_missing_from_dataset");
  if (items.some((item) => !Array.isArray(item.images)
      || item.images.length < 1 || item.images.length > 2)) {
    throw new Error("cloud_payload_requires_one_or_two_images_per_card");
  }

  const supabaseUrl = `https://${projectRef}.supabase.co`;
  const secret = serviceKey || await serviceKeyForProject(projectRef);
  const assets = await mapConcurrent(items, signingConcurrency, async (item) => {
    const imageUrls = await signImageUrls(item.images, {
      supabaseUrl,
      serviceKey: secret,
      expiresIn,
      fetchImpl
    });
    if (imageUrls.length !== item.images.length
        || imageUrls.some((url) => new URL(url).hostname !== `${projectRef}.supabase.co`)) {
      throw new Error(`cloud_payload_signed_images_invalid:${item.asset_id}`);
    }
    await Promise.all(imageUrls.map((url) => verifySignedUrl(url, fetchImpl)));
    return {
      asset_id: item.asset_id,
      image_set_sha256: imageSetFingerprint(item),
      image_urls: imageUrls
    };
  });

  const control = {
    schema_version: "lynca-cloud-accuracy-payload-v1",
    arm_id: "canonical_high",
    request_template: requestTemplate(CONTROL),
    assets
  };
  const treatment = {
    schema_version: "lynca-cloud-accuracy-payload-v1",
    arm_id: "canonical_residual_v1_high",
    request_template: requestTemplate(TREATMENT),
    assets
  };
  const manifest = {
    schema_version: "lynca-cloud-accuracy-payload-manifest-v1",
    authority: "evaluation_only",
    project_ref: projectRef,
    storage_host: `${projectRef}.supabase.co`,
    cards: assets.length,
    images: assets.reduce((sum, asset) => sum + asset.image_urls.length, 0),
    expires_in_seconds: expiresIn,
    dataset_sha256: sha256(datasetBody),
    asset_ids_sha256: sha256(assetIdsBody),
    ordered_asset_ids_sha256: sha256(JSON.stringify(selectedIds)),
    ordered_image_sets_sha256: sha256(JSON.stringify(assets.map((asset) => asset.image_set_sha256))),
    control_template_sha256: sha256(JSON.stringify(control.request_template)),
    treatment_template_sha256: sha256(JSON.stringify(treatment.request_template)),
    control_request_sha256: EXPECTED_REQUESTS[CONTROL],
    treatment_request_sha256: EXPECTED_REQUESTS[TREATMENT],
    labels_loaded: false,
    provider_calls: 0
  };

  await mkdir(outDirectory, { recursive: true, mode: 0o700 });
  const controlPath = resolve(outDirectory, "control.payload.json");
  const treatmentPath = resolve(outDirectory, "treatment.payload.json");
  const manifestPath = resolve(outDirectory, "payload.manifest.json");
  await Promise.all([
    writeJsonAtomic(controlPath, control),
    writeJsonAtomic(treatmentPath, treatment),
    writeJsonAtomic(manifestPath, manifest)
  ]);
  return { controlPath, treatmentPath, manifestPath, manifest };
}

async function main(argv = process.argv.slice(2)) {
  const datasetPath = resolve(argument(
    argv,
    "--dataset",
    "/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json"
  ));
  const assetIdsPath = resolve(argument(
    argv,
    "--asset-ids",
    "/Users/paidaxin/lynca-thin-path/artifacts/accuracy-mechanism-confirmatory-2026-08-02/outside-development-105.asset-ids.json"
  ));
  const outDirectory = resolve(argument(argv, "--out-dir", "artifacts/cloud-paid105-payloads"));
  const result = await buildCloudPaid105Payloads({ datasetPath, assetIdsPath, outDirectory });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    cards: result.manifest.cards,
    images: result.manifest.images,
    storage_host: result.manifest.storage_host,
    control_request_sha256: result.manifest.control_request_sha256,
    treatment_request_sha256: result.manifest.treatment_request_sha256,
    provider_calls: 0
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "cloud_payload_build_failed").slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}
