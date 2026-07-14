#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { evaluateRow, metricRow } from "./compare-concurrency-sweep.mjs";

function argValue(argv, name, fallback = "") {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1) || fallback;
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

export function assessConcurrencySweepLevel(report = {}, concurrency = 0) {
  const row = metricRow(report, "", concurrency);
  const evaluated = evaluateRow(row, row);
  return {
    level: row.concurrency,
    stop: evaluated.stable !== true,
    stop_reasons: evaluated.rejection_reasons,
    warning_reasons: evaluated.warning_reasons,
    attempted_count: row.attempted_count,
    ok_count: row.ok_count,
    completed_cards_per_minute: row.completed_cards_per_minute,
    submission_concurrency: row.submission_concurrency,
    provider_concurrency: row.provider_concurrency,
    writer_ready_p95_ms: row.writer_ready_p95_ms,
    writer_visible_recognition_p95_ms: row.writer_visible_recognition_p95_ms,
    writer_visible_recognition_measurement_rate: row.writer_visible_recognition_measurement_rate,
    scheduler_queue_wait_p95_ms: row.scheduler_queue_wait_p95_ms
  };
}

export async function main(argv = process.argv) {
  const reportPath = argValue(argv, "--report", "");
  const concurrency = Number(argValue(argv, "--concurrency", "0"));
  if (!reportPath || !Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error("--report and a positive --concurrency are required");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const decision = assessConcurrencySweepLevel(report, concurrency);
  console.log(JSON.stringify(decision));
  return decision.stop ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Concurrency level assertion failed: ${error.message}`);
    process.exit(2);
  }
}
