#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvaluationSamplePolicy,
  normalizeEvaluationSampleMode
} from "../lib/listing/evaluation/sample-policy.mjs";

const defaultSource = "data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json";
const defaultOut = "data/eval/reviewed-title-blind/reviewed-title-image-only.json";
const defaultLabelsOut = "data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl";

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

function numberArg(argv, name, fallback) {
  const parsed = Number(argValue(argv, name, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function stableHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function loadItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

async function readStructuredFile(path) {
  const text = await readFile(resolve(path), "utf8");
  if (/\.jsonl$/i.test(path)) {
    return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
  }
  return JSON.parse(text);
}

function collectSourceFeedbackIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceFeedbackIds(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const explicit = cleanText(value.source_feedback_id || value.sourceFeedbackId);
  if (explicit) output.add(explicit);
  for (const nested of Object.values(value)) collectSourceFeedbackIds(nested, output);
  return output;
}

function reviewedTitle(item = {}) {
  return cleanText(item.source_titles?.corrected_title || item.corrected_title || item.reviewed_title);
}

function eligibleItem(item = {}) {
  return Boolean(
    cleanText(item.source_feedback_id)
    && reviewedTitle(item)
    && item.source_record?.reviewed_ground_truth === true
    && Array.isArray(item.images)
    && item.images.some((image) => image?.bucket && image?.object_path)
  );
}

function sanitizedImages(images = []) {
  return images.filter((image) => image?.bucket && image?.object_path).map((image, index) => ({
    image_id: cleanText(image.image_id) || `image_${index + 1}`,
    bucket: cleanText(image.bucket),
    object_path: cleanText(image.object_path),
    role: cleanText(image.role) || `image_${index + 1}_original`
  }));
}

function selectionOrder(seed, item) {
  return stableHash(`${seed}:${cleanText(item.source_feedback_id)}`);
}

async function writeJson(path, value) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path, rows) {
  const output = resolve(path);
  if (!existsSync(dirname(output))) await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

export async function buildReviewedTitleBlindEval({
  sourcePath = defaultSource,
  excludePaths = [],
  outPath = defaultOut,
  labelsOutPath = defaultLabelsOut,
  limit = 30,
  allItems = false,
  allowPartial = false,
  selectionSeed = "reviewed-title-blind-v1",
  evaluationSampleMode = "FRESH_GENERALIZATION",
  reuseReason = "",
  reuseScopeId = "",
  now = new Date()
} = {}) {
  const source = await readStructuredFile(sourcePath);
  const excludedIds = new Set();
  for (const path of excludePaths.map(cleanText).filter(Boolean)) {
    collectSourceFeedbackIds(await readStructuredFile(path), excludedIds);
  }
  const mode = normalizeEvaluationSampleMode(evaluationSampleMode);
  const candidates = loadItems(source).filter(eligibleItem).filter((item) => !excludedIds.has(cleanText(item.source_feedback_id)));
  const requestedCount = allItems ? candidates.length : Math.max(1, limit);
  const selected = candidates
    .sort((left, right) => selectionOrder(selectionSeed, left).localeCompare(selectionOrder(selectionSeed, right)))
    .slice(0, requestedCount);
  if (!selected.length) throw new Error("No eligible reviewed-title image records remain after exclusions.");
  if (!allItems && !allowPartial && selected.length < requestedCount) {
    throw new Error(`Only ${selected.length} eligible reviewed-title image records remain; requested ${requestedCount}.`);
  }

  const items = [];
  const labels = [];
  for (const item of selected) {
    const sourceFeedbackId = cleanText(item.source_feedback_id);
    const key = `reviewed_${stableHash(sourceFeedbackId).slice(0, 24)}`;
    const assetId = `reviewed_blind_${stableHash(sourceFeedbackId).slice(0, 20)}`;
    items.push({
      asset_id: assetId,
      physical_card_id: assetId,
      source_feedback_id: sourceFeedbackId,
      category: cleanText(item.category) || "collectible_card",
      review_status: "BLIND_EVALUATION_ONLY",
      canonical_title: "",
      source_titles: {},
      sealed_eval_label_ref: { path: labelsOutPath, key },
      source_record: {
        source_type: "REVIEWED_INTERNAL_IMAGE_ONLY",
        source_provider: "listing_title_feedback",
        sealed_eval_label_key: key,
        reviewed_title_visible_to_model: false,
        title_derived_fields_visible_to_model: false,
        self_retrieval_exclusion_required: true
      },
      images: sanitizedImages(item.images)
    });
    labels.push({
      key,
      source_feedback_id: sourceFeedbackId,
      reviewed_title: reviewedTitle(item),
      label_type: "REVIEWED_INTERNAL_TITLE",
      policy: {
        reviewed_title_is_ground_truth: true,
        field_ground_truth: false,
        model_prompt_visible: false,
        load_after_predictions_frozen: true,
        self_retrieval_exclusion_required: true
      }
    });
  }

  const evaluationSamplePolicy = buildEvaluationSamplePolicy({
    mode,
    excludedItemIds: [...excludedIds],
    selectedItemIds: selected.map((item) => item.source_feedback_id),
    exclusionSourceCount: excludePaths.length,
    sampleSeed: selectionSeed,
    selectionStrategy: "deterministic_hash_shuffle",
    reuseReason: reuseReason || (allItems ? "Exhaustive replay of every image-backed reviewed card currently in the internal library." : ""),
    reuseScopeId: reuseScopeId || (allItems ? "supabase-reviewed-image-inventory" : "")
  });
  const dataset = {
    schema_version: "reviewed-title-blind-eval-v1",
    generated_at: now.toISOString(),
    source_schema_version: source.schema_version || null,
    selection_seed: selectionSeed,
    item_count: items.length,
    eligible_source_count: candidates.length,
    evaluation_sample_policy: {
      ...evaluationSamplePolicy,
      inventory_exhaustive: allItems,
      eligible_inventory_count: candidates.length,
      selected_inventory_count: selected.length,
      inventory_coverage_rate: candidates.length
        ? Number((selected.length / candidates.length).toFixed(6))
        : null
    },
    accuracy_policy: {
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_is_field_ground_truth: false,
      title_visible_during_recognition: false,
      predictions_frozen_before_scoring: true
    },
    intake_policy: {
      image_only: true,
      inventory_exhaustive: allItems,
      reviewed_titles_in_dataset: false,
      source_feedback_id_used_for_self_exclusion_only: true
    },
    sealed_labels_path: labelsOutPath,
    items
  };
  await writeJson(outPath, dataset);
  await writeJsonl(labelsOutPath, labels);
  return { dataset, labels };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const result = await buildReviewedTitleBlindEval({
    sourcePath: argValue(argv, "--source", env.REVIEWED_TITLE_SOURCE || defaultSource),
    excludePaths: listArg(argValue(argv, "--exclude", env.REVIEWED_TITLE_EXCLUDE_PATHS || "")),
    outPath: argValue(argv, "--out", env.REVIEWED_TITLE_BLIND_OUT || defaultOut),
    labelsOutPath: argValue(argv, "--sealed-labels-out", env.REVIEWED_TITLE_LABELS_OUT || defaultLabelsOut),
    limit: numberArg(argv, "--limit", Number(env.REVIEWED_TITLE_BLIND_LIMIT || 30)),
    allItems: argv.includes("--all-items"),
    allowPartial: argv.includes("--allow-partial"),
    selectionSeed: argValue(argv, "--selection-seed", env.REVIEWED_TITLE_SELECTION_SEED || `reviewed-${Date.now()}`),
    evaluationSampleMode: argValue(argv, "--sample-mode", env.EVALUATION_SAMPLE_MODE || "FRESH_GENERALIZATION"),
    reuseReason: argValue(argv, "--reuse-reason", env.EVALUATION_REUSE_REASON || ""),
    reuseScopeId: argValue(argv, "--reuse-scope-id", env.EVALUATION_REUSE_SCOPE_ID || "")
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    item_count: result.dataset.item_count,
    eligible_source_count: result.dataset.eligible_source_count,
    sample_mode: result.dataset.evaluation_sample_policy.mode,
    novelty_verified: result.dataset.evaluation_sample_policy.novelty_verified,
    inventory_exhaustive: result.dataset.evaluation_sample_policy.inventory_exhaustive,
    inventory_coverage_rate: result.dataset.evaluation_sample_policy.inventory_coverage_rate,
    out: resolve(argValue(argv, "--out", env.REVIEWED_TITLE_BLIND_OUT || defaultOut)),
    sealed_labels_out: resolve(argValue(argv, "--sealed-labels-out", env.REVIEWED_TITLE_LABELS_OUT || defaultLabelsOut))
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Build reviewed-title blind eval failed: ${error.message}`);
    process.exitCode = 1;
  });
}
