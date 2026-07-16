#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvaluationSamplePolicy } from "../lib/listing/evaluation/sample-policy.mjs";
import { buildReviewedTitleBlindEval } from "./build-reviewed-title-blind-eval.mjs";

const defaultReviewedSource = "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json";
const defaultEbayDataset = "data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json";
const defaultEbayLabels = "data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl";
const defaultOut = "data/eval/launch-gate/mixed-100-manifest.json";
const defaultLabelsOut = "data/eval/launch-gate/mixed-100-sealed-labels.jsonl";
const prohibitedRecognitionKey = /(?:title|label)/i;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function listArg(value = "") {
  return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function positiveIntegerArg(argv, name, fallback) {
  const parsed = Number(argValue(argv, name, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function loadItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function readJsonl(path) {
  const text = await readFile(resolve(path), "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
    }
  });
}

async function writeJson(path, value) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path, rows) {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function candidateId(item = {}, index = 0) {
  return cleanText(item.asset_id || item.physical_card_id || item.id || `launch_gate_${index + 1}`);
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => (
    entry !== null && entry !== undefined && entry !== ""
  )));
}

function recognitionImages(images = []) {
  return images.filter((image) => image?.bucket && image?.object_path).map((image, index) => compactObject({
    image_id: cleanText(image.image_id) || `image_${index + 1}`,
    bucket: cleanText(image.bucket),
    object_path: cleanText(image.object_path),
    role: cleanText(image.role) || `image_${index + 1}_original`,
    capture_angle: cleanText(image.capture_angle),
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    content_sha256: cleanText(image.content_sha256)
  }));
}

function recognitionItem(item = {}, index = 0, cohort = "") {
  const assetId = candidateId(item, index);
  return compactObject({
    asset_id: assetId,
    physical_card_id: cleanText(item.physical_card_id) || assetId,
    source_feedback_id: cleanText(item.source_feedback_id),
    category: cleanText(item.category) || "collectible_card",
    evaluation_cohort: cohort,
    cold_start_blind: cohort === "EBAY_COLD_START",
    self_retrieval_exclusion_required: cohort === "INTERNAL_REVIEWED_GT",
    images: recognitionImages(item.images)
  });
}

function indexReferences(rows = []) {
  const index = new Map();
  for (const row of rows) {
    for (const value of [row.key, row.case_id, row.item_id, row.asset_id, row.source_feedback_id]) {
      const key = cleanText(value);
      if (key) index.set(key, row);
    }
  }
  return index;
}

function referenceForItem(item = {}, index = new Map()) {
  const assetId = candidateId(item);
  const keys = [
    item.sealed_eval_label_ref?.key,
    item.source_record?.sealed_eval_label_key,
    item.source_record?.case_id,
    item.source_feedback_id,
    assetId,
    assetId.replace(/^ebay_image_only_/, "")
  ].map(cleanText).filter(Boolean);
  return keys.map((key) => index.get(key)).find(Boolean) || null;
}

function seededOrder(seed, cohort, item) {
  return stableHash(`${seed}:${cohort}:${candidateId(item)}`);
}

function sortedBySeed(items = [], seed = "", cohort = "") {
  return [...items].sort((left, right) => (
    seededOrder(seed, cohort, left).localeCompare(seededOrder(seed, cohort, right))
  ));
}

function prohibitedKeyPaths(value, path = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => prohibitedKeyPaths(entry, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (prohibitedRecognitionKey.test(key)) output.push(nextPath);
    prohibitedKeyPaths(entry, nextPath, output);
  }
  return output;
}

function stringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => stringValues(entry, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => stringValues(entry, output));
  }
  return output;
}

