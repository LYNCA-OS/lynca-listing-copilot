#!/usr/bin/env node

// Zero-cost paired replay of the open-expression v4 identity channel followed
// by the already screened product and serial overlays.  This is an evaluation
// artifact only: it never calls the provider and never changes production
// authority.

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
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};

const canonicalPath = arg("--canonical", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const candidatePath = arg("--candidates", "artifacts/candidate-expression-v4/development-150-merged-2026-08-02.jsonl");
const controlPath = arg("--control", canonicalPath);
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/candidate-expression-v4/expression-v4-bundle-replay-150-2026-08-02.json");

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
  const identity = replayCandidateIdentityV3(row.fields, candidate.candidate_facts || []);
  const freeFields = projectFreeTitleThroughCsm(freeControl.title).fields;
  const product = applyAccuracyMechanismV2("product_known_manufacturer_extension", identity.fields, { freeFields, freeTitle: freeControl.title });
  const serial = replaySerialObservationSingleDigitV1(product.fields, observation.observations || []);
  const titles = {
    identity: composeFromCanonicalFields(identity.fields).title,
    product: composeFromCanonicalFields(product.fields).title,
    bundle: composeFromCanonicalFields(serial.fields).title
  };
  const baselineScore = score(row.reference, baseline.title);
  // A formatting repair is not a gain if the extra character crosses the
  // marketplace budget and forces a higher-priority identity bracket out.
  // Keep the mechanism measurable, but reject that card-level promotion.
  const serialLosses = referenceLosses(row.reference, titles.product, titles.bundle);
  const serialBlocked = serial.changes.length && (titles.bundle.length > 80 || serialLosses.length)
    ? (titles.bundle.length > 80 ? "over_80_after_serial" : "reference_loss_after_serial")
    : null;
  if (serialBlocked) titles.bundle = titles.product;
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    stage_titles: titles,
    baseline_score: baselineScore,
    stage_scores: Object.fromEntries(Object.entries(titles).map(([name, title]) => [name, score(row.reference, title)])),
    delta_f1: score(row.reference, titles.bundle).f1 - baselineScore.f1,
    over_80: titles.bundle.length > 80,
    reference_loss_tokens: referenceLosses(row.reference, baseline.title, titles.bundle),
    changes: { identity: identity.changes, product: product.changed ? [product.fields.product] : [], serial: serial.changes },
    blocked: { product: product.blocked || null, serial: serialBlocked },
    rejected_identity_facts: identity.rejected_facts
  };
});

const stageSummary = (name) => {
  const deltas = cards.map((card) => card.stage_scores[name].f1 - card.baseline_score.f1);
  return {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.stage_scores[name].f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card.stage_titles[name] !== card.baseline_title).length
  };
};

const result = {
  schema_version: "expression-v4-accuracy-bundle-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  source: { canonicalPath, controlPath, candidatePath, exhaustivePath, limit: cards.length, control_arm: "thin_budgeted" },
  mechanisms: ["candidate_expression_v4_identity_v3", "product_known_manufacturer_extension_v2", "serial_single_digit_v1"],
  summary: {
    identity: stageSummary("identity"),
    product: stageSummary("product"),
    bundle: stageSummary("bundle"),
    reference_loss_cards: cards.filter((card) => card.reference_loss_tokens.length).length,
    over_80: cards.filter((card) => card.over_80).length
  },
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, summary: result.summary }, null, 2));
