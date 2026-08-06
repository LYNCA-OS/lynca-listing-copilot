#!/usr/bin/env node

// Offline, evaluation-only comparison of the stored canonical title and the
// stored v4 visible-fact identity projection.  The provider was called only
// for candidate facts; no new request is made here and no production path is
// imported.

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
  const wanted = tokens(reference);
  const got = tokens(title);
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
  const wanted = tokens(reference);
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
};

const canonicalPath = arg("--canonical", "artifacts/accuracy-unseen17-thin-canonical-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const candidatePath = arg("--candidates", "artifacts/accuracy-unseen17-candidate-v4-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/accuracy-unseen17-candidate-v4-2026-08-02/identity-replay.json");

const canonical = new Map((await rows(canonicalPath))
  .filter((row) => row.arm === "thin_canonical" && row.fields)
  .map((row) => [row.asset_id, row]));
const candidates = new Map((await rows(candidatePath)).map((row) => [row.asset_id, row]));
const cards = [...canonical.values()].filter((row) => candidates.has(row.asset_id)).map((row) => {
  const candidate = candidates.get(row.asset_id);
  const baseline = composeFromCanonicalFields(row.fields).title;
  const replay = replayCandidateIdentityV3(row.fields, candidate.candidate_facts || []);
  const projected = composeFromCanonicalFields(replay.fields).title;
  const baselineScore = score(row.reference, baseline);
  const candidateScore = score(row.reference, projected);
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline,
    candidate_title: projected,
    baseline_score: baselineScore,
    candidate_score: candidateScore,
    delta_f1: candidateScore.f1 - baselineScore.f1,
    changed: baseline !== projected,
    reference_loss_tokens: referenceLosses(row.reference, baseline, projected),
    changes: replay.changes,
    rejected_facts: replay.rejected_facts
  };
});
const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "unseen17-candidate-v4-identity-replay-v1",
  authority: "evaluation_only",
  production_promoted: false,
  source: { canonicalPath, candidatePath, cards: cards.length },
  summary: {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.candidate_score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: cards.filter((card) => card.changed).length,
    reference_loss_cards: cards.filter((card) => card.reference_loss_tokens.length).length,
    proposed_set_cards: cards.filter((card) => card.changes.some((change) => change.field === "set")).length
  },
  cards
};
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));
