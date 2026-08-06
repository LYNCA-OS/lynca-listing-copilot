#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { composeTypedParetoV1 } from "../experiments/accuracy/typed-pareto-composer-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};
const inputPath = resolve(arg("--input",
  "artifacts/accuracy-mechanism-confirmatory-2026-08-02/fresh-budgeted-canonical/thin-path-gpt-5.6-luna.jsonl"));
const outPath = resolve(arg("--out",
  "artifacts/typed-pareto-composer-v1/replay-150.json"));
const expected = Number(arg("--count", "150"));
if (expected !== 150) throw new Error("typed_pareto_replay_requires_complete_150");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const numbers = (value) => [...clean(value).matchAll(/\d+/g)].map((match) => String(Number(match[0])));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const signs = (values) => ({
  wins: values.filter((value) => value > 1e-12).length,
  losses: values.filter((value) => value < -1e-12).length,
  ties: values.filter((value) => Math.abs(value) <= 1e-12).length
});

const body = await readFile(inputPath);
const allRows = body.toString("utf8").split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
const rows = allRows.filter((row) => row.arm === "thin_canonical_high");
if (rows.length !== expected || new Set(rows.map((row) => row.asset_id)).size !== expected) {
  throw new Error(`typed_pareto_complete_150_mismatch:${rows.length}`);
}
if (rows.some((row) => !row.fields || !clean(row.reference))) {
  throw new Error("typed_pareto_input_missing_fields_or_label");
}

const cards = rows.map((row) => {
  const replay = composeTypedParetoV1(row.fields);
  if (replay.baseline.title !== row.title) {
    throw new Error(`typed_pareto_baseline_drift:${row.asset_id}`);
  }
  const baseline = score(row.reference, replay.baseline.title);
  const candidate = score(row.reference, replay.candidate.title);
  const baselineTokens = tokens(replay.baseline.title);
  const candidateTokens = tokens(replay.candidate.title);
  const referenceTokens = tokens(row.reference);
  const referenceLosses = [...baselineTokens].filter((token) => (
    referenceTokens.has(token) && !candidateTokens.has(token)
  ));
  const subjectTokens = tokens((row.fields.subjects || []).join(" "));
  const subjectLosses = [...subjectTokens].filter((token) => (
    baselineTokens.has(token) && !candidateTokens.has(token)
  ));
  const oracle = replay.frontier.map((frontier) => ({
    title: frontier.title,
    f1: score(row.reference, frontier.title).f1
  })).sort((left, right) => right.f1 - left.f1 || left.title.localeCompare(right.title))[0];
  return {
    asset_id: row.asset_id,
    grammar: replay.baseline.grammar,
    reference: row.reference,
    baseline_title: replay.baseline.title,
    candidate_title: replay.candidate.title,
    baseline_f1: baseline.f1,
    candidate_f1: candidate.f1,
    delta_f1: candidate.f1 - baseline.f1,
    changed: replay.candidate.changed,
    reference_losses: referenceLosses,
    numeric_mutation: JSON.stringify(numbers(replay.baseline.title))
      !== JSON.stringify(numbers(replay.candidate.title)),
    subject_drift: subjectLosses.length > 0,
    subject_losses: subjectLosses,
    over_80: replay.candidate.length > 80,
    baseline_dropped: replay.baseline.dropped,
    restored_vs_baseline: replay.candidate.restored_vs_baseline,
    displaced_vs_baseline: replay.candidate.displaced_vs_baseline,
    normalizations: replay.candidate.normalizations,
    drop_ledger: replay.candidate.drop_ledger,
    candidate_count: replay.candidate_count,
    frontier_count: replay.frontier.length,
    diagnostic_frontier_oracle_title: oracle?.title || replay.baseline.title,
    diagnostic_frontier_oracle_f1: oracle?.f1 ?? baseline.f1
  };
});

const deltas = cards.map((card) => card.delta_f1);
const oracleDeltas = cards.map((card) => card.diagnostic_frontier_oracle_f1 - card.baseline_f1);
const countBy = (values) => Object.fromEntries([...values.reduce((counts, value) => (
  counts.set(value, (counts.get(value) || 0) + 1)
), new Map())].sort(([left], [right]) => left.localeCompare(right)));
const summary = {
  cards: cards.length,
  baseline_macro_f1: mean(cards.map((card) => card.baseline_f1)),
  candidate_macro_f1: mean(cards.map((card) => card.candidate_f1)),
  delta_f1: mean(deltas),
  ...signs(deltas),
  changed_cards: cards.filter((card) => card.changed).length,
  reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
  numeric_mutation_cards: cards.filter((card) => card.numeric_mutation).length,
  subject_drift_cards: cards.filter((card) => card.subject_drift).length,
  over_80_cards: cards.filter((card) => card.over_80).length,
  candidate_count_average: mean(cards.map((card) => card.candidate_count)),
  candidate_count_max: Math.max(...cards.map((card) => card.candidate_count)),
  frontier_count_average: mean(cards.map((card) => card.frontier_count)),
  baseline_dropped_by_bracket: countBy(cards.flatMap((card) => card.baseline_dropped)),
  candidate_dropped_by_bracket: countBy(cards.flatMap((card) => (
    card.drop_ledger.map((entry) => entry.bracket)
  ))),
  restored_by_bracket: countBy(cards.flatMap((card) => card.restored_vs_baseline)),
  diagnostic_frontier_oracle_macro_f1: mean(cards.map((card) => card.diagnostic_frontier_oracle_f1)),
  diagnostic_frontier_oracle_signs: signs(oracleDeltas)
};
summary.diagnostic_frontier_oracle_delta_f1 = summary.diagnostic_frontier_oracle_macro_f1
  - summary.baseline_macro_f1;
const gate = {
  delta_f1_at_least_0003: summary.delta_f1 >= 0.003,
  at_least_8_wins: summary.wins >= 8,
  zero_losses: summary.losses === 0,
  zero_reference_loss: summary.reference_loss_cards === 0,
  zero_numeric_mutation: summary.numeric_mutation_cards === 0,
  zero_subject_drift: summary.subject_drift_cards === 0,
  zero_over_80: summary.over_80_cards === 0
};
const result = {
  schema_version: "typed-pareto-composer-v1-replay-v1",
  authority: "evaluation_only",
  provider_calls: 0,
  production_composer_changed: false,
  input: { path: inputPath, sha256: sha256(body), selected_arm: "thin_canonical_high" },
  summary,
  gate,
  decision: Object.values(gate).every(Boolean) ? "PASS_FOR_FRESH_CONFIRMATION" : "STOP",
  oracle_boundary: "diagnostic_frontier_oracle reads labels only after candidate generation and cannot promote the selector",
  changed_cards: cards.filter((card) => card.changed),
  budget_cards: cards.filter((card) => card.baseline_dropped.length || card.drop_ledger.length),
  loss_cards: cards.filter((card) => card.delta_f1 < -1e-12)
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
