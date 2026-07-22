#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGoldenSemReviewWorklist,
  planGoldenSemReviewSplits
} from "../lib/listing/evaluation/golden-sem-release.mjs";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const inputArg = argValue(argv, "--input");
  if (!inputArg) throw new Error("--input is required");
  const input = resolve(inputArg);
  const outputDir = resolve(argValue(argv, "--output-dir", "data/eval/v4-chain-oracle"));
  const packet = JSON.parse(await readFile(input, "utf8"));
  const worklist = buildGoldenSemReviewWorklist(packet);
  const splitPlan = planGoldenSemReviewSplits(packet, { minimumHoldout: 45 });
  await Promise.all([
    writeJson(resolve(outputDir, "field-review-worklist.json"), worklist),
    writeJson(resolve(outputDir, "sealed-split-plan.json"), splitPlan)
  ]);
  console.log(JSON.stringify({ worklist: worklist.summary, split_plan: splitPlan.actual_counts }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
