#!/usr/bin/env node
// Evaluation only. Replays stored provider bytes through the current parser,
// CSM/SEM and Composer. It never imports a provider client or performs I/O
// other than reading the frozen corpus and writing the requested report.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAccuracyLossLedger,
  validateAccuracyLossLedger
} from "../lib/listing/thin/accuracy-loss-ledger.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";
import { printFinishSuggestion } from "../lib/listing/csm/title-derived-sem.mjs";
import {
  composeWithDiagnosticOracleDownstreamRecoveryV1,
  titleTokens
} from "../experiments/accuracy/composer-downstream-recovery-v1.mjs";
import {
  composeWithGeneralizableDownstreamRecoveryV1
} from "../experiments/accuracy/composer-downstream-generalizable-v1.mjs";
import { analyzeExhaustiveRows } from "./analyze-exhaustive-observation.mjs";

const DEFAULT_CANONICAL = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_EXHAUSTIVE = "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_MANIFEST = "docs/evaluation/post-luna-current-main-150-corpus-manifest-2026-08-08.json";
const DEFAULT_JSON = "docs/evaluation/post-luna-current-main-150-2026-08-08.json";
const DEFAULT_MD = "docs/evaluation/post-luna-current-main-150-2026-08-08.md";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = Object.freeze({
  manifest_schema_version: "post-luna-current-main-150-corpus-manifest-v1",
  canonical_path: DEFAULT_CANONICAL,
  exhaustive_path: DEFAULT_EXHAUSTIVE,
  canonical_sha256: "2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5",
  exhaustive_sha256: "96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9",
  canonical_arm: "thin_canonical_high",
  exhaustive_arm: "exhaustive_observation_high",
  cards: 150
});

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJsonl = (body) => body.split(/\n+/).filter(Boolean).map(JSON.parse);
const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten)
  : value && typeof value === "object" ? Object.values(value).flatMap(flatten)
    : [String(value ?? "")];
const PROVIDER_EVIDENCE_FIELDS = Object.freeze([
  "year", "manufacturer", "product", "language", "set", "card_name",
  "release_variant", "surface_color", "parallel_family", "parallel_exact",
  "descriptive_rarity", "subjects", "team", "card_number", "serial",
  "attributes", "grade", "lot_count"
]);

// Metadata values such as `unreadable: ["card_number"]` are not evidence that
// the card actually says "card number". Unknown future keys also fail closed.
export function providerEvidenceText(providerValue = {}) {
  return PROVIDER_EVIDENCE_FIELDS.flatMap((field) => flatten(providerValue[field]))
    .join(" ");
}

// Keep numeric claims distinct from numeric-looking identity words. `49ers`
// and `76ers` are team names, while `DF-3`, `2023-24`, `2/8`, and `9.5` are
// numeric-bearing claims whose addition/removal belongs in the safety ledger.
export function numericClaims(value) {
  let text = String(value ?? "");
  const claims = [];
  text = text.replace(/#?\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)+\b/gi, (claim) => {
    claims.push(claim.replace(/^#/, "").toLowerCase());
    return " ";
  });
  for (const match of text.matchAll(/(?<![a-z0-9])\d+(?:[./-]\d+)*(?![a-z0-9])/gi)) {
    claims.push(match[0]);
  }
  return new Set(claims);
}

function readRequiredEvaluationFile(path, kind) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`post_luna_required_${kind}_unavailable:${path}:authorized_local_input_required`);
    }
    throw error;
  }
}

export function loadCorpusManifest(path = resolve(REPO_ROOT, DEFAULT_MANIFEST)) {
  const absolute = resolve(REPO_ROOT, path);
  const body = readRequiredEvaluationFile(absolute, "corpus_manifest");
  const manifest = JSON.parse(body);
  const canonical = manifest?.corpora?.canonical;
  const exhaustive = manifest?.corpora?.exhaustive;
  if (manifest?.schema_version !== EXPECTED.manifest_schema_version
    || manifest?.authority !== "evaluation_only"
    || manifest?.contains_raw_provider_output !== false
    || manifest?.portability?.clean_checkout_replayable !== false
    || manifest?.portability?.raw_corpora_git_tracked !== false
    || manifest?.portability?.missing_or_mismatched_input_behavior !== "fail_closed"
    || manifest?.portability?.production_copy_allowed !== false
    || canonical?.path !== EXPECTED.canonical_path
    || canonical?.sha256 !== EXPECTED.canonical_sha256
    || canonical?.selected_arm !== EXPECTED.canonical_arm
    || canonical?.expected_selected_rows !== EXPECTED.cards
    || exhaustive?.path !== EXPECTED.exhaustive_path
    || exhaustive?.sha256 !== EXPECTED.exhaustive_sha256
    || exhaustive?.selected_arm !== EXPECTED.exhaustive_arm
    || exhaustive?.expected_selected_rows !== EXPECTED.cards) {
    throw new Error("post_luna_corpus_manifest_contract_mismatch");
  }
  return { path: absolute, body, sha256: sha256(body), manifest };
}

