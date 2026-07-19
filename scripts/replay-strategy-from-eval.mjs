#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildStrategyReplayPacket,
  evaluateStrategyTraceReplay,
  replayCurrentProductionStrategy
} from "../lib/listing/v4/policy/strategy-trace-replay.mjs";

function argValues(argv, name) {
  const values = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
    else if (value.startsWith(`${name}=`)) values.push(value.slice(name.length + 1));
  });
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

async function writeJson(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function strategyFromModule(path) {
  if (!path) return replayCurrentProductionStrategy;
  const module = await import(pathToFileURL(resolve(path)).href);
  if (typeof module.replayStrategyDecision !== "function") {
    throw new Error("--strategy-module must export replayStrategyDecision(decisionInput)");
  }
  return module.replayStrategyDecision;
}

export async function replayStrategyFromEval({
  inputPath,
  strategyModulePath = "",
  outputPath = "",
  packetOutputPath = "",
  passThreshold = 0.72,
  requiredPassCaseIds = []
} = {}) {
  if (!inputPath) throw new Error("inputPath is required");
  const resolvedInput = resolve(inputPath);
  const report = JSON.parse(await readFile(resolvedInput, "utf8"));
  const packet = buildStrategyReplayPacket(report, { source: resolvedInput });
  const replayStrategyDecision = await strategyFromModule(strategyModulePath);
  const gate = await evaluateStrategyTraceReplay({
    packet,
    replayStrategyDecision,
    passThreshold,
    requiredPassCaseIds
  });
  if (packetOutputPath) await writeJson(packetOutputPath, packet);
  if (outputPath) await writeJson(outputPath, gate);
  return { packet, gate };
}

function renderSummary(gate) {
  const lines = [
    `strategy replay gate: ${gate.promotion_eligible ? "PASS" : "BLOCK"}`,
    `sample: ${gate.sample.card_count}/${gate.sample.expected_card_count} fingerprint=${gate.sample.fingerprint_sha256}`,
    `baseline: avg=${gate.baseline.policy_fair_average} pass=${gate.baseline.pass_count}`,
    `replay: avg=${gate.replay.policy_fair_average} pass=${gate.replay.pass_count} up=${gate.replay.improved_count} down=${gate.replay.regressed_count}`,
    `unrecorded external effects: ${gate.replay.unrecorded_external_effect_count}`,
    `blockers: ${gate.blockers.length ? gate.blockers.join(", ") : "none"}`
  ];
  for (const row of gate.rows.filter((item) => item.blockers.length || Number(item.delta) !== 0)) {
    lines.push(
      `${row.blockers.length ? "BLOCK" : Number(row.delta) > 0 ? "UP" : "DOWN"} ${row.case_id} ${row.baseline_policy_fair_recall} -> ${row.replay_policy_fair_recall}`
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) {
    process.stderr.write(
      "Usage: node scripts/replay-strategy-from-eval.mjs --input <report.json> [--strategy-module <module.mjs>] [--require-pass <case-id>] [--out <gate.json>]\n"
    );
    return 2;
  }
  const passThreshold = Number(argValue(argv, "--threshold", "0.72"));
  if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 1) {
    throw new Error("--threshold must be a number between 0 and 1");
  }
  const { gate } = await replayStrategyFromEval({
    inputPath,
    strategyModulePath: argValue(argv, "--strategy-module"),
    outputPath: argValue(argv, "--out"),
    packetOutputPath: argValue(argv, "--packet-out"),
    passThreshold,
    requiredPassCaseIds: argValues(argv, "--require-pass")
  });
  process.stdout.write(renderSummary(gate));
  return gate.promotion_eligible ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  });
}
