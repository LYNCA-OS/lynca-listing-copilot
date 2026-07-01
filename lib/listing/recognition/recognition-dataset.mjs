import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { recognitionCandidatesFromSupabaseFeedbackRows } from "./supabase-recognition-source.mjs";

export const recognitionDatasetSchemaVersion = "recognition-dataset-v1";

export const recognitionSplits = Object.freeze([
  "development",
  "calibration",
  "held_out",
  "held_out_commercial"
]);

export const recognitionMetricFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "players",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

const requiredItemFields = Object.freeze([
  "asset_id",
  "physical_card_id",
  "capture_session_id",
  "images",
  "category",
  "ground_truth",
  "critical_fields",
  "difficulty_tags",
  "ground_truth_sources",
  "reviewed_by",
  "review_status"
]);

const requiredGroundTruthFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "set",
  "players",
  "card_type",
  "insert",
  "parallel",
  "variation",
  "serial_number",
  "collector_number",
  "checklist_code",
  "attributes",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type"
]);

const acceptedReviewStatuses = new Set([
  "DRAFT",
  "SINGLE_REVIEWED",
  "DOUBLE_REVIEWED",
  "ARBITRATED",
  "REJECTED",
  "NEEDS_REVIEW"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable).filter(Boolean).sort().join("|");
  if (typeof value === "boolean") return value ? "true" : "false";
  return normalizeText(value).toLowerCase();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== undefined && value !== null && value !== "";
}

function validationError(pathName, message) {
  return { path: pathName, message };
}

