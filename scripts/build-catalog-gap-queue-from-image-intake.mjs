import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatasetPath = "data/eval/ebay-reference/ebay-image-intake-dataset.json";
const defaultOutPath = "data/eval/ebay-reference/catalog-gap-queue-from-image-intake.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function imageEvidenceRefs(item = {}) {
  return (Array.isArray(item.images) ? item.images : []).map((image) => ({
    image_id: image.image_id || "",
    role: image.role || "",
    capture_angle: image.capture_angle || "",
    content_sha256: image.content_sha256 || "",
    bucket: image.bucket || "",
    object_path: image.object_path || "",
    local_path: image.local_path || "",
    storage_verified: image.storage_verified === true
  }));
}

function sealedEvalLabelRef(item = {}) {
  const ref = item.sealed_eval_label_ref && typeof item.sealed_eval_label_ref === "object"
    ? item.sealed_eval_label_ref
    : {};
  return {
    path: ref.path || "",
    key: ref.key || ref.label_key || ""
  };
}

function queryImageIds(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .map((image) => image.image_id || image.object_path || image.local_path || "")
    .filter(Boolean);
}

function gapRowForItem(item = {}, index = 0) {
  const labelRef = sealedEvalLabelRef(item);
  return {
    client_gap_key: `image_intake_gap_${normalizeText(item.asset_id || item.source_feedback_id || index)}`,
    source_feedback_id: null,
    asset_id: item.asset_id || "",
    physical_card_id: item.physical_card_id || "",
    proposed_identity_fields: {},
    proposed_instance_fields: {},
    gap_reason: "new_identity",
    status: "open",
    source_batch: item.source_manifest || "ebay_cold_start",
    image_ids: queryImageIds(item),
    query_image_ids: queryImageIds(item),
    ai_draft_title: "",
    observed_fields: {},
    internal_candidates: [],
    official_candidates: [],
    external_candidates: [],
    unresolved_fields: [],
    high_risk_fields: [],
    external_retrieval_hints: [],
    marketplace_hints: [],
    reason: "NO_APPROVED_CATALOG_MATCH",
    cold_start_status: "CATALOG_GAP_REQUIRED",
    writer_action_required: true,
    writer_final_title: null,
    writer_confirmed_fields: null,
    selected_candidate_id: null,
    rejected_candidate_ids: [],
    field_diff: [],
    review_time_ms: null,
    promoted_catalog_identity_id: null,
    promotion_status: "pending",
    training_eligible: false,
    requires_writer_review: true,
    sealed_eval_label_ref: labelRef,
    metadata: {
      source_provider: item.source_provider || item.source_record?.source_provider || "",
      source_manifest: item.source_manifest || "",
      category: item.category || "",
      source_listing_key_hash: item.source_record?.source_listing_key_hash || "",
      seller_title_visible_to_model: false,
      seller_title_used_for_catalog_import: false,
      ebay_answer_key_is_reviewed_ground_truth: false,
      title_derived_fields_are_ground_truth: false,
      image_evidence_refs: imageEvidenceRefs(item)
    }
  };
}

async function writeJson(path, value) {
  const resolvedOut = resolve(path);
  if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, `${JSON.stringify(value, null, 2)}\n`);
}

export async function buildCatalogGapQueueFromImageIntake({
  argv = process.argv.slice(2),
  env = process.env,
  now = new Date()
} = {}) {
  const datasetPath = argValue(argv, "--dataset", env.CATALOG_GAP_IMAGE_INTAKE_DATASET || defaultDatasetPath);
  const outPath = argValue(argv, "--out", env.CATALOG_GAP_IMAGE_INTAKE_OUT || defaultOutPath);
  const limit = numberArg(argv, "--limit", Number(env.CATALOG_GAP_IMAGE_INTAKE_LIMIT || 0));
  const dataset = JSON.parse(await readFile(resolve(datasetPath), "utf8"));
  const sourceItems = Array.isArray(dataset.items) ? dataset.items : [];
  const items = sourceItems.slice(0, limit > 0 ? limit : sourceItems.length);
  const rows = items.map(gapRowForItem);
  const report = {
    schema_version: "catalog-gap-queue-image-intake-v1",
    generated_at: now.toISOString(),
    dataset_path: datasetPath,
    source_schema_version: dataset.schema_version || "",
    row_count: rows.length,
    policy: {
      seller_titles_are_ground_truth: false,
      seller_titles_enter_catalog: false,
      sealed_labels_are_eval_only: true,
      promotion_requires_writer_review: true
    },
    rows
  };
  await writeJson(outPath, report);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildCatalogGapQueueFromImageIntake().then((report) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schema_version: report.schema_version,
      row_count: report.row_count,
      seller_titles_enter_catalog: report.policy.seller_titles_enter_catalog
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
