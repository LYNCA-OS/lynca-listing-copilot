#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeTypedParetoV1,
  typedParetoSemanticTokens
} from "../experiments/accuracy/typed-pareto-composer-v1.mjs";

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(arg("--manifest", resolve(repositoryRoot,
  "docs/evaluation/typed-pareto-composer-v1-evidence-manifest-2026-08-08.json")));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schema_version !== "typed-pareto-composer-v1-evidence-v1"
  || !manifest.dataset_id || !manifest.source_checkout_env
  || !manifest.source_checkout_sibling || !manifest.relative_path || !manifest.sha256
  || !manifest.arm || !Number.isInteger(manifest.count)) {
  throw new Error(`typed_pareto_invalid_evidence_manifest:${manifestPath}`);
}
const configuredSourceCheckout = String(process.env[manifest.source_checkout_env] || "").trim();
const sourceCheckout = configuredSourceCheckout
  ? resolve(configuredSourceCheckout)
  : resolve(dirname(repositoryRoot), manifest.source_checkout_sibling);
const manifestInputPath = resolve(sourceCheckout, manifest.relative_path);
const explicitInput = arg("--input");
const inputPath = explicitInput ? resolve(explicitInput) : manifestInputPath;
const expectedSha256 = arg("--sha256",
  inputPath === manifestInputPath ? manifest.sha256 : null);
if (!expectedSha256) {
  throw new Error("typed_pareto_explicit_input_requires_sha256:pass --sha256 <expected>");
}
const outPath = resolve(arg("--out",
  "artifacts/typed-pareto-composer-v1/replay-150.json"));
