#!/usr/bin/env node

// lynca-csm paid boundary. This process has no label/scorer input and writes
// only raw model results plus execution receipts. A provider claim is fsynced
// before dispatch; an uncertain claim is never retried or paired later.

import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  LUNA_PARITY_ARM_SPECS,
  LUNA_PARITY_EFFORT,
  LUNA_PARITY_MAX_OUTPUT_TOKENS,
  LUNA_PARITY_MODEL,
  assertLunaParityRequest,
  imageTransportSha256,
  lunaParityArm,
  normalizedRequestSha256,
  parseLunaParityResponse,
  sha256
} from "./luna-parity-core.mjs";

const EXECUTION_SCHEMA = "luna-parity-blind-execution-v1";
const RESULT_SCHEMA = "luna-parity-blind-result-v1";
const CLAIM_SCHEMA = "luna-parity-provider-claim-v1";
const FORBIDDEN_ARGUMENTS = new Set([
  "--labels", "--sealed-labels", "--scorer", "--score-contract",
  "--label-map", "--reference"
]);
const FORBIDDEN_KEYS = new Set([
  "canonical_title", "source_titles", "reviewed_title", "reference_title",
  "ground_truth", "corrected_title", "source_feedback_id",
  "sealed_eval_label_ref", "label_key", "labels", "reference",
  "score", "f1", "recall", "precision"
]);

const arg = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
};

function assertNoLabels(value, path = "execution") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`luna_parity_forbidden_execution_key:${path}.${key}`);
    }
    assertNoLabels(nested, `${path}.${key}`);
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function appendJsonLineDurable(path, value) {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const [index, line] of String(await readFile(path)).split("\n").entries()) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch { throw new Error(`luna_parity_jsonl_invalid:${path}:line_${index + 1}`); }
  }
  return rows;
}

function mimeFor(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new Error("luna_parity_image_signature_unsupported");
}

function validateAssetsManifest(manifest) {
  assertNoLabels(manifest);
  if (manifest?.schema_version !== "luna-parity-assets-only-v1"
      || manifest.sealed_label_bytes_read !== false
      || !Array.isArray(manifest.assets) || manifest.assets.length < 1
      || !/^[0-9a-f]{64}$/.test(String(manifest.selected_asset_ids_sha256 || ""))) {
    throw new Error("luna_parity_assets_manifest_invalid");
  }
  const ids = new Set();
  for (const asset of manifest.assets) {
    if (!asset?.asset_id || ids.has(asset.asset_id)
        || !Array.isArray(asset.images) || asset.images.length !== 2
        || asset.images[0]?.role !== "front_original"
        || asset.images[1]?.role !== "back_original") {
      throw new Error(`luna_parity_asset_pair_invalid:${asset?.asset_id || "missing"}`);
    }
    ids.add(asset.asset_id);
    for (const image of asset.images) {
      const remote = typeof image.bucket === "string" && image.bucket
        && typeof image.object_path === "string" && image.object_path;
      const local = typeof image.local_path === "string" && image.local_path;
      if ((!remote && !local)
          || !/^[0-9a-f]{64}$/.test(String(image.content_sha256 || ""))
          || !Number.isInteger(image.byte_length) || image.byte_length < 1) {
        throw new Error(`luna_parity_image_manifest_invalid:${asset.asset_id}:${image.role}`);
      }
    }
    if (asset.image_set_sha256 !== sha256(JSON.stringify(asset.images))) {
      throw new Error(`luna_parity_image_set_mismatch:${asset.asset_id}`);
    }
  }
  if (manifest.selected_asset_ids_sha256
      !== sha256(JSON.stringify(manifest.assets.map(({ asset_id: id }) => id)))) {
    throw new Error("luna_parity_selected_asset_ids_mismatch");
  }
  return manifest;
}

