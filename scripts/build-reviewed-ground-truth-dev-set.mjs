import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "reviewed-ground-truth-v1";
const defaultSource = "data/eval/regression-sets/supabase-feedback-regression-30.json";
const defaultOut = "data/eval/reviewed-ground-truth/development-reviewed-30.json";

export const reviewedFieldKeys = Object.freeze([
  "subject",
  "year",
  "product_or_set",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "serial_number",
  "grade"
]);

const allowedStatuses = Object.freeze(["UNREVIEWED", "CONFIRMED", "UNKNOWN", "NOT_APPLICABLE"]);
const allowedDisplayStatuses = Object.freeze(["NORMAL", "REVIEW", "CONFLICT"]);

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nonEmpty(value) {
  if (Array.isArray(value)) return value.some(nonEmpty);
  if (value && typeof value === "object") return Object.values(value).some(nonEmpty);
  return normalizeText(value) !== "";
}

function gradeValue(groundTruth = {}) {
  return {
    company: normalizeText(groundTruth.grade_company),
    card_grade: normalizeText(groundTruth.card_grade),
    auto_grade: normalizeText(groundTruth.auto_grade),
    grade_type: normalizeText(groundTruth.grade_type)
  };
}

function variantValue(groundTruth = {}) {
  return {
    exact: normalizeText(groundTruth.parallel || groundTruth.variation),
    narrow: "",
    color: ""
  };
}

function productOrSetValue(groundTruth = {}) {
  return {
    product: normalizeText(groundTruth.product),
    set: normalizeText(groundTruth.set),
    value: [groundTruth.product, groundTruth.set].map(normalizeText).filter(Boolean).join(" ")
  };
}

function defaultValueForField(field, groundTruth = {}) {
  switch (field) {
    case "subject":
      return Array.isArray(groundTruth.players)
        ? groundTruth.players.map(normalizeText).filter(Boolean)
        : [];
    case "year":
      return normalizeText(groundTruth.year);
    case "product_or_set":
      return productOrSetValue(groundTruth);
    case "card_type":
      return normalizeText(groundTruth.card_type || groundTruth.insert);
    case "variant_or_parallel":
      return variantValue(groundTruth);
    case "collector_number":
      return normalizeText(groundTruth.collector_number);
    case "serial_number":
      return normalizeText(groundTruth.serial_number);
    case "grade":
      return gradeValue(groundTruth);
    default:
      return "";
  }
}

function reviewStatusForValue({ value, trustExistingGroundTruth }) {
  if (!trustExistingGroundTruth) return "UNREVIEWED";
  return nonEmpty(value) ? "CONFIRMED" : "UNKNOWN";
}

function labelField(field, groundTruth = {}, { trustExistingGroundTruth = false } = {}) {
  const value = defaultValueForField(field, groundTruth);
  return {
    status: reviewStatusForValue({ value, trustExistingGroundTruth }),
    value,
    allowed_statuses: allowedStatuses,
    evidence_sources: [],
    reviewer_notes: ""
  };
}

function buildItem(item = {}, index = 0, options = {}) {
  const groundTruth = item.ground_truth || {};
  const cardId = item.source_feedback_id
    || item.physical_card_id
    || item.asset_id
    || `development-card-${index + 1}`;

  return {
    card_id: cardId,
    asset_id: item.asset_id || null,
    physical_card_id: item.physical_card_id || null,
    source_feedback_id: item.source_feedback_id || null,
    split: "development",
    commercial_heldout: false,
    review_status: options.trustExistingGroundTruth ? "IMPORTED_FROM_EXISTING_GROUND_TRUTH" : "UNREVIEWED",
    image_inputs: item.images || [],
    annotation_hint: {
      corrected_title: item.source_titles?.corrected_title || "",
      generated_title: item.source_titles?.generated_title || "",
      can_be_used_as_ground_truth: false,
      use_as: "review_hint_only"
    },
    source_notes: item.notes || "",
    fields: Object.fromEntries(reviewedFieldKeys.map((field) => [
      field,
      labelField(field, groundTruth, options)
    ]))
  };
}

export async function readJson(path, label = "input") {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} not found: ${resolvedPath}`);
  return JSON.parse(await readFile(resolvedPath, "utf8"));
}

async function writeJson(path, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (!path) {
    process.stdout.write(text);
    return;
  }
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, text);
}

export function buildReviewedGroundTruthDevSet(source = {}, {
  now = () => new Date(),
  trustExistingGroundTruth = false
} = {}) {
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  const items = sourceItems.map((item, index) => buildItem(item, index, { trustExistingGroundTruth }));

  return {
    schema_version: schemaVersion,
    dataset_id: "supabase-feedback-development-reviewed-30",
    generated_at: now().toISOString(),
    split: "development",
    commercial_heldout: false,
    commercial_heldout_usage_allowed: false,
    corrected_title_policy: {
      can_be_used_as_ground_truth: false,
      use_as: "annotation_hint_only"
    },
    field_contract: {
      key_fields: reviewedFieldKeys,
      field_statuses: allowedStatuses,
      display_statuses_expected_from_predictions: allowedDisplayStatuses,
      subject_matching: "normalized_set_exact",
      variant_or_parallel_matching: "exact_required_with_auxiliary_narrow_and_color_match",
      serial_number_matching: "complete_exact_required_with_auxiliary_denominator_match",
      excluded_from_denominators: ["UNKNOWN", "NOT_APPLICABLE", "UNREVIEWED"],
      corrected_title_rule: "corrected_title is a labeling aid only and is never imported as ground truth."
    },
    source: {
      schema_version: source.schema_version || null,
      manifest_hash: source.manifest_hash || null,
      item_count: sourceItems.length,
      source_table: source.source?.table || source.source_table || null
    },
    summary: {
      item_count: items.length,
      reviewed_field_count: items.reduce((sum, item) => (
        sum + reviewedFieldKeys.filter((field) => item.fields[field]?.status === "CONFIRMED").length
      ), 0),
      corrected_title_used_as_ground_truth: false,
      trust_existing_ground_truth: trustExistingGroundTruth
    },
    items
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-reviewed-ground-truth-dev-set.mjs --source <fixed-30.json> --out <reviewed-labels.json>",
    "",
    "Default behavior creates an UNREVIEWED development import set and keeps corrected_title as a hint only.",
    "Use --trust-existing-ground-truth only when the source file already contains human-reviewed field labels."
  ].join("\n");
}

export async function main(argv = process.argv.slice(2), {
  now = () => new Date()
} = {}) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }

  const sourcePath = argValue(argv, "--source", defaultSource);
  const out = argValue(argv, "--out", defaultOut);
  const trustExistingGroundTruth = hasFlag(argv, "--trust-existing-ground-truth");
  const source = await readJson(sourcePath, "fixed regression set");
  const dataset = buildReviewedGroundTruthDevSet(source, {
    now,
    trustExistingGroundTruth
  });
  await writeJson(out, dataset);
  return dataset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((dataset) => {
    if (dataset) {
      console.error(`Reviewed GT development items: ${dataset.summary.item_count}`);
      console.error(`Confirmed reviewed fields: ${dataset.summary.reviewed_field_count}`);
      console.error("corrected_title remains annotation_hint_only.");
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