export function stableManifestHash(items = []) {
  const canonical = JSON.stringify(
    items
      .map((item) => ({
        asset_id: item.asset_id,
        physical_card_id: item.physical_card_id,
        capture_session_id: item.capture_session_id,
        source_feedback_id: item.source_feedback_id || null,
        split: item.split || null,
        images: (item.images || []).map((image) => ({
          role: image.role,
          bucket: image.bucket || null,
          object_path: image.object_path,
          content_sha256: image.content_sha256 || null
        })),
        ground_truth: item.ground_truth || {},
        critical_fields: item.critical_fields || [],
        difficulty_tags: item.difficulty_tags || [],
        review_status: item.review_status
      }))
      .sort((left, right) => String(left.asset_id).localeCompare(String(right.asset_id)))
  );

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function validateRecognitionItem(item = {}, index = 0) {
  const errors = [];
  const itemPath = `items[${index}]`;

  if (!isPlainObject(item)) {
    return [validationError(itemPath, "Recognition item must be an object.")];
  }

  requiredItemFields.forEach((field) => {
    if (!(field in item)) errors.push(validationError(`${itemPath}.${field}`, "Required field is missing."));
  });

  ["asset_id", "physical_card_id", "capture_session_id", "category"].forEach((field) => {
    if (!normalizeText(item[field])) errors.push(validationError(`${itemPath}.${field}`, "Field must be a non-empty string."));
  });

  if (item.split !== undefined && item.split !== null && !recognitionSplits.includes(item.split)) {
    errors.push(validationError(`${itemPath}.split`, "Invalid split."));
  }

  if (!Array.isArray(item.images) || item.images.length < 1) {
    errors.push(validationError(`${itemPath}.images`, "At least one image is required."));
  } else {
    item.images.forEach((image, imageIndex) => {
      if (!isPlainObject(image)) {
        errors.push(validationError(`${itemPath}.images[${imageIndex}]`, "Image must be an object."));
        return;
      }
      if (!normalizeText(image.object_path)) errors.push(validationError(`${itemPath}.images[${imageIndex}].object_path`, "Image object_path is required."));
      if (!normalizeText(image.role)) errors.push(validationError(`${itemPath}.images[${imageIndex}].role`, "Image role is required."));
      if (image.has_glare !== undefined && typeof image.has_glare !== "boolean") {
        errors.push(validationError(`${itemPath}.images[${imageIndex}].has_glare`, "has_glare must be boolean when present."));
      }
    });
  }

  if (!isPlainObject(item.ground_truth)) {
    errors.push(validationError(`${itemPath}.ground_truth`, "ground_truth must be an object."));
  } else {
    requiredGroundTruthFields.forEach((field) => {
      if (!(field in item.ground_truth)) errors.push(validationError(`${itemPath}.ground_truth.${field}`, "Ground truth field is missing."));
    });
    ["players", "attributes"].forEach((field) => {
      if (!Array.isArray(item.ground_truth[field])) {
        errors.push(validationError(`${itemPath}.ground_truth.${field}`, "Field must be an array."));
      }
    });
  }

  if (!Array.isArray(item.critical_fields)) {
    errors.push(validationError(`${itemPath}.critical_fields`, "critical_fields must be an array."));
  } else {
    item.critical_fields.forEach((field, fieldIndex) => {
      if (!recognitionMetricFields.includes(field)) {
        errors.push(validationError(`${itemPath}.critical_fields[${fieldIndex}]`, "Critical field is not recognized."));
      }
      if (!valuePresent(item.ground_truth?.[field])) {
        errors.push(validationError(`${itemPath}.critical_fields[${fieldIndex}]`, "Critical field must have reviewed ground truth."));
      }
    });
  }

  if (!Array.isArray(item.difficulty_tags)) errors.push(validationError(`${itemPath}.difficulty_tags`, "difficulty_tags must be an array."));
  if (!Array.isArray(item.ground_truth_sources)) {
    errors.push(validationError(`${itemPath}.ground_truth_sources`, "ground_truth_sources must be an array."));
  }
  if (!Array.isArray(item.reviewed_by) || item.reviewed_by.length < 1) {
    errors.push(validationError(`${itemPath}.reviewed_by`, "At least one reviewer is required."));
  }
  if (!acceptedReviewStatuses.has(item.review_status)) {
    errors.push(validationError(`${itemPath}.review_status`, "Invalid review_status."));
  }
  if (item.review_status === "DOUBLE_REVIEWED" && item.reviewed_by.length < 2) {
    errors.push(validationError(`${itemPath}.reviewed_by`, "DOUBLE_REVIEWED items require at least two reviewers."));
  }

  return errors;
}

export function validateRecognitionDataset(items = []) {
  if (!Array.isArray(items)) {
    return [validationError("items", "Dataset must be an array of recognition items.")];
  }
  return items.flatMap((item, index) => validateRecognitionItem(item, index));
}

export function leakageGroups(items = []) {
  const groups = {
    physical_card_id: new Map(),
    capture_session_id: new Map(),
    source_feedback_id: new Map()
  };

  items.forEach((item) => {
    const split = item.split || "unsplit";
    [
      ["physical_card_id", item.physical_card_id],
      ["capture_session_id", item.capture_session_id],
      ["source_feedback_id", item.source_feedback_id]
    ].forEach(([key, value]) => {
      const normalized = normalizeText(value);
      if (!normalized) return;
      groups[key].set(normalized, [...(groups[key].get(normalized) || []), split]);
    });
  });

  return groups;
}

export function detectRecognitionLeakage(items = []) {
  const groups = leakageGroups(items);
  const leaks = [];

  Object.entries(groups).forEach(([group_type, groupMap]) => {
    groupMap.forEach((splits, group_id) => {
      const uniqueSplits = [...new Set(splits.filter((split) => split !== "unsplit"))];
      if (uniqueSplits.length > 1) {
        leaks.push({
          group_type,
          group_id,
          splits: uniqueSplits.sort()
        });
      }
    });
  });

  return leaks;
}

function groupedItems(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const key = [
      item.physical_card_id,
      item.capture_session_id,
      item.ground_truth?.product,
      item.ground_truth?.year
    ].map((value) => normalizeText(value) || "unknown").join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()];
}

export function assignRecognitionSplits(items = [], {
  ratios = { development: 0.6, calibration: 0.2, held_out: 0.2 },
  includeHeldOutCommercial = false
} = {}) {
  const splits = includeHeldOutCommercial
    ? ["development", "calibration", "held_out", "held_out_commercial"]
    : ["development", "calibration", "held_out"];
  const counts = Object.fromEntries(splits.map((split) => [split, 0]));
  const output = [];
  const groups = groupedItems(items);

  groups.forEach((group, index) => {
    const desired = Object.entries(ratios)
      .filter(([split]) => splits.includes(split))
      .sort((a, b) => {
        const left = counts[a[0]] / Math.max(1, ratios[a[0]]);
        const right = counts[b[0]] / Math.max(1, ratios[b[0]]);
        return left - right;
      })[0]?.[0] || splits[index % splits.length];
    group.forEach((item) => {
      counts[desired] += 1;
      output.push({ ...item, split: desired });
    });
  });

  return output;
}

