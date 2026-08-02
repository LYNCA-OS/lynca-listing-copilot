#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  composeWithDiagnosticOracleDownstreamRecoveryV1,
  titleTokens
} from "../experiments/accuracy/composer-downstream-recovery-v1.mjs";
import {
  COMPOSER_DOWNSTREAM_GENERALIZABLE_MECHANISMS_V1,
  composeWithGeneralizableDownstreamRecoveryV1
} from "../experiments/accuracy/composer-downstream-generalizable-v1.mjs";

const DEFAULT_ROWS = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_ARM = "thin_canonical_high";
const DEFAULT_HIGH100_ROWS = "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_HIGH100_DIAGNOSIS = "artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json";
const DEFAULT_OUT = "artifacts/composer-downstream-recovery-v1-2026-08-02/replay-fresh-150.json";

const valueFor = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const parseRows = (body) => body.split(/\n+/).filter(Boolean).map(JSON.parse);
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function score(reference, title) {
  const wanted = titleTokens(reference);
  const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

const flatten = (value) => {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [String(value ?? "")];
};

const numericLexemes = (value) => new Set(String(value ?? "").match(/\d+(?:[./-]\d+)*/g) ?? []);
const setDifference = (left, right) => [...left].filter((value) => !right.has(value));

function evaluateRows(rows, { enabledMechanisms = null, lane = "generalizable" } = {}) {
  const cards = rows.map((row) => {
    const replay = lane === "diagnostic_oracle"
      ? composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields)
      : composeWithGeneralizableDownstreamRecoveryV1(row.fields, { enabledMechanisms });
    const baselineScore = score(row.reference, replay.baseline.title);
    const candidateScore = score(row.reference, replay.candidate.title);
    const delta = candidateScore.f1 - baselineScore.f1;
    const baselineTokens = titleTokens(replay.baseline.title);
    const candidateTokens = titleTokens(replay.candidate.title);
    const referenceTokens = titleTokens(row.reference);
    const sourceTokens = titleTokens(flatten(row.fields).join(" "));
    const lostReferenceTokens = setDifference(baselineTokens, candidateTokens)
      .filter((token) => referenceTokens.has(token));
    const unbackedNewTokens = setDifference(candidateTokens, baselineTokens)
      .filter((token) => !sourceTokens.has(token));
    const baselineNumbers = numericLexemes(replay.baseline.title);
    const candidateNumbers = numericLexemes(replay.candidate.title);
    const sourceNumbers = numericLexemes(flatten(row.fields).join(" "));
    const lostNumbers = setDifference(baselineNumbers, candidateNumbers);
    const unbackedNumbers = setDifference(candidateNumbers, baselineNumbers)
      .filter((value) => !sourceNumbers.has(value));

    return {
      asset_id: row.asset_id,
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
      lost_reference_tokens: lostReferenceTokens,
      unbacked_new_tokens: unbackedNewTokens,
      numeric_mutation: lostNumbers.length > 0 || unbackedNumbers.length > 0,
      lost_numeric_lexemes: lostNumbers,
      unbacked_numeric_lexemes: unbackedNumbers,
      over_80: replay.candidate.length > 80,
      dropped_before: replay.baseline.dropped,
      dropped_after: replay.candidate.dropped,
      suppressed_before: replay.baseline.suppressed,
      suppressed_after: replay.candidate.suppressed,
      normalization_reasons: replay.candidate.normalization_reasons,
      recovery_reasons: replay.candidate.evaluation_recovery_reasons
    };
  });
  const baselineScores = cards.map((row) => row.baseline_score);
  const candidateScores = cards.map((row) => row.candidate_score);
  return {
    population: cards.length,
    baseline: {
      macro_f1: mean(baselineScores.map((row) => row.f1)),
      macro_recall: mean(baselineScores.map((row) => row.recall)),
      macro_precision: mean(baselineScores.map((row) => row.precision))
    },
    candidate: {
      macro_f1: mean(candidateScores.map((row) => row.f1)),
      macro_recall: mean(candidateScores.map((row) => row.recall)),
      macro_precision: mean(candidateScores.map((row) => row.precision))
    },
    paired: {
      delta_macro_f1: mean(candidateScores.map((row) => row.f1)) - mean(baselineScores.map((row) => row.f1)),
      wins: cards.filter((row) => row.verdict === "WIN").length,
      losses: cards.filter((row) => row.verdict === "LOSS").length,
      ties: cards.filter((row) => row.verdict === "TIE").length,
      changed_cards: cards.filter((row) => row.changed).length
    },
    safety: {
      reference_loss_cards: cards.filter((row) => row.lost_reference_tokens.length).length,
      unbacked_new_token_cards: cards.filter((row) => row.unbacked_new_tokens.length).length,
      numeric_mutation_cards: cards.filter((row) => row.numeric_mutation).length,
      over_80_cards: cards.filter((row) => row.over_80).length
    },
    applied_action_counts: Object.fromEntries([...new Set(cards.flatMap((row) =>
      row.applied.map((action) => action.kind)))].map((kind) => [kind, cards.reduce((count, row) =>
      count + row.applied.filter((action) => action.kind === kind).length, 0)])),
    changed_cards: cards.filter((row) => row.changed),
    rejected_actions: cards.flatMap((row) => row.rejected.map((rejection) => ({
      asset_id: row.asset_id,
      ...rejection
    })))
  };
}

