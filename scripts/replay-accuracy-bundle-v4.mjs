#!/usr/bin/env node

// Zero-cost interaction replay. It combines the screened identity-v3
// resolver with the eight narrow v3 field overlays over already-paid rows.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyMechanismBundleV4 } from "../lib/listing/thin/accuracy-mechanism-bundle-v4.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
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
const outPath = arg("--out", "artifacts/extreme-observation-2026-08-02/accuracy-bundle-v4-interaction-replay-150.json");
const input = rows(inputPath);
const exhaustive = rows(exhaustivePath);
const canonicalByAsset = new Map(input.filter((row) => row.arm === "thin_canonical_high" && row.fields).map((row) => [row.asset_id, row]));
const freeByAsset = new Map(input.filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(exhaustive.map((row) => [row.asset_id, row]));

const cards = [...canonicalByAsset.values()].map((row) => {
  const free = freeByAsset.get(row.asset_id);
  const observation = exhaustiveByAsset.get(row.asset_id);
  if (!free || !observation) throw new Error(`paired_cohort_mismatch:${row.asset_id}`);
  const baseline = composeFromCanonicalFields(row.fields);
  const replay = applyAccuracyMechanismBundleV4(row.fields, {
    identityFacts: factsFromObservations(observation.observations),
    freeFields: projectFreeTitleThroughCsm(free.title).fields,
    freeTitle: free.title,
    observations: observation.observations
  });
  const candidate = composeFromCanonicalFields(replay.fields);
  const before = score(row.reference, baseline.title);
  const after = score(row.reference, candidate.title);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    candidate_title: candidate.title,
    baseline_score: before,
    candidate_score: after,
    delta_f1: after.f1 - before.f1,
    length: candidate.title.length,
    over_80: candidate.title.length > 80,
    reference_losses: refLosses(row.reference, baseline.title, candidate.title),
    changes: replay.changes,
    identity_changes: replay.identity_changes,
    overlay_changes: replay.overlay_changes,
    rejected_identity_facts: replay.identity_rejected_facts
  };
});

const result = {
  schema_version: "accuracy-bundle-v4-interaction-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  source: { inputPath, exhaustivePath, limit: cards.length, arms: ["thin_budgeted", "thin_canonical_high", "exhaustive_observation_high"] },
  mechanisms: ["candidate_identity_replay_v3", "accuracy_mechanism_bundle_v3"],
  summary: {
    cards: cards.length,
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.candidate_score.f1)),
    delta_macro_f1: mean(cards.map((card) => card.delta_f1)),
    ...sign(cards.map((card) => card.delta_f1)),
    changed_cards: cards.filter((card) => card.candidate_title !== card.baseline_title).length,
    reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
    over_80: cards.filter((card) => card.over_80).length,
    field_actions: cards.reduce((sum, card) => sum + card.identity_changes.length
      + card.overlay_changes.reduce((inner, row) => inner + row.fields.length, 0), 0)
  },
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary: result.summary }, null, 2));