export function recognitionDatasetStats(items = []) {
  const bySplit = {};
  const byCategory = {};
  const byDifficultyTag = {};
  const byProduct = {};
  const byYear = {};
  const fieldCounts = {};

  items.forEach((item) => {
    const split = item.split || "unsplit";
    bySplit[split] = (bySplit[split] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    const product = normalizeText(item.ground_truth?.product) || "unknown";
    const year = normalizeText(item.ground_truth?.year) || "unknown";
    byProduct[product] = (byProduct[product] || 0) + 1;
    byYear[year] = (byYear[year] || 0) + 1;
    (item.difficulty_tags || []).forEach((tag) => {
      byDifficultyTag[tag] = (byDifficultyTag[tag] || 0) + 1;
    });
    recognitionMetricFields.forEach((field) => {
      if (valuePresent(item.ground_truth?.[field])) {
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      }
    });
  });

  return {
    schema_version: recognitionDatasetSchemaVersion,
    total_items: items.length,
    manifest_hash: stableManifestHash(items),
    by_split: bySplit,
    by_category: byCategory,
    by_product: byProduct,
    by_year: byYear,
    by_difficulty_tag: byDifficultyTag,
    ground_truth_field_counts: fieldCounts,
    leakage: detectRecognitionLeakage(items)
  };
}

export function createRecognitionCandidatesFromFeedbackRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const id = normalizeText(row.id || row.feedback_id || `feedback_${index + 1}`);
    const supabaseCandidate = recognitionCandidatesFromSupabaseFeedbackRows([row])[0];
    if (supabaseCandidate) return supabaseCandidate;

    const images = [];
    if (row.front_object_path || row.front_image_url) {
      images.push({
        object_path: row.front_object_path || row.front_image_url,
        role: "front_original",
        capture_angle: "primary",
        has_glare: false
      });
    }
    if (row.back_object_path || row.back_image_url) {
      images.push({
        object_path: row.back_object_path || row.back_image_url,
        role: "back_original",
        capture_angle: "primary",
        has_glare: false
      });
    }

    return {
      asset_id: `candidate_${id}`,
      physical_card_id: `needs_review_${id}`,
      capture_session_id: `needs_review_${id}`,
      source_feedback_id: id,
      split: null,
      images,
      category: "sports_card",
      ground_truth: {
        year: null,
        manufacturer: null,
        product: null,
        set: null,
        players: [],
        card_type: null,
        insert: null,
        parallel: null,
        variation: null,
        serial_number: null,
        collector_number: null,
        checklist_code: null,
        attributes: [],
        rc: false,
        first_bowman: false,
        auto: false,
        patch: false,
        relic: false,
        ssp: false,
        case_hit: false,
        one_of_one: false,
        grade_company: null,
        card_grade: null,
        auto_grade: null,
        grade_type: "UNKNOWN"
      },
      critical_fields: [],
      difficulty_tags: [],
      ground_truth_sources: [],
      reviewed_by: ["needs_owner_review"],
      review_status: "NEEDS_REVIEW",
      notes: "Candidate exported from Supabase feedback. Corrected title is reviewed title ground truth; field-level ground truth still requires explicit field review."
    };
  });
}

export async function readRecognitionDatasetFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  throw new Error(`Recognition dataset file must be an array or { items }: ${filePath}`);
}

export async function readRecognitionDatasetDir(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
  const datasets = await Promise.all(jsonFiles.map(readRecognitionDatasetFile));
  return datasets.flat();
}

export function recognitionFieldAccuracy(items = []) {
  const counts = {};

  items.forEach((item) => {
    const prediction = item.prediction?.resolved_fields || item.prediction?.resolved || {};
    recognitionMetricFields.forEach((field) => {
      if (!valuePresent(item.ground_truth?.[field])) return;
      counts[field] ||= { correct: 0, total: 0 };
      counts[field].total += 1;
      if (normalizeComparable(prediction[field]) === normalizeComparable(item.ground_truth[field])) {
        counts[field].correct += 1;
      }
    });
  });

  return Object.fromEntries(Object.entries(counts).map(([field, count]) => [
    field,
    {
      ...count,
      accuracy: count.total ? count.correct / count.total : null
    }
  ]));
}
