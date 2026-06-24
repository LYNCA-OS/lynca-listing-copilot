import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "supabase-feedback-field-review-packet-v1";
const defaultInput = "data/eval/provider-regression-30/cascade-fast-246ad3b-rerun-30.json";
const defaultOut = "data/recognition/review/supabase-feedback-regression-30-field-review-packet.json";

const reviewFields = Object.freeze([
  "year",
  "manufacturer",
  "brand",
  "product",
  "set",
  "players",
  "card_type",
  "insert",
  "surface_color",
  "parallel_family",
  "parallel_exact",
  "serial_number",
  "collector_number",
  "checklist_code",
  "grade_company",
  "card_grade",
  "auto_grade",
  "grade_type",
  "rc",
  "first_bowman",
  "auto",
  "patch",
  "relic",
  "one_of_one",
  "multi_card",
  "card_count"
]);

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

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function pickValue(fields = {}, field) {
  if (field === "players") return normalizeArray(fields.players || fields.player);
  if (field === "serial_number") return normalizeText(fields.serial_number);
  if (field === "collector_number") return normalizeText(fields.collector_number || fields.card_number);
  if (field === "card_grade") return normalizeText(fields.card_grade || fields.grade);
  const value = fields[field];
  if (Array.isArray(value)) return normalizeArray(value);
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  return normalizeText(value);
}

function blankReviewField(result = {}, field) {
  const prediction = result.prediction || {};
  const predictedFields = prediction.fields || {};
  const resolvedFields = result.resolved || result.prediction?.resolved || {};
  const publicationGate = result.publication_gate || prediction.publication_gate || {};
  const writerRequired = new Set(Array.isArray(publicationGate.writer_required_fields)
    ? publicationGate.writer_required_fields
    : []);

  return {
    field,
    predicted_value: pickValue(predictedFields, field),
    resolved_value: pickValue(resolvedFields, field),
    requires_review: writerRequired.has(field),
    reviewed_value: field === "players" ? [] : "",
    reviewed_status: "UNREVIEWED",
    review_label_type: "",
    allowed_review_label_types: ["FACT_CORRECTION", "TITLE_STYLE_CHANGE", "CONFIRMED_FACT", "NOT_APPLICABLE"],
    evidence_sources: [],
    reviewer_notes: ""
  };
}

function reviewTask(result = {}, index = 0) {
  return {
    task_id: result.candidate_id || result.asset_id || `task-${index + 1}`,
    candidate_id: result.candidate_id || null,
    asset_id: result.asset_id || null,
    source_feedback_id: result.source_feedback_id || null,
    priority: result.identity_resolution_status === "ABSTAIN" ? "P0" : "P1",
    review_status: "UNREVIEWED",
    corrected_title_hint: result.corrected_title_reference || "",
    corrected_title_hint_policy: {
      can_be_used_as_ground_truth: false,
      use_as: "review_hint_only"
    },
    generated_title: result.prediction?.title || "",
    identity_resolution_status: result.identity_resolution_status || result.prediction?.identity_resolution_status || "",
    abstain_reason_codes: result.identity_resolution_summary?.abstain_reason_codes || [],
    primary_root_cause_code: result.primary_root_cause_code || "",
    secondary_root_cause_codes: result.secondary_root_cause_codes || result.root_cause_codes || [],
    publication_gate: result.publication_gate || result.prediction?.publication_gate || null,
    image_inputs: result.image_inputs || [],
    fields: Object.fromEntries(reviewFields.map((field) => [field, blankReviewField(result, field)])),
    card_level_review: {
      reviewed_identity_status: "",
      allowed_statuses: ["FACTS_CONFIRMED", "FACT_CORRECTION_REQUIRED", "TITLE_STYLE_ONLY", "NON_CARD_OR_BAD_CAPTURE"],
      fact_correction_required: null,
      title_style_change_only: null,
      reviewer_notes: ""
    }
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

export function buildSupabaseFeedbackFieldReviewPacket(report = {}, {
  limit = 0,
  now = () => new Date()
} = {}) {
  const sourceResults = Array.isArray(report.results) ? report.results : [];
  const selected = limit > 0 ? sourceResults.slice(0, limit) : sourceResults;
  const tasks = selected.map(reviewTask);

  return {
    schema_version: schemaVersion,
    generated_at: now().toISOString(),
    source: {
      report_schema_version: report.schema_version || null,
      report_provider: report.provider || null,
      report_provider_display_name: report.provider_display_name || null,
      source_manifest_hash: report.source_manifest_hash || null,
      source_table: report.source_table || null,
      corrected_title_reference_only: report.corrected_title_reference_only === true,
      field_ground_truth_available: false
    },
    instructions: {
      purpose: "Create field-level reviewed labels for the fixed Supabase feedback development set.",
      corrected_title_rule: "corrected_title_hint is a review hint only and must not be copied as ground truth without visual or trusted-source evidence.",
      required_distinction: "Use FACT_CORRECTION when a card fact changes; use TITLE_STYLE_CHANGE when only wording/order/style changes.",
      minimum_fields: ["year", "product", "players", "card_type", "parallel", "serial_number", "collector_number", "checklist_code", "grade_company", "card_grade", "auto_grade", "grade_type"]
    },
    summary: {
      task_count: tasks.length,
      corrected_title_used_as_ground_truth: false,
      field_ground_truth_available: false,
      review_fields: reviewFields
    },
    tasks
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-supabase-feedback-field-review-packet.mjs --input <eval-report.json> --out <review-packet.json> [--limit 30]",
    "",
    "The packet exports corrected_title only as a hint. Field reviewed_value cells start empty."
  ].join("\n");
}

export async function main(argv = process.argv.slice(2), {
  now = () => new Date()
} = {}) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }

  const input = argValue(argv, "--input", defaultInput);
  const out = argValue(argv, "--out", defaultOut);
  const limit = Number(argValue(argv, "--limit", "0"));
  const report = await readJson(input, "Supabase feedback eval report");
  const packet = buildSupabaseFeedbackFieldReviewPacket(report, {
    limit: Number.isFinite(limit) ? limit : 0,
    now
  });
  await writeJson(out, packet);
  return packet;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((packet) => {
    if (packet) {
      console.error(`Field review tasks: ${packet.summary.task_count}`);
      console.error("Corrected titles are hints only; reviewed_value fields remain empty.");
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
