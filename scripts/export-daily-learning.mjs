#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { writeDailyLearningExport } from "../lib/listing/learning/daily-learning-export.mjs";
import { loadSupabaseDailyLearningBundle } from "../lib/listing/learning/supabase-daily-learning-source.mjs";

function argumentValue(argv, name, fallback = "") {
  const equalsValue = argv.find((value) => value.startsWith(`${name}=`));
  if (equalsValue) return equalsValue.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/export-daily-learning.mjs --input bundle.json [--out learning] [--date YYYY-MM-DD]",
    "  node scripts/export-daily-learning.mjs --supabase [--out learning] [--date YYYY-MM-DD]",
    "",
    "Input JSON:",
    "  { feedback_events: [], learning_events: [], sem_validation_events?: [], images_by_asset?: {}, writer_verified_titles?: [] }",
    "",
    "The export contains no signed image URLs, embedded image bytes, credentials, or training-ready labels.",
    "Writer-verified titles are Golden Title truth; parser-produced SEM remains OBSERVE_ONLY."
  ].join("\n");
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const inputArg = argumentValue(argv, "--input");
const fromSupabase = argv.includes("--supabase");
if ((!inputArg && !fromSupabase) || (inputArg && fromSupabase)) {
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}

const inputPath = resolve(inputArg);
const outRoot = resolve(argumentValue(argv, "--out", "learning"));
const date = argumentValue(argv, "--date", new Date().toISOString().slice(0, 10));

let bundle;
if (fromSupabase) {
  try {
    bundle = await loadSupabaseDailyLearningBundle({ date });
  } catch (error) {
    process.stderr.write(`daily_learning_export_input_error:${error.message}\n`);
    process.exit(1);
  }
} else {
  try {
    bundle = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    process.stderr.write(`daily_learning_export_input_error:${error.message}\n`);
    process.exit(1);
  }
}

try {
  const result = await writeDailyLearningExport({ bundle, outRoot, date });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    export_date: result.manifest.export_date,
    destination: result.destination,
    manifest_path: result.manifest_path,
    counts: result.manifest.counts,
    dataset_disposition: result.manifest.dataset_disposition
  })}\n`);
} catch (error) {
  process.stderr.write(`daily_learning_export_failed:${error.message}\n`);
  process.exit(1);
}