export function buildReplaySourceContract(entryPath = fileURLToPath(import.meta.url)) {
  const seen = new Set();
  const hashes = {};
  const visit = (path) => {
    const absolute = resolve(path);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const body = readFileSync(absolute, "utf8");
    const repoPath = relative(REPO_ROOT, absolute);
    if (repoPath.startsWith("..")) throw new Error(`post_luna_replay_source_outside_repo:${absolute}`);
    hashes[repoPath] = sha256(body);
    const imports = [...body.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)]
      .map((match) => match[1]);
    for (const specifier of imports) visit(resolve(dirname(absolute), specifier));
  };
  visit(entryPath);
  const sha256ByPath = Object.fromEntries(Object.entries(hashes)
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    files: Object.keys(sha256ByPath).length,
    aggregate_sha256: sha256(Object.entries(sha256ByPath)
      .map(([path, hash]) => `${path}\0${hash}\n`).join("")),
    sha256_by_path: sha256ByPath
  };
}

function score(reference, title) {
  const wanted = titleTokens(reference);
  const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
}

function signSummary(deltas) {
  return {
    wins: deltas.filter((value) => value > 1e-12).length,
    losses: deltas.filter((value) => value < -1e-12).length,
    ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
  };
}

function assertCohort(canonicalRows, exhaustiveRows) {
  const canonical = canonicalRows.filter((row) => row.arm === EXPECTED.canonical_arm);
  const exhaustive = exhaustiveRows.filter((row) => row.arm === EXPECTED.exhaustive_arm);
  if (canonical.length !== EXPECTED.cards || exhaustive.length !== EXPECTED.cards) {
    throw new Error(`post_luna_complete_150_mismatch:${canonical.length}/${exhaustive.length}`);
  }
  const canonicalById = new Map(canonical.map((row) => [row.asset_id, row]));
  const exhaustiveById = new Map(exhaustive.map((row) => [row.asset_id, row]));
  if (canonicalById.size !== EXPECTED.cards || exhaustiveById.size !== EXPECTED.cards) {
    throw new Error("post_luna_duplicate_asset_id");
  }
  for (const [assetId, row] of canonicalById) {
    const paired = exhaustiveById.get(assetId);
    if (!paired || paired.reference !== row.reference || !row.raw_title
      || !Array.isArray(paired.observations)) {
      throw new Error(`post_luna_pair_binding_mismatch:${assetId}`);
    }
    if (!row.image_set_sha256 || !paired.image_set_sha256
      || row.image_set_sha256 !== paired.image_set_sha256) {
      throw new Error(`post_luna_image_set_mismatch:${assetId}`);
    }
    for (const field of ["image_count", "image_detail", "model", "served_model",
      "requested_effort", "served_effort"]) {
      if (row[field] === null || row[field] === undefined
        || paired[field] === null || paired[field] === undefined
        || row[field] !== paired[field]) {
        throw new Error(`post_luna_nuisance_mismatch:${field}:${assetId}`);
      }
    }
  }
  return {
    canonical,
    exhaustive,
    pairing: {
      paired_assets: EXPECTED.cards,
      reference_verified_pairs: EXPECTED.cards,
      image_set_verified_pairs: EXPECTED.cards,
      configuration_verified_pairs: EXPECTED.cards
    }
  };
}

