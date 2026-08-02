#!/usr/bin/env node

// Zero-provider-cost resolver screen for canonical-open-evidence-v1. It only
// tests a strict, visible candidate-product extension; all other facts stay
// append-only. The canonical fields are never mutated in the paid checkpoint.

import { readFile, writeFile } from "node:fs/promises";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const words = (value) => clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const tokens = (value) => new Set(words(value));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const sign = (deltas) => ({
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
});
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const beforeTokens = tokens(before); const afterTokens = tokens(after);
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};

function visibleIdentityCandidates(facts) {
  return (Array.isArray(facts) ? facts : [])
    .filter((fact) => ["identity", "affiliation"].includes(fact?.kind))
    .filter((fact) => ["exact_text", "stamped_text", "logo_or_symbol"].includes(fact?.basis))
    .filter((fact) => fact?.image !== "none" && fact?.uncertainty === "none")
    .map((fact) => ({ ...fact, value: clean(fact.value) }))
    .filter((fact) => fact.value.length >= 3);
}

function strictProductExtension(fields, facts) {
  const manufacturer = words(fields?.manufacturer);
  const existing = words(fields?.product);
  if (!manufacturer.length) return null;
  const existingSet = new Set(existing);
  const candidate = visibleIdentityCandidates(facts)
    .filter((fact) => {
      const candidateWords = words(fact.value);
      if (candidateWords.length <= existing.length) return false;
      if (!manufacturer.every((word) => candidateWords.includes(word))) return false;
      if (!existing.every((word) => candidateWords.includes(word))) return false;
      return candidateWords[0] === manufacturer[0];
    })
    .sort((left, right) => words(right.value).length - words(left.value).length)[0];
  if (!candidate || tokens(candidate.value).size <= existingSet.size) return null;
  return candidate;
}

const inputPath = arg("--input", "artifacts/canonical-open-evidence-screen-20-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const outputPath = arg("--out", "artifacts/canonical-open-evidence-screen-20-2026-08-02/replay.json");
const controlArm = arg("--control-arm", "thin_canonical_high");
const treatmentArm = arg("--treatment-arm", "canonical_open_evidence_v1_high");
const limit = Number(arg("--limit", "20"));
const rows = (await readFile(inputPath, "utf8")).split(/\n+/).filter(Boolean).map(JSON.parse);
const control = new Map(rows.filter((row) => row.arm === controlArm).map((row) => [row.asset_id, row]));
const treatment = new Map(rows.filter((row) => row.arm === treatmentArm).map((row) => [row.asset_id, row]));
if (control.size !== limit || treatment.size !== limit || [...control.keys()].some((id) => !treatment.has(id))) {
  throw new Error(`paired_cohort_mismatch:${control.size}/${treatment.size}/${limit}`);
}

const cards = [...control.keys()].map((assetId) => {
  const controlRow = control.get(assetId);
  const treatmentRow = treatment.get(assetId);
  const baselineFields = controlRow.fields || {};
  const baseline = composeFromCanonicalFields(baselineFields);
  // Use the canonical control fields on both sides. This isolates the open
  // ledger's resolver effect from unrelated field drift between two paid
  // responses on the same image.
  const candidate = strictProductExtension(baselineFields, treatmentRow.candidate_facts);
  const candidateFields = candidate ? { ...baselineFields, product: candidate.value } : { ...baselineFields };
  const candidateTitle = composeFromCanonicalFields(candidateFields);
  const baselineScore = score(controlRow.reference, baseline.title);
  const candidateScore = score(controlRow.reference, candidateTitle.title);
  return {
    asset_id: assetId,
    reference: controlRow.reference,
    baseline_title: baseline.title,
    candidate_title: candidateTitle.title,
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta_f1: candidateScore.f1 - baselineScore.f1,
    product_candidate: candidate ? { value: candidate.value, basis: candidate.basis, image: candidate.image, region: candidate.region } : null,
    reference_losses: referenceLosses(controlRow.reference, baseline.title, candidateTitle.title),
    over_80: candidateTitle.title.length > 80,
    treatment_facts: Array.isArray(treatmentRow.candidate_facts) ? treatmentRow.candidate_facts.length : 0,
    treatment_defects: treatmentRow.candidate_defects || []
  };
});
const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "canonical-open-evidence-v1-replay-v1",
  authority: "evaluation_only",
  source: { inputPath, controlArm, treatmentArm, limit },
  summary: {
    n: cards.length,
    baseline_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_f1: mean(cards.map((card) => card.candidate_score.f1)),
    delta_f1: mean(deltas),
    sign_test: sign(deltas),
    product_candidate_cards: cards.filter((card) => card.product_candidate).length,
    reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
    over_80_cards: cards.filter((card) => card.over_80).length,
    candidate_fact_mean: mean(cards.map((card) => card.treatment_facts)),
    defect_cards: cards.filter((card) => card.treatment_defects.length).length
  },
  cards
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outputPath, summary: result.summary }, null, 2));
