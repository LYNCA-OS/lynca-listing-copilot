import { readFile, writeFile } from "node:fs/promises";
import {
  recognitionCandidatesFromSupabaseFeedbackRows
} from "../lib/listing/recognition/supabase-recognition-source.mjs";
import {
  recognitionDatasetStats,
  stableManifestHash,
  validateRecognitionDataset
} from "../lib/listing/recognition/recognition-dataset.mjs";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function firstJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

function parseJsonish(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.result)) return value.result;
    if (typeof value.result === "string") return parseJsonish(value.result);
  }
  if (typeof value !== "string") {
    throw new Error("Supabase SQL export must be a JSON array, { rows }, { data }, or MCP { result } payload.");
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    return parseJsonish(JSON.parse(trimmed));
  } catch {
    const fenced = trimmed.match(/<untrusted-data-[^>]+>\s*([\s\S]*?)\s*<\/untrusted-data-[^>]+>/);
    const candidate = fenced?.[1] || firstJsonArray(trimmed);
    if (!candidate) {
      throw new Error("Could not find a JSON row array in Supabase SQL export payload.");
    }
    return parseJsonish(JSON.parse(candidate));
  }
}

export function feedbackRowsFromSqlExportPayload(payload) {
  const rows = parseJsonish(payload);
  if (!Array.isArray(rows)) {
    throw new Error("Parsed Supabase SQL export payload did not produce a row array.");
  }
  return rows;
}

async function writeJson(writeFileImpl, filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (filePath) {
    await writeFileImpl(filePath, text);
  } else {
    process.stdout.write(text);
  }
}

export async function runExportSupabaseRecognitionCandidatesFromRows({
  argv = process.argv.slice(2),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  now = () => new Date()
} = {}) {
  const input = argValue(argv, "--input") || argValue(argv, "-i");
  const output = argValue(argv, "--output") || argValue(argv, "-o") || "data/recognition/manifests/supabase-feedback-candidates.json";
  const reportOutput = argValue(argv, "--report-output") || "";
  const table = argValue(argv, "--table", "listing_title_feedback");
  const projectUrl = argValue(argv, "--project-url", "https://osrrujmpxxiefppjfgpd.supabase.co");
  const dryRun = argv.includes("--dry-run");

  if (!input) {
    throw new Error("Missing --input Supabase SQL export JSON file.");
  }

  const raw = await readFileImpl(input, "utf8");
  const rows = feedbackRowsFromSqlExportPayload(raw);
  const items = recognitionCandidatesFromSupabaseFeedbackRows(rows);
  const validationErrors = validateRecognitionDataset(items);
  const frontCount = items.filter((item) => item.images.some((image) => image.role === "front_original")).length;
  const backCount = items.filter((item) => item.images.some((image) => image.role === "back_original")).length;
  const buckets = [...new Set(items.flatMap((item) => item.images.map((image) => image.bucket).filter(Boolean)))].sort();
  const generatedAt = now().toISOString();
  const payload = {
    schema_version: "recognition-candidate-export-v1",
    source: {
      provider: "supabase_sql_export",
      project_url: projectUrl,
      table,
      source_row_count: rows.length,
      image_backed_row_count: items.length,
      filtered_out_no_image_count: rows.length - items.length
    },
    generated_at: generatedAt,
    manifest_hash: stableManifestHash(items),
    summary: {
      item_count: items.length,
      front_image_items: frontCount,
      back_image_items: backCount,
      buckets,
      review_status: "NEEDS_REVIEW",
      corrected_title_is_reviewed_title_ground_truth: true,
      corrected_title_used_as_ground_truth: false,
      corrected_title_used_as_field_ground_truth: false,
      validation_error_count: validationErrors.length
    },
    items
  };

  if (!dryRun) {
    await writeJson(writeFileImpl, output, payload);
  }

  if (reportOutput && !dryRun) {
    await writeJson(writeFileImpl, reportOutput, {
      schema_version: "supabase-recognition-candidate-report-v1",
      generated_at: generatedAt,
      source: payload.source,
      summary: payload.summary,
      dataset_stats: recognitionDatasetStats(items),
      validation: {
        ok: validationErrors.length === 0,
        errors: validationErrors
      }
    });
  }

  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExportSupabaseRecognitionCandidatesFromRows().then((payload) => {
    console.error(`Exported ${payload.summary.item_count} Supabase SQL recognition candidates.`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
