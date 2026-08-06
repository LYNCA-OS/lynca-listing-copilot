#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = resolve(arg("--root", "artifacts/candidate-expression-v4/concurrency-screen-20-2026-08-01"));
const output = resolve(arg("--out", join(root, "report.json")));
const percentile = (values, fraction) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : null;
};
const readRows = async (path) => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(JSON.parse);

const levels = [];
for (const name of (await readdir(root)).filter((entry) => /^c\d+$/.test(entry)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
  const concurrency = Number(name.slice(1));
  const dir = join(root, name);
  const checkpointPath = join(dir, "thin-path-gpt-5.6-luna.jsonl");
  const attemptsPath = join(dir, "thin-path-gpt-5.6-luna.attempts.jsonl");
  const rows = await readRows(checkpointPath);
  const attempts = await readRows(attemptsPath);
  const latencies = rows.map((row) => Number(row.latency_ms));
  const failures = attempts.filter((attempt) => {
    if (attempt.outcome === "provider_success") return false;
    if (attempt.event === "final_status" && attempt.status === "checkpoint_committed") return false;
    return true;
  });
  const retryRows = rows.filter((row) => Number(row.request_attempt_count) > 1);
  const startedAt = rows.map((row) => Date.parse(row.started_at)).filter(Number.isFinite);
  const completedAt = rows.map((row) => Date.parse(row.completed_at)).filter(Number.isFinite);
  const wallMs = startedAt.length && completedAt.length ? Math.max(...completedAt) - Math.min(...startedAt) : null;
  levels.push({
    concurrency,
    requested_cards: 20,
    completed_cards: rows.length,
    failed_cards: Math.max(0, 20 - rows.length),
    attempt_records: attempts.length,
    retry_rows: retryRows.length,
    retryable_or_failed_attempts: failures.length,
    throughput_cards_per_minute: wallMs && rows.length ? rows.length * 60_000 / wallMs : null,
    wall_ms: wallMs,
    latency_p50_ms: percentile(latencies, 0.50),
    latency_p95_ms: percentile(latencies, 0.95),
    latency_p99_ms: percentile(latencies, 0.99),
    latency_max_ms: percentile(latencies, 1),
    candidate_defect_cards: rows.filter((row) => (row.candidate_defects || []).length).length,
    out_dir: dir
  });
}
if (levels.length !== 4 || levels.some((level) => ![2, 4, 6, 8].includes(level.concurrency))) {
  throw new Error("expected_c2_c4_c6_c8_levels");
}

const stable = levels.filter((level) => level.completed_cards === 20 && level.retryable_or_failed_attempts === 0);
const latencyBudgetMs = 15_000;
const withinLatency = stable.filter((level) => level.latency_p95_ms !== null && level.latency_p95_ms <= latencyBudgetMs);
const eligible = withinLatency.length ? withinLatency : stable;
const selected = eligible.slice().sort((left, right) =>
  (right.throughput_cards_per_minute ?? -Infinity) - (left.throughput_cards_per_minute ?? -Infinity)
  || (left.latency_p95_ms ?? Infinity) - (right.latency_p95_ms ?? Infinity)
)[0] || null;

const result = {
  schema_version: "candidate-expression-v4-concurrency-screen-v1",
  authority: "evaluation_only",
  source: { root, cards_per_level: 20, levels: [2, 4, 6, 8] },
  latency_budget_ms: latencyBudgetMs,
  selection_rule: "zero_failure_and_zero_retry_then_max_throughput_within_latency_budget; latency_tiebreak",
  selected_concurrency: selected?.concurrency ?? null,
  selected_reason: selected ? (withinLatency.length ? "LOW_LATENCY_STABLE_THROUGHPUT" : "NO_LEVEL_WITHIN_LATENCY_BUDGET_STABLE_MAX_THROUGHPUT") : "NO_STABLE_LEVEL",
  levels
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ selected_concurrency: result.selected_concurrency, selected_reason: result.selected_reason, levels: result.levels, out: output }, null, 2));
