import { writeFile } from "node:fs/promises";
import {
  fetchSupabaseFeedbackRows,
  recognitionCandidatesFromSupabaseFeedbackRows
} from "../lib/listing/recognition/supabase-recognition-source.mjs";
import { recognitionDatasetStats, stableManifestHash, validateRecognitionDataset } from "../lib/listing/recognition/recognition-dataset.mjs";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function numberArg(args, name, fallback) {
  const value = Number(argValue(args, name, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function writeJson(filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (filePath) {
    await writeFile(filePath, text);
  } else {
    process.stdout.write(text);
  }
}

export async function runExportSupabaseRecognitionCandidates({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const output = argValue(argv, "--output") || argValue(argv, "-o") || "data/recognition/manifests/supabase-feedback-candidates.json";
  const reportOutput = argValue(argv, "--report-output") || "";
  const table = argValue(argv, "--table", env.SUPABASE_RECOGNITION_FEEDBACK_TABLE || "listing_title_feedback");
  const limit = numberArg(argv, "--limit", Number(env.SUPABASE_RECOGNITION_CANDIDATE_LIMIT) || 1000);
  const offset = numberArg(argv, "--offset", 0);
  const dryRun = argv.includes("--dry-run");

  const result = await fetchSupabaseFeedbackRows({
    env,
    fetchImpl,
    table,
    limit,
    offset
  });

  if (!result.ok) {
    throw new Error(`Supabase recognition candidate export failed: ${result.reason}${result.message ? ` ${result.message}` : ""}`);
  }

  const items = recognitionCandidatesFromSupabaseFeedbackRows(result.rows);
  const validationErrors = validateRecognitionDataset(items);
  const frontCount = items.filter((item) => item.images.some((image) => image.role === "front_original")).length;
  const backCount = items.filter((item) => item.images.some((image) => image.role === "back_original")).length;
  const buckets = [...new Set(items.flatMap((item) => item.images.map((image) => image.bucket).filter(Boolean)))].sort();
  const payload = {
    schema_version: "recognition-candidate-export-v1",
    source: {
      provider: "supabase",
      project_url: env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : null,
      table,
      offset,
      limit,
      source_row_count: result.rows.length
    },
    generated_at: new Date().toISOString(),
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
    await writeJson(output, payload);
  }

  if (reportOutput && !dryRun) {
    await writeJson(reportOutput, {
      schema_version: "supabase-recognition-candidate-report-v1",
      generated_at: payload.generated_at,
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
  runExportSupabaseRecognitionCandidates().then((payload) => {
    console.error(`Exported ${payload.summary.item_count} Supabase recognition candidates.`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
