#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  LOT_CONTRACT_RECOVERY_MECHANISMS_V1,
  composeWithLotContractRecoveryV1
} from "../experiments/accuracy/lot-contract-recovery-v1.mjs";
import { titleTokens } from "../experiments/accuracy/composer-downstream-recovery-v1.mjs";

const DEFAULT_ROWS = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_ARM = "thin_canonical_high";
const DEFAULT_OUT = "artifacts/lot-contract-recovery-v1-2026-08-02/replay-fresh-150.json";

const valueFor = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const parseRows = (body) => body.split(/\n+/).filter(Boolean).map(JSON.parse);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const flatten = (value) => {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [String(value ?? "")];
};
const numericLexemes = (value) => new Set(String(value ?? "").match(/\d+(?:[./-]\d+)*/g) ?? []);

function score(reference, title) {
  const wanted = titleTokens(reference);
  const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function evaluate(rows, enabledMechanisms) {
  const cards = rows.map((row) => {
    const replay = composeWithLotContractRecoveryV1(row.fields, { enabledMechanisms });
    const baselineScore = score(row.reference, replay.baseline.title);
    const candidateScore = score(row.reference, replay.candidate.title);
    const delta = candidateScore.f1 - baselineScore.f1;
    const baselineTokens = titleTokens(replay.baseline.title);
    const candidateTokens = titleTokens(replay.candidate.title);
    const referenceTokens = titleTokens(row.reference);
    const grammarTokens = row.fields?.lot_count ? `lotx${row.fields.lot_count}` : "";
    const sourceText = `${flatten(row.fields).join(" ")} ${grammarTokens}`;
    const sourceTokens = titleTokens(sourceText);
    const baselineNumbers = numericLexemes(replay.baseline.title);
    const candidateNumbers = numericLexemes(replay.candidate.title);
    const sourceNumbers = numericLexemes(sourceText);
    return {
      asset_id: row.asset_id,
      grammar: row.fields?.grammar,
      reference: row.reference,
      baseline_title: replay.baseline.title,
      candidate_title: replay.candidate.title,
      baseline_score: baselineScore,
      candidate_score: candidateScore,
      delta_f1: delta,
      verdict: delta > 1e-12 ? "WIN" : delta < -1e-12 ? "LOSS" : "TIE",
      changed: replay.baseline.title !== replay.candidate.title,
      applied: replay.applied,
      rejected: replay.rejected,
      lost_reference_tokens: difference(baselineTokens, candidateTokens).filter((token) => referenceTokens.has(token)),
      unbacked_new_tokens: difference(candidateTokens, baselineTokens).filter((token) => !sourceTokens.has(token)),
      lost_numeric_lexemes: difference(baselineNumbers, candidateNumbers),
      unbacked_numeric_lexemes: difference(candidateNumbers, baselineNumbers).filter((token) => !sourceNumbers.has(token)),
      over_80: replay.candidate.length > 80,
      dropped_before: replay.baseline.dropped,
      dropped_after: replay.candidate.dropped
    };
  });
  const baselineF1 = mean(cards.map((row) => row.baseline_score.f1));
  const candidateF1 = mean(cards.map((row) => row.candidate_score.f1));
  return {
    population: cards.length,
    lot_population: cards.filter((row) => row.grammar === "lot").length,
    baseline_macro_f1: baselineF1,
    candidate_macro_f1: candidateF1,
    delta_macro_f1: candidateF1 - baselineF1,
    wins: cards.filter((row) => row.verdict === "WIN").length,
    losses: cards.filter((row) => row.verdict === "LOSS").length,
    ties: cards.filter((row) => row.verdict === "TIE").length,
    changed_cards: cards.filter((row) => row.changed).length,
    safety: {
      reference_loss_cards: cards.filter((row) => row.lost_reference_tokens.length).length,
      unbacked_new_token_cards: cards.filter((row) => row.unbacked_new_tokens.length).length,
      numeric_mutation_cards: cards.filter((row) => row.lost_numeric_lexemes.length || row.unbacked_numeric_lexemes.length).length,
      over_80_cards: cards.filter((row) => row.over_80).length
    },
    changed_detail: cards.filter((row) => row.changed)
  };
}

const rowsPath = resolve(valueFor("--rows", DEFAULT_ROWS));
const arm = valueFor("--arm", DEFAULT_ARM);
const outPath = resolve(valueFor("--out", DEFAULT_OUT));
const rowsBody = readFileSync(rowsPath, "utf8");
const rows = parseRows(rowsBody).filter((row) => row.arm === arm && row.fields);
if (rows.length !== 150) throw new Error(`replay_population_not_150:${rows.length}`);
if (new Set(rows.map((row) => row.asset_id)).size !== 150) throw new Error("duplicate_asset_ids");

const combined = evaluate(rows, LOT_CONTRACT_RECOVERY_MECHANISMS_V1);
const ablations = Object.fromEntries(LOT_CONTRACT_RECOVERY_MECHANISMS_V1.map((mechanism) => [
  mechanism,
  evaluate(rows, [mechanism])
]));
const result = {
  schema_version: "lot-contract-recovery-v1",
  evaluation_only: true,
  provider_calls: 0,
  source: { rows_path: rowsPath, rows_sha256: sha256(rowsBody), arm },
  mechanisms: LOT_CONTRACT_RECOVERY_MECHANISMS_V1,
  combined,
  ablations
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  schema_version: result.schema_version,
  out: outPath,
  provider_calls: 0,
  combined: {
    delta_macro_f1: combined.delta_macro_f1,
    wins: combined.wins,
    losses: combined.losses,
    ties: combined.ties,
    changed_cards: combined.changed_cards,
    safety: combined.safety
  },
  ablations: Object.fromEntries(Object.entries(ablations).map(([name, value]) => [name, {
    delta_macro_f1: value.delta_macro_f1,
    wins: value.wins,
    losses: value.losses,
    ties: value.ties,
    changed_cards: value.changed_cards,
    safety: value.safety
  }]))
}, null, 2));

