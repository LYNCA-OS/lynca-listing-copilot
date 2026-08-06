#!/usr/bin/env node

// Offline paired analysis for the same-call channel. It compares the stored
// hybrid canonical title with the stored canonical control, then applies the
// existing evaluation-only identity resolver to the hybrid's candidate facts.

import { readFile, writeFile } from "node:fs/promises";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replayCandidateIdentityV3 } from "../lib/listing/thin/candidate-identity-replay-v3.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = async (path) => (await readFile(path, "utf8"))
  .split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .split(/[^a-z0-9/']+/).filter(Boolean));
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
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};

const controlPath = arg("--control", "artifacts/accuracy-unseen17-thin-canonical-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const hybridPath = arg("--hybrid", "artifacts/accuracy-unseen17-canonical-candidate-v1-2026-08-02/canonical-candidate-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/accuracy-unseen17-canonical-candidate-v1-2026-08-02/paired-analysis.json");
const control = new Map((await rows(controlPath)).filter((row) => row.arm === "thin_canonical" && row.fields).map((row) => [row.asset_id, row]));
const hybrid = new Map((await rows(hybridPath)).map((row) => [row.asset_id, row]));
const cards = [...control.values()].filter((row) => hybrid.has(row.asset_id)).map((base) => {
  const treatment = hybrid.get(base.asset_id);
  const hybridIdentity = replayCandidateIdentityV3(base.fields, treatment.candidate_facts || []);
  const projected = composeFromCanonicalFields(hybridIdentity.fields).title;
  const controlScore = score(base.reference, base.title);
  const hybridScore = score(base.reference, treatment.title);
  const projectedScore = score(base.reference, projected);
  return {
    asset_id: base.asset_id,
    reference: base.reference,
    control_title: base.title,
    hybrid_title: treatment.title,
    projected_title: projected,
    control_score: controlScore,
    hybrid_score: hybridScore,
    projected_score: projectedScore,
    hybrid_delta_f1: hybridScore.f1 - controlScore.f1,
    projected_delta_f1: projectedScore.f1 - controlScore.f1,
    hybrid_reference_loss_tokens: referenceLosses(base.reference, base.title, treatment.title),
    projected_reference_loss_tokens: referenceLosses(base.reference, base.title, projected),
    hybrid_changed: treatment.title !== base.title,
    projected_changed: projected !== base.title,
    identity_changes: hybridIdentity.changes,
    rejected_identity_facts: hybridIdentity.rejected_facts,
    candidate_fact_count: (treatment.candidate_facts || []).length,
    candidate_hypothesis_count: (treatment.candidate_hypotheses || []).length,
    hybrid_latency_ms: treatment.latency_ms,
    hybrid_input_tokens: treatment.input_tokens,
    hybrid_output_tokens: treatment.output_tokens
  };
});
const hybridDeltas = cards.map((card) => card.hybrid_delta_f1);
const projectedDeltas = cards.map((card) => card.projected_delta_f1);
const result = {
  schema_version: "canonical-candidate-unseen17-paired-v1",
  authority: "evaluation_only",
  production_promoted: false,
  source: { controlPath, hybridPath, cards: cards.length },
  summary: {
    cards: cards.length,
    control_macro_f1: mean(cards.map((card) => card.control_score.f1)),
    hybrid_macro_f1: mean(cards.map((card) => card.hybrid_score.f1)),
    hybrid_delta_macro_f1: mean(hybridDeltas),
    hybrid_paired: sign(hybridDeltas),
    hybrid_reference_loss_cards: cards.filter((card) => card.hybrid_reference_loss_tokens.length).length,
    projected_macro_f1: mean(cards.map((card) => card.projected_score.f1)),
    projected_delta_macro_f1: mean(projectedDeltas),
    projected_paired: sign(projectedDeltas),
    projected_reference_loss_cards: cards.filter((card) => card.projected_reference_loss_tokens.length).length,
    projected_changed_cards: cards.filter((card) => card.projected_changed).length,
    median_hybrid_latency_ms: [...cards].sort((a, b) => a.hybrid_latency_ms - b.hybrid_latency_ms)[Math.floor(cards.length / 2)]?.hybrid_latency_ms ?? null,
    median_hybrid_input_tokens: [...cards].sort((a, b) => a.hybrid_input_tokens - b.hybrid_input_tokens)[Math.floor(cards.length / 2)]?.hybrid_input_tokens ?? null,
    median_hybrid_output_tokens: [...cards].sort((a, b) => a.hybrid_output_tokens - b.hybrid_output_tokens)[Math.floor(cards.length / 2)]?.hybrid_output_tokens ?? null
  },
  cards
};
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));
