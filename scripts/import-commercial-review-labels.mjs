import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reviewedRecognitionExportPayload,
  reviewPacketToRecognitionDataset
} from "../lib/listing/recognition/commercial-review-packet.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function readJsonFile(path, label) {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`${label} not found: ${resolvedPath}`);
  try {
    return JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function writeJson(path, payload) {
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/import-commercial-review-labels.mjs --input <review-packet.json> --out <reviewed-manifest.json> --report-output <report.json>",
    "",
    "Options:",
    "  --split <split>             Defaults to held_out_commercial.",
    "  --require-double-review     Require at least two reviewers for every imported item.",
    "  --allow-rejections          Continue when some tasks are rejected.",
    "",
    "Import requires reviewed_ground_truth, reviewed_by, critical_fields, and ground_truth_sources."
  ].join("\n");
}

export async function runImportCommercialReviewLabels({
  argv = process.argv.slice(2),
  now = () => new Date()
} = {}) {
  const input = argValue(argv, "--input") || argValue(argv, "-i");
  const out = argValue(argv, "--out") || argValue(argv, "-o");
  const reportOutput = argValue(argv, "--report-output") || "";
  const split = argValue(argv, "--split", "held_out_commercial");
  const requireDoubleReview = hasFlag(argv, "--require-double-review");
  const allowRejections = hasFlag(argv, "--allow-rejections");

  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, result: null };
  }
  if (!input || !out) {
    throw new Error("Missing --input or --out.\n\n" + usage());
  }

  const packet = await readJsonFile(input, "Commercial review packet");
  const result = reviewPacketToRecognitionDataset(packet, {
    split,
    requireDoubleReview
  });
  const generatedAt = now().toISOString();
  const manifest = reviewedRecognitionExportPayload({
    items: result.items,
    rejectedTasks: result.rejected_tasks,
    sourcePacket: packet,
    generatedAt
  });
  const report = {
    schema_version: "commercial-review-label-import-report-v1",
    generated_at: generatedAt,
    source: manifest.source,
    summary: manifest.summary,
    rejected_tasks: result.rejected_tasks,
    dataset_stats: result.dataset_stats,
    validation: result.validation
  };

  if (!result.items.length) {
    throw new Error("No reviewed commercial labels were imported.");
  }
  if (result.rejected_tasks.length && !allowRejections) {
    const first = result.rejected_tasks[0];
    throw new Error(`Rejected commercial review tasks found. First rejection asset_id=${first.asset_id || "n/a"} reasons=${first.reasons.join("; ")}`);
  }
  if (!result.validation.ok) {
    throw new Error(`Imported recognition dataset is invalid: ${result.validation.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }

  await writeJson(out, manifest);
  if (reportOutput) await writeJson(reportOutput, report);

  return {
    exitCode: 0,
    result,
    manifest,
    report
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImportCommercialReviewLabels().then(({ manifest }) => {
    if (manifest) {
      console.error(`Imported reviewed commercial items: ${manifest.summary.item_count}`);
      console.error(`Rejected tasks: ${manifest.summary.rejected_task_count}`);
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
