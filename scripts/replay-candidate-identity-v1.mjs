#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { replayCandidateIdentityV1 } from "../lib/listing/thin/candidate-identity-replay-v1.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const readRows = (path) => readFileSync(path, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tokenise = (value) => new Set(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = tokenise(reference); const got = tokenise(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const canonicalPath = arg("--canonical", "artifacts/canonical-v4/thin-path-gpt-5.6-luna.jsonl");
const candidatePath = arg("--candidates", "artifacts/candidate-expression-v3/mechanism6/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/candidate-expression-v3/mechanism6/identity-replay-v1.json");
const candidateByAsset = new Map(readRows(candidatePath).map((row) => [row.asset_id, row.candidate_facts || []]));
const rows = readRows(canonicalPath).filter((row) => row.fields && candidateByAsset.has(row.asset_id));
const cards = rows.map((row) => {
  const baseline = composeFromCanonicalFields(row.fields);
  const replay = replayCandidateIdentityV1(row.fields, candidateByAsset.get(row.asset_id));
  const candidate = composeFromCanonicalFields(replay.fields);
  const before = score(row.reference, baseline.title);
  const after = score(row.reference, candidate.title);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    replay_title: candidate.title,
    baseline_score: before,
    replay_score: after,
    delta_f1: after.f1 - before.f1,
    changes: replay.changes,
    baseline_composer: baseline,
    replay_composer: candidate
  };
});
const changed = cards.filter((card) => card.changes.length);
const result = {
  resolver: "candidate-identity-replay-v1",
  authority: "evaluation_only",
  source: { canonical: canonicalPath, candidates: candidatePath },
  cards: cards.length,
  changed_cards: changed.length,
  baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
  replay_macro_f1: mean(cards.map((card) => card.replay_score.f1)),
  delta_macro_f1: mean(cards.map((card) => card.delta_f1)),
  wins: cards.filter((card) => card.delta_f1 > 1e-12).length,
  losses: cards.filter((card) => card.delta_f1 < -1e-12).length,
  ties: cards.filter((card) => Math.abs(card.delta_f1) <= 1e-12).length,
  cards
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  resolver: result.resolver,
  cards: result.cards,
  changed_cards: result.changed_cards,
  baseline_macro_f1: result.baseline_macro_f1,
  replay_macro_f1: result.replay_macro_f1,
  delta_macro_f1: result.delta_macro_f1,
  wins: result.wins,
  losses: result.losses,
  ties: result.ties,
  out: outPath
}, null, 2));

