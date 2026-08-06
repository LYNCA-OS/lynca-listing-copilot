#!/usr/bin/env node

// Zero-cost replay of the standalone candidate-expression-v4 channel through
// the guarded identity-v3 resolver. This measures whether the model's open
// facts are useful without a second provider call or production authority.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replayCandidateIdentityV3 } from "../lib/listing/thin/candidate-identity-replay-v3.mjs";

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const rows = (path) => readFileSync(path, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokens(reference); const got = tokens(title); const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0; const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference); const oldTokens = tokens(before); const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const canonicalPath = arg("--canonical", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const candidatePath = arg("--candidates", "artifacts/candidate-expression-v4/development-150/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/candidate-expression-v4/development-150/identity-replay-v3.json");
const canonical = new Map(rows(canonicalPath).filter((row) => row.arm === "thin_canonical" && row.fields).map((row) => [row.asset_id, row]));
const candidatePaths = candidatePath.split(",").map((path) => path.trim()).filter(Boolean);
const candidates = new Map();
for (const path of candidatePaths) {
  for (const row of rows(path)) {
    if (candidates.has(row.asset_id)) throw new Error(`duplicate_candidate_asset:${row.asset_id}`);
    candidates.set(row.asset_id, row.candidate_facts || []);
  }
}
const cards = [...canonical.values()].filter((row) => candidates.has(row.asset_id)).map((row) => {
  const baseline = composeFromCanonicalFields(row.fields);
  const replay = replayCandidateIdentityV3(row.fields, candidates.get(row.asset_id));
  const candidate = composeFromCanonicalFields(replay.fields);
  const before = score(row.reference, baseline.title); const after = score(row.reference, candidate.title);
  return { asset_id: row.asset_id, reference: row.reference, baseline_title: baseline.title, replay_title: candidate.title,
    baseline_score: before, replay_score: after, delta_f1: after.f1 - before.f1,
    over_80: candidate.title.length > 80,
    reference_loss_tokens: referenceLosses(row.reference, baseline.title, candidate.title),
    changes: replay.changes,
    rejected_facts: replay.rejected_facts };
});
const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "candidate-expression-v4-identity-v3-replay",
  resolver: "candidate-identity-replay-v3",
  authority: "evaluation_only",
  production_promoted: false,
  source: { canonical: canonicalPath, candidates: candidatePaths, candidate_arm: "candidate_expression_v4_high" },
  cards: cards.length,
  changed_cards: cards.filter((card) => card.changes.length).length,
  baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
  replay_macro_f1: mean(cards.map((card) => card.replay_score.f1)),
  delta_macro_f1: mean(deltas),
  wins: deltas.filter((delta) => delta > 1e-12).length,
  losses: deltas.filter((delta) => delta < -1e-12).length,
  ties: deltas.filter((delta) => Math.abs(delta) <= 1e-12).length,
  over_80: cards.filter((card) => card.over_80).length,
  reference_loss_cards: cards.filter((card) => card.reference_loss_tokens.length).length,
  cards_detail: cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ resolver: result.resolver, cards: result.cards, changed_cards: result.changed_cards,
  baseline_macro_f1: result.baseline_macro_f1, replay_macro_f1: result.replay_macro_f1,
  delta_macro_f1: result.delta_macro_f1, wins: result.wins, losses: result.losses, ties: result.ties, out: outPath }, null, 2));
