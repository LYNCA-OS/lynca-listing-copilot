#!/usr/bin/env node

// Zero-cost replay of the capture-only bridge. This script deliberately reads
// paid checkpoints; it never invokes a provider or writes production state.

import { readFileSync, writeFileSync } from "node:fs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyExpressionOverlayV1 } from "../lib/listing/thin/accuracy-expression-overlay-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sign = (deltas) => ({
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
});
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};
const imageFor = (region) => region === "card_back" ? "image_2" : "image_1";
const factsFromObservations = (observations = []) => observations.flatMap((observation) => {
  if (observation?.label !== "logo" || observation?.kind !== "printed_text") return [];
  const value = String(observation.evidence ?? "").replace(/\s+/g, " ").trim();
  return value ? [{
    value, kind: "affiliation", basis: "logo_or_symbol", image: imageFor(observation.region),
    region: observation.region || "unknown", uncertainty: "none",
    source_kind: observation.kind, source_confidence: observation.confidence
  }] : [];
});

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/expression-overlay-v1-replay-150.json");
const input = rows(inputPath); const exhaustive = rows(exhaustivePath);
const canonicalByAsset = new Map(input.filter((row) => row.arm === "thin_canonical_high" && row.fields)
  .map((row) => [row.asset_id, row]));
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(exhaustive.map((row) => [row.asset_id, row]));

const cards = [...canonicalByAsset.values()].map((row) => {
  const free = freeByAsset.get(row.asset_id); const diagnostic = exhaustiveByAsset.get(row.asset_id);
  if (!free || !diagnostic) throw new Error(`paired_cohort_mismatch:${row.asset_id}`);
  const baseline = composeFromCanonicalFields(row.fields);
  const expression = projectFreeTitleThroughCsm(free.title);
  const context = {
    expressionFields: expression.fields,
    expressionTitle: free.title,
    candidateFacts: factsFromObservations(diagnostic.observations),
    observations: diagnostic.observations
  };
  const overlay = applyAccuracyExpressionOverlayV1(row.fields, context);
  const candidate = overlay.composed;
  const baselineScore = score(row.reference, baseline.title);
  const candidateScore = score(row.reference, candidate.title);
  const stageConfigs = {
    identity: { mechanisms: [], includeSerial: false },
    insert: { mechanisms: ["attested_insert"], includeSerial: false },
    finish: { mechanisms: ["attested_insert", "finish_family_color_only"], includeSerial: false },
    product: { mechanisms: ["attested_insert", "finish_family_color_only", "product_known_manufacturer_extension"], includeSerial: false },
    combined: { mechanisms: ["attested_insert", "finish_family_color_only", "product_known_manufacturer_extension"], includeSerial: true }
  };
  const stages = Object.fromEntries(Object.entries(stageConfigs).map(([name, config]) => {
    const stage = applyAccuracyExpressionOverlayV1(row.fields, { ...context, ...config });
    return [name, { title: stage.composed.title, rejected: stage.rejected }];
  }));
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    candidate_title: candidate.title,
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta_f1: candidateScore.f1 - baselineScore.f1,
    reference_losses: referenceLosses(row.reference, baseline.title, candidate.title),
    over_80: candidate.title.length > 80,
    changes: overlay.changes,
    rejected: overlay.rejected,
    sem: overlay.sem,
    stages
  };
});

const stageSummary = (name) => {
  const deltas = cards.map((card) => score(card.reference, card.stages[name].title).f1
    - card.baseline_score.f1);
  return {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => score(card.reference, card.stages[name].title).f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card.stages[name].title !== card.baseline_title).length,
    reference_loss_cards: cards.filter((card) => referenceLosses(card.reference, card.baseline_title, card.stages[name].title).length).length,
    over_80_cards: cards.filter((card) => card.stages[name].title.length > 80).length
  };
};

const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "accuracy-expression-overlay-v1-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  source: {
    inputPath, exhaustivePath, limit: cards.length,
    arms: ["thin_budgeted", "thin_canonical_high", "exhaustive_observation_high"]
  },
  summary: {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.candidate_score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card.candidate_title !== card.baseline_title).length,
    reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
    over_80_cards: cards.filter((card) => card.over_80).length,
    rejected_overlays: cards.filter((card) => card.rejected.length).length
  },
  stages: Object.fromEntries(Object.keys({ identity: 1, insert: 1, finish: 1, product: 1, combined: 1 })
    .map((name) => [name, stageSummary(name)])),
  cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary: result.summary }, null, 2));