function summarizeLedger(currentRows) {
  const fields = {};
  const admittedReasonCodes = {};
  const composerReasonCodes = {};
  for (const row of currentRows) {
    const ledger = row.accuracy_loss_ledger;
    for (const entry of ledger.stages.admitted_canonical_fields.fields) {
      fields[entry.field] ||= {};
      fields[entry.field][entry.status] = (fields[entry.field][entry.status] || 0) + 1;
      for (const reason of entry.reason_codes) {
        admittedReasonCodes[reason] = (admittedReasonCodes[reason] || 0) + 1;
      }
    }
    for (const reason of ledger.stages.composed_bracket_ledger.reason_codes) {
      composerReasonCodes[reason] = (composerReasonCodes[reason] || 0) + 1;
    }
  }
  return { fields, admitted_reason_codes: admittedReasonCodes, composer_reason_codes: composerReasonCodes };
}

function summarizeCandidates(currentRows, candidateFor) {
  const cards = currentRows.map((row) => {
    const candidate = candidateFor(row);
    const before = score(row.reference, row.title);
    const after = score(row.reference, candidate.title);
    const baselineTokens = titleTokens(row.title);
    const candidateTokens = titleTokens(candidate.title);
    const referenceTokens = titleTokens(row.reference);
    const sourceText = providerEvidenceText(row.provider_value);
    const sourceTokens = titleTokens(sourceText);
    const baselineNumbers = numericClaims(row.title);
    const candidateNumbers = numericClaims(candidate.title);
    const sourceNumbers = numericClaims(sourceText);
    const deltaF1 = after.f1 - before.f1;
    const lostBaselineTokens = difference(baselineTokens, candidateTokens);
    const addedNumericClaims = difference(candidateNumbers, baselineNumbers);
    const lostNumericClaims = difference(baselineNumbers, candidateNumbers);
    return {
      asset_id: row.asset_id,
      reference: row.reference,
      baseline_title: row.title,
      candidate_title: candidate.title,
      delta_f1: deltaF1,
      outcome: deltaF1 > 1e-12 ? "win" : deltaF1 < -1e-12 ? "loss" : "tie",
      changed: candidate.title !== row.title,
      evaluation_recovery_reasons: candidate.evaluation_recovery_reasons ?? [],
      lost_baseline_tokens: lostBaselineTokens,
      lost_reference_tokens: lostBaselineTokens.filter((token) => referenceTokens.has(token)),
      unbacked_new_tokens: difference(candidateTokens, baselineTokens)
        .filter((token) => !sourceTokens.has(token)),
      numeric_claim_changed: addedNumericClaims.length > 0 || lostNumericClaims.length > 0,
      added_numeric_claims: addedNumericClaims,
      lost_numeric_claims: lostNumericClaims,
      unbacked_numeric_claims: addedNumericClaims.filter((value) => !sourceNumbers.has(value)),
      over_80: candidate.title.length > 80
    };
  });
  const deltas = cards.map((row) => row.delta_f1);
  return {
    cards: cards.length,
    baseline_macro_f1: mean(currentRows.map((row) => score(row.reference, row.title).f1)),
    candidate_macro_f1: mean(currentRows.map((row, index) =>
      score(row.reference, cards[index].candidate_title).f1)),
    delta_macro_f1: mean(deltas),
    ...signSummary(deltas),
    changed_cards: cards.filter((row) => row.changed).length,
    critical: {
      baseline_token_loss_cards: cards.filter((row) => row.lost_baseline_tokens.length).length,
      reference_loss_cards: cards.filter((row) => row.lost_reference_tokens.length).length,
      unbacked_new_token_cards: cards.filter((row) => row.unbacked_new_tokens.length).length,
      numeric_claim_change_cards: cards.filter((row) => row.numeric_claim_changed).length,
      numeric_claim_add_cards: cards.filter((row) => row.added_numeric_claims.length).length,
      numeric_claim_loss_cards: cards.filter((row) => row.lost_numeric_claims.length).length,
      unbacked_numeric_claim_cards: cards.filter((row) => row.unbacked_numeric_claims.length).length,
      over_80_cards: cards.filter((row) => row.over_80).length
    },
    changed_card_rows: cards.filter((row) => row.changed)
  };
}

function restoreAllWithheldFinish(row) {
  const fields = {
    ...row.fields,
    surface_color: String(row.provider_value.surface_color || "").trim(),
    parallel_family: String(row.provider_value.parallel_family || "").trim(),
    parallel_exact: String(row.provider_value.parallel_exact || "").trim()
  };
  fields.print_finish = printFinishSuggestion(fields) || "";
  return composeFromCanonicalFields(fields);
}

