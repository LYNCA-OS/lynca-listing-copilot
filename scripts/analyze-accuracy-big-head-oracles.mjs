#!/usr/bin/env node

// Planning-only upper bounds for the fresh-150 loss ledger. This script never
// changes a title with a rule: it asks how much token-set F1 each audited loss
// family could recover if every missing reviewed-title token in that family
// were restored while every existing candidate token stayed in place.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const ledgerPath = resolve(root, "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json");
const bundlePath = resolve(root, "docs/evaluation/accuracy-combined-positive-bundle-v1-replay-150-2026-08-02.json");
const paidPath = resolve(root, "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = resolve(root, "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");

const tokenise = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

function f1(reference, candidateTokens) {
  const wanted = tokenise(reference);
  const got = candidateTokens instanceof Set ? candidateTokens : tokenise(candidateTokens);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function oracle(cards, references, items) {
  const byAsset = new Map();
  const tokenFrequency = new Map();
  for (const item of items) {
    if (!byAsset.has(item.asset_id)) byAsset.set(item.asset_id, new Set());
    byAsset.get(item.asset_id).add(String(item.token).toLowerCase());
    const token = String(item.token).toLowerCase();
    tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
  }
  let wins = 0;
  const deltas = [];
  for (const card of cards) {
    const reference = references.get(card.asset_id);
    if (!reference) throw new Error(`missing_reference:${card.asset_id}`);
    const baseline = tokenise(card.candidate_title);
    const restored = new Set(baseline);
    for (const token of byAsset.get(card.asset_id) ?? []) restored.add(token);
    const delta = f1(reference, restored) - f1(reference, baseline);
    deltas.push(delta);
    if (delta > 1e-12) wins += 1;
  }
  return {
    occurrences: items.length,
    affected_cards: byAsset.size,
    oracle_win_cards: wins,
    baseline_f1: average(cards.map((card) => f1(references.get(card.asset_id), card.candidate_title))),
    oracle_f1: average(cards.map((card) => {
      const restored = tokenise(card.candidate_title);
      for (const token of byAsset.get(card.asset_id) ?? []) restored.add(token);
      return f1(references.get(card.asset_id), restored);
    })),
    oracle_delta: average(deltas),
    top_missing_tokens: [...tokenFrequency.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20).map(([token, occurrences]) => ({ token, occurrences }))
  };
}

function precisionOracle(cards, references) {
  const deltas = [];
  let affectedCards = 0;
  let removedOccurrences = 0;
  const tokenFrequency = new Map();
  for (const card of cards) {
    const reference = references.get(card.asset_id);
    const wanted = tokenise(reference);
    const baseline = tokenise(card.candidate_title);
    const extras = [...baseline].filter((token) => !wanted.has(token));
    if (extras.length) affectedCards += 1;
    removedOccurrences += extras.length;
    for (const token of extras) tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    const retained = new Set([...baseline].filter((token) => wanted.has(token)));
    deltas.push(f1(reference, retained) - f1(reference, baseline));
  }
  return {
    incorrect_token_occurrences: removedOccurrences,
    affected_cards: affectedCards,
    oracle_f1: average(cards.map((card) => {
      const wanted = tokenise(references.get(card.asset_id));
      return f1(references.get(card.asset_id), new Set([...tokenise(card.candidate_title)]
        .filter((token) => wanted.has(token))));
    })),
    oracle_delta: average(deltas),
    top_incorrect_tokens: [...tokenFrequency.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20).map(([token, occurrences]) => ({ token, occurrences }))
  };
}

const [ledger, bundle, paidBody, exhaustiveBody] = await Promise.all([
  readFile(ledgerPath, "utf8").then(JSON.parse),
  readFile(bundlePath, "utf8").then(JSON.parse),
  readFile(paidPath, "utf8"),
  readFile(exhaustivePath, "utf8")
]);

const references = new Map(paidBody.trim().split("\n").map(JSON.parse)
  .filter((row) => row.arm === "thin_canonical_high")
  .map((row) => [row.asset_id, row.reference]));
const canonicalRows = new Map(paidBody.trim().split("\n").map(JSON.parse)
  .filter((row) => row.arm === "thin_canonical_high")
  .map((row) => [row.asset_id, row]));
const cards = bundle.cards;
if (cards.length !== 150 || references.size !== 150) throw new Error("fresh150_cohort_mismatch");

const stages = Object.fromEntries(Object.keys(ledger.stages).map((stage) => [
  stage,
  oracle(cards, references, ledger.items.filter((item) => item.stage === stage))
]));
const families = Object.fromEntries([...new Set(ledger.items.map((item) => item.structural_family))]
  .map((family) => [family, oracle(cards, references, ledger.items.filter((item) => item.structural_family === family))])
  .sort((left, right) => right[1].oracle_delta - left[1].oracle_delta));

const all = oracle(cards, references, ledger.items);
const precisionOnly = precisionOracle(cards, references);
const exhaustiveRows = exhaustiveBody.trim().split("\n").map(JSON.parse);
const certValuesByAsset = new Map(exhaustiveRows.map((row) => {
  const values = new Set((row.observations ?? [])
    .filter((observation) => String(observation?.label ?? "").toLowerCase() === "certification_number")
    .map((observation) => String(observation?.evidence ?? "").match(/\b\d{7,12}\b/)?.[0])
    .filter(Boolean));
  return [row.asset_id, values];
}).filter(([, values]) => values.size));
const certConflictCards = [...certValuesByAsset.values()].filter((values) => values.size > 1).length;
const certAssetIds = new Set([...certValuesByAsset.entries()]
  .filter(([, values]) => values.size === 1).map(([assetId]) => assetId));
const certCards = cards.filter((card) => certAssetIds.has(card.asset_id));
const nonCertCards = cards.filter((card) => !certAssetIds.has(card.asset_id));
const certMissingItems = ledger.items.filter((item) => certAssetIds.has(item.asset_id));
const certRecallOracle = oracle(cards, references, certMissingItems);
const certPerfectF1 = average(cards.map((card) => certAssetIds.has(card.asset_id)
  ? 1 : f1(references.get(card.asset_id), card.candidate_title)));
const certPrecisionF1 = average(cards.map((card) => {
  const wanted = tokenise(references.get(card.asset_id));
  const got = tokenise(card.candidate_title);
  if (!certAssetIds.has(card.asset_id)) return f1(references.get(card.asset_id), got);
  return f1(references.get(card.asset_id), new Set([...got].filter((token) => wanted.has(token))));
}));
const certStageOccurrences = Object.fromEntries(Object.keys(stages).map((stage) => [
  stage, certMissingItems.filter((item) => item.stage === stage).length
]));
const finishLossByAsset = new Map();
for (const item of ledger.items.filter((row) => [
  "parallel_or_finish", "color", "rarity_or_marker"
].includes(row.structural_family))) {
  if (!finishLossByAsset.has(item.asset_id)) finishLossByAsset.set(item.asset_id, new Set());
  finishLossByAsset.get(item.asset_id).add(String(item.token).toLowerCase());
}
const finishSwapPairs = new Map();
const finishSwapCards = [];
for (const card of cards) {
  const wanted = tokenise(references.get(card.asset_id));
  const missing = finishLossByAsset.get(card.asset_id) ?? new Set();
  if (!missing.size) continue;
  const fields = canonicalRows.get(card.asset_id)?.fields ?? {};
  const emittedFinishTokens = tokenise([
    fields.surface_color, fields.parallel_family, fields.parallel_exact,
    fields.print_finish, fields.descriptive_rarity
  ].filter(Boolean).join(" "));
  const incorrectFinish = new Set([...tokenise(card.candidate_title)]
    .filter((token) => !wanted.has(token) && emittedFinishTokens.has(token)));
  if (!incorrectFinish.size) continue;
  finishSwapCards.push({
    asset_id: card.asset_id,
    missing: [...missing].sort(),
    incorrect_emitted_finish: [...incorrectFinish].sort()
  });
  for (const from of incorrectFinish) for (const to of missing) {
    const key = `${from}\u0000${to}`;
    finishSwapPairs.set(key, (finishSwapPairs.get(key) ?? 0) + 1);
  }
}
const target = 0.90;
const report = {
  schema_version: "accuracy-big-head-oracle-v1",
  authority: "planning_only_reference_oracle",
  production_promoted: false,
  provider_calls: 0,
  caveat: "Upper bounds add audited missing reference tokens and retain all existing candidate tokens. They are not implementable rules, predictions, or additive estimates.",
  target,
  gap_from_candidate: target - all.baseline_f1,
  audited_recall_oracle_fraction_required_for_target:
    (target - all.baseline_f1) / all.oracle_delta,
  all_audited_missing_tokens: all,
  remove_all_incorrect_candidate_tokens: precisionOnly,
  exact_slab_certificate_anchor_opportunity: {
    authority: "planning_only_reference_oracle",
    live_registry_coverage_verified: false,
    exact_single_cert_cards: certCards.length,
    conflicting_cert_cards: certConflictCards,
    cohort_share: certCards.length / cards.length,
    current_cert_card_f1: average(certCards.map((card) =>
      f1(references.get(card.asset_id), card.candidate_title))),
    current_non_cert_card_f1: average(nonCertCards.map((card) =>
      f1(references.get(card.asset_id), card.candidate_title))),
    audited_missing_occurrences: certMissingItems.length,
    missing_occurrences_by_stage: certStageOccurrences,
    restore_all_cert_missing_tokens_f1: certRecallOracle.oracle_f1,
    restore_all_cert_missing_tokens_delta: certRecallOracle.oracle_delta,
    perfect_cert_cards_f1: certPerfectF1,
    perfect_cert_cards_delta: certPerfectF1 - all.baseline_f1,
    remove_cert_card_reference_absent_tokens_f1: certPrecisionF1,
    remove_cert_card_reference_absent_tokens_delta: certPrecisionF1 - all.baseline_f1
  },
  finish_classification_swap_opportunity: {
    affected_cards: finishSwapCards.length,
    top_pairs: [...finishSwapPairs.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20).map(([key, cards]) => {
        const [incorrect, missing] = key.split("\u0000");
        return { incorrect, missing, cards };
      }),
    cards: finishSwapCards
  },
  by_stage: stages,
  by_structural_family: families
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
