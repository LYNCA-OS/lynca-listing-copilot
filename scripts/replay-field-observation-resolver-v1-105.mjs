#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyFieldObservationResolverV1, FIELD_OBSERVATION_RESOLVER_V1 } from "../experiments/accuracy/field-observation-resolver-v1.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const ROOT = resolve(".");
const INPUT = resolve(ROOT, "artifacts/accuracy-field-observation-v2-105-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const OUTPUT = resolve(ROOT, "artifacts/accuracy-field-observation-v2-105-2026-08-02/resolver-v1-replay.json");
const TREATMENT = "thin_canonical_field_observation_v2_high";

const tokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hit = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hit / wanted.size : 0;
  const precision = got.size ? hit / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const numericTokens = (value) => [...tokens(value)].filter((token) => /\d/.test(token));

function main() {
  const body = readFileSync(INPUT, "utf8");
  const rows = body.split(/\n+/).filter(Boolean).map(JSON.parse).filter((row) => row.arm === TREATMENT);
  if (rows.length !== 105) throw new Error(`expected_105_observation_rows:${rows.length}`);
  const cards = rows.map((row) => {
    const base = composeFromCanonicalFields(row.fields || {});
    const replay = applyFieldObservationResolverV1(row.fields || {}, row.observations || [], { baselineTitle: row.title });
    const beforeScore = score(row.reference, row.title);
    const afterScore = score(row.reference, replay.title);
    const beforeNumbers = numericTokens(row.title);
    const afterNumbers = numericTokens(replay.title);
    const referenceLosses = [...tokens(row.reference)].filter((token) => tokens(row.title).has(token) && !tokens(replay.title).has(token));
    return {
      asset_id: row.asset_id,
      reference: row.reference,
      before_title: row.title,
      after_title: replay.title,
      before_f1: beforeScore.f1,
      after_f1: afterScore.f1,
      delta_f1: afterScore.f1 - beforeScore.f1,
      observations: row.observations || [],
      decisions: replay.decisions,
      changed_fields: replay.changed_fields,
      guards: replay.guards,
      applied: replay.applied,
      over_80: replay.title.length > 80,
      numeric_tokens_before: beforeNumbers,
      numeric_tokens_after: afterNumbers,
      reference_losses: referenceLosses,
      canonical_title_replay_matches_row: base.title === row.title
    };
  });
  const deltas = cards.map((card) => card.delta_f1);
  const wins = deltas.filter((delta) => delta > 1e-12).length;
  const losses = deltas.filter((delta) => delta < -1e-12).length;
  const result = {
    schema_version: `${FIELD_OBSERVATION_RESOLVER_V1}-replay-105`,
    authority: "evaluation_only",
    production_promoted: false,
    provider_calls: 0,
    source: { input: INPUT, input_sha256: sha256(body), cards: cards.length, arm: TREATMENT },
    summary: {
      n: cards.length,
      wins,
      losses,
      ties: cards.length - wins - losses,
      before_f1: cards.reduce((sum, card) => sum + card.before_f1, 0) / cards.length,
      after_f1: cards.reduce((sum, card) => sum + card.after_f1, 0) / cards.length,
      mean_delta_f1: deltas.reduce((sum, delta) => sum + delta, 0) / cards.length,
      applied_cards: cards.filter((card) => card.applied).length,
      admitted_decisions: cards.flatMap((card) => card.decisions).filter((row) => row.disposition === "admitted").length,
      candidate_only_decisions: cards.flatMap((card) => card.decisions).filter((row) => row.disposition === "candidate_only").length,
      reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
      over_80_cards: cards.filter((card) => card.over_80).length,
      replay_mismatch_cards: cards.filter((card) => !card.canonical_title_replay_matches_row).length
    },
    gate: {
      mechanism_threshold_met: wins >= 8 && losses === 0 && (deltas.reduce((sum, delta) => sum + delta, 0) / cards.length) >= 0.003,
      decision: wins >= 8 && losses === 0 && (deltas.reduce((sum, delta) => sum + delta, 0) / cards.length) >= 0.003
        ? "KEEP_FOR_INDEPENDENT_CONFIRMATION"
        : "SAFE_NARROW_REPAIR_BUT_NOT_A_BIG_HEAD"
    },
    cards
  };
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...result.summary, gate: result.gate, output: OUTPUT }, null, 2)}\n`);
}

main();

