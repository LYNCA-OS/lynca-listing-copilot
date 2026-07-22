#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loginSessionToCloud } from "../lib/listing/evaluation/blind-eval.mjs";
import { materializeLaunchGateImages } from "./materialize-launch-gate-images.mjs";

function cleanText(value) {
  return String(value || "").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const inputPath = resolve(argValue(argv, "--input"));
  const outputPath = resolve(argValue(argv, "--out"));
  const outputDirectory = resolve(argValue(argv, "--local-dir"));
  if (!cleanText(inputPath) || !cleanText(outputPath) || !cleanText(outputDirectory)) {
    throw new Error("--input, --out, and --local-dir are required");
  }
  if (existsSync(outputPath) && !hasFlag(argv, "--fresh")) {
    process.stdout.write(`${JSON.stringify({ output: outputPath, reused: true }, null, 2)}\n`);
    return;
  }
  const baseUrl = cleanText(argValue(argv, "--base-url", env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, "");
  const login = await loginSessionToCloud({
    baseUrl,
    username: cleanText(env.METAVERSE_USERNAME),
    password: cleanText(env.METAVERSE_PASSWORD),
    bypassSecret: cleanText(env.VERCEL_AUTOMATION_BYPASS_SECRET)
  });
  const dataset = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await materializeLaunchGateImages({
    dataset,
    outputDirectory,
    baseUrl,
    cookie: login.cookie,
    concurrency: 8,
    launchGateEvalSecret: cleanText(env.LAUNCH_GATE_EVAL_SECRET)
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.dataset, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: outputPath, reused: false, ...result.summary }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