function profileWithout(...suppressedFields) {
  const removed = new Set(suppressedFields);
  return {
    ...MARKETPLACE_PROFILES.ebay,
    suppress: Object.fromEntries(Object.entries(MARKETPLACE_PROFILES.ebay.suppress)
      .map(([field, values]) => [field, removed.has(field) ? [] : values]))
  };
}

function summarizeRecovery(currentRows, lane) {
  return summarizeCandidates(currentRows, (row) => lane === "diagnostic_oracle"
    ? composeWithDiagnosticOracleDownstreamRecoveryV1(row.asset_id, row.fields).candidate
    : composeWithGeneralizableDownstreamRecoveryV1(row.fields).candidate);
}

function stageOracles(currentRows, diagnosis) {
  const diagnosisById = new Map(diagnosis.rows.map((row) => [row.asset_id, row]));
  return Object.fromEntries(Object.keys(diagnosis.stages).map((stage) => {
    const deltas = currentRows.map((row) => {
      const restored = titleTokens(row.title);
      for (const token of diagnosisById.get(row.asset_id)?.causes?.[stage] || []) restored.add(token);
      return score(row.reference, [...restored].join(" ")).f1 - score(row.reference, row.title).f1;
    });
    return [stage, {
      token_occurrences: diagnosis.stages[stage].token_occurrences,
      affected_cards: diagnosis.stages[stage].affected_cards,
      oracle_delta_f1: mean(deltas),
      oracle_macro_f1: mean(currentRows.map((row) => score(row.reference, row.title).f1)) + mean(deltas),
      oracle_win_cards: deltas.filter((value) => value > 1e-12).length,
      scope: "add-only recovery of reference tokens assigned to this earliest stage",
      interpretation: "label-reading all-missing-token addition oracle; upper bound only within this add-only scope; not a mechanism"
    }];
  }));
}

export function analyzePostLunaCurrent150({ canonicalRows, exhaustiveRows }) {
  const cohort = assertCohort(canonicalRows, exhaustiveRows);
  const currentRows = cohort.canonical.map((row) => {
    const result = finishCanonicalTitle(row.raw_title);
    const ledger = validateAccuracyLossLedger(buildAccuracyLossLedger({
      rawProviderOutput: row.raw_title,
      result
    }), { result });
    return {
      asset_id: row.asset_id,
      reference: row.reference,
      historical_title: row.title,
      provider_value: JSON.parse(row.raw_title),
      ...result,
      accuracy_loss_ledger: ledger
    };
  });
  const diagnosis = analyzeExhaustiveRows([
    ...currentRows.map((row) => ({ ...row, arm: "thin_canonical_high" })),
    ...cohort.exhaustive
  ]);
  const historicalDeltas = currentRows.map((row) =>
    score(row.reference, row.title).f1 - score(row.reference, row.historical_title).f1);
  return {
    schema_version: "post-luna-current-main-150-v1",
    authority: "evaluation_only",
    provider_calls: 0,
    production_runtime_changed: false,
    cohort: {
      cards: EXPECTED.cards,
      canonical_arm: EXPECTED.canonical_arm,
      exhaustive_arm: EXPECTED.exhaustive_arm,
      pairing: cohort.pairing
    },
    current_vs_historical: {
      historical_macro_f1: mean(currentRows.map((row) => score(row.reference, row.historical_title).f1)),
      current_macro_f1: mean(currentRows.map((row) => score(row.reference, row.title).f1)),
      delta_macro_f1: mean(historicalDeltas),
      ...signSummary(historicalDeltas),
      changed_cards: currentRows.filter((row) => row.title !== row.historical_title).length
    },
    earliest_boundary: {
      counts: diagnosis.stages,
      reference_oracles: stageOracles(currentRows, diagnosis)
    },
    accuracy_loss_ledger: summarizeLedger(currentRows),
    constraint_removal: {
      all_withheld_finish: summarizeCandidates(currentRows, restoreAllWithheldFinish),
      search_optimization: summarizeCandidates(currentRows, (row) =>
        composeFromCanonicalFields(row.fields, { profile: profileWithout("search_optimization") })),
      card_number: summarizeCandidates(currentRows, (row) =>
        composeFromCanonicalFields(row.fields, { profile: profileWithout("card_number") })),
      both_profile_suppressions: summarizeCandidates(currentRows, (row) =>
        composeFromCanonicalFields(row.fields, { profile: profileWithout("search_optimization", "card_number") }))
    },
    composer_recovery: {
      generalizable: summarizeRecovery(currentRows, "generalizable"),
      diagnostic_reference_oracle: summarizeRecovery(currentRows, "diagnostic_oracle")
    }
  };
}

