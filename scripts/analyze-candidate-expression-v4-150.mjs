#!/usr/bin/env node

// Evaluation-only report for the v4 expression channel. The report measures
// capture and hypothesis quality; it deliberately does not call Composer or
// promote any candidate into CSM/SEM.

import { readFile, writeFile } from "node:fs/promises";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const input = arg("--input", "artifacts/candidate-expression-v4/development-150-c10/thin-path-gpt-5.6-luna.jsonl");
const output = arg("--out", "artifacts/candidate-expression-v4/development-150-c10/report.json");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const rowsFrom = (body) => String(body).split("\n").filter((line) => line.trim()).map((line, index) => {
  try { return JSON.parse(line); } catch { throw new Error(`invalid_json_line:${index + 1}`); }
});
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[‘’ʼ]/g, "'").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, value) => {
  const want = tokens(reference); const got = tokens(value);
  const hits = [...want].filter((token) => got.has(token)).length;
  const recall = want.size ? hits / want.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const increment = (map, key, amount = 1) => map.set(key, (map.get(key) || 0) + amount);
const mapObject = (map) => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

const body = await readFile(input, "utf8");
const rows = rowsFrom(body);
if (rows.length !== limit) throw new Error(`row_count_mismatch:${rows.length}/${limit}`);
const ids = rows.map((row) => row.asset_id);
if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
  throw new Error("asset_ids_missing_or_duplicate");
}

const factKinds = new Map();
const factBases = new Map();
const hypothesisBases = new Map();
const missedReferenceTokens = new Map();
const cards = rows.map((row) => {
  const facts = Array.isArray(row.candidate_facts) ? row.candidate_facts : [];
  const hypotheses = Array.isArray(row.candidate_hypotheses) ? row.candidate_hypotheses : [];
  for (const fact of facts) { increment(factKinds, fact.kind || "missing"); increment(factBases, fact.basis || "missing"); }
  for (const hypothesis of hypotheses) increment(hypothesisBases, hypothesis.basis || "missing");
  const factText = facts.map((fact) => fact.value).join(" ");
  const hypothesisText = hypotheses.map((hypothesis) => hypothesis.value).join(" ");
  const expressionText = `${factText} ${hypothesisText}`.trim();
  const expressionScore = score(row.reference, expressionText);
  const hypothesisScores = hypotheses.map((hypothesis) => ({
    value: hypothesis.value,
    basis: hypothesis.basis,
    score: score(row.reference, hypothesis.value)
  }));
  const bestHypothesis = hypothesisScores.reduce((best, current) => !best || current.score.f1 > best.score.f1 ? current : best, null);
  const referenceTokens = tokens(row.reference);
  const expressionTokens = tokens(expressionText);
  for (const token of referenceTokens) if (!expressionTokens.has(token)) increment(missedReferenceTokens, token);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    fact_count: facts.length,
    hypothesis_count: hypotheses.length,
    fact_kinds: [...new Set(facts.map((fact) => fact.kind))],
    fact_bases: [...new Set(facts.map((fact) => fact.basis))],
    hypothesis_bases: [...new Set(hypotheses.map((hypothesis) => hypothesis.basis))],
    model_knowledge_hypotheses: hypotheses.filter((hypothesis) => hypothesis.basis === "model_knowledge").length,
    candidate_defects: row.candidate_defects || [],
    expression_score: expressionScore,
    best_hypothesis: bestHypothesis,
    latency_ms: row.latency_ms,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    request_attempt_count: row.request_attempt_count
  };
});

const values = (field) => cards.map((card) => card[field]).filter((value) => Number.isFinite(value));
const result = {
  schema_version: "candidate-expression-v4-report-v1",
  authority: "evaluation_only",
  source: { input, limit },
  cards: cards.length,
  complete_cards: cards.filter((card) => card.request_attempt_count >= 1).length,
  defect_cards: cards.filter((card) => card.candidate_defects.length).length,
  hypothesis_cards: cards.filter((card) => card.hypothesis_count > 0).length,
  model_knowledge_cards: cards.filter((card) => card.model_knowledge_hypotheses > 0).length,
  mean_fact_count: mean(cards.map((card) => card.fact_count)),
  median_fact_count: median(cards.map((card) => card.fact_count)),
  mean_hypothesis_count: mean(cards.map((card) => card.hypothesis_count)),
  median_hypothesis_count: median(cards.map((card) => card.hypothesis_count)),
  expression_macro_f1: mean(cards.map((card) => card.expression_score.f1)),
  expression_macro_recall: mean(cards.map((card) => card.expression_score.recall)),
  expression_macro_precision: mean(cards.map((card) => card.expression_score.precision)),
  best_hypothesis_macro_f1: mean(cards.map((card) => card.best_hypothesis?.score.f1 || 0)),
  total_tokens: {
    mean: mean(values("total_tokens")), median: median(values("total_tokens")),
    p95: percentile(values("total_tokens"), 0.95)
  },
  output_tokens: {
    mean: mean(values("output_tokens")), median: median(values("output_tokens")),
    p95: percentile(values("output_tokens"), 0.95)
  },
  latency_ms: {
    mean: mean(values("latency_ms")), median: median(values("latency_ms")),
    p95: percentile(values("latency_ms"), 0.95)
  },
  fact_kinds: mapObject(factKinds),
  fact_bases: mapObject(factBases),
  hypothesis_bases: mapObject(hypothesisBases),
  missed_reference_tokens: mapObject(missedReferenceTokens),
  per_card: cards
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  cards: result.cards,
  defect_cards: result.defect_cards,
  hypothesis_cards: result.hypothesis_cards,
  model_knowledge_cards: result.model_knowledge_cards,
  expression_macro_f1: result.expression_macro_f1,
  best_hypothesis_macro_f1: result.best_hypothesis_macro_f1,
  median_output_tokens: result.output_tokens.median,
  median_latency_ms: result.latency_ms.median,
  out: output
}, null, 2));
