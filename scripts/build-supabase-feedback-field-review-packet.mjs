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
  "parallel",
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
  const publishability = publicationGate.field_publishability?.[field]
    || publicationGate.field_publication_states?.[field]
    || "";

  return {
    field,
    predicted_value: pickValue(predictedFields, field),
    resolved_value: pickValue(resolvedFields, field),
    requires_review: writerRequired.has(field),
    publishability,
    reviewed_value: field === "players" ? [] : "",
    reviewed_status: "UNREVIEWED",
    allowed_reviewed_statuses: ["UNREVIEWED", "CONFIRMED", "UNKNOWN", "NOT_APPLICABLE"],
    review_label_type: "",
    allowed_review_label_types: ["FACT_CORRECTION", "TITLE_STYLE_CHANGE", "CONFIRMED_FACT", "NOT_APPLICABLE"],
    evidence_sources: [],
    allowed_evidence_sources: ["CARD_FRONT", "CARD_BACK", "SLAB", "OFFICIAL_CHECKLIST", "OPERATOR_KNOWLEDGE", "APPROVED_MEMORY", "REGISTRY"],
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
      can_be_used_as_title_ground_truth: Boolean(result.corrected_title_reference),
      can_be_used_as_field_ground_truth: false,
      use_as: "writer_reviewed_title_ground_truth_and_field_review_hint"
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
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_reference_only: false,
      field_ground_truth_available: false
    },
    instructions: {
      purpose: "Create field-level reviewed labels for the fixed Supabase feedback development set.",
      corrected_title_rule: "corrected_title_hint is writer-reviewed title ground truth. Title-derived field suggestions still require image/card/official evidence before becoming field-level ground truth.",
      required_distinction: "Use FACT_CORRECTION when a card fact changes; use TITLE_STYLE_CHANGE when only wording/order/style changes.",
      minimum_fields: ["year", "product", "players", "card_type", "parallel", "surface_color", "parallel_family", "parallel_exact", "serial_number", "collector_number", "checklist_code", "grade_company", "card_grade", "auto_grade", "grade_type"],
      reviewed_statuses: {
        CONFIRMED: "Reviewer verified the field from image or trusted source.",
        UNKNOWN: "Reviewer cannot verify the field.",
        NOT_APPLICABLE: "Field does not apply to this card."
      },
      import_contract: {
        task_key: "task_id",
        field_path: "tasks[].fields.<field>",
        reviewed_value: "Use scalar strings, booleans, or players[] arrays matching the field type.",
        reviewed_status: "CONFIRMED, UNKNOWN, or NOT_APPLICABLE required before import.",
        evidence_sources: "At least one trusted source is required for CONFIRMED factual labels.",
        corrected_title_hint: "Reviewed title ground truth; never imported as field-level ground truth by itself."
      }
    },
    summary: {
      task_count: tasks.length,
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_used_as_ground_truth: false,
      corrected_title_used_as_field_ground_truth: false,
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
    "The packet exports corrected_title as reviewed title ground truth and a field-review hint. Field reviewed_value cells start empty."
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