function old53Recovery(rows, diagnosis) {
  const rowByAsset = new Map(rows.map((row) => [row.asset_id, row]));
  const downstreamRows = diagnosis.rows.filter((row) => row.causes?.downstream_composition?.length);
  const occurrences = downstreamRows.reduce((sum, row) => sum + row.causes.downstream_composition.length, 0);
  invariant(occurrences === 53, `downstream_ledger_not_53:${occurrences}`);
  const detail = [];
  for (const diagnosed of downstreamRows) {
    const row = rowByAsset.get(diagnosed.asset_id);
    invariant(row?.fields, `high100_row_missing:${diagnosed.asset_id}`);
    const generalizable = composeWithGeneralizableDownstreamRecoveryV1(row.fields);
    const diagnosticOracle = composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields);
    const baselineTokens = titleTokens(generalizable.baseline.title);
    const generalizableTokens = titleTokens(generalizable.candidate.title);
    const oracleTokens = titleTokens(diagnosticOracle.candidate.title);
    const baselinePresent = diagnosed.causes.downstream_composition.filter((token) => baselineTokens.has(token));
    const generalizableIncremental = diagnosed.causes.downstream_composition
      .filter((token) => !baselineTokens.has(token) && generalizableTokens.has(token));
    const oracleIncremental = diagnosed.causes.downstream_composition
      .filter((token) => !generalizableTokens.has(token) && oracleTokens.has(token));
    const remaining = diagnosed.causes.downstream_composition.filter((token) => !oracleTokens.has(token));
    detail.push({
      asset_id: row.asset_id,
      audited_occurrences: diagnosed.causes.downstream_composition,
      baseline_present: baselinePresent,
      generalizable_incremental: generalizableIncremental,
      diagnostic_oracle_incremental: oracleIncremental,
      remaining,
      baseline_title: generalizable.baseline.title,
      generalizable_title: generalizable.candidate.title,
      diagnostic_oracle_title: diagnosticOracle.candidate.title,
      generalizable_applied: generalizable.applied,
      diagnostic_oracle_applied: diagnosticOracle.applied.filter((action) =>
        !generalizable.applied.some((candidate) => candidate.kind === action.kind)),
      rejected: diagnosticOracle.rejected
    });
  }
  return {
    audited_occurrences: 53,
    current_composer_present: detail.reduce((sum, row) => sum + row.baseline_present.length, 0),
    generalizable_incremental_recovered: detail.reduce((sum, row) => sum + row.generalizable_incremental.length, 0),
    diagnostic_oracle_incremental_recovered: detail.reduce((sum, row) => sum + row.diagnostic_oracle_incremental.length, 0),
    total_recovered_with_diagnostic_oracle: detail.reduce((sum, row) => sum
      + row.baseline_present.length
      + row.generalizable_incremental.length
      + row.diagnostic_oracle_incremental.length, 0),
    remaining: detail.reduce((sum, row) => sum + row.remaining.length, 0),
    remaining_detail: detail.filter((row) => row.remaining.length).map((row) => ({
      asset_id: row.asset_id,
      tokens: row.remaining
    })),
    detail
  };
}

