#!/usr/bin/env node

// Zero-cost interaction replay. Open expression is admitted through the
// identity-v3 resolver first; each already-screened narrow overlay is then
// proposed one at a time. A card-level budget or reference-token regression
// rejects that proposal before the next overlay sees it.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replayCandidateIdentityV3 } from "../lib/listing/thin/candidate-identity-replay-v3.mjs";
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
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};

const canonicalPath = arg("--canonical", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const candidatePath = arg("--candidates", "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl");
const controlPath = arg("--control", canonicalPath);
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/candidate-expression-v4/expression-v4-narrow-bundle-replay-150-2026-08-02.json");
const mechanismNames = [
  "finish_family_color_only",
  "rarity_sar_only",
  "printed_trainer_gallery",
  "printed_first_bowman",
  "product_known_manufacturer_extension",
  "serial_single_digit"
];

const canonical = new Map(rows(canonicalPath).filter((row) => row.arm === "thin_canonical" && row.fields).map((row) => [row.asset_id, row]));
const candidates = new Map(rows(candidatePath).map((row) => [row.asset_id, row]));
const control = new Map(rows(controlPath).filter((row) => row.arm === "thin_budgeted").map((row) => [row.asset_id, row]));
const exhaustive = new Map(rows(exhaustivePath).map((row) => [row.asset_id, row]));

const cards = [...canonical.values()].filter((row) => candidates.has(row.asset_id)).map((row) => {
  const candidate = candidates.get(row.asset_id);
  const freeControl = control.get(row.asset_id);
  const observation = exhaustive.get(row.asset_id);
  if (!freeControl || !observation) throw new Error(`paired_cohort_mismatch:${row.asset_id}`);

  const baseline = composeFromCanonicalFields(row.fields);
  const baselineScore = score(row.reference, baseline.title);
  const identity = replayCandidateIdentityV3(row.fields, candidate.candidate_facts || []);
  let currentFields = identity.fields;
  let currentTitle = composeFromCanonicalFields(currentFields).title;
  const freeFields = projectFreeTitleThroughCsm(freeControl.title).fields;
  const stages = { identity: currentTitle };
  const changes = { identity: identity.changes };
  const blocked = [];

  for (const mechanism of mechanismNames) {
    const proposal = applyAccuracyMechanismV2(mechanism, currentFields, {
      freeFields,
      freeTitle: freeControl.title,
      observations: observation.observations || []
    });
    const proposedTitle = composeFromCanonicalFields(proposal.fields).title;
    const losses = referenceLosses(row.reference, currentTitle, proposedTitle);
    const reason = proposal.blocked
      || (proposedTitle.length > 80 ? "over_80" : null)
      || (losses.length ? "reference_loss" : null);
    if (reason) {
      blocked.push({ mechanism, reason, losses });
      stages[mechanism] = currentTitle;
      changes[mechanism] = [];
      continue;
    }
    currentFields = proposal.fields;
    currentTitle = proposedTitle;
    stages[mechanism] = currentTitle;
    changes[mechanism] = proposal.changed ? [mechanism] : [];
  }

  const finalScore = score(row.reference, currentTitle);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    stage_titles: stages,
    baseline_score: baselineScore,
    final_score: finalScore,
    delta_f1: finalScore.f1 - baselineScore.f1,
    over_80: currentTitle.length > 80,
    reference_loss_tokens: referenceLosses(row.reference, baseline.title, currentTitle),
    changes,
    blocked,
    rejected_identity_facts: identity.rejected_facts
  };
});

const stageSummary = (name) => {
  const deltas = cards.map((card) => score(card.reference, card.stage_titles[name]).f1 - card.baseline_score.f1);
  return {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => score(card.reference, card.stage_titles[name]).f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card.stage_titles[name] !== card.baseline_title).length
  };
};

const result = {
  schema_version: "expression-v4-narrow-bundle-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  source: { canonicalPath, controlPath, candidatePath, exhaustivePath, limit: cards.length, control_arm: "thin_budgeted" },
  mechanisms: ["candidate_expression_v4_identity_v3", ...mechanismNames],
  summary: {
    identity: stageSummary("identity"),
    ...Object.fromEntries(mechanismNames.map((name) => [name, stageSummary(name)])),
    final: {
      baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
      candidate_macro_f1: mean(cards.map((card) => card.final_score.f1)),
      delta_macro_f1: mean(cards.map((card) => card.delta_f1)),
      ...sign(cards.map((card) => card.delta_f1)),
      changed_cards: cards.filter((card) => card.stage_titles.serial_single_digit !== card.baseline_title).length,
      reference_loss_cards: cards.filter((card) => card.reference_loss_tokens.length).length,
      over_80: cards.filter((card) => card.over_80).length
    }
  },
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary: result.summary }, null, 2));
