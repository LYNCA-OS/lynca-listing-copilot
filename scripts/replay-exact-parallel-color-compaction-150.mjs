#!/usr/bin/env node

// Provider-free paired replay through the same `finishCanonicalTitle` runtime
// entrypoint Production uses. The frozen provider bytes are parsed twice: once
// with the feature disabled and once with the default Composer.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

const DEFAULT_INPUT = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_JSON = "docs/evaluation/exact-parallel-color-compaction-runtime-150-2026-08-08.json";
const DEFAULT_MD = "docs/evaluation/exact-parallel-color-compaction-runtime-150-2026-08-08.md";
const EXPECTED = Object.freeze({
  input_sha256: "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5",
  arm: "thin_canonical_high",
  cards: 150,
  run_fingerprint: "ee0d30c2a3af46339b9392b9bc5eddb9241d1a761e8b7ef2ba48a6bb3e68e0e3"
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const numericClaims = (value) => new Set(clean(value).match(/\d+(?:[./-]\d+)*/g) || []);
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten)
  : value && typeof value === "object" ? Object.values(value).flatMap(flatten)
    : [String(value ?? "")];

function score(reference, title) {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

export function analyzeExactParallelColorCompaction150(rows) {
  const cohort = rows.filter((row) => row.arm === EXPECTED.arm);
  if (cohort.length !== EXPECTED.cards || new Set(cohort.map((row) => row.asset_id)).size !== EXPECTED.cards) {
    throw new Error(`exact_parallel_runtime_cohort_mismatch:${cohort.length}`);
  }
  if (cohort.some((row) => row.run_fingerprint !== EXPECTED.run_fingerprint
    || !row.raw_title || !row.reference || !row.image_set_sha256)) {
    throw new Error("exact_parallel_runtime_binding_mismatch");
  }

  const cards = cohort.map((row) => {
    const baseline = finishCanonicalTitle(row.raw_title, {
      exactParallelColorCompaction: false
    });
    const candidate = finishCanonicalTitle(row.raw_title);
    const baselineScore = score(row.reference, baseline.title);
    const candidateScore = score(row.reference, candidate.title);
    const delta = candidateScore.f1 - baselineScore.f1;
    const baselineTokens = tokens(baseline.title);
    const candidateTokens = tokens(candidate.title);
    const referenceTokens = tokens(row.reference);
    const evidenceTokens = tokens(flatten(candidate.fields).join(" "));
    const titleLosses = difference(baselineTokens, candidateTokens);
    const addedTokens = difference(candidateTokens, baselineTokens);
    const baselineNumbers = numericClaims(baseline.title);
    const candidateNumbers = numericClaims(candidate.title);
    const newDrops = candidate.dropped_brackets.filter((name) => !baseline.dropped_brackets.includes(name));
    const fieldsByteIdentical = JSON.stringify(baseline.fields) === JSON.stringify(candidate.fields);

    return {
      asset_id: row.asset_id,
      outcome: delta > 1e-12 ? "WIN" : delta < -1e-12 ? "LOSS" : "TIE",
      delta_f1: delta,
      baseline_title: baseline.title,
      candidate_title: candidate.title,
      baseline_dropped: baseline.dropped_brackets,
      candidate_dropped: candidate.dropped_brackets,
      safety: {
        fields_byte_identical: fieldsByteIdentical,
        new_drops: newDrops,
        truncated: candidate.truncated,
        over_80: candidate.length > 80,
        lost_reference_tokens: titleLosses.filter((token) => referenceTokens.has(token)),
        unbacked_new_tokens: addedTokens.filter((token) => !evidenceTokens.has(token)),
        numeric_mutation: difference(baselineNumbers, candidateNumbers).length > 0
          || difference(candidateNumbers, baselineNumbers).length > 0
      }
    };
  });

  const changed = cards.filter((row) => row.baseline_title !== row.candidate_title);
  const result = {
    schema_version: "exact-parallel-color-compaction-runtime-replay-v1",
    authority: "evaluation_only",
    runtime_entrypoint: "finishCanonicalTitle",
    mechanism: "exact_parallel_color_compaction",
    provider_calls: 0,
    population: cards.length,
    baseline: { macro_f1: mean(cohort.map((row, index) => score(row.reference, cards[index].baseline_title).f1)) },
    candidate: { macro_f1: mean(cohort.map((row, index) => score(row.reference, cards[index].candidate_title).f1)) },
    paired: {
      wins: cards.filter((row) => row.outcome === "WIN").length,
      losses: cards.filter((row) => row.outcome === "LOSS").length,
      ties: cards.filter((row) => row.outcome === "TIE").length,
      changed_cards: changed.length
    },
    safety: {
      field_byte_change_cards: cards.filter((row) => !row.safety.fields_byte_identical).length,
      new_drop_cards: cards.filter((row) => row.safety.new_drops.length).length,
      truncated_cards: cards.filter((row) => row.safety.truncated).length,
      over_80_cards: cards.filter((row) => row.safety.over_80).length,
      lost_reference_token_cards: cards.filter((row) => row.safety.lost_reference_tokens.length).length,
      unbacked_new_token_cards: cards.filter((row) => row.safety.unbacked_new_tokens.length).length,
      numeric_mutation_cards: cards.filter((row) => row.safety.numeric_mutation).length
    },
    changed_cards: changed
  };
  result.paired.delta_macro_f1 = result.candidate.macro_f1 - result.baseline.macro_f1;
  return result;
}

export function reportMarkdown(report) {
  const changed = report.changed_cards.map((row) =>
    `| \`${row.asset_id}\` | ${row.outcome} | ${row.delta_f1.toFixed(6)} | ${row.baseline_title} | ${row.candidate_title} |`
  ).join("\n") || "| none | — | — | — | — |";
  return `# Exact parallel color compaction — Production runtime 150 replay\n\n`
    + `## Decision evidence\n\n`
    + `This is a zero-call paired replay through \`${report.runtime_entrypoint}\`, the same parser and Composer entrypoint used by Production. The reference label is used only after both titles exist, for scoring. Canonical field bytes are compared between the two runtime arms.\n\n`
    + `- Population: ${report.population}\n`
    + `- Input SHA-256: \`${report.input.sha256}\`\n`
    + `- Provider calls: ${report.provider_calls}\n`
    + `- Macro F1: ${report.baseline.macro_f1.toFixed(6)} -> ${report.candidate.macro_f1.toFixed(6)} (${report.paired.delta_macro_f1 >= 0 ? "+" : ""}${report.paired.delta_macro_f1.toFixed(6)})\n`
    + `- Wins / losses / ties: ${report.paired.wins} / ${report.paired.losses} / ${report.paired.ties}\n`
    + `- Changed cards: ${report.paired.changed_cards}\n\n`
    + `## Safety\n\n`
    + `| Field-byte changes | New drop cards | Truncated | Over 80 | Lost reference token | Unbacked new token | Numeric mutation |\n`
    + `|---:|---:|---:|---:|---:|---:|---:|\n`
    + `| ${report.safety.field_byte_change_cards} | ${report.safety.new_drop_cards} | ${report.safety.truncated_cards} | ${report.safety.over_80_cards} | ${report.safety.lost_reference_token_cards} | ${report.safety.unbacked_new_token_cards} | ${report.safety.numeric_mutation_cards} |\n\n`
    + `## Changed cards\n\n`
    + `| Asset | Outcome | Delta F1 | Baseline | Candidate |\n|---|---|---:|---|---|\n${changed}\n`;
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const input = arg("--input", DEFAULT_INPUT);
  const outputJson = arg("--json", DEFAULT_JSON);
  const outputMd = arg("--md", DEFAULT_MD);
  const body = readFileSync(input);
  const inputSha = sha256(body);
  if (inputSha !== EXPECTED.input_sha256) throw new Error(`exact_parallel_runtime_input_sha_mismatch:${inputSha}`);
  const rows = body.toString("utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
  const report = analyzeExactParallelColorCompaction150(rows);
  report.input = { path: input, sha256: inputSha, selected_arm: EXPECTED.arm };
  const unsafe = Object.values(report.safety).some((value) => value !== 0);
  if (report.paired.losses || unsafe) throw new Error("exact_parallel_runtime_promotion_gate_failed");
  mkdirSync(dirname(outputJson), { recursive: true });
  mkdirSync(dirname(outputMd), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outputMd, reportMarkdown(report));
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
