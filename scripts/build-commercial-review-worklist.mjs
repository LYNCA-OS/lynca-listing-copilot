import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commercialReviewWorklistToCsv,
  createCommercialReviewWorklist
} from "../lib/listing/recognition/commercial-review-worklist.mjs";

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

async function writeText(path, text) {
  if (!path) {
    process.stdout.write(text);
    return;
  }
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, text);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/build-commercial-review-worklist.mjs --input <review-packet.json> --out <worklist.json> [--csv-out <worklist.csv>] [--limit 100]",
    "",
    "The worklist is an operator queue only. It never turns corrected-title suggestions into ground truth."
  ].join("\n");
}

export async function runBuildCommercialReviewWorklist({
  argv = process.argv.slice(2),
  now = () => new Date()
} = {}) {
  const input = argValue(argv, "--input") || argValue(argv, "-i") || "data/recognition/review/supabase-commercial-review-packet.json";
  const out = argValue(argv, "--out") || argValue(argv, "-o") || "";
  const csvOut = argValue(argv, "--csv-out") || "";
  const limit = Number(argValue(argv, "--limit", "0"));

  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, worklist: null };
  }

  const packet = await readJsonFile(input, "Commercial review packet");
  const worklist = createCommercialReviewWorklist(packet, {
    now,
    limit: Number.isFinite(limit) ? limit : 0
  });

  await writeText(out, `${JSON.stringify(worklist, null, 2)}\n`);
  if (csvOut) await writeText(csvOut, commercialReviewWorklistToCsv(worklist));

  return {
    exitCode: 0,
    worklist
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuildCommercialReviewWorklist().then(({ worklist }) => {
    if (worklist) {
      console.error(`Commercial review worklist tasks: ${worklist.summary.task_count}`);
      console.error(`Priority bands: ${JSON.stringify(worklist.summary.priority_band_counts)}`);
      console.error("Worklist suggestions are operator hints only, not ground truth.");
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
