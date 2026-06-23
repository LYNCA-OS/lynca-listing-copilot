import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildHeldOutCommercialItems,
  mergeHeldOutCommercialItems,
  normalizeCommercialHeldoutRows
} from "../lib/listing/evaluation/commercial-heldout-builder.mjs";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printUsage() {
  console.error([
    "Usage:",
    "  npm run commercial:heldout -- --source <reviews-export.json> --out <dataset-out.json> [--dataset data/golden-dataset.json] [--replace]",
    "",
    "Options:",
    "  --source                         JSON export containing approved review rows.",
    "  --dataset                        Base golden dataset path. Defaults to data/golden-dataset.json.",
    "  --out                            Output dataset path. Required; use an explicit path to avoid accidental overwrite.",
    "  --replace                        Replace the existing held_out_commercial split instead of appending.",
    "  --allow-rejections               Continue when some rows/items are rejected.",
    "  --allow-derived-title-flags      Derive title quality booleans when explicit reviewer flags are absent.",
    "  --require-gate-pass              Exit non-zero unless the commercial acceptance gate passes."
  ].join("\n"));
}

async function readJsonFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }

  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function printReasons(prefix, rows = []) {
  rows.slice(0, 20).forEach((row) => {
    const id = row.asset_id ? ` asset_id:${row.asset_id}` : "";
    const reason = row.reason || arrayText(row.reasons);
    console.log(`${prefix}: index:${row.index ?? "n/a"}${id} ${reason}`);
  });

  if (rows.length > 20) {
    console.log(`${prefix}: ... ${rows.length - 20} more`);
  }
}

function arrayText(value) {
  return Array.isArray(value) ? value.join("; ") : String(value || "n/a");
}

function gateSummary(gate = {}) {
  return [
    `eligible:${gate.eligible === true}`,
    `passed:${gate.passed === true}`,
    `minimum_held_out_assets:${gate.minimum_held_out_assets ?? "n/a"}`
  ].join(" ");
}

const sourceArg = argValue("--source", process.env.COMMERCIAL_HELDOUT_SOURCE || "");
const datasetArg = argValue("--dataset", process.env.GOLDEN_DATASET_PATH || "data/golden-dataset.json");
const outArg = argValue("--out", process.env.COMMERCIAL_HELDOUT_OUT || "");
const allowRejections = hasFlag("--allow-rejections");
const requireGatePass = hasFlag("--require-gate-pass");

if (!sourceArg || !outArg || hasFlag("--help") || hasFlag("-h")) {
  printUsage();
  process.exit(sourceArg && outArg ? 0 : 1);
}

const sourcePath = resolve(sourceArg);
const datasetPath = resolve(datasetArg);
const outPath = resolve(outArg);

try {
  const [source, dataset] = await Promise.all([
    readJsonFile(sourcePath, "Commercial held-out source"),
    readJsonFile(datasetPath, "Golden dataset")
  ]);
  const sourceRows = normalizeCommercialHeldoutRows(source);
  const buildResult = buildHeldOutCommercialItems(sourceRows, {
    allowDerivedTitleFlags: hasFlag("--allow-derived-title-flags")
  });

  const mergeResult = mergeHeldOutCommercialItems(dataset, buildResult.items, {
    replace: hasFlag("--replace")
  });
  const rejectedRows = buildResult.rejected_rows;
  const rejectedItems = mergeResult.rejected_items;

  console.log("Commercial held-out build complete");
  console.log(`source: ${sourcePath}`);
  console.log(`dataset: ${datasetPath}`);
  console.log(`out: ${outPath}`);
  console.log(`source_rows: ${sourceRows.length}`);
  console.log(`imported_items: ${buildResult.items.length}`);
  console.log(`rejected_rows: ${rejectedRows.length}`);
  console.log(`rejected_items: ${rejectedItems.length}`);
  console.log(`warnings: ${buildResult.warnings.length}`);

  printReasons("rejected_row", rejectedRows);
  printReasons("rejected_item", rejectedItems);
  buildResult.warnings.slice(0, 20).forEach((warning) => console.log(`warning: ${warning}`));

  if (!buildResult.items.length) {
    console.error("No held_out_commercial items were imported.");
    process.exit(1);
  }

  if ((rejectedRows.length || rejectedItems.length) && !allowRejections) {
    console.error("Rejected rows/items found. Re-run with --allow-rejections only after reviewing them.");
    process.exit(1);
  }

  if (!mergeResult.validation.ok) {
    console.error("Merged golden dataset validation failed:");
    mergeResult.validation.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  const report = mergeResult.evaluation;
  console.log(`held_out_commercial_assets: ${report.held_out_commercial_evidence.total_assets}`);
  console.log(`commercial_acceptance_gate: ${gateSummary(report.commercial_acceptance_gate)}`);
  console.log(`commercial_acceptance_reasons: ${report.commercial_acceptance_gate.reasons.length ? report.commercial_acceptance_gate.reasons.join("; ") : "none"}`);
  console.log(`held_out_ai_overall_exact_resolution_rate: ${report.held_out_commercial_evidence.commercial_metrics.ai_overall_exact_resolution_rate ?? "n/a"}`);
  console.log(`held_out_ai_complete_result_precision: ${report.held_out_commercial_evidence.commercial_metrics.ai_complete_result_precision ?? "n/a"}`);
  console.log(`held_out_accepted_critical_error_rate: ${report.held_out_commercial_evidence.commercial_metrics.accepted_critical_error_rate ?? "n/a"}`);

  if (requireGatePass && !report.commercial_acceptance_gate.passed) {
    console.error("Commercial acceptance gate did not pass.");
    process.exit(1);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(mergeResult.dataset, null, 2)}\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