async function storageBytes(image, { env, fetchImpl }) {
  if (image.local_path) return readFile(resolve(image.local_path));
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || !key) throw new Error("luna_parity_supabase_credentials_required");
  const signResponse = await fetchImpl(
    `${supabaseUrl}/storage/v1/object/sign/${image.bucket}/${image.object_path}`,
    {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 })
    }
  );
  if (!signResponse.ok) throw new Error(`luna_parity_sign_failed:${signResponse.status}`);
  const signed = await signResponse.json();
  const signedPath = signed.signedURL || signed.signedUrl;
  if (typeof signedPath !== "string" || !signedPath) {
    throw new Error("luna_parity_signed_url_missing");
  }
  const url = signedPath.startsWith("http")
    ? signedPath
    : `${supabaseUrl}/storage/v1${signedPath}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`luna_parity_storage_read_failed:${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function materializeAsset(asset, options) {
  const imageUrls = [];
  for (const image of asset.images) {
    const bytes = await storageBytes(image, options);
    if (bytes.length !== image.byte_length || sha256(bytes) !== image.content_sha256) {
      throw new Error(`luna_parity_original_bytes_mismatch:${asset.asset_id}:${image.role}`);
    }
    imageUrls.push(`data:${mimeFor(bytes)};base64,${bytes.toString("base64")}`);
  }
  return {
    imageUrls,
    image_transport_sha256: imageTransportSha256(imageUrls)
  };
}

function validateHistory({ claims, results, runFingerprint, assets, arms }) {
  const allowed = new Set(assets.flatMap((asset) => arms.map((arm) =>
    `${asset.asset_id}::${arm.key}`)));
  const claimed = new Map();
  for (const row of claims.filter(({ event }) => event === "provider_claimed")) {
    const key = `${row.asset_id}::${row.arm}`;
    if (row.schema_version !== CLAIM_SCHEMA || row.run_fingerprint !== runFingerprint
        || !allowed.has(key) || claimed.has(key)) {
      throw new Error(`luna_parity_claim_history_invalid:${key}`);
    }
    claimed.set(key, row);
  }
  const completed = new Map();
  const responseIds = new Set();
  for (const row of results) {
    const key = `${row.asset_id}::${row.arm}`;
    if (row.schema_version !== RESULT_SCHEMA || row.run_fingerprint !== runFingerprint
        || !claimed.has(key) || completed.has(key)
        || row.request_attempt_count !== 1 || row.provider_retries !== 0
        || typeof row.provider_response_id !== "string"
        || responseIds.has(row.provider_response_id)) {
      throw new Error(`luna_parity_result_history_invalid:${key}`);
    }
    responseIds.add(row.provider_response_id);
    completed.set(key, row);
  }
  return { claimed, completed, responseIds };
}

function executionContract({ assetsManifest, assetsManifestSha256, scoreContractSha256,
  arms, sourceSha256 }) {
  const sentinel = ["data:image/jpeg;base64,front", "data:image/jpeg;base64,back"];
  const requestTemplates = Object.fromEntries(arms.map((arm) => {
    const request = assertLunaParityRequest({
      arm,
      request: arm.buildRequest({ imageUrls: sentinel, model: LUNA_PARITY_MODEL }),
      imageUrls: sentinel
    });
    return [arm.key, normalizedRequestSha256(request)];
  }));
  return {
    schema_version: EXECUTION_SCHEMA,
    authority: "evaluation_only",
    production_authorized: false,
    assets_manifest_sha256: assetsManifestSha256,
    selected_asset_ids_sha256: assetsManifest.selected_asset_ids_sha256,
    selected_cards: assetsManifest.assets.length,
    score_contract_sha256: scoreContractSha256,
    arms: arms.map(({ key }) => key),
    request_template_sha256: requestTemplates,
    model: LUNA_PARITY_MODEL,
    effort: LUNA_PARITY_EFFORT,
    max_output_tokens: LUNA_PARITY_MAX_OUTPUT_TOKENS,
    image_delivery: "sha256_verified_original_inline",
    card_boundary: "one_physical_card_front_back_per_response",
    concurrency: 1,
    provider_max_attempts: 1,
    provider_retries: 0,
    pair_order: "asset_index_alternating",
    sealed_labels_accessed_during_execution: false,
    source_sha256: sourceSha256
  };
}

export async function runLunaParityBlind({
  assetsManifest,
  scoreContractSha256,
  armKeys,
  outDir,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = 120_000,
  sourceSha256 = {}
}) {
  validateAssetsManifest(assetsManifest);
  if (!/^[0-9a-f]{64}$/.test(String(scoreContractSha256 || ""))
      || !Array.isArray(armKeys) || armKeys.length !== 2
      || new Set(armKeys).size !== armKeys.length) {
    throw new Error("luna_parity_execution_contract_input_invalid");
  }
  const arms = armKeys.map(lunaParityArm);
  await mkdir(outDir, { recursive: true });
  const lockPath = resolve(outDir, ".luna-parity.lock");
  try { await mkdir(lockPath); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error("luna_parity_out_dir_locked");
    throw error;
  }
  try {
    const manifestPath = resolve(outDir, "execution-manifest.json");
    const claimsPath = resolve(outDir, "attempts.jsonl");
    const resultsPath = resolve(outDir, "raw-results.jsonl");
    const receiptPath = resolve(outDir, "execution-receipt.json");
    const assetsManifestSha256 = sha256(JSON.stringify(assetsManifest));
    const contract = executionContract({
      assetsManifest,
      assetsManifestSha256,
      scoreContractSha256,
      arms,
      sourceSha256
    });
    const runFingerprint = sha256(JSON.stringify(contract));
    const executionManifest = { ...contract, run_fingerprint: runFingerprint };
    if (existsSync(manifestPath)) {
      const stored = JSON.parse(await readFile(manifestPath, "utf8"));
      if (JSON.stringify(stored) !== JSON.stringify(executionManifest)) {
        throw new Error("luna_parity_execution_manifest_mismatch");
      }
    } else {
      await writeJsonAtomic(manifestPath, executionManifest);
    }

    const claimRows = await readJsonLines(claimsPath);
    const resultRows = await readJsonLines(resultsPath);
    const history = validateHistory({
      claims: claimRows,
      results: resultRows,
      runFingerprint,
      assets: assetsManifest.assets,
      arms
    });
    const providerApiKey = String(env.OPENAI_API_KEY || "");
    if (!providerApiKey) throw new Error("luna_parity_openai_api_key_required");

    for (const [assetIndex, asset] of assetsManifest.assets.entries()) {
      const keys = arms.map((arm) => `${asset.asset_id}::${arm.key}`);
      if (keys.every((key) => history.completed.has(key))) continue;
      if (keys.some((key) => history.claimed.has(key))) continue;
      const materialized = await materializeAsset(asset, { env, fetchImpl });
      const order = assetIndex % 2 === 0 ? arms : [...arms].reverse();
      for (const arm of order) {
        const key = `${asset.asset_id}::${arm.key}`;
        const request = assertLunaParityRequest({
          arm,
          request: arm.buildRequest({
            imageUrls: materialized.imageUrls,
            model: LUNA_PARITY_MODEL
          }),
          imageUrls: materialized.imageUrls
        });
        const requestWireSha256 = sha256(JSON.stringify(request));
        const requestNormalizedSha256 = normalizedRequestSha256(request);
        const claim = {
          schema_version: CLAIM_SCHEMA,
          event: "provider_claimed",
          run_fingerprint: runFingerprint,
          asset_id: asset.asset_id,
          arm: arm.key,
          image_set_sha256: asset.image_set_sha256,
          image_transport_sha256: materialized.image_transport_sha256,
          request_wire_sha256: requestWireSha256,
          request_normalized_sha256: requestNormalizedSha256,
          provider_max_attempts: 1,
          claimed_at: new Date().toISOString()
        };
        await appendJsonLineDurable(claimsPath, claim);
        history.claimed.set(key, claim);

        const startedAt = Date.now();
        let response = null;
        let body = null;
        let thrown = null;
        try {
          response = await fetchImpl("https://api.openai.com/v1/responses", {
            method: "POST",
            signal: AbortSignal.timeout(requestTimeoutMs),
            headers: {
              authorization: `Bearer ${providerApiKey}`,
              "content-type": "application/json"
            },
            body: JSON.stringify(request)
          });
          body = await response.json();
        } catch (error) {
          thrown = error;
        }
        await appendJsonLineDurable(claimsPath, {
          schema_version: "luna-parity-provider-attempt-v1",
          event: "provider_attempt",
          run_fingerprint: runFingerprint,
          asset_id: asset.asset_id,
          arm: arm.key,
          request_attempt_count: 1,
          http_status: Number(response?.status || 0) || null,
          outcome: thrown ? "transport_error"
            : response?.ok && !body?.error ? "provider_success" : "provider_error",
          provider_retries: 0,
          completed_at: new Date().toISOString()
        });
        if (thrown || !response?.ok || body?.error) break;

        let parsed;
        try { parsed = parseLunaParityResponse({ arm, body, request }); }
        catch (error) {
          await appendJsonLineDurable(claimsPath, {
            schema_version: "luna-parity-provider-final-v1",
            event: "derivation_failed",
            run_fingerprint: runFingerprint,
            asset_id: asset.asset_id,
            arm: arm.key,
            error: String(error?.message || error).slice(0, 240),
            completed_at: new Date().toISOString()
          });
          break;
        }
        if (history.responseIds.has(body.id)) {
          throw new Error(`luna_parity_provider_response_reused:${body.id}`);
        }
        const result = {
          schema_version: RESULT_SCHEMA,
          run_fingerprint: runFingerprint,
          asset_id: asset.asset_id,
          arm: arm.key,
          image_set_sha256: asset.image_set_sha256,
          image_transport_sha256: materialized.image_transport_sha256,
          request_wire_sha256: requestWireSha256,
          request_normalized_sha256: requestNormalizedSha256,
          request_attempt_count: 1,
          provider_retries: 0,
          provider_response_id: body.id,
          served_model: body.model,
          served_effort: LUNA_PARITY_EFFORT,
          latency_ms: Date.now() - startedAt,
          usage: body.usage ?? null,
          provider_body_sha256: sha256(JSON.stringify(body)),
          provider_body: body,
          raw_output: parsed.rawOutput,
          title: parsed.finished.title,
          title_length: parsed.finished.title.length,
          fields: parsed.finished.fields ?? null,
          field_defects: parsed.finished.field_defects ?? null,
          completed_at: new Date().toISOString()
        };
        assertNoLabels(result);
        await appendJsonLineDurable(resultsPath, result);
        history.completed.set(key, result);
        history.responseIds.add(body.id);
      }
    }

    const expectedJobs = assetsManifest.assets.length * arms.length;
    const incompleteAssets = assetsManifest.assets.filter((asset) => arms.some((arm) =>
      !history.completed.has(`${asset.asset_id}::${arm.key}`)))
      .map(({ asset_id: assetId }) => assetId);
    const completedBody = existsSync(resultsPath) ? await readFile(resultsPath) : Buffer.alloc(0);
    const attemptsBody = existsSync(claimsPath) ? await readFile(claimsPath) : Buffer.alloc(0);
    const receipt = {
      schema_version: "luna-parity-blind-execution-receipt-v1",
      state: incompleteAssets.length ? "INCOMPLETE" : "COMPLETE",
      run_fingerprint: runFingerprint,
      score_contract_sha256: scoreContractSha256,
      selected_cards: assetsManifest.assets.length,
      expected_jobs: expectedJobs,
      provider_claims: history.claimed.size,
      completed_jobs: history.completed.size,
      incomplete_assets: incompleteAssets,
      concurrency: 1,
      provider_max_attempts: 1,
      provider_retries: 0,
      sealed_labels_accessed_during_execution: false,
      raw_results_sha256: sha256(completedBody),
      raw_results_bytes: completedBody.length,
      attempts_sha256: sha256(attemptsBody),
      attempts_bytes: attemptsBody.length,
      completed_at: new Date().toISOString()
    };
    assertNoLabels(receipt);
    await writeJsonAtomic(receiptPath, receipt);
    return receipt;
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some((value) => FORBIDDEN_ARGUMENTS.has(value))) {
    throw new Error("luna_parity_execution_label_argument_forbidden");
  }
  const assetsPath = arg(argv, "--assets-manifest");
  const scoreContractSha256 = arg(argv, "--score-contract-sha256");
  const outDirArg = arg(argv, "--out-dir");
  const armKeys = arg(argv, "--arms").split(",").filter(Boolean);
  if (!assetsPath || !outDirArg || !scoreContractSha256 || armKeys.length !== 2) {
    throw new Error("luna_parity_execution_argument_missing");
  }
  const outDir = resolve(outDirArg);
  const assetsManifestBody = await readFile(resolve(assetsPath));
  const assetsManifest = JSON.parse(assetsManifestBody);
  const [coreBody, executorBody] = await Promise.all([
    readFile(fileURLToPath(new URL("./luna-parity-core.mjs", import.meta.url))),
    readFile(fileURLToPath(import.meta.url))
  ]);
  const receipt = await runLunaParityBlind({
    assetsManifest,
    scoreContractSha256,
    armKeys,
    outDir,
    sourceSha256: {
      "luna-parity-core.mjs": sha256(coreBody),
      "run-luna-parity-blind.mjs": sha256(executorBody)
    }
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { LUNA_PARITY_ARM_SPECS };
