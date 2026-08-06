#!/usr/bin/env node

// Zero-cost paired replay of the three currently strongest, orthogonal
// mechanisms. The source rows were already paid for; this script only applies
// deterministic overlays and records per-card/per-mechanism attribution.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replayCandidateIdentityV3 } from "../lib/listing/thin/candidate-identity-replay-v3.mjs";
import { replaySerialObservationSingleDigitV1 } from "../lib/listing/thin/candidate-identity-replay-v1.mjs";
import { applyAccuracyMechanismV2 } from "../lib/listing/thin/accuracy-mechanism-bundle-v2.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const rows = (path) => readFileSync(path, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title); const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0; const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sign = (deltas) => ({ wins: deltas.filter((v) => v > 1e-12).length, losses: deltas.filter((v) => v < -1e-12).length, ties: deltas.filter((v) => Math.abs(v) <= 1e-12).length });
const refLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};
const imageFor = (region) => region === "card_back" ? "image_2" : "image_1";
const factsFromObservations = (observations = []) => observations.flatMap((observation) => {
  if (observation?.label !== "logo" || observation?.kind !== "printed_text") return [];
  const value = String(observation.evidence ?? "").replace(/\s+/g, " ").trim();
  return value ? [{ value, kind: "affiliation", basis: "logo_or_symbol", image: imageFor(observation.region), region: observation.region || "unknown", uncertainty: "none" }] : [];
});

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/extreme-observation-2026-08-02/accuracy-bundle-v3-replay-150.json");
const input = rows(inputPath); const exhaustive = rows(exhaustivePath);
const canonicalByAsset = new Map(input.filter((row) => row.arm === "thin_canonical_high" && row.fields).map((row) => [row.asset_id, row]));
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(exhaustive.map((row) => [row.asset_id, row]));
const cards = [...canonicalByAsset.values()].map((row) => {
  const free = freeByAsset.get(row.asset_id); const observation = exhaustiveByAsset.get(row.asset_id);
  if (!free || !observation) throw new Error(`paired_cohort_mismatch:${row.asset_id}`);
  const baseline = composeFromCanonicalFields(row.fields); const baseScore = score(row.reference, baseline.title);
  const freeFields = projectFreeTitleThroughCsm(free.title).fields;
  const identity = replayCandidateIdentityV3(row.fields, factsFromObservations(observation.observations));
  const product = applyAccuracyMechanismV2("product_known_manufacturer_extension", identity.fields, { freeFields, freeTitle: free.title });
  const serial = replaySerialObservationSingleDigitV1(product.fields, observation.observations);
  const candidate = composeFromCanonicalFields(serial.fields); const candidateScore = score(row.reference, candidate.title);
  const stages = { identity: composeFromCanonicalFields(identity.fields), product: composeFromCanonicalFields(product.fields), serial: candidate };
  return {
    asset_id: row.asset_id, reference: row.reference, baseline_title: baseline.title, candidate_title: candidate.title,
    baseline_score: baseScore, candidate_score: candidateScore, delta_f1: candidateScore.f1 - baseScore.f1,
    length: candidate.title.length, over_80: candidate.title.length > 80, reference_losses: refLosses(row.reference, baseline.title, candidate.title),
    changes: { identity: identity.changes, product: product.changed ? [product.fields.product] : [], serial: serial.changes },
    stage_titles: Object.fromEntries(Object.entries(stages).map(([name, value]) => [name, value.title])),
    rejected_identity_facts: identity.rejected_facts
  };
});

const stageSummary = (name) => {
  const deltas = cards.map((card) => score(card.reference, card.stage_titles[name]).f1 - card.baseline_score.f1);
  return { baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)), candidate_macro_f1: mean(cards.map((card) => score(card.reference, card.stage_titles[name]).f1)), delta_macro_f1: mean(deltas), ...sign(deltas), changed_cards: cards.filter((card) => card.stage_titles[name] !== card.baseline_title).length };
};
const result = {
  schema_version: "accuracy-bundle-v3-replay-150", authority: "evaluation_only", production_promoted: false,
  source: { inputPath, exhaustivePath, limit: cards.length, arms: ["thin_budgeted", "thin_canonical_high", "exhaustive_observation_high"] },
  mechanisms: ["candidate_identity_replay_v3", "product_known_manufacturer_extension_v2", "serial_single_digit_v1"],
  summary: { identity: stageSummary("identity"), product: stageSummary("product"), bundle: { baseline_macro_f1: mean(cards.map((c) => c.baseline_score.f1)), candidate_macro_f1: mean(cards.map((c) => c.candidate_score.f1)), delta_macro_f1: mean(cards.map((c) => c.delta_f1)), ...sign(cards.map((c) => c.delta_f1)), changed_cards: cards.filter((c) => c.candidate_title !== c.baseline_title).length, reference_loss_cards: cards.filter((c) => c.reference_losses.length).length, over_80: cards.filter((c) => c.over_80).length } },
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary: result.summary }, null, 2));
