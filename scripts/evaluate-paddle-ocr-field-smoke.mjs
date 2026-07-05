#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import {
  applyOcrEvidencePatchToResult,
  buildOcrRequestFromCrop,
  ocrResultToEvidencePatch
} from "../lib/listing/ocr/ocr-contract.mjs";
import { createPaddleOcrClient, PaddleOcrClientError } from "../lib/listing/ocr/paddle-ocr-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.resolve(__dirname, "../data/eval/paddle-ocr/paddle-ocr-field-smoke.json");

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefix = `${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function intArg(argv, name, fallback) {
  const number = Number(argValue(argv, name, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && normalizeText(value) !== "";
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort().join("|");
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function flattenCards(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["cards", "items", "results", "records", "per_card", "per_card_results", "asset_results", "runs"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.report && typeof payload.report === "object") return flattenCards(payload.report);
  return [];
}

async function readJson(file) {
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

function fieldValue(record = {}, field = "") {
  const sources = [
    record.ground_truth,
    record.reviewed_gt,
    record.reviewed_ground_truth,
    record.gt,
    record.corrected_fields,
    record.fields,
    record.reference_fields
  ];
  for (const source of sources) {
    if (source && typeof source === "object" && hasValue(source[field])) return source[field];
  }
  return null;
}

function predictionFields(record = {}) {
  return record.prediction?.resolved
    || record.result?.resolved
    || record.response?.resolved
    || record.resolved
    || record.cloud_result?.resolved
    || {};
}

function recordImages(record = {}) {
  const images = [
    record.images,
    record.input?.images,
    record.payload?.images,
    record.asset?.images,
    record.request?.images,
    record.cloud_request?.images
  ].find(Array.isArray) || [];
  const nestedImages = images.flatMap((image) => Array.isArray(image?.images) ? image.images : [image]).filter(Boolean);
  const topLevelImages = [];
  [
    ["card_image_url", "front_original"],
    ["image_url", "front_original"],
    ["front_image_url", "front_original"],
    ["back_image_url", "back_original"],
    ["thumbnail_url", "front_original"]
  ].forEach(([key, role]) => {
    if (hasValue(record[key])) {
      topLevelImages.push({
        image_id: `${record.candidate_id || record.asset_id || record.item_id || "record"}:${key}`,
        role,
        image_url: record[key],
        full_image_fallback: true
      });
    }
  });
  [
    record.additional_image_urls,
    record.additionalImages,
    record.image_urls,
    record.imageUrls
  ].filter(Array.isArray).forEach((urls) => {
    urls.forEach((url, index) => {
      if (hasValue(url)) {
        topLevelImages.push({
          image_id: `${record.candidate_id || record.asset_id || record.item_id || "record"}:additional:${index + 1}`,
          role: index === 0 ? "front_original" : "additional",
          image_url: typeof url === "object" ? imageUrl(url) : url,
          full_image_fallback: true
        });
      }
    });
  });
  return [...nestedImages, ...topLevelImages];
}

function imageUrl(image = {}) {
  const value = image.signed_url
    || image.signedUrl
    || image.image_url
    || image.imageUrl
    || image.public_url
    || image.publicUrl
    || image.url
    || image.src
    || "";
  return typeof value === "object" ? value.url || value.signed_url || "" : value;
}

function imageRoleText(image = {}) {
  return [
    image.role,
    image.storageRole,
    image.storage_role,
    image.sourceRegion,
    image.source_region,
    image.name,
    image.filename,
    image.cropMetadata?.crop_role,
    image.crop_metadata?.crop_role,
    image.cropMetadata?.source_region,
    image.crop_metadata?.source_region
  ].filter(Boolean).join(" ").toLowerCase();
}

function cropTypeForImage(image = {}) {
  const text = imageRoleText(image);
  if (/serial/.test(text)) return "serial_number";
  if (/(?:grade|slab|psa|bgs|sgc|cgc)/.test(text)) return "grade_label";
  if (/(?:collector|checklist|card_code|card number|code)/.test(text)) return "collector_number";
  if (/(?:tcg|rarity|set_code)/.test(text)) return "tcg_code";
  if (/(?:year_product|product_text)/.test(text)) return "product_text";
  if (/(?:subject|player|name)/.test(text)) return "player_name";
  return "";
}

function defaultCropBoxForType(cropType = "", image = {}) {
  if (image.crop_box || image.cropBox || image.cropMetadata?.normalized_bounds || image.crop_metadata?.normalized_bounds) {
    return image.crop_box || image.cropBox || image.cropMetadata?.normalized_bounds || image.crop_metadata?.normalized_bounds;
  }
  const roleText = imageRoleText(image);
  const isBack = /back/.test(roleText);
  if (cropType === "serial_number" || cropType === "serial_denominator") return { x: 0.48, y: 0.55, width: 0.5, height: 0.4 };
  if (cropType === "grade_label" || cropType === "slab_cert") return { x: 0.04, y: 0.0, width: 0.92, height: 0.22 };
  if (cropType === "collector_number" || cropType === "checklist_code" || cropType === "tcg_code") {
    return isBack
      ? { x: 0.0, y: 0.0, width: 1.0, height: 0.38 }
      : { x: 0.0, y: 0.0, width: 1.0, height: 0.32 };
  }
  if (cropType === "product_text") {
    return isBack
      ? { x: 0.0, y: 0.55, width: 1.0, height: 0.45 }
      : { x: 0.0, y: 0.0, width: 1.0, height: 0.35 };
  }
  if (cropType === "player_name") return { x: 0.0, y: 0.0, width: 1.0, height: 0.45 };
  return { x: 0.0, y: 0.0, width: 1.0, height: 0.5 };
}

function buildRequestsForRecord(record = {}, limitPerCard = 4) {
  const cardId = normalizeText(record.query_card_id || record.card_id || record.asset_id || record.id || record.item_id || record.itemId) || crypto.randomUUID();
  const requests = [];
  recordImages(record).forEach((image, index) => {
    const cropType = cropTypeForImage(image);
    const url = normalizeText(imageUrl(image));
    if (!url) return;
    const cropTypes = cropType
      ? [cropType]
      : (
          /back/.test(imageRoleText(image))
            ? ["collector_number", "product_text"]
            : ["player_name", "product_text", "collector_number"]
        );
    cropTypes.forEach((type) => {
      if (requests.length >= limitPerCard) return;
      requests.push(buildOcrRequestFromCrop({
        requestId: `${cardId}:ocr:${index + 1}:${type}`,
        imageUrl: url,
        cropType: type,
        expectedPattern: type,
        cropBox: defaultCropBoxForType(type, image),
        metadata: {
          card_id: cardId,
          image_id: image.image_id || image.id || null,
          crop_id: image.crop_id || image.cropMetadata?.crop_id || image.crop_metadata?.crop_id || null,
          full_image_fallback: Boolean(image.full_image_fallback || !cropType)
        }
      }));
    });
  });
  return requests.slice(0, limitPerCard);
}

async function runPool(items = [], concurrency = 2, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function runOne() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        results[current] = { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runOne));
  return results;
}

function percentile(values = [], p = 0.5) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function exactMetric(records = [], field = "", source = "gpt") {
  let denominator = 0;
  let correct = 0;
  records.forEach((record) => {
    const expected = fieldValue(record.input_record || record, field);
    if (!hasValue(expected) || ["UNKNOWN", "NOT_APPLICABLE"].includes(String(expected).toUpperCase())) return;
    denominator += 1;
    const prediction = source === "ocr"
      ? record.ocr_fields?.[field]
      : source === "combined"
        ? record.combined_resolved?.[field]
        : predictionFields(record.input_record || record)[field];
    if (canonical(expected) === canonical(prediction)) correct += 1;
  });
  return {
    correct,
    denominator,
    accuracy: denominator ? correct / denominator : null
  };
}

function serialDenominator(value = "") {
  return normalizeText(value).match(/\/\s*(\d{1,5})\b/)?.[1] || null;
}

function denominatorMetric(records = []) {
  let denominator = 0;
  let correct = 0;
  records.forEach((record) => {
    const expected = serialDenominator(fieldValue(record.input_record || record, "serial_number"));
    if (!expected) return;
    denominator += 1;
    const predicted = record.ocr_fields?.serial_denominator || serialDenominator(record.ocr_fields?.serial_number);
    if (expected === predicted) correct += 1;
  });
  return { correct, denominator, accuracy: denominator ? correct / denominator : null };
}

function collectOcrFields(ocrResults = []) {
  return ocrResults.reduce((fields, result) => {
    Object.entries(result?.normalized_fields || {}).forEach(([field, value]) => {
      if (hasValue(value) && !hasValue(fields[field])) fields[field] = value;
    });
    return fields;
  }, {});
}

function combineWithOcr(record = {}, ocrResults = []) {
  const base = {
    resolved: predictionFields(record),
    evidence: record.result?.evidence || record.response?.evidence || record.evidence || {},
    unresolved: record.result?.unresolved || record.response?.unresolved || record.unresolved || []
  };
  const merged = ocrResults.reduce((current, ocrResult) => {
    const patch = ocrResult.evidence_patch || ocrResultToEvidencePatch(ocrResult);
    return applyOcrEvidencePatchToResult(current, patch);
  }, base);
  return applyIdentityResolutionGate(merged, {
    providerId: "openai_legacy",
    maxLength: 85
  });
}

function compareImprovement(record = {}) {
  const fields = ["serial_number", "collector_number", "checklist_code", "grade_company", "card_grade"];
  const beforeWrong = fields.filter((field) => {
    const expected = fieldValue(record.input_record, field);
    if (!hasValue(expected)) return false;
    return canonical(expected) !== canonical(predictionFields(record.input_record)[field]);
  });
  const afterWrong = fields.filter((field) => {
    const expected = fieldValue(record.input_record, field);
    if (!hasValue(expected)) return false;
    return canonical(expected) !== canonical(record.combined_resolved?.[field]);
  });
  const recovered = beforeWrong.filter((field) => !afterWrong.includes(field));
  const regressed = afterWrong.filter((field) => !beforeWrong.includes(field));
  return { recovered, regressed };
}

async function main() {
  const argv = process.argv.slice(2);
  const inputPath = argValue(argv, "--input", "");
  const outPath = argValue(argv, "--out", defaultOut);
  const limit = intArg(argv, "--limit", 10);
  const concurrency = intArg(argv, "--concurrency", 2);

  const inputPayload = inputPath ? await readJson(inputPath) : [];
  const inputRecords = flattenCards(inputPayload).slice(0, limit);
  const client = createPaddleOcrClient();
  const startedAt = Date.now();

  const report = {
    schema_version: "paddle_ocr_field_smoke_v1",
    created_at: new Date().toISOString(),
    input_path: inputPath || null,
    limit,
    concurrency,
    status: "READY",
    config: {
      enabled: client.config.enabled,
      configured: client.config.configured,
      timeout_ms: client.config.timeout_ms,
      model_id: client.config.model_id,
      model_revision: client.config.model_revision || null
    },
    policy: {
      paddle_ocr_role: "field_level_ocr_verifier_only",
      replaces_gpt: false,
      can_generate_title: false,
      can_override_resolved_fields: false,
      resolver_gate_decides: true,
      uses_corrected_title_as_prompt_hint: false
    },
    records: [],
    metrics: {}
  };

  if (!client.config.enabled || !client.config.configured) {
    report.status = "BLOCKED";
    report.blocked_reason = client.config.reason || "paddle_ocr_worker_not_configured";
    report.metrics = {
      serial_exact: { correct: 0, denominator: 0, accuracy: null },
      serial_denominator_exact: { correct: 0, denominator: 0, accuracy: null },
      collector_number_exact: { correct: 0, denominator: 0, accuracy: null },
      slab_grade_exact: { correct: 0, denominator: 0, accuracy: null },
      cert_number_exact: { correct: 0, denominator: 0, accuracy: null },
      tcg_card_number_exact: { correct: 0, denominator: 0, accuracy: null },
      ocr_recovery_count: 0,
      ocr_regression_count: 0,
      ocr_abstain_count: inputRecords.length,
      latency_ms: { p50: null, p95: null },
      cost_estimate_usd: 0
    };
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, blocked_reason: report.blocked_reason, out: outPath }, null, 2));
    return;
  }

  const runRecords = await runPool(inputRecords, concurrency, async (record, index) => {
    const cardId = normalizeText(record.query_card_id || record.card_id || record.asset_id || record.id || record.item_id || record.itemId) || `card_${index + 1}`;
    const requests = buildRequestsForRecord(record);
    if (!requests.length) {
      return {
        query_card_id: cardId,
        input_record: record,
        status: "ABSTAIN",
        reason: "no_crop_urls_for_paddle_ocr",
        ocr_results: [],
        ocr_fields: {},
        combined_resolved: predictionFields(record)
      };
    }
    const ocrResults = [];
    for (const request of requests) {
      try {
        ocrResults.push(await client.verifyCrop(request));
      } catch (error) {
        ocrResults.push({
          request_id: request.request_id,
          crop_type: request.crop_type,
          error_type: error instanceof PaddleOcrClientError ? error.code : "paddle_ocr_unknown_error",
          error_message: error?.message || String(error),
          normalized_fields: {},
          latency_ms: null
        });
      }
    }
    const combined = combineWithOcr(record, ocrResults.filter((result) => !result.error_type));
    return {
      query_card_id: cardId,
      input_record: record,
      status: ocrResults.some((result) => !result.error_type) ? "OK" : "ABSTAIN",
      reason: ocrResults.some((result) => result.error_type) ? "one_or_more_ocr_requests_failed" : null,
      ocr_results: ocrResults,
      ocr_fields: collectOcrFields(ocrResults),
      gpt_current_resolved: predictionFields(record),
      combined_resolved: combined.resolved || {},
      combined_identity_status: combined.identity_resolution_status || null,
      combined_writer_required_fields: combined.writer_required_fields || []
    };
  });

  report.records = runRecords.map((record) => {
    const { input_record: inputRecord, ...publicRecord } = record;
    return {
      ...publicRecord,
      corrected_title_present: Boolean(inputRecord?.corrected_title || inputRecord?.seller_title || inputRecord?.title),
      ground_truth_fields_present: ["serial_number", "collector_number", "checklist_code", "grade_company", "card_grade"].filter((field) => hasValue(fieldValue(inputRecord, field)))
    };
  });

  const evaluatedRecords = runRecords.map((record) => {
    const delta = compareImprovement(record);
    return { ...record, delta };
  });
  const latencies = evaluatedRecords.flatMap((record) => record.ocr_results || []).map((result) => Number(result.latency_ms)).filter(Number.isFinite);
  report.metrics = {
    serial_exact: exactMetric(evaluatedRecords, "serial_number", "ocr"),
    serial_denominator_exact: denominatorMetric(evaluatedRecords),
    collector_number_exact: exactMetric(evaluatedRecords, "collector_number", "ocr"),
    slab_grade_exact: exactMetric(evaluatedRecords, "card_grade", "ocr"),
    cert_number_exact: exactMetric(evaluatedRecords, "cert_number", "ocr"),
    tcg_card_number_exact: exactMetric(evaluatedRecords, "tcg_card_number", "ocr"),
    ocr_recovery_count: evaluatedRecords.reduce((sum, record) => sum + record.delta.recovered.length, 0),
    ocr_regression_count: evaluatedRecords.reduce((sum, record) => sum + record.delta.regressed.length, 0),
    ocr_abstain_count: evaluatedRecords.filter((record) => record.status === "ABSTAIN").length,
    latency_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95)
    },
    cost_estimate_usd: 0,
    total_ms: Date.now() - startedAt
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, out: outPath, metrics: report.metrics }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
