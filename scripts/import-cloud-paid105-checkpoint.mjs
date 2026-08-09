#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ARM_SPECS,
  buildRunManifest,
  imageSetFingerprint,
  requestFingerprint
} from "./run-thin-path-eval.mjs";

const CONTROL = "thin_canonical_high";
const TREATMENT = "thin_canonical_residual_v1_high";
const MODEL = "gpt-5.6-luna";
const EFFORT = "none";
const IMAGE_DETAIL = "high";
const EXPECTED_CARDS = 105;
const FROZEN_STORAGE_HOST = "irpgnhkslrsiucybkufc.supabase.co";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function argument(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
}

async function writeAtomic(path, body) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tokenScore(reference, title) {
  const tokenize = (value) => new Set(clean(value).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9/']+/).filter(Boolean));
  const wanted = tokenize(reference);
  const got = tokenize(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return {
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0
  };
}

function armSpec(key) {
  return { key, ...ARM_SPECS[key] };
}

function expectedWireIdentity(arm, imageUrls) {
  const request = arm.buildRequest({
    imageUrls,
    model: MODEL,
    effort: EFFORT,
    imageDetail: IMAGE_DETAIL
  });
  const body = JSON.stringify(request);
  let imageIndex = 0;
  const normalizedBody = JSON.stringify(request, (key, value) => {
    if (key === "image_url" && typeof value === "string") {
      imageIndex += 1;
      return `signed-image-${imageIndex}`;
    }
    return value;
  });
  return {
    normalized_request_sha256: requestFingerprint(request),
    normalized_request_bytes: Buffer.byteLength(normalizedBody),
    wire_sha256: sha256(body),
    wire_bytes: Buffer.byteLength(body)
  };
}

function validateSource({ checkpoint, preflight, control, treatment, items, expectedCards }) {
  if (checkpoint?.state !== "COMPLETE" || checkpoint?.dry_run !== false
      || checkpoint?.schema_version !== "lynca-cloud-paired-accuracy-contract-v2"
      || checkpoint?.task_count !== expectedCards || checkpoint?.pairs?.length !== expectedCards
      || checkpoint?.completed_pairs !== expectedCards || checkpoint?.provider_calls !== expectedCards * 2
      || checkpoint?.provider_retries !== 0 || checkpoint?.preregistered_contract_verified !== true) {
    throw new Error("cloud_checkpoint_not_complete");
  }
  if (preflight?.state !== "COMPLETE" || preflight?.dry_run !== true
      || preflight?.provider_calls !== 0 || preflight?.preflight_calls !== 2
      || preflight?.pair_contract_fingerprint !== checkpoint.pair_contract_fingerprint
      || preflight?.preregistered_contract_verified !== true) {
    throw new Error("cloud_preflight_receipt_invalid");
  }
  if (control?.arm_id !== "canonical_high" || treatment?.arm_id !== "canonical_residual_v1_high"
      || JSON.stringify(control.assets) !== JSON.stringify(treatment.assets)
      || control.assets.length !== expectedCards) {
    throw new Error("cloud_payload_pair_invalid");
  }
  const selectedIds = items.map((item) => item.asset_id);
  if (JSON.stringify(selectedIds) !== JSON.stringify(control.assets.map((asset) => asset.asset_id))) {
    throw new Error("cloud_payload_cohort_order_mismatch");
  }
  const stableIdentity = control.assets.map((asset) => ({
    asset_id: asset.asset_id,
    image_set_sha256: asset.image_set_sha256
  }));
  const signedIdentity = control.assets.map((asset) => (
    asset.image_urls.map((url) => sha256(url))
  ));
  if (checkpoint.ordered_assets_sha256 !== sha256(JSON.stringify(stableIdentity))
      || checkpoint.ordered_signed_urls_sha256 !== sha256(JSON.stringify(signedIdentity))
      || checkpoint.control_template_sha256 !== sha256(JSON.stringify(control.request_template))
      || checkpoint.treatment_template_sha256 !== sha256(JSON.stringify(treatment.request_template))) {
    throw new Error("cloud_checkpoint_payload_fingerprint_mismatch");
  }
  if (checkpoint.environment === "production" || checkpoint.region !== undefined) {
    throw new Error("cloud_checkpoint_unexpected_root_runtime_fields");
  }
  if (checkpoint.deployment_hostname !== new URL(checkpoint.deployment).hostname
      || checkpoint.storage_host !== FROZEN_STORAGE_HOST
      || new URL(control.assets[0].image_urls[0]).hostname !== FROZEN_STORAGE_HOST) {
    throw new Error("cloud_checkpoint_runtime_binding_invalid");
  }
}

function finishRows({ checkpoint, control, treatment, items }) {
  const payloadByRole = { control, treatment };
  const armByRole = { control: armSpec(CONTROL), treatment: armSpec(TREATMENT) };
  const responseIds = new Set();
  const rows = [];
  for (const pair of checkpoint.pairs) {
    const item = items[pair.pair_index - 1];
    if (!item || pair.asset_id !== item.asset_id
        || pair.image_set_sha256 !== imageSetFingerprint(item)) {
      throw new Error(`cloud_pair_item_identity_mismatch:${pair.pair_index}`);
    }
    const asset = control.assets[pair.pair_index - 1];
    const expectedImageCount = (item.images || []).slice(0, 2).length;
    if (asset.image_urls.length !== expectedImageCount || expectedImageCount < 1) {
      throw new Error(`cloud_pair_image_count_mismatch:${pair.asset_id}`);
    }
    if (pair.signed_urls_sha256 !== sha256(JSON.stringify(asset.image_urls))) {
      throw new Error(`cloud_pair_signed_urls_mismatch:${pair.asset_id}`);
    }
    if (!Array.isArray(pair.order) || new Set(pair.order).size !== 2
        || !pair.order.includes("control") || !pair.order.includes("treatment")) {
      throw new Error(`cloud_pair_order_invalid:${pair.asset_id}`);
    }
    for (const role of ["control", "treatment"]) {
      const arm = armByRole[role];
      const armCheckpoint = pair.arms?.[role];
      const report = armCheckpoint?.report;
      const providerRow = report?.rows?.[0];
      const expectedArmId = role === "control" ? "canonical_high" : "canonical_residual_v1_high";
      const expectedContract = role === "control"
        ? checkpoint.control_contract
        : checkpoint.treatment_contract;
      if (armCheckpoint?.state !== "COMPLETE" || report?.ok !== true
          || report?.environment !== "preview" || report?.region !== "sin1"
          || report?.deployment_hostname !== checkpoint.deployment_hostname
          || report?.storage_host !== checkpoint.storage_host
          || report?.arm_id !== expectedArmId
          || typeof report?.run_id !== "string" || !report.run_id.includes(`.${role}`)
          || report?.model !== MODEL || report?.reasoning_effort !== EFFORT
          || report?.image_detail !== IMAGE_DETAIL || report?.provider_calls !== 1
          || report?.provider_retries !== 0 || report?.failed_count !== 0
          || report?.succeeded_count !== 1 || providerRow?.ok !== true
          || providerRow?.asset_id !== pair.asset_id
          || providerRow?.image_set_sha256 !== pair.image_set_sha256) {
        throw new Error(`cloud_pair_report_invalid:${pair.asset_id}:${role}`);
      }
      if (report.contract_normalized_request_sha256 !== expectedContract.normalized_request_sha256
          || report.contract_normalized_request_bytes !== expectedContract.normalized_request_bytes
          || report.contract_wire_sha256 !== expectedContract.wire_sha256
          || report.contract_wire_bytes !== expectedContract.wire_bytes) {
        throw new Error(`cloud_pair_contract_mismatch:${pair.asset_id}:${role}`);
      }
      const expected = expectedWireIdentity(arm, asset.image_urls);
      if (providerRow.normalized_request_sha256 !== expected.normalized_request_sha256
          || providerRow.normalized_request_bytes !== expected.normalized_request_bytes
          || providerRow.request_wire_sha256 !== expected.wire_sha256
          || providerRow.request_wire_bytes !== expected.wire_bytes) {
        throw new Error(`cloud_pair_request_identity_mismatch:${pair.asset_id}:${role}`);
      }
      if (!providerRow.provider_response_id || responseIds.has(providerRow.provider_response_id)) {
        throw new Error(`cloud_pair_provider_response_id_invalid:${pair.asset_id}:${role}`);
      }
      responseIds.add(providerRow.provider_response_id);
      const rawResponse = String(providerRow.provider_response_raw || "");
      if (!rawResponse || providerRow.provider_response_sha256 !== sha256(rawResponse)) {
        throw new Error(`cloud_pair_response_body_invalid:${pair.asset_id}:${role}`);
      }
      let body;
      try {
        body = JSON.parse(rawResponse);
      } catch {
        throw new Error(`cloud_pair_response_json_invalid:${pair.asset_id}:${role}`);
      }
      if (body.id !== providerRow.provider_response_id || body.model !== MODEL
          || body.status !== "completed" || body.incomplete_details
          || providerRow.provider_status !== "completed" || providerRow.incomplete_details
          || body.reasoning?.effort !== EFFORT
          || providerRow.served_effort !== EFFORT
          || providerRow.served_effort_attested !== true) {
        throw new Error(`cloud_pair_served_contract_invalid:${pair.asset_id}:${role}`);
      }
      const payload = arm.extract(body);
      const parsedPayload = JSON.parse(payload);
      if (JSON.stringify(parsedPayload) !== JSON.stringify(providerRow.structured_output)) {
        throw new Error(`cloud_pair_structured_output_mismatch:${pair.asset_id}:${role}`);
      }
      const finished = arm.finish(payload);
      rows.push({
        asset_id: pair.asset_id,
        arm: arm.key,
        image_detail: IMAGE_DETAIL,
        title: finished.title,
        raw_title: payload,
        sanitised: finished.sanitised,
        truncated: finished.truncated,
        raw_length: finished.raw_length,
        length: finished.length,
        latency_ms: providerRow.latency_ms,
        input_tokens: providerRow.input_tokens,
        output_tokens: providerRow.output_tokens,
        total_tokens: body?.usage?.total_tokens ?? null,
        cached_input_tokens: providerRow.cached_input_tokens,
        model: MODEL,
        served_model: providerRow.served_model,
        requested_effort: EFFORT,
        served_effort: providerRow.served_effort,
        served_effort_attested: true,
        request_sha256: expected.normalized_request_sha256,
        image_set_sha256: pair.image_set_sha256,
        image_count: asset.image_urls.length,
        request_attempt_count: 1,
        provider_attempts: [{
          schema_version: "thin-path-provider-attempt-v1",
          attempt: 1,
          http_status: providerRow.status,
          outcome: "provider_success",
          retryable: false,
          will_retry: false,
          final: false,
          retry_delay_ms: 0
        }],
        arm_eval_version: arm.evalVersion || null,
        started_at: new Date(armCheckpoint.started_at_ms).toISOString(),
        completed_at: new Date(armCheckpoint.completed_at_ms).toISOString(),
        provider_response_id: providerRow.provider_response_id,
        cloud_request_wire_sha256: expected.wire_sha256,
        cloud_pair_order: pair.order,
        cloud_pair_gap_ms: pair.arm_gap_ms ?? null,
        fields: finished.fields ?? null,
        canonical_control_title: finished.canonical_control_title ?? null,
        canonical_control_length: finished.canonical_control_length ?? null,
        field_defects: finished.field_defects ?? null,
        grammar: finished.grammar ?? null,
        brackets: finished.brackets ?? null,
        dropped_brackets: finished.dropped_brackets ?? null,
        suppressed_brackets: finished.suppressed_brackets ?? null,
        empty_fields: finished.empty_fields ?? null,
        unreadable_fields: finished.unreadable_fields ?? null,
        low_confidence_fields: finished.low_confidence_fields ?? null,
        observations: finished.observations ?? null,
        unreadable_regions: finished.unreadable_regions ?? null,
        observation_defects: finished.observation_defects ?? null,
        candidate_schema_version: finished.candidate_schema_version ?? null,
        candidate_facts: finished.candidate_facts ?? null,
        candidate_hypotheses: finished.candidate_hypotheses ?? null,
        candidate_defects: finished.candidate_defects ?? null,
        free_title: finished.free_title ?? null,
        eval_version: finished.eval_version ?? null,
        open_evidence: finished.open_evidence ?? null,
        evidence_schema_version: finished.evidence_schema_version ?? null,
        evidence_spans: finished.evidence_spans ?? null,
        evidence_candidates: finished.evidence_candidates ?? null,
        evidence_noise_dropped: finished.evidence_noise_dropped ?? null,
        evidence_promotions: finished.evidence_promotions ?? null,
        evidence_defects: finished.evidence_defects ?? null,
        evidence_resolution: finished.evidence_resolution ?? null,
        evidence_resolver_version: finished.evidence_resolver_version ?? null,
        residual_schema_version: finished.residual_schema_version ?? null,
        residual_source_present: finished.residual_source_present ?? null,
        residual_candidates: finished.residual_candidates ?? null,
        residual_replay_candidates: finished.residual_replay_candidates ?? null,
        residual_dropped: finished.residual_dropped ?? null,
        residual_defects: finished.residual_defects ?? null,
        residual_canonical_fields_unchanged: finished.residual_canonical_fields_unchanged ?? null,
        production_promoted: finished.production_promoted ?? null
      });
    }
  }
  return rows;
}

export async function importCloudPaid105Checkpoint({
  checkpointPath,
  preflightPath,
  controlPayloadPath,
  treatmentPayloadPath,
  datasetPath,
  sealedLabelsPath,
  assetIdsPath,
  outDirectory,
  evalRoot = "/Users/paidaxin/lynca-eval-root",
  expectedCards = EXPECTED_CARDS
}) {
  const lockPath = `${checkpointPath}.lock`;
  try {
    await readFile(lockPath);
    throw new Error("cloud_checkpoint_still_locked");
  } catch (error) {
    if (error?.message === "cloud_checkpoint_still_locked") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const [checkpointBody, preflightBody, controlBody, treatmentBody, datasetBody, assetIdsBody] = await Promise.all([
    readFile(checkpointPath),
    readFile(preflightPath),
    readFile(controlPayloadPath),
    readFile(treatmentPayloadPath),
    readFile(datasetPath),
    readFile(assetIdsPath)
  ]);
  const checkpoint = JSON.parse(checkpointBody);
  const preflight = JSON.parse(preflightBody);
  const control = JSON.parse(controlBody);
  const treatment = JSON.parse(treatmentBody);
  const dataset = JSON.parse(datasetBody);
  const selectedIds = JSON.parse(assetIdsBody);
  if (!Array.isArray(selectedIds) || selectedIds.length !== expectedCards
      || new Set(selectedIds).size !== expectedCards) {
    throw new Error("cloud_import_asset_ids_invalid");
  }
  const byId = new Map((dataset.items || []).map((item) => [item.asset_id, item]));
  const items = selectedIds.map((assetId) => byId.get(assetId));
  if (items.some((item) => !item)) throw new Error("cloud_import_asset_missing");
  validateSource({ checkpoint, preflight, control, treatment, items, expectedCards });

  // Provider responses are now fully frozen and validated. Only after this
  // boundary do sealed labels enter memory.
  const predictions = finishRows({ checkpoint, control, treatment, items });
  if (predictions.length !== expectedCards * 2) throw new Error("cloud_import_prediction_count_mismatch");
  const sealedLabelsBody = await readFile(sealedLabelsPath);
  const labels = new Map(sealedLabelsBody.toString("utf8").split(/\n+/).filter(Boolean)
    .map((line) => JSON.parse(line)).map((row) => [row.key, row.reviewed_title]));
  const scorerPath = resolve(evalRoot, "scripts/evaluate-cloud-listing-api.mjs");
  const { policyFairTokenRecall } = await import(pathToFileURL(scorerPath).href);
  const arms = [armSpec(CONTROL), armSpec(TREATMENT)];
  const manifest = await buildRunManifest({
    arms,
    model: MODEL,
    effort: EFFORT,
    imageDetail: IMAGE_DETAIL,
    limit: expectedCards,
    dataset: datasetPath,
    sealedLabels: sealedLabelsPath,
    assetIdsFile: assetIdsPath,
    scorer: scorerPath,
    concurrency: checkpoint.concurrency,
    requestTimeoutMs: 120_000,
    maxAttempts: 1,
    datasetBody,
    sealedLabelsBody,
    assetIdsBody,
    selectedAssetIds: selectedIds,
    selectionRole: "disjoint105_learning"
  });
  const rows = predictions.map((prediction) => {
    const item = byId.get(prediction.asset_id);
    const reference = labels.get(String(item?.sealed_eval_label_ref?.key || ""));
    if (!reference) throw new Error(`cloud_import_label_missing:${prediction.asset_id}`);
    const quality = tokenScore(reference, prediction.title);
    return {
      ...prediction,
      score: policyFairTokenRecall(reference, prediction.title),
      f1: quality.f1,
      recall: quality.recall,
      precision: quality.precision,
      reference,
      run_fingerprint: manifest.fingerprint,
      finisher_fingerprint: manifest.finisher.fingerprint
    };
  });
  const checkpointJsonl = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  manifest.completed_at = new Date().toISOString();
  manifest.checkpoint_sha256 = sha256(checkpointJsonl);
  manifest.checkpoint_rows = rows.length;
  manifest.paired_cards = expectedCards;
  manifest.cloud_evidence = {
    schema_version: "lynca-cloud-paid105-import-v1",
    source_checkpoint_sha256: sha256(checkpointBody),
    source_preflight_sha256: sha256(preflightBody),
    pair_contract_fingerprint: checkpoint.pair_contract_fingerprint,
    deployment_hostname: checkpoint.deployment_hostname,
    region: "sin1",
    storage_host: checkpoint.storage_host,
    provider_calls: checkpoint.provider_calls,
    provider_retries: checkpoint.provider_retries,
    response_ids_sha256: sha256(JSON.stringify(rows.map((row) => row.provider_response_id).sort())),
    labels_loaded_after_predictions_frozen: true,
    production_recommendation: false
  };

  await mkdir(outDirectory, { recursive: true });
  const outputPath = resolve(outDirectory, `thin-path-${MODEL}.jsonl`);
  const manifestPath = resolve(outDirectory, `thin-path-${MODEL}.manifest.json`);
  await Promise.all([
    writeAtomic(outputPath, checkpointJsonl),
    writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  ]);
  return { outputPath, manifestPath, manifest, rows };
}

async function main(argv = process.argv.slice(2)) {
  const required = [
    "--checkpoint",
    "--preflight",
    "--control-payload",
    "--treatment-payload",
    "--dataset",
    "--sealed-labels",
    "--asset-ids",
    "--out-dir"
  ];
  for (const name of required) {
    if (!argument(argv, name)) throw new Error(`required_option_missing:${name}`);
  }
  const result = await importCloudPaid105Checkpoint({
    checkpointPath: resolve(argument(argv, "--checkpoint")),
    preflightPath: resolve(argument(argv, "--preflight")),
    controlPayloadPath: resolve(argument(argv, "--control-payload")),
    treatmentPayloadPath: resolve(argument(argv, "--treatment-payload")),
    datasetPath: resolve(argument(argv, "--dataset")),
    sealedLabelsPath: resolve(argument(argv, "--sealed-labels")),
    assetIdsPath: resolve(argument(argv, "--asset-ids")),
    outDirectory: resolve(argument(argv, "--out-dir"))
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    rows: result.rows.length,
    paired_cards: result.manifest.paired_cards,
    checkpoint_sha256: result.manifest.checkpoint_sha256,
    provider_calls: result.manifest.cloud_evidence.provider_calls,
    production_recommendation: false
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "cloud_checkpoint_import_failed").slice(0, 600)}\n`);
    process.exitCode = 1;
  });
}