const expected = Number(arg("--count", String(manifest.count)));
if (expected !== manifest.count) throw new Error(
  `typed_pareto_replay_count_must_match_manifest:${expected}:${manifest.count}`
);
const selectedArm = arg("--arm", manifest.arm);
if (selectedArm !== manifest.arm) {
  throw new Error(`typed_pareto_arm_must_match_manifest:${selectedArm}:${manifest.arm}`);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const tokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const numbers = (value) => [...clean(value).matchAll(/\d+/g)].map((match) => String(Number(match[0])));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const signs = (values) => ({
  wins: values.filter((value) => value > 1e-12).length,
  losses: values.filter((value) => value < -1e-12).length,
  ties: values.filter((value) => Math.abs(value) <= 1e-12).length
});

let body;
try {
  body = await readFile(inputPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  throw new Error(
    `typed_pareto_evidence_missing:${inputPath}:restore the manifest-pinned source artifact or pass --input <path> --sha256 <expected>`
  );
}
const actualSha256 = sha256(body);
if (actualSha256 !== expectedSha256) {
  throw new Error(`typed_pareto_input_sha256_mismatch:${actualSha256}:${expectedSha256}`);
}
const allRows = body.toString("utf8").split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
const rows = allRows.filter((row) => row.arm === selectedArm);
if (rows.length !== expected || new Set(rows.map((row) => row.asset_id)).size !== expected) {
  throw new Error(`typed_pareto_complete_150_mismatch:${rows.length}`);
}
if (rows.some((row) => !row.fields || !clean(row.reference))) {
  throw new Error("typed_pareto_input_missing_fields_or_label");
}

function evaluateMechanism(row, mechanism) {
  const replay = composeTypedParetoV1(row.fields, {
    enabledMechanisms: mechanism.enabled
  });
  const baseline = score(row.reference, replay.baseline.title);
  const candidate = score(row.reference, replay.candidate.title);
  const baselineTokens = tokens(replay.baseline.title);
  const candidateTokens = tokens(replay.candidate.title);
  const referenceTokens = tokens(row.reference);
  const baselineSemanticTokens = typedParetoSemanticTokens(replay.baseline.title);
  const candidateSemanticTokens = typedParetoSemanticTokens(replay.candidate.title);
  const referenceSemanticTokens = typedParetoSemanticTokens(row.reference);
  const lexicalReferenceLosses = [...baselineTokens].filter((token) => (
    referenceTokens.has(token) && !candidateTokens.has(token)
  ));
  const referenceLosses = [...baselineSemanticTokens].filter((token) => (
    referenceSemanticTokens.has(token) && !candidateSemanticTokens.has(token)
  ));
  const subjectTokens = tokens((row.fields.subjects || []).join(" "));
  const subjectLosses = [...subjectTokens].filter((token) => (
    baselineTokens.has(token) && !candidateTokens.has(token)
  ));
  const safeOracle = replay.safe_frontier.map((frontier) => ({
    title: frontier.title,
    f1: score(row.reference, frontier.title).f1
  })).sort((left, right) => right.f1 - left.f1 || left.title.localeCompare(right.title))[0];
  const numericSemanticError = !replay.candidate.preserves_numeric_semantics;
  return {
    asset_id: row.asset_id,
    grammar: replay.baseline.grammar,
    reference: row.reference,
    baseline_title: replay.baseline.title,
    candidate_title: replay.candidate.title,
    baseline_f1: baseline.f1,
    candidate_f1: candidate.f1,
    delta_f1: candidate.f1 - baseline.f1,
    changed: replay.candidate.changed,
    historical_baseline_drift: replay.baseline.title !== row.title,
    reference_losses: referenceLosses,
    lexical_reference_losses: lexicalReferenceLosses,
    numeric_claim_change: JSON.stringify(numbers(replay.baseline.title))
      !== JSON.stringify(numbers(replay.candidate.title)),
    numeric_semantic_error: numericSemanticError,
    subject_drift: subjectLosses.length > 0,
    subject_losses: subjectLosses,
    over_80: replay.candidate.length > 80,
    baseline_dropped: replay.baseline.dropped,
    restored_vs_baseline: replay.candidate.restored_vs_baseline,
    displaced_vs_baseline: replay.candidate.displaced_vs_baseline,
    normalizations: replay.candidate.normalizations,
    mechanisms: replay.candidate.mechanisms,
    selection_reason: replay.candidate.selection_reason,
    reason_ledger: replay.candidate.reason_ledger,
    drop_ledger: replay.candidate.drop_ledger,
    candidate_count: replay.candidate_count,
    frontier_count: replay.frontier.length,
    unsafe_frontier_candidate_count: replay.frontier.filter((candidate) => (
      !candidate.preserves_baseline_tokens
      || !candidate.preserves_baseline_brackets
      || !candidate.preserves_numeric_semantics
    )).length,
    safe_frontier_count: replay.safe_frontier.length,
    diagnostic_safe_frontier_oracle_title: safeOracle?.title || replay.baseline.title,
    diagnostic_safe_frontier_oracle_f1: safeOracle?.f1 ?? baseline.f1
  };
}

const mechanismDefinitions = [
  { id: "pareto_without_new_compaction", enabled: [] },
  { id: "grading_auth_auto", enabled: ["grading_auth_auto"] }
];
const mechanismCards = Object.fromEntries(mechanismDefinitions.map((mechanism) => [
  mechanism.id,
  rows.map((row) => evaluateMechanism(row, mechanism))
]));
const cards = mechanismCards.grading_auth_auto;

const deltas = cards.map((card) => card.delta_f1);
const oracleDeltas = cards.map((card) => card.diagnostic_safe_frontier_oracle_f1 - card.baseline_f1);
const countBy = (values) => Object.fromEntries([...values.reduce((counts, value) => (
  counts.set(value, (counts.get(value) || 0) + 1)
), new Map())].sort(([left], [right]) => left.localeCompare(right)));
function summarize(cardsForMechanism) {
  const mechanismDeltas = cardsForMechanism.map((card) => card.delta_f1);
  const macroBaseline = mean(cardsForMechanism.map((card) => card.baseline_f1));
  const macroCandidate = mean(cardsForMechanism.map((card) => card.candidate_f1));
  return {
    cards: cardsForMechanism.length,
    changed: cardsForMechanism.filter((card) => card.changed).length,
    wins: signs(mechanismDeltas).wins,
    losses: signs(mechanismDeltas).losses,
    ties: signs(mechanismDeltas).ties,
    baseline_macro_f1: macroBaseline,
    candidate_macro_f1: macroCandidate,
    delta_f1: macroCandidate - macroBaseline,
    critical: {
      reference_loss_cards: cardsForMechanism.filter((card) => card.reference_losses.length).length,
      numeric_semantic_error_cards: cardsForMechanism.filter((card) => card.numeric_semantic_error).length,
      subject_drift_cards: cardsForMechanism.filter((card) => card.subject_drift).length
    },
    over_80: cardsForMechanism.filter((card) => card.over_80).length
  };
}

const summary = {
  cards: cards.length,
  baseline_macro_f1: mean(cards.map((card) => card.baseline_f1)),
  candidate_macro_f1: mean(cards.map((card) => card.candidate_f1)),
  delta_f1: mean(deltas),
  ...signs(deltas),
  changed_cards: cards.filter((card) => card.changed).length,
  reference_loss_cards: cards.filter((card) => card.reference_losses.length).length,
  lexical_reference_loss_cards: cards.filter((card) => card.lexical_reference_losses.length).length,
  historical_baseline_drift_cards: cards.filter((card) => card.historical_baseline_drift).length,
  numeric_claim_change_cards: cards.filter((card) => card.numeric_claim_change).length,
  numeric_semantic_error_cards: cards.filter((card) => card.numeric_semantic_error).length,
  subject_drift_cards: cards.filter((card) => card.subject_drift).length,
  over_80_cards: cards.filter((card) => card.over_80).length,
  candidate_count_average: mean(cards.map((card) => card.candidate_count)),
  candidate_count_max: Math.max(...cards.map((card) => card.candidate_count)),
  frontier_count_average: mean(cards.map((card) => card.frontier_count)),
  unsafe_frontier_candidate_count: cards.reduce((sum, card) => (
    sum + card.unsafe_frontier_candidate_count
  ), 0),
  safe_frontier_count_average: mean(cards.map((card) => card.safe_frontier_count)),
  baseline_dropped_by_bracket: countBy(cards.flatMap((card) => card.baseline_dropped)),
  candidate_dropped_by_bracket: countBy(cards.flatMap((card) => (
    card.drop_ledger.map((entry) => entry.bracket)
  ))),
  restored_by_bracket: countBy(cards.flatMap((card) => card.restored_vs_baseline)),
  per_mechanism: Object.fromEntries(Object.entries(mechanismCards).map(([id, values]) => (
    [id, summarize(values)]
  ))),
  diagnostic_safe_frontier_oracle_macro_f1: mean(cards.map((card) => (
    card.diagnostic_safe_frontier_oracle_f1
  ))),
  diagnostic_safe_frontier_oracle_signs: signs(oracleDeltas)
};
summary.diagnostic_safe_frontier_oracle_delta_f1 = summary.diagnostic_safe_frontier_oracle_macro_f1
  - summary.baseline_macro_f1;
const gate = {
  delta_f1_at_least_0003: summary.delta_f1 >= 0.003,
  at_least_8_wins: summary.wins >= 8,
  zero_losses: summary.losses === 0,
  zero_reference_loss: summary.reference_loss_cards === 0,
  zero_numeric_semantic_error: summary.numeric_semantic_error_cards === 0,
  zero_subject_drift: summary.subject_drift_cards === 0,
  zero_over_80: summary.over_80_cards === 0
};
const result = {
  schema_version: "typed-pareto-composer-v1-replay-v2",
  authority: "evaluation_only",
  provider_calls: 0,
  production_composer_changed: false,
  input: {
    manifest_path: manifestPath,
    path: inputPath,
    sha256: actualSha256,
    selected_arm: selectedArm
  },
  summary,
  gate,
  decision: Object.values(gate).every(Boolean) ? "PASS_FOR_FRESH_CONFIRMATION" : "STOP",
  oracle_boundary: "diagnostic_safe_frontier_oracle reads labels only after safety filtering and candidate generation; it cannot promote the selector",
  changed_cards: cards.filter((card) => card.changed),
  budget_cards: cards.filter((card) => card.baseline_dropped.length || card.drop_ledger.length),
  loss_cards: cards.filter((card) => card.delta_f1 < -1e-12)
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
