#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const [, , barePath, canonicalPath, canonicalArm = "thin_canonical_high"] = process.argv;
if (!barePath || !canonicalPath) {
  throw new Error("usage: analyze-bare-title-eval.mjs <bare.jsonl> <canonical.jsonl> [canonical-arm]");
}

const readJsonl = async (path) => String(await readFile(path, "utf8"))
  .split("\n").filter(Boolean).map((line) => JSON.parse(line));

const tokenise = (text) => new Set(String(text ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

const score = (reference, title) => {
  const want = tokenise(reference);
  const got = tokenise(title);
  const hits = [...want].filter((token) => got.has(token)).length;
  const recall = want.size ? hits / want.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return {
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0,
  };
};

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};

const compare = (left, right) => {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    if (delta > 1e-12) wins += 1;
    else if (delta < -1e-12) losses += 1;
    else ties += 1;
  }
  const trials = wins + losses;
  let tail = 0;
  let coefficient = 1;
  const extreme = Math.min(wins, losses);
  for (let k = 0; k <= extreme; k += 1) {
    if (k > 0) coefficient = coefficient * (trials - k + 1) / k;
    tail += coefficient;
  }
  return {
    wins,
    losses,
    ties,
    mean_delta: mean(left) - mean(right),
    sign_test_p: trials ? Math.min(1, 2 * tail * 0.5 ** trials) : 1,
  };
};

const bands = (values) => ({
  below_0_50: values.filter((value) => value < 0.5).length,
  from_0_50_to_0_60: values.filter((value) => value >= 0.5 && value < 0.6).length,
  from_0_60_to_0_70: values.filter((value) => value >= 0.6 && value < 0.7).length,
  from_0_70_to_0_80: values.filter((value) => value >= 0.7 && value < 0.8).length,
  at_least_0_80: values.filter((value) => value >= 0.8).length,
});

const topCounts = (tokens, limit = 20) => [...tokens.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, limit)
  .map(([token, count]) => ({ token, count }));

const bareRows = await readJsonl(barePath);
const canonicalRows = (await readJsonl(canonicalPath)).filter((row) => row.arm === canonicalArm);
const canonicalById = new Map(canonicalRows.map((row) => [row.asset_id, row]));
const duplicateBareIds = bareRows.length - new Set(bareRows.map((row) => row.asset_id)).size;
const paired = bareRows.map((bare) => {
  const canonical = canonicalById.get(bare.asset_id);
  if (!canonical) throw new Error(`canonical row missing for ${bare.asset_id}`);
  if (bare.reference !== canonical.reference) throw new Error(`reference mismatch for ${bare.asset_id}`);
  return { bare, canonical, raw: score(bare.reference, bare.raw_title) };
});
if (paired.length !== canonicalRows.length) throw new Error("cohort cardinality mismatch");

const finalF1 = paired.map(({ bare }) => bare.f1);
const rawF1 = paired.map(({ raw }) => raw.f1);
const canonicalF1 = paired.map(({ canonical }) => canonical.f1);
const metricSummary = (items) => ({
  f1: mean(items.map((item) => item.f1)),
  recall: mean(items.map((item) => item.recall)),
  precision: mean(items.map((item) => item.precision)),
  ...bands(items.map((item) => item.f1)),
});
const missing = new Map();
const recoveredByCanonical = new Map();
const extra = new Map();
for (const { bare, canonical } of paired) {
  const want = tokenise(bare.reference);
  const bareTokens = tokenise(bare.title);
  const canonicalTokens = tokenise(canonical.title);
  for (const token of want) {
    if (!bareTokens.has(token)) missing.set(token, (missing.get(token) || 0) + 1);
    if (!bareTokens.has(token) && canonicalTokens.has(token)) {
      recoveredByCanonical.set(token, (recoveredByCanonical.get(token) || 0) + 1);
    }
  }
  for (const token of bareTokens) {
    if (!want.has(token)) extra.set(token, (extra.get(token) || 0) + 1);
  }
}

const latencies = bareRows.map((row) => row.latency_ms);
const result = {
  integrity: {
    bare_rows: bareRows.length,
    canonical_rows: canonicalRows.length,
    exact_asset_id_overlap: paired.length,
    duplicate_bare_ids: duplicateBareIds,
    request_failures: bareRows.filter((row) => !row.title).length,
    retried_cards: bareRows.filter((row) => row.request_attempt_count > 1).length,
    model: [...new Set(bareRows.map((row) => row.model))],
    served_model: [...new Set(bareRows.map((row) => row.served_model))],
    requested_effort: [...new Set(bareRows.map((row) => row.requested_effort))],
    served_effort: [...new Set(bareRows.map((row) => row.served_effort))],
    image_detail: [...new Set(bareRows.map((row) => row.image_detail))],
  },
  scores: {
    raw_model_text: metricSummary(paired.map(({ raw }) => raw)),
    listable_80_char: metricSummary(paired.map(({ bare }) => bare)),
    canonical_high: metricSummary(paired.map(({ canonical }) => canonical)),
    final_vs_raw: compare(finalF1, rawF1),
    bare_vs_canonical: compare(finalF1, canonicalF1),
  },
  expression: {
    raw_over_80: bareRows.filter((row) => row.raw_length > 80).length,
    final_over_80: bareRows.filter((row) => row.length > 80).length,
    raw_changed_by_finisher: bareRows.filter((row) => row.raw_title !== row.title).length,
    median_raw_length: quantile(bareRows.map((row) => row.raw_length), 0.5),
    median_final_length: quantile(bareRows.map((row) => row.length), 0.5),
  },
  latency_ms: {
    p50: quantile(latencies, 0.5),
    p90: quantile(latencies, 0.9),
    p95: quantile(latencies, 0.95),
    p99: quantile(latencies, 0.99),
    max: Math.max(...latencies),
  },
  tokens: {
    input_total: bareRows.reduce((sum, row) => sum + row.input_tokens, 0),
    output_total: bareRows.reduce((sum, row) => sum + row.output_tokens, 0),
    most_common_reference_tokens_missing_from_bare: topCounts(missing),
    most_common_extra_bare_tokens: topCounts(extra),
    most_common_missing_tokens_recovered_by_canonical: topCounts(recoveredByCanonical),
  },
  examples: {
    worst_bare: [...paired].sort((a, b) => a.bare.f1 - b.bare.f1).slice(0, 8).map(({ bare, canonical }) => ({
      asset_id: bare.asset_id,
      f1: bare.f1,
      canonical_f1: canonical.f1,
      reference: bare.reference,
      bare: bare.title,
      canonical: canonical.title,
    })),
    bare_beats_canonical: paired
      .filter(({ bare, canonical }) => bare.f1 > canonical.f1 + 1e-12)
      .sort((a, b) => (b.bare.f1 - b.canonical.f1) - (a.bare.f1 - a.canonical.f1))
      .slice(0, 8).map(({ bare, canonical }) => ({
        asset_id: bare.asset_id,
        delta: bare.f1 - canonical.f1,
        reference: bare.reference,
        bare: bare.title,
        canonical: canonical.title,
      })),
  },
};

console.log(JSON.stringify(result, null, 2));
