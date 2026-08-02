#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const DEFAULT_ROWS = "artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_DIAGNOSIS = "artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json";

const valueFor = (argv, name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const tokenise = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

const flattenTokens = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenTokens);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenTokens);
  return [...tokenise(String(value ?? "").replace(/\s*\/\s*/g, "/"))];
};

function isSanctionedNormalization(token, candidateTokens) {
  return /^(?:autograph|autographs|autographed|autos?)$/.test(token)
    && candidateTokens.has("auto");
}

function score(reference, candidate) {
  const wanted = tokenise(reference);
  const got = tokenise(candidate);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function signTest(deltas) {
  const wins = deltas.filter((value) => value > 1e-12).length;
  const losses = deltas.filter((value) => value < -1e-12).length;
  const trials = wins + losses;
  if (!trials) return { wins, losses, ties: deltas.length, p_two_sided: 1 };
  const tailK = Math.min(wins, losses);
  let coefficient = 1;
  let tail = 1;
  for (let k = 1; k <= tailK; k += 1) {
    coefficient = (coefficient * (trials - k + 1)) / k;
    tail += coefficient;
  }
  return {
    wins,
    losses,
    ties: deltas.length - trials,
    p_two_sided: Math.min(1, 2 * tail * (0.5 ** trials))
  };
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

export function analyzeCanonicalComposerRecovery(rows, diagnosis = null, {
  arm = "thin_canonical_high",
  baselineCompose = null,
  baselineSource = "stored_title"
} = {}) {
  const sourceRows = rows.filter((row) => row.arm === arm);
  const downstreamByAsset = new Map((diagnosis?.rows || [])
    .map((row) => [row.asset_id, row.causes?.downstream_composition || []]));
  const reasonCounts = {};
  const changed = [];
  const deltas = [];
  let overBudget = 0;
  let recoveredDownstreamOccurrences = 0;
  const recoveredDownstreamCards = new Set();
  const baselineTitles = new Map(sourceRows.map((row) => [
    row.asset_id,
    baselineCompose ? baselineCompose(row.fields || {}).title : row.title
  ]));

  for (const row of sourceRows) {
    const candidate = composeFromCanonicalFields(row.fields || {});
    const baselineTitle = baselineTitles.get(row.asset_id);
    const baselineScore = score(row.reference, baselineTitle);
    const candidateScore = score(row.reference, candidate.title);
    const delta = candidateScore.f1 - baselineScore.f1;
    deltas.push(delta);
    if (candidate.length > 80) overBudget += 1;

    const baselineTokens = tokenise(baselineTitle);
    const candidateTokens = tokenise(candidate.title);
    const referenceTokens = tokenise(row.reference);
    const fieldTokens = new Set(flattenTokens(row.fields || {}));
    if ([...fieldTokens].some((token) => /^(?:autograph|autographs|autographed|autos?)$/.test(token))) {
      fieldTokens.add("auto");
    }
    const newTokens = [...candidateTokens].filter((token) => !baselineTokens.has(token));
    const removedTokens = [...baselineTokens].filter((token) => !candidateTokens.has(token));
    const newReferenceTokens = newTokens.filter((token) => referenceTokens.has(token));
    const rawLostReferenceTokens = removedTokens.filter((token) => referenceTokens.has(token));
    const normalizedReferenceTokens = rawLostReferenceTokens
      .filter((token) => isSanctionedNormalization(token, candidateTokens));
    const lostReferenceTokens = rawLostReferenceTokens
      .filter((token) => !normalizedReferenceTokens.includes(token));
    const unbackedNewTokens = newTokens.filter((token) => !fieldTokens.has(token));
    const downstreamRecovered = (downstreamByAsset.get(row.asset_id) || [])
      .filter((token) => candidateTokens.has(token));
    if (downstreamRecovered.length) {
      recoveredDownstreamCards.add(row.asset_id);
      recoveredDownstreamOccurrences += downstreamRecovered.length;
    }

    for (const reason of candidate.normalization_reasons || []) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    if (candidate.title !== baselineTitle) {
      changed.push({
        asset_id: row.asset_id,
        verdict: delta > 1e-12 ? "WIN" : delta < -1e-12 ? "LOSS" : "TIE",
        delta_f1: delta,
        reference: row.reference,
        baseline_title: baselineTitle,
        candidate_title: candidate.title,
        new_reference_tokens: newReferenceTokens,
        normalized_reference_tokens: normalizedReferenceTokens,
        lost_reference_tokens: lostReferenceTokens,
        unbacked_new_tokens: unbackedNewTokens,
        downstream_recovered_tokens: downstreamRecovered,
        dropped_before: row.dropped_brackets || [],
        dropped_after: candidate.dropped,
        normalization_reasons: candidate.normalization_reasons || []
      });
    }
  }

  const baselineScores = sourceRows.map((row) => score(row.reference, baselineTitles.get(row.asset_id)));
  const candidateScores = sourceRows.map((row) => score(row.reference,
    composeFromCanonicalFields(row.fields || {}).title));
  const sign = signTest(deltas);
  const cardsWithLostReferenceTokens = changed.filter((row) => row.lost_reference_tokens.length);
  const cardsWithUnbackedNewTokens = changed.filter((row) => row.unbacked_new_tokens.length);
  const downstreamTotal = diagnosis?.stages?.downstream_composition?.token_occurrences ?? null;

  return {
    schema_version: "canonical-composer-recovery-analysis-v1",
    source_arm: arm,
    baseline_source: baselineSource,
    population: sourceRows.length,
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
      delta_macro_recall: mean(candidateScores.map((row) => row.recall)) - mean(baselineScores.map((row) => row.recall)),
      delta_macro_precision: mean(candidateScores.map((row) => row.precision)) - mean(baselineScores.map((row) => row.precision)),
      changed_cards: changed.length,
      ...sign
    },
    downstream_53: {
      recovered_occurrences: recoveredDownstreamOccurrences,
      total_occurrences: downstreamTotal,
      recovered_share: downstreamTotal ? recoveredDownstreamOccurrences / downstreamTotal : null,
      recovered_cards: recoveredDownstreamCards.size
    },
    safety: {
      over_80_characters: overBudget,
      cards_with_lost_reference_tokens: cardsWithLostReferenceTokens.length,
      cards_with_unbacked_new_tokens: cardsWithUnbackedNewTokens.length,
      critical_wrong_proxy: cardsWithLostReferenceTokens.length + cardsWithUnbackedNewTokens.length
    },
    normalization_reason_counts: reasonCounts,
    promotion_gate: {
      default_eligible: sign.wins > sign.losses
        && cardsWithLostReferenceTokens.length === 0
        && cardsWithUnbackedNewTokens.length === 0
        && overBudget === 0,
      note: "Eligibility is offline evidence for deterministic serialization only; it does not validate suppressed team/card-number or absent lot brackets."
    },
    changed_rows: changed
  };
}

async function loadComposerAtCommit(commit) {
  const root = mkdtempSync(join(tmpdir(), "lynca-composer-baseline-"));
  const files = [
    "lib/listing/thin/canonical-composer.mjs",
    "lib/listing/thin/marketplace-composer-rules.mjs",
    "lib/listing/csm/sem-definition.mjs",
    "lib/listing/csm/product-semantics.mjs"
  ];
  try {
    for (const file of files) {
      const output = execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8" });
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, output);
    }
    const module = await import(`${pathToFileURL(join(root, files[0])).href}?baseline=${encodeURIComponent(commit)}`);
    return module.composeFromCanonicalFields;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const argv = process.argv.slice(2);
  const rowsPath = valueFor(argv, "--rows", DEFAULT_ROWS);
  const diagnosisPath = valueFor(argv, "--diagnosis", DEFAULT_DIAGNOSIS);
  const arm = valueFor(argv, "--arm", "thin_canonical_high");
  const out = valueFor(argv, "--out");
  const baselineCommit = valueFor(argv, "--baseline-commit");
  const rows = readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const diagnosis = diagnosisPath && diagnosisPath !== "none"
    ? JSON.parse(readFileSync(diagnosisPath, "utf8"))
    : null;
  const baselineCompose = baselineCommit ? await loadComposerAtCommit(baselineCommit) : null;
  const result = analyzeCanonicalComposerRecovery(rows, diagnosis, {
    arm,
    baselineCompose,
    baselineSource: baselineCommit ? `git:${baselineCommit}` : "stored_title"
  });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
