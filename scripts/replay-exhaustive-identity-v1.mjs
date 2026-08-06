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
const imageFor = (region) => region === "card_back" ? "image_2" : "image_1";

function factsFromObservations(observations = []) {
  return observations.flatMap((observation) => {
    if (observation?.label !== "logo" || observation?.kind !== "printed_text") return [];
    const value = String(observation.evidence ?? "").replace(/\s+/g, " ").trim();
    if (!value) return [];
    return [{
      value,
      kind: "affiliation",
      basis: "logo_or_symbol",
      image: imageFor(observation.region),
      region: observation.region || "unknown",
      uncertainty: "none"
    }];
  });
}

const canonicalPath = arg("--canonical", "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl");
const outPath = arg("--out", "artifacts/extreme-observation-2026-08-01/identity-replay-exhaustive-v1-100.json");
const canonicalByAsset = new Map(readRows(canonicalPath).filter((row) => row.arm === "thin_canonical_high" && row.fields)
  .map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(readRows(exhaustivePath).filter((row) => row.arm === "exhaustive_observation_high")
  .map((row) => [row.asset_id, row]));
const rows = [...canonicalByAsset.entries()].flatMap(([assetId, row]) => {
  const observation = exhaustiveByAsset.get(assetId);
  return observation ? [{ row, observation }] : [];
});
const cards = rows.map(({ row, observation }) => {
  const facts = factsFromObservations(observation.observations);
  const baseline = composeFromCanonicalFields(row.fields);
  const replay = replayCandidateIdentityV1(row.fields, facts);
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
    source_logo_facts: facts,
    changes: replay.changes
  };
});
const result = {
  resolver: "candidate-identity-replay-v1",
  source: { canonical: canonicalPath, exhaustive: exhaustivePath },
  cards: cards.length,
  changed_cards: cards.filter((card) => card.changes.length).length,
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
  resolver: result.resolver, cards: result.cards, changed_cards: result.changed_cards,
  baseline_macro_f1: result.baseline_macro_f1, replay_macro_f1: result.replay_macro_f1,
  delta_macro_f1: result.delta_macro_f1, wins: result.wins, losses: result.losses,
  ties: result.ties, out: outPath
}, null, 2));

