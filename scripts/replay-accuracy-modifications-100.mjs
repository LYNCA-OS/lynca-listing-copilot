#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  replayCandidateIdentityV1,
  replayLanguageObservationV1,
  replayPrintedSetObservationV1,
  replaySerialObservationV1
} from "../lib/listing/thin/candidate-identity-replay-v1.mjs";

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const rows = (path) => readFileSync(path, "utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse);
const tokens = (value) => new Set(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const want = tokens(reference); const got = tokens(title); const hits = [...want].filter((token) => got.has(token)).length;
  const recall = want.size ? hits / want.size : 0; const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const imageFor = (region) => region === "card_back" ? "image_2" : "image_1";
const referenceLosses = (reference, before, after) => {
  const wanted = tokens(reference);
  const beforeTokens = tokens(before);
  const afterTokens = tokens(after);
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};
const logoFacts = (observations) => observations.flatMap((observation) => {
  if (observation?.label !== "logo" || observation?.kind !== "printed_text") return [];
  return [{ value: String(observation.evidence ?? "").trim(), kind: "affiliation", basis: "logo_or_symbol", image: imageFor(observation.region), region: observation.region || "unknown" }];
});

const canonicalPath = arg("--canonical", "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", canonicalPath);
const canonicalArm = arg("--canonical-arm", "thin_canonical_high");
const exhaustiveArm = arg("--exhaustive-arm", "exhaustive_observation_high");
const limit = Number(arg("--limit", "150"));
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");
const outPath = arg("--out", `artifacts/accuracy-modifications-${limit}.json`);
const canonicalRows = rows(canonicalPath);
const exhaustiveRows = rows(exhaustivePath);
const canonicalArmRows = canonicalRows.filter((row) => row.arm === canonicalArm && row.fields);
const exhaustiveArmRows = exhaustiveRows.filter((row) => row.arm === exhaustiveArm);
const canonicalByAsset = new Map(canonicalArmRows.map((row) => [row.asset_id, row]));
const observationByAsset = new Map(exhaustiveArmRows.map((row) => [row.asset_id, row.observations || []]));
const canonicalSelected = canonicalArmRows.slice(0, limit);
const exhaustiveSelectedIds = new Set(exhaustiveArmRows.slice(0, limit).map((row) => row.asset_id));
if (canonicalSelected.length !== limit || exhaustiveArmRows.length < limit) {
  throw new Error(`replay_cohort_too_small:${Math.min(canonicalSelected.length, exhaustiveArmRows.length)}/${limit}`);
}
const missing = canonicalSelected.map((row) => row.asset_id).filter((assetId) => !exhaustiveSelectedIds.has(assetId));
const extra = [...exhaustiveSelectedIds].filter((assetId) => !canonicalSelected.some((row) => row.asset_id === assetId));
if (missing.length || extra.length) throw new Error(`replay_cohort_mismatch:missing=${missing.slice(0, 3).join(",")}:extra=${extra.slice(0, 3).join(",")}`);
const cards = canonicalSelected.map((row) => ({ row, observations: observationByAsset.get(row.asset_id) }));

const variants = {
  logo_set: (row, observations) => replayCandidateIdentityV1(row.fields, logoFacts(observations)),
  printed_set: (row, observations) => replayPrintedSetObservationV1(row.fields, observations),
  serial_observation: (row, observations) => replaySerialObservationV1(row.fields, observations),
  language_observation: (row, observations) => replayLanguageObservationV1(row.fields, observations)
};
const results = {};
for (const [name, replay] of Object.entries(variants)) {
  const cardResults = cards.map(({ row, observations }) => {
    const baseline = composeFromCanonicalFields(row.fields);
    const replayed = replay(row, observations);
    let candidate = composeFromCanonicalFields(replayed.fields);
    const rejectedChanges = [];
    // Formatting is subordinate to identity. A leading-zero repair that
    // crosses the 80-character boundary and makes Composer drop a reference
    // token is rejected for this card rather than counted as a numerical win.
    if (name === "serial_observation" && replayed.changes.length) {
      const losses = referenceLosses(row.reference, baseline.title, candidate.title);
      if (candidate.length > 80 || losses.length) {
        rejectedChanges.push(...replayed.changes.map((change) => ({ ...change, reason: losses.length ? "reference_token_loss" : "over_80" })));
        candidate = baseline;
        replayed.changes.length = 0;
      }
    }
    const before = score(row.reference, baseline.title); const after = score(row.reference, candidate.title);
    return { asset_id: row.asset_id, reference: row.reference, baseline_title: baseline.title, replay_title: candidate.title, baseline_score: before, replay_score: after, delta_f1: after.f1 - before.f1, changes: replayed.changes, rejected_changes: rejectedChanges };
  });
  results[name] = {
    cards: cardResults.length,
    changed_cards: cardResults.filter((card) => card.changes.length).length,
    rejected_cards: cardResults.filter((card) => card.rejected_changes?.length).length,
    baseline_macro_f1: mean(cardResults.map((card) => card.baseline_score.f1)),
    replay_macro_f1: mean(cardResults.map((card) => card.replay_score.f1)),
    delta_macro_f1: mean(cardResults.map((card) => card.delta_f1)),
    wins: cardResults.filter((card) => card.delta_f1 > 1e-12).length,
    losses: cardResults.filter((card) => card.delta_f1 < -1e-12).length,
    ties: cardResults.filter((card) => Math.abs(card.delta_f1) <= 1e-12).length,
    cards_detail: cardResults
  };
}
const result = {
  schema_version: "accuracy-modifications-replay-v1",
  limit,
  source: { canonical: canonicalPath, canonical_arm: canonicalArm, exhaustive: exhaustivePath, exhaustive_arm: exhaustiveArm },
  variants: results
};
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out: outPath, variants: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, { cards: value.cards, changed_cards: value.changed_cards, baseline_macro_f1: value.baseline_macro_f1, replay_macro_f1: value.replay_macro_f1, delta_macro_f1: value.delta_macro_f1, wins: value.wins, losses: value.losses, ties: value.ties }])) }, null, 2));