const rowsPath = resolve(valueFor("--rows", DEFAULT_ROWS));
const arm = valueFor("--arm", DEFAULT_ARM);
const high100RowsPath = resolve(valueFor("--high100-rows", DEFAULT_HIGH100_ROWS));
const diagnosisPath = resolve(valueFor("--diagnosis", DEFAULT_HIGH100_DIAGNOSIS));
const outPath = resolve(valueFor("--out", DEFAULT_OUT));

const rowsBody = readFileSync(rowsPath, "utf8");
const high100Body = readFileSync(high100RowsPath, "utf8");
const diagnosisBody = readFileSync(diagnosisPath, "utf8");
const rows = parseRows(rowsBody).filter((row) => row.arm === arm && row.fields);
const high100Rows = parseRows(high100Body).filter((row) => row.arm === "thin_canonical_high" && row.fields);
const diagnosis = JSON.parse(diagnosisBody);

invariant(rows.length === 150, `fresh_replay_population_not_150:${rows.length}`);
invariant(new Set(rows.map((row) => row.asset_id)).size === 150, "fresh_replay_duplicate_asset_ids");
invariant(high100Rows.length === 100, `high100_population_not_100:${high100Rows.length}`);

const generalizable = evaluateRows(rows);
const diagnosticOracle = evaluateRows(rows, { lane: "diagnostic_oracle" });
const ablations = Object.fromEntries(COMPOSER_DOWNSTREAM_GENERALIZABLE_MECHANISMS_V1.map((mechanism) => [
  mechanism,
  evaluateRows(rows, { enabledMechanisms: [mechanism] })
]));
const old53 = old53Recovery(high100Rows, diagnosis);

const result = {
  schema_version: "composer-downstream-recovery-v1",
  evaluation_only: true,
  provider_calls: 0,
  source: {
    rows_path: rowsPath,
    rows_sha256: sha256(rowsBody),
    arm,
    high100_rows_path: high100RowsPath,
    high100_rows_sha256: sha256(high100Body),
    diagnosis_path: diagnosisPath,
    diagnosis_sha256: sha256(diagnosisBody)
  },
  generalizable_mechanisms: COMPOSER_DOWNSTREAM_GENERALIZABLE_MECHANISMS_V1,
  old_downstream_53: old53,
  fresh_150_generalizable: generalizable,
  fresh_150_diagnostic_oracle: diagnosticOracle,
  ablations
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  schema_version: result.schema_version,
  out: outPath,
  provider_calls: 0,
  old_downstream_53: {
    current_composer_present: old53.current_composer_present,
    generalizable_incremental_recovered: old53.generalizable_incremental_recovered,
    diagnostic_oracle_incremental_recovered: old53.diagnostic_oracle_incremental_recovered,
    total_recovered_with_diagnostic_oracle: old53.total_recovered_with_diagnostic_oracle,
    remaining: old53.remaining,
    remaining_detail: old53.remaining_detail
  },
  fresh_150_generalizable: {
    delta_macro_f1: generalizable.paired.delta_macro_f1,
    wins: generalizable.paired.wins,
    losses: generalizable.paired.losses,
    ties: generalizable.paired.ties,
    changed_cards: generalizable.paired.changed_cards,
    safety: generalizable.safety,
    applied_action_counts: generalizable.applied_action_counts
  },
  fresh_150_diagnostic_oracle: {
    delta_macro_f1: diagnosticOracle.paired.delta_macro_f1,
    wins: diagnosticOracle.paired.wins,
    losses: diagnosticOracle.paired.losses,
    ties: diagnosticOracle.paired.ties,
    changed_cards: diagnosticOracle.paired.changed_cards,
    safety: diagnosticOracle.safety
  },
  ablations: Object.fromEntries(Object.entries(ablations).map(([name, value]) => [name, {
    delta_macro_f1: value.paired.delta_macro_f1,
    wins: value.paired.wins,
    losses: value.paired.losses,
    ties: value.paired.ties,
    changed_cards: value.paired.changed_cards,
    safety: value.safety
  }]))
}, null, 2));