const format = (value) => Number(value).toFixed(6);
export function reportMarkdown(report) {
  const fieldRows = Object.entries(report.accuracy_loss_ledger.fields)
    .map(([name, statuses]) => `| ${name} | ${Object.entries(statuses).map(([status, count]) => `${status}=${count}`).join(", ")} |`)
    .join("\n");
  const reasonRows = Object.entries(report.accuracy_loss_ledger.admitted_reason_codes)
    .filter(([name]) => !["VALUE_UNCHANGED", "EMPTY_AT_INPUT", "CSM_SEM_NORMALIZED", "CSM_SEM_DERIVED"].includes(name))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join("\n");
  const boundaryRows = Object.entries(report.earliest_boundary.reference_oracles)
    .map(([name, row]) => `| ${name} | ${row.token_occurrences} | ${row.affected_cards} | +${format(row.oracle_delta_f1)} |`)
    .join("\n");
  const constraintRows = Object.entries(report.constraint_removal)
    .map(([name, row]) => `| ${name} | ${format(row.delta_macro_f1)} | ${row.wins}/${row.losses}/${row.ties} | ${row.changed_cards} | ${row.critical.baseline_token_loss_cards}/${row.critical.reference_loss_cards}/${row.critical.unbacked_new_token_cards}/${row.critical.numeric_claim_add_cards}/${row.critical.numeric_claim_loss_cards}/${row.critical.unbacked_numeric_claim_cards}/${row.critical.over_80_cards} |`)
    .join("\n");
  const recoveryRows = Object.entries(report.composer_recovery)
    .map(([name, row]) => `| ${name} | ${format(row.delta_macro_f1)} | ${row.wins}/${row.losses}/${row.ties} | ${row.changed_cards} | ${row.critical.baseline_token_loss_cards}/${row.critical.reference_loss_cards}/${row.critical.unbacked_new_token_cards}/${row.critical.numeric_claim_add_cards}/${row.critical.numeric_claim_loss_cards}/${row.critical.unbacked_numeric_claim_cards}/${row.critical.over_80_cards} |`)
    .join("\n");
  const inputs = report.inputs || {};
  return `# Post-Luna current-main 150-card zero-call replay — 2026-08-08

## Decision

The four measured removals (withheld finish, search optimization, card number, and both profile suppressions) are negative on the same stored provider responses. This does **not** prove that every constraint is beneficial. The exact current-main replay preserves the historical 109 schema-compression and 63 downstream-composition occurrence counts; current code changes which individual downstream tokens move, so historical rows must not be treated as current output.

Provider calls: **0**. Production runtime changes: **none**.

Current macro F1 is **${format(report.current_vs_historical.current_macro_f1)}**; the stored historical titles score ${format(report.current_vs_historical.historical_macro_f1)}. Current recomposition is ${report.current_vs_historical.wins}/${report.current_vs_historical.losses}/${report.current_vs_historical.ties} versus historical.

## Earliest boundary

| boundary | occurrences | cards | reference-oracle F1 delta |
|---|---:|---:|---:|
${boundaryRows}

The deltas restore reviewed-title tokens by reading the label. They are add-only, stage-scoped upper bounds, not mechanisms or promotion evidence.

## Current accuracy-loss ledger

| field | current-main admission status counts |
|---|---|
${fieldRows}

| non-routine reason | occurrences |
|---|---:|
${reasonRows}

## Constraint removal

| removal | macro F1 delta | W/L/T | changed | title-loss / ref-loss / unbacked / numeric-add / numeric-loss / unbacked-numeric / >80 cards |
|---|---:|---:|---:|---:|
${constraintRows}

## Existing Composer recovery

| lane | macro F1 delta | W/L/T | changed | title-loss / ref-loss / unbacked / numeric-add / numeric-loss / unbacked-numeric / >80 cards |
|---|---:|---:|---:|---:|
${recoveryRows}

The generalizable lane is source-only evaluation code. The diagnostic lane contains asset-bound, reviewed-label attestations and is an oracle only.

Numeric additions and losses are counted separately. Numeric-looking identity words such as \`49ers\` and \`76ers\` are not numeric claims; unbacked numeric means an added claim absent from the provider's value fields. Provider metadata (\`grammar\`, \`low_confidence\`, \`unreadable\`, and unknown keys) is never treated as source evidence.

The JSON artifact records every changed card's asset id, reference, before/after title, win/loss/tie outcome, F1 delta, recovery reasons, and safety signals. Omitted cards are unchanged ties.

## Evidence boundary

- Canonical input SHA-256: \`${inputs.canonical?.sha256 || "not-attached"}\`.
- Exhaustive input SHA-256: \`${inputs.exhaustive?.sha256 || "not-attached"}\`.
- Corpus manifest SHA-256: \`${inputs.corpus_manifest?.sha256 || "not-attached"}\`.
- Replay source graph: ${inputs.replay_sources?.files ?? 0} local modules, aggregate SHA-256 \`${inputs.replay_sources?.aggregate_sha256 || "not-attached"}\`.
- Pairing verified reference, exact image set, model, served model, image detail/count, and requested/served effort for all ${report.cohort.pairing.reference_verified_pairs} cards.
- The raw corpora are git-ignored internal inputs, not part of a clean checkout. Replay therefore requires the exact authorized local files above and fails closed when either is absent or hash-mismatched; this work does not copy them into Production.

## Reproduce

\`\`\`bash
node scripts/analyze-post-luna-current-150.mjs
node scripts/analyze-post-luna-current-150.test.mjs
\`\`\`
`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const arg = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  const manifestInput = arg("--manifest", DEFAULT_MANIFEST);
  const loadedManifest = loadCorpusManifest(resolve(REPO_ROOT, manifestInput));
  const canonicalInput = arg("--canonical", loadedManifest.manifest.corpora.canonical.path);
  const exhaustiveInput = arg("--exhaustive", loadedManifest.manifest.corpora.exhaustive.path);
  const canonicalPath = resolve(REPO_ROOT, canonicalInput);
  const exhaustivePath = resolve(REPO_ROOT, exhaustiveInput);
  const jsonPath = resolve(REPO_ROOT, arg("--json", DEFAULT_JSON));
  const mdPath = resolve(REPO_ROOT, arg("--md", DEFAULT_MD));
  const canonicalBody = readRequiredEvaluationFile(canonicalPath, "canonical_corpus");
  const exhaustiveBody = readRequiredEvaluationFile(exhaustivePath, "exhaustive_corpus");
  const canonicalSha = sha256(canonicalBody);
  const exhaustiveSha = sha256(exhaustiveBody);
  const canonicalRows = readJsonl(canonicalBody);
  const exhaustiveRows = readJsonl(exhaustiveBody);
  if (canonicalSha !== loadedManifest.manifest.corpora.canonical.sha256
    || exhaustiveSha !== loadedManifest.manifest.corpora.exhaustive.sha256) {
    throw new Error(`post_luna_input_sha_mismatch:${canonicalSha}/${exhaustiveSha}`);
  }
  if (canonicalRows.length !== loadedManifest.manifest.corpora.canonical.expected_total_rows
    || exhaustiveRows.length !== loadedManifest.manifest.corpora.exhaustive.expected_total_rows) {
    throw new Error(`post_luna_input_row_count_mismatch:${canonicalRows.length}/${exhaustiveRows.length}`);
  }
  const report = analyzePostLunaCurrent150({
    canonicalRows,
    exhaustiveRows
  });
  report.inputs = {
    canonical: { path: canonicalInput, sha256: canonicalSha },
    exhaustive: { path: exhaustiveInput, sha256: exhaustiveSha },
    corpus_manifest: {
      path: manifestInput,
      sha256: loadedManifest.sha256,
      schema_version: loadedManifest.manifest.schema_version,
      portability: loadedManifest.manifest.portability
    },
    analyzer_sha256: sha256(readFileSync(new URL(import.meta.url))),
    replay_sources: buildReplaySourceContract()
  };
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, reportMarkdown(report));
  process.stdout.write(`${JSON.stringify({
    json: jsonPath,
    md: mdPath,
    cards: report.cohort.cards,
    current_f1: report.current_vs_historical.current_macro_f1,
    schema_compression: report.earliest_boundary.counts.canonical_schema_compression.token_occurrences,
    downstream_composition: report.earliest_boundary.counts.downstream_composition.token_occurrences,
    provider_calls: report.provider_calls
  }, null, 2)}\n`);
}