function comparableLeakText(value = "") {
  return cleanText(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function assertRecognitionManifestBlind(manifest = {}, sealedRows = []) {
  const prohibitedPaths = prohibitedKeyPaths(manifest);
  if (prohibitedPaths.length) {
    throw new Error(`Recognition manifest contains prohibited title/label keys: ${prohibitedPaths.join(", ")}`);
  }
  const manifestStrings = stringValues(manifest).map(comparableLeakText).filter(Boolean);
  const leakedReferences = sealedRows.map((row) => cleanText(
    row.reviewed_title || row.corrected_title || row.title || row.seller_title
  )).filter(Boolean).filter((reference) => {
    const comparableReference = comparableLeakText(reference);
    return comparableReference && manifestStrings.some((value) => value.includes(comparableReference));
  });
  if (leakedReferences.length) {
    throw new Error(`Recognition manifest contains ${leakedReferences.length} sealed reference value(s).`);
  }
  return {
    prohibited_key_count: 0,
    sealed_reference_value_count: sealedRows.length,
    leaked_reference_value_count: 0,
    verified: true
  };
}

function reviewedSealedRow(item, row) {
  const assetId = candidateId(item);
  const reviewedTitle = cleanText(row?.reviewed_title || row?.corrected_title);
  if (!reviewedTitle) throw new Error(`Missing reviewed reference for ${assetId}.`);
  return {
    ...row,
    key: cleanText(row?.key) || `reviewed_${stableHash(assetId).slice(0, 24)}`,
    case_id: assetId,
    asset_id: assetId,
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    reviewed_title: reviewedTitle,
    label_type: "REVIEWED_INTERNAL_TITLE",
    policy: {
      ...row?.policy,
      reviewed_title_is_ground_truth: true,
      model_prompt_visible: false,
      load_after_predictions_frozen: true,
      self_retrieval_exclusion_required: true
    }
  };
}

function ebaySealedRow(item, row) {
  const assetId = candidateId(item);
  const sellerTitle = cleanText(row?.title || row?.seller_title);
  if (!sellerTitle) throw new Error(`Missing eBay weak reference for ${assetId}.`);
  return {
    ...row,
    key: cleanText(row?.key) || `ebay_${stableHash(assetId).slice(0, 24)}`,
    case_id: assetId.replace(/^ebay_image_only_/, ""),
    asset_id: assetId,
    evaluation_cohort: "EBAY_WEAK_LABEL",
    title: sellerTitle,
    label_type: "MARKETPLACE_WEAK_LABEL",
    policy: {
      ...row?.policy,
      seller_title_is_ground_truth: false,
      model_prompt_visible: false,
      use_after_prediction_for_eval_only: true
    }
  };
}

export async function buildLaunchGateMixedManifest({
  reviewedSourcePath = defaultReviewedSource,
  reviewedExcludePaths = [],
  ebayDatasetPath = defaultEbayDataset,
  ebayLabelsPath = defaultEbayLabels,
  outPath = defaultOut,
  labelsOutPath = defaultLabelsOut,
  targetPerCohort = 50,
  selectionSeed = "",
  seedFactory = () => crypto.randomUUID(),
  writeOutputs = true,
  now = new Date()
} = {}) {
  const normalizedTarget = Math.max(1, Math.trunc(Number(targetPerCohort) || 50));
  const normalizedSeed = cleanText(selectionSeed) || `mixed-${cleanText(seedFactory())}`;
  const reviewed = await buildReviewedTitleBlindEval({
    sourcePath: reviewedSourcePath,
    excludePaths: reviewedExcludePaths,
    outPath,
    labelsOutPath,
    allItems: true,
    selectionSeed: `${normalizedSeed}:internal`,
    evaluationSampleMode: "UNSPECIFIED",
    writeOutputs: false,
    now
  });
  const reviewedReferenceIndex = indexReferences(reviewed.labels);
  const reviewedPool = reviewed.dataset.items.filter((item) => (
    recognitionImages(item.images).length > 0 && referenceForItem(item, reviewedReferenceIndex)
  ));

  const ebayDataset = await readJson(ebayDatasetPath);
  const ebayReferences = await readJsonl(ebayLabelsPath);
  const ebayReferenceIndex = indexReferences(ebayReferences);
  const ebayPool = loadItems(ebayDataset).filter((item) => {
    const reference = referenceForItem(item, ebayReferenceIndex);
    return recognitionImages(item.images).length > 0
      && Boolean(cleanText(reference?.title || reference?.seller_title))
      && reference?.policy?.seller_title_is_ground_truth !== true;
  });

  const effectivePerCohort = Math.min(normalizedTarget, reviewedPool.length, ebayPool.length);
  if (effectivePerCohort < 1) {
    throw new Error(`Mixed manifest requires both cohorts; reviewed=${reviewedPool.length}, ebay=${ebayPool.length}.`);
  }
  const selectedReviewed = sortedBySeed(reviewedPool, normalizedSeed, "INTERNAL_REVIEWED_GT").slice(0, effectivePerCohort);
  const selectedEbay = sortedBySeed(ebayPool, normalizedSeed, "EBAY_COLD_START").slice(0, effectivePerCohort);
  const pairs = [
    ...selectedReviewed.map((item, index) => ({
      item: recognitionItem(item, index, "INTERNAL_REVIEWED_GT"),
      reference: reviewedSealedRow(item, referenceForItem(item, reviewedReferenceIndex))
    })),
    ...selectedEbay.map((item, index) => ({
      item: recognitionItem(item, index, "EBAY_COLD_START"),
      reference: ebaySealedRow(item, referenceForItem(item, ebayReferenceIndex))
    }))
  ].sort((left, right) => (
    stableHash(`${normalizedSeed}:mixed:${left.item.asset_id}`)
      .localeCompare(stableHash(`${normalizedSeed}:mixed:${right.item.asset_id}`))
  ));
  const items = pairs.map((pair) => pair.item);
  const sealedRows = pairs.map((pair) => pair.reference);
  const uniqueAssetIds = new Set(items.map((item) => item.asset_id));
  if (uniqueAssetIds.size !== items.length) throw new Error("Mixed manifest contains duplicate asset_id values.");

  const evaluationSamplePolicy = buildEvaluationSamplePolicy({
    mode: "RANDOM_BLIND",
    selectedItemIds: items.map((item) => item.source_feedback_id || item.asset_id),
    sampleSeed: normalizedSeed,
    selectionStrategy: "seeded_sha256_balanced_cohort_shuffle"
  });
  const downsized = effectivePerCohort < normalizedTarget;
  const manifest = {
    schema_version: "launch-gate-mixed-100-manifest-v1",
    generated_at: now.toISOString(),
    selection_seed: normalizedSeed,
    item_count: items.length,
    evaluation_sample_policy: evaluationSamplePolicy,
    allocation: {
      requested_total: normalizedTarget * 2,
      selected_total: items.length,
      requested_per_cohort: normalizedTarget,
      selected_per_cohort: effectivePerCohort,
      balanced_one_to_one: true,
      downsized,
      downsize_reason: downsized ? "one_or_both_cohorts_below_requested_capacity" : null,
      internal_reviewed_gt: {
        eligible_count: reviewedPool.length,
        requested_count: normalizedTarget,
        selected_count: effectivePerCohort,
        shortfall_count: Math.max(0, normalizedTarget - effectivePerCohort)
      },
      ebay_cold_start: {
        eligible_count: ebayPool.length,
        requested_count: normalizedTarget,
        selected_count: effectivePerCohort,
        shortfall_count: Math.max(0, normalizedTarget - effectivePerCohort)
      }
    },
    intake_policy: {
      image_only: true,
      known_reference_values_present: false,
      reference_data_external: true,
      balanced_cohorts_required: true
    },
    items
  };
  const blindVerification = assertRecognitionManifestBlind(manifest, sealedRows);
  if (writeOutputs) {
    await writeJson(outPath, manifest);
    await writeJsonl(labelsOutPath, sealedRows);
  }
  return { manifest, sealedRows, blindVerification };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const outPath = argValue(argv, "--out", env.LAUNCH_GATE_MIXED_OUT || defaultOut);
  const labelsOutPath = argValue(argv, "--sealed-labels-out", env.LAUNCH_GATE_MIXED_LABELS_OUT || defaultLabelsOut);
  const result = await buildLaunchGateMixedManifest({
    reviewedSourcePath: argValue(argv, "--reviewed-source", env.LAUNCH_GATE_REVIEWED_SOURCE || defaultReviewedSource),
    reviewedExcludePaths: listArg(argValue(argv, "--reviewed-exclude", env.LAUNCH_GATE_REVIEWED_EXCLUDE || "")),
    ebayDatasetPath: argValue(argv, "--ebay-dataset", env.LAUNCH_GATE_EBAY_DATASET || defaultEbayDataset),
    ebayLabelsPath: argValue(argv, "--ebay-sealed-labels", env.LAUNCH_GATE_EBAY_LABELS || defaultEbayLabels),
    outPath,
    labelsOutPath,
    targetPerCohort: positiveIntegerArg(argv, "--per-cohort", Number(env.LAUNCH_GATE_PER_COHORT || 50)),
    selectionSeed: argValue(argv, "--selection-seed", env.LAUNCH_GATE_SELECTION_SEED || "")
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    item_count: result.manifest.item_count,
    selection_seed: result.manifest.selection_seed,
    allocation: result.manifest.allocation,
    blind_verification: result.blindVerification,
    out: resolve(outPath),
    sealed_labels_out: resolve(labelsOutPath)
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Build launch-gate mixed manifest failed: ${error.message}`);
    process.exitCode = 1;
  });
}
