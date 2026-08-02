#!/usr/bin/env node

// Zero-provider-cost 150-card replay for complete-phrase evidence resolution.
// It evaluates the phrase resolver independently, incrementally on top of the
// current expression overlay, and against the older token-oriented schema73
// overlay. Reference strings are used only by this scorer, never by resolver
// candidate construction or admission.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { applyAccuracyExpressionOverlayV1 } from "../lib/listing/thin/accuracy-expression-overlay-v1.mjs";
import { applyAccuracySchema73OverlayV1 } from "../lib/listing/thin/accuracy-schema73-overlay-v1.mjs";
import {
  ACCURACY_PHRASE_AWARE_RESOLVER_V1,
  buildPhraseAwareCandidatesV1,
  resolvePhraseAwareCandidatesV1
} from "../lib/listing/thin/accuracy-phrase-aware-resolver-v1.mjs";
import { projectFreeTitleThroughCsm } from "./measure-free-title-csm-projection.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const copy = (value) => structuredClone(value ?? {});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (path) => sha256(readFileSync(path));
const readRows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function tokens(value) {
  return new Set(String(value ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9/']+/)
    .filter(Boolean));
}

function score(reference, title) {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return {
    recall,
    precision,
    f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0
  };
}

function sign(values) {
  return {
    wins: values.filter((value) => value > 1e-12).length,
    losses: values.filter((value) => value < -1e-12).length,
    ties: values.filter((value) => Math.abs(value) <= 1e-12).length
  };
}

function referenceLosses(reference, before, after) {
  const wanted = tokens(reference);
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  return [...wanted].filter((token) => oldTokens.has(token) && !newTokens.has(token));
}

function titleLosses(before, after) {
  const oldTokens = tokens(before);
  const newTokens = tokens(after);
  return [...oldTokens].filter((token) => !newTokens.has(token));
}

function numericTokens(value) {
  return [...tokens(value)].filter((token) => /\d/.test(token));
}

function serialParts(value) {
  const match = clean(value).replace(/\s*\/\s*/g, "/").match(/^(\d{1,5})\/(\d{1,5})$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function criticalSerialMutation(before, after) {
  if (clean(before) === clean(after)) return false;
  const oldParts = serialParts(before);
  const newParts = serialParts(after);
  return !oldParts || !newParts || oldParts[0] !== newParts[0] || oldParts[1] !== newParts[1];
}

function unbackedNumericAdditions(before, after, decisions, beforeFields = {}) {
  const oldTokens = tokens(before);
  // A proposed value cannot attest to itself. Numeric support must pre-exist
  // either in the visible observation or in the field being extended.
  const evidence = tokens(decisions.map((row) => (
    `${row.observation_phrase} ${beforeFields?.[row.candidate_field] ?? ""}`
  )).join(" "));
  return numericTokens(after).filter((token) => !oldTokens.has(token) && !evidence.has(token));
}

if (unbackedNumericAdditions("", "2099", [{
  observation_phrase: "",
  candidate_field: "year",
  candidate_value: "2099"
}], {}).join(",") !== "2099") {
  throw new Error("numeric_safety_self_attestation_regression");
}

function changedFieldNames(before, after) {
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...names].filter((name) => JSON.stringify(before?.[name]) !== JSON.stringify(after?.[name]));
}

function factsFromObservations(observations = []) {
  return observations.flatMap((row) => {
    if (row?.label !== "logo" || row?.kind !== "printed_text") return [];
    const value = clean(row.evidence);
    return value ? [{
      value,
      kind: "affiliation",
      basis: "logo_or_symbol",
      image: row.region === "card_back" ? "image_2" : "image_1",
      region: row.region || "unknown",
      uncertainty: "none",
      source_kind: row.kind,
      source_confidence: row.confidence
    }] : [];
  });
}

function applyPhraseDecisions(fields, decisions) {
  const next = copy(fields);
  for (const row of decisions) {
    if (row.decision === "admit") next[row.candidate_field] = row.candidate_value;
  }
  return next;
}

function applyComposerDisplacementGuard(fields, decisions) {
  let virtual = copy(fields);
  return decisions.map((row) => {
    if (row.decision !== "admit") return row;
    const before = composeFromCanonicalFields(virtual);
    const next = copy(virtual);
    next[row.candidate_field] = row.candidate_value;
    const after = composeFromCanonicalFields(next);
    const lost = titleLosses(before.title, after.title);
    if (lost.length || after.length > 80) {
      return {
        ...row,
        decision: "candidate_only",
        admission_reason: lost.length ? "composer_displacement_guard" : "composer_over_80_guard",
        resolver_admission_reason: row.admission_reason,
        displaced_title_tokens: lost
      };
    }
    virtual = next;
    return row;
  });
}

function phraseOutcome(baseFields, observations, sourceProvenance, reference, {
  guardComposerDisplacement = false
} = {}) {
  const beforeFields = copy(baseFields);
  const beforeComposition = composeFromCanonicalFields(beforeFields);
  const candidates = buildPhraseAwareCandidatesV1(beforeFields, observations, {
    provenance: sourceProvenance
  });
  const resolvedDecisions = resolvePhraseAwareCandidatesV1(beforeFields, candidates);
  const decisions = guardComposerDisplacement
    ? applyComposerDisplacementGuard(beforeFields, resolvedDecisions)
    : resolvedDecisions;
  const afterFields = applyPhraseDecisions(beforeFields, decisions);
  const afterComposition = composeFromCanonicalFields(afterFields);
  const admitted = decisions.filter((row) => row.decision === "admit");
  const changedFields = changedFieldNames(beforeFields, afterFields);
  const admittedFields = new Set(admitted.map((row) => row.candidate_field));
  const unrelatedFieldDrift = changedFields.filter((field) => !admittedFields.has(field));
  const numericFieldChanges = changedFields.filter((field) => (
    /\d/.test(clean(beforeFields[field])) || /\d/.test(clean(afterFields[field]))
  )).map((field) => ({ field, before: beforeFields[field] ?? "", after: afterFields[field] ?? "" }));
  const unsupportedNumericFieldChanges = numericFieldChanges.filter((row) => {
    const fieldAdmissions = admitted.filter((decision) => decision.candidate_field === row.field);
    return !fieldAdmissions.some((decision) => {
      const proposedNumbers = numericTokens(decision.candidate_value);
      const evidenceNumbers = new Set([
        ...numericTokens(decision.observation_phrase),
        ...numericTokens(beforeFields[row.field])
      ]);
      return proposedNumbers.every((token) => evidenceNumbers.has(token));
    });
  });

  const phraseOutcomes = admitted.map((admission) => {
    const isolatedFields = copy(beforeFields);
    isolatedFields[admission.candidate_field] = admission.candidate_value;
    const isolated = composeFromCanonicalFields(isolatedFields);
    const beforeScore = score(reference, beforeComposition.title);
    const afterScore = score(reference, isolated.title);
    return {
      observation_phrase: admission.observation_phrase,
      source_region: admission.source_region,
      source_role: admission.source_role,
      candidate_field: admission.candidate_field,
      candidate_value: admission.candidate_value,
      admission_reason: admission.admission_reason,
      delta_f1: afterScore.f1 - beforeScore.f1,
      changed_title: isolated.title !== beforeComposition.title,
      reference_losses: referenceLosses(reference, beforeComposition.title, isolated.title),
      title_losses: titleLosses(beforeComposition.title, isolated.title),
      unbacked_numeric_additions: unbackedNumericAdditions(
        beforeComposition.title, isolated.title, [admission], beforeFields
      ),
      over_80: isolated.length > 80,
      dropped: isolated.dropped
    };
  });

  return {
    before_fields: beforeFields,
    after_fields: afterFields,
    before_title: beforeComposition.title,
    after_title: afterComposition.title,
    before_score: score(reference, beforeComposition.title),
    after_score: score(reference, afterComposition.title),
    decisions,
    admitted,
    phrase_outcomes: phraseOutcomes,
    changed_fields: changedFields,
    unrelated_field_drift: unrelatedFieldDrift,
    numeric_field_changes: numericFieldChanges,
    unsupported_numeric_field_changes: unsupportedNumericFieldChanges,
    serial_mutation: criticalSerialMutation(beforeFields.serial, afterFields.serial),
    reference_losses: referenceLosses(reference, beforeComposition.title, afterComposition.title),
    title_losses: titleLosses(beforeComposition.title, afterComposition.title),
    unbacked_numeric_additions: unbackedNumericAdditions(
      beforeComposition.title, afterComposition.title, admitted, beforeFields
    ),
    over_80: afterComposition.length > 80,
    dropped_before: beforeComposition.dropped,
    dropped_after: afterComposition.dropped
  };
}

function genericOutcome(beforeFields, afterFields, reference) {
  const beforeComposition = composeFromCanonicalFields(beforeFields);
  const afterComposition = composeFromCanonicalFields(afterFields);
  return {
    before_fields: copy(beforeFields),
    after_fields: copy(afterFields),
    before_title: beforeComposition.title,
    after_title: afterComposition.title,
    before_score: score(reference, beforeComposition.title),
    after_score: score(reference, afterComposition.title),
    reference_losses: referenceLosses(reference, beforeComposition.title, afterComposition.title),
    title_losses: titleLosses(beforeComposition.title, afterComposition.title),
    unbacked_numeric_additions: [],
    unrelated_field_drift: [],
    unsupported_numeric_field_changes: [],
    serial_mutation: criticalSerialMutation(beforeFields.serial, afterFields.serial),
    over_80: afterComposition.length > 80
  };
}

function outcomeSummary(outcomes, { includePhrase = false } = {}) {
  const deltas = outcomes.map((row) => row.after_score.f1 - row.before_score.f1);
  const summary = {
    before_macro_f1: mean(outcomes.map((row) => row.before_score.f1)),
    after_macro_f1: mean(outcomes.map((row) => row.after_score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_titles: outcomes.filter((row) => row.before_title !== row.after_title).length,
    reference_loss_cards: outcomes.filter((row) => row.reference_losses.length).length,
    reference_loss_tokens: outcomes.reduce((sum, row) => sum + row.reference_losses.length, 0),
    title_loss_cards: outcomes.filter((row) => row.title_losses.length).length,
    title_loss_tokens: outcomes.reduce((sum, row) => sum + row.title_losses.length, 0),
    unbacked_numeric_addition_cards: outcomes.filter((row) => row.unbacked_numeric_additions.length).length,
    unsupported_numeric_field_change_cards: outcomes.filter((row) => row.unsupported_numeric_field_changes.length).length,
    serial_mutation_cards: outcomes.filter((row) => row.serial_mutation).length,
    unrelated_field_drift_cards: outcomes.filter((row) => row.unrelated_field_drift.length).length,
    over_80_cards: outcomes.filter((row) => row.over_80).length
  };
  if (includePhrase) {
    const phraseRows = outcomes.flatMap((row) => row.phrase_outcomes);
    const phraseDeltas = phraseRows.map((row) => row.delta_f1);
    summary.candidates = outcomes.reduce((sum, row) => sum + row.decisions.length, 0);
    summary.admitted_actions = outcomes.reduce((sum, row) => sum + row.admitted.length, 0);
    summary.decisions = outcomes.flatMap((row) => row.decisions).reduce((counts, row) => {
      counts[row.decision] = (counts[row.decision] || 0) + 1;
      return counts;
    }, {});
    summary.decision_reasons = outcomes.flatMap((row) => row.decisions).reduce((counts, row) => {
      counts[row.admission_reason] = (counts[row.admission_reason] || 0) + 1;
      return counts;
    }, {});
    summary.phrase_level = {
      actions: phraseRows.length,
      ...sign(phraseDeltas),
      reference_loss_actions: phraseRows.filter((row) => row.reference_losses.length).length,
      title_loss_actions: phraseRows.filter((row) => row.title_losses.length).length,
      unbacked_numeric_actions: phraseRows.filter((row) => row.unbacked_numeric_additions.length).length,
      over_80_actions: phraseRows.filter((row) => row.over_80).length
    };
  }
  summary.safety_status = summary.losses
    || summary.reference_loss_cards
    || summary.title_loss_cards
    || summary.unbacked_numeric_addition_cards
    || summary.unsupported_numeric_field_change_cards
    || summary.serial_mutation_cards
    || summary.unrelated_field_drift_cards
    || summary.over_80_cards
    ? "STOP"
    : summary.wins ? "REPLAY_CANDIDATE" : "NO_CHANGE";
  return summary;
}

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const freshLedgerPath = arg("--fresh-ledger", "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json");
const oldDiagnosisPath = arg("--old-diagnosis", "artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json");
const outPath = arg("--out", "docs/evaluation/accuracy-phrase-aware-resolver-v1-replay-150-2026-08-02.json");
const limit = Number(arg("--limit", "150"));
if (limit !== 150) throw new Error("phrase_aware_replay_requires_exactly_150_cards");

const inputBody = readFileSync(inputPath);
const exhaustiveBody = readFileSync(exhaustivePath);
const freshLedgerBody = readFileSync(freshLedgerPath);
const oldDiagnosisBody = readFileSync(oldDiagnosisPath);
const inputRows = readRows(inputPath);
const canonicalRows = inputRows.filter((row) => row.arm === "thin_canonical_high" && row.fields);
const freeRows = inputRows.filter((row) => row.arm === "thin_budgeted");
const exhaustiveRows = readRows(exhaustivePath).filter((row) => row.arm === "exhaustive_observation_high");
const unique = (rows) => new Set(rows.map((row) => row.asset_id)).size === rows.length;
if (canonicalRows.length !== limit || freeRows.length !== limit || exhaustiveRows.length !== limit
  || !unique(canonicalRows) || !unique(freeRows) || !unique(exhaustiveRows)) {
  throw new Error("phrase_aware_replay_cohort_count_or_uniqueness_mismatch");
}

const canonicalIds = new Set(canonicalRows.map((row) => row.asset_id));
const freeByAsset = new Map(freeRows.map((row) => [row.asset_id, row]));
const exhaustiveByAsset = new Map(exhaustiveRows.map((row) => [row.asset_id, row]));
if (canonicalRows.some((row) => !freeByAsset.has(row.asset_id) || !exhaustiveByAsset.has(row.asset_id))
  || freeRows.some((row) => !canonicalIds.has(row.asset_id))
  || exhaustiveRows.some((row) => !canonicalIds.has(row.asset_id))) {
  throw new Error("phrase_aware_replay_asset_set_mismatch");
}

const artifactSha = sha256(exhaustiveBody);
const cards = canonicalRows.map((canonicalRow) => {
  const freeRow = freeByAsset.get(canonicalRow.asset_id);
  const exhaustiveRow = exhaustiveByAsset.get(canonicalRow.asset_id);
  const observations = exhaustiveRow.observations || [];
  const expression = projectFreeTitleThroughCsm(freeRow.title);
  const existingExpression = applyAccuracyExpressionOverlayV1(canonicalRow.fields, {
    expressionFields: expression.fields,
    expressionTitle: freeRow.title,
    candidateFacts: factsFromObservations(observations),
    observations
  });
  const tokenOverlay = applyAccuracySchema73OverlayV1(existingExpression.fields, { observations });
  const provenance = {
    source: "exhaustive_observation_high",
    checkpoint_sha256: artifactSha
  };

  const phraseStandalone = phraseOutcome(canonicalRow.fields, observations, provenance, canonicalRow.reference);
  const phraseIncremental = phraseOutcome(existingExpression.fields, observations, provenance, canonicalRow.reference);
  const phraseAfterToken = phraseOutcome(tokenOverlay.fields, observations, provenance, canonicalRow.reference);
  const phraseGuardedIncremental = phraseOutcome(existingExpression.fields, observations, provenance, canonicalRow.reference, {
    guardComposerDisplacement: true
  });
  const phraseGuardedAfterToken = phraseOutcome(tokenOverlay.fields, observations, provenance, canonicalRow.reference, {
    guardComposerDisplacement: true
  });
  const tokenOutcome = genericOutcome(existingExpression.fields, tokenOverlay.fields, canonicalRow.reference);
  const expressionOutcome = genericOutcome(canonicalRow.fields, existingExpression.fields, canonicalRow.reference);

  return {
    asset_id: canonicalRow.asset_id,
    reference: canonicalRow.reference,
    canonical_title: composeFromCanonicalFields(canonicalRow.fields).title,
    existing_expression_title: existingExpression.composed.title,
    token_overlay_title: composeFromCanonicalFields(tokenOverlay.fields).title,
    expression_outcome: expressionOutcome,
    token_outcome: tokenOutcome,
    phrase_standalone: phraseStandalone,
    phrase_incremental: phraseIncremental,
    phrase_after_token: phraseAfterToken,
    phrase_guarded_incremental: phraseGuardedIncremental,
    phrase_guarded_after_token: phraseGuardedAfterToken
  };
});

const summaries = {
  existing_expression_vs_canonical: outcomeSummary(cards.map((row) => row.expression_outcome)),
  token_overlay_vs_existing_expression: outcomeSummary(cards.map((row) => row.token_outcome)),
  phrase_standalone_vs_canonical: outcomeSummary(cards.map((row) => row.phrase_standalone), { includePhrase: true }),
  phrase_incremental_vs_existing_expression: outcomeSummary(cards.map((row) => row.phrase_incremental), { includePhrase: true }),
  phrase_incremental_after_token_overlay: outcomeSummary(cards.map((row) => row.phrase_after_token), { includePhrase: true }),
  phrase_guarded_vs_existing_expression: outcomeSummary(cards.map((row) => row.phrase_guarded_incremental), { includePhrase: true }),
  phrase_guarded_after_token_overlay: outcomeSummary(cards.map((row) => row.phrase_guarded_after_token), { includePhrase: true })
};

const deltaFor = (outcome) => outcome.after_score.f1 - outcome.before_score.f1;
const tokenWins = new Set(cards.filter((row) => deltaFor(row.token_outcome) > 1e-12).map((row) => row.asset_id));
const phraseWins = new Set(cards.filter((row) => deltaFor(row.phrase_guarded_incremental) > 1e-12).map((row) => row.asset_id));
const contributionOverlap = {
  token_winning_cards: tokenWins.size,
  phrase_winning_cards: phraseWins.size,
  shared_winning_cards: [...tokenWins].filter((id) => phraseWins.has(id)).length,
  token_only_winning_cards: [...tokenWins].filter((id) => !phraseWins.has(id)).length,
  phrase_only_winning_cards: [...phraseWins].filter((id) => !tokenWins.has(id)).length
};

function matchDecision(decisions, evidence, token, { allowTokenFallback = false } = {}) {
  const evidenceKey = clean(evidence).toLowerCase();
  const tokenKey = clean(token).toLowerCase();
  const exactPhrase = decisions.filter((row) => clean(row.observation_phrase).toLowerCase() === evidenceKey);
  const tokenPhrase = allowTokenFallback
    ? decisions.filter((row) => tokens(`${row.observation_phrase} ${row.candidate_value}`).has(tokenKey))
    : [];
  const matches = exactPhrase.length ? exactPhrase : tokenPhrase;
  const precedence = ["admit", "no_change", "candidate_only", "reject"];
  return precedence.map((name) => matches.find((row) => row.decision === name)).find(Boolean) || null;
}

const decisionsByAsset = new Map(cards.map((row) => [row.asset_id, row.phrase_guarded_incremental.decisions]));
const freshLedger = JSON.parse(freshLedgerBody);
const freshSchemaItems = freshLedger.items.filter((item) => item.stage === "canonical_schema_compression");
const freshSchemaCoverageRows = freshSchemaItems.map((item) => {
  const matched = matchDecision(
    decisionsByAsset.get(item.asset_id) || [],
    item.source_observation?.evidence || "",
    item.token
  );
  return {
    item_id: item.id,
    semantic_class: item.semantic_class,
    token: item.token,
    phrase: item.phrase,
    matched_observation_phrase: matched?.observation_phrase || null,
    phrase_decision: matched?.decision || "no_candidate",
    admission_reason: matched?.admission_reason || "no_phrase_rule"
  };
});

function coverageSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    summary.by_decision[row.phrase_decision] = (summary.by_decision[row.phrase_decision] || 0) + 1;
    if (row.semantic_class) {
      const group = summary.by_semantic_class[row.semantic_class] ||= { total: 0, decisions: {} };
      group.total += 1;
      group.decisions[row.phrase_decision] = (group.decisions[row.phrase_decision] || 0) + 1;
    }
    return summary;
  }, { total: 0, by_decision: {}, by_semantic_class: {} });
}

const oldDiagnosis = JSON.parse(oldDiagnosisBody);
const old73Rows = oldDiagnosis.rows.flatMap((row) => (
  row.causes.canonical_schema_compression || []
).map((token) => {
  const matched = matchDecision(decisionsByAsset.get(row.asset_id) || [], "", token, {
    allowTokenFallback: true
  });
  return {
    asset_id: row.asset_id,
    token,
    matched_observation_phrase: matched?.observation_phrase || null,
    phrase_decision: matched?.decision || "no_candidate",
    admission_reason: matched?.admission_reason || "no_phrase_rule"
  };
}));
if (old73Rows.length !== 73) throw new Error(`old_schema_occurrence_count_changed:${old73Rows.length}`);

const wrongRoleDecisions = cards.flatMap((row) => row.phrase_guarded_incremental.decisions)
  .filter((decision) => decision.admission_reason.startsWith("wrong_role_"));
const wrongRoleSummary = wrongRoleDecisions.reduce((summary, row) => {
  summary.total += 1;
  summary.by_reason[row.admission_reason] = (summary.by_reason[row.admission_reason] || 0) + 1;
  summary.by_source_role[row.source_role] = (summary.by_source_role[row.source_role] || 0) + 1;
  return summary;
}, { total: 0, by_reason: {}, by_source_role: {} });

const phraseRows = cards.flatMap((card) => card.phrase_guarded_incremental.phrase_outcomes.map((row) => ({
  asset_id: card.asset_id,
  ...row
})));
const phraseFamilySummary = cards.flatMap((card) => card.phrase_guarded_incremental.admitted).reduce((summary, row) => {
  const group = summary[row.candidate_family] ||= { actions: 0, fields: {}, reasons: {} };
  group.actions += 1;
  group.fields[row.candidate_field] = (group.fields[row.candidate_field] || 0) + 1;
  group.reasons[row.admission_reason] = (group.reasons[row.admission_reason] || 0) + 1;
  return summary;
}, {});

const materialDecision = (row) => !row.admission_reason.startsWith("wrong_role_")
  && row.admission_reason !== "non_printed_observation";
const materialCards = cards.filter((card) => [
  ...card.phrase_standalone.decisions,
  ...card.phrase_guarded_incremental.decisions,
  ...card.phrase_guarded_after_token.decisions
].some(materialDecision));

const result = {
  schema_version: "accuracy-phrase-aware-resolver-v1-replay-150",
  authority: "evaluation_only",
  production_promoted: false,
  provider_calls: 0,
  source: {
    input_path: inputPath,
    exhaustive_path: exhaustivePath,
    fresh_ledger_path: freshLedgerPath,
    old_diagnosis_path: oldDiagnosisPath,
    input_sha256: sha256(inputBody),
    exhaustive_sha256: artifactSha,
    fresh_ledger_sha256: sha256(freshLedgerBody),
    old_diagnosis_sha256: sha256(oldDiagnosisBody),
    cohort_sha256: sha256([...canonicalIds].sort().join("\n")),
    resolver_sha256: fileSha256(new URL("../lib/listing/thin/accuracy-phrase-aware-resolver-v1.mjs", import.meta.url)),
    replay_script_sha256: fileSha256(new URL("./replay-accuracy-phrase-aware-resolver-v1.mjs", import.meta.url)),
    cards: 150,
    arms: ["thin_canonical_high", "thin_budgeted", "exhaustive_observation_high"]
  },
  resolver: ACCURACY_PHRASE_AWARE_RESOLVER_V1,
  summaries,
  token_vs_phrase_contribution: contributionOverlap,
  phrase_families: phraseFamilySummary,
  wrong_role_rejections: wrongRoleSummary,
  fresh150_schema_109_coverage: {
    summary: coverageSummary(freshSchemaCoverageRows),
    rows: freshSchemaCoverageRows
  },
  old100_schema_73_coverage: {
    summary: coverageSummary(old73Rows),
    rows: old73Rows
  },
  phrase_level_outcomes: phraseRows,
  material_cards: materialCards.map((card) => ({
    asset_id: card.asset_id,
    reference: card.reference,
    canonical_title: card.canonical_title,
    existing_expression_title: card.existing_expression_title,
    token_overlay_title: card.token_overlay_title,
    phrase_standalone: {
      before_title: card.phrase_standalone.before_title,
      after_title: card.phrase_standalone.after_title,
      delta_f1: deltaFor(card.phrase_standalone),
      decisions: card.phrase_standalone.decisions.filter(materialDecision),
      changed_fields: card.phrase_standalone.changed_fields,
      reference_losses: card.phrase_standalone.reference_losses,
      title_losses: card.phrase_standalone.title_losses,
      unbacked_numeric_additions: card.phrase_standalone.unbacked_numeric_additions,
      unsupported_numeric_field_changes: card.phrase_standalone.unsupported_numeric_field_changes,
      unrelated_field_drift: card.phrase_standalone.unrelated_field_drift,
      serial_mutation: card.phrase_standalone.serial_mutation,
      over_80: card.phrase_standalone.over_80
    },
    phrase_guarded_incremental: {
      before_title: card.phrase_guarded_incremental.before_title,
      after_title: card.phrase_guarded_incremental.after_title,
      delta_f1: deltaFor(card.phrase_guarded_incremental),
      decisions: card.phrase_guarded_incremental.decisions.filter(materialDecision),
      changed_fields: card.phrase_guarded_incremental.changed_fields,
      reference_losses: card.phrase_guarded_incremental.reference_losses,
      title_losses: card.phrase_guarded_incremental.title_losses,
      unbacked_numeric_additions: card.phrase_guarded_incremental.unbacked_numeric_additions,
      unsupported_numeric_field_changes: card.phrase_guarded_incremental.unsupported_numeric_field_changes,
      unrelated_field_drift: card.phrase_guarded_incremental.unrelated_field_drift,
      serial_mutation: card.phrase_guarded_incremental.serial_mutation,
      over_80: card.phrase_guarded_incremental.over_80
    },
    phrase_guarded_after_token: {
      before_title: card.phrase_guarded_after_token.before_title,
      after_title: card.phrase_guarded_after_token.after_title,
      delta_f1: deltaFor(card.phrase_guarded_after_token),
      decisions: card.phrase_guarded_after_token.decisions.filter(materialDecision),
      changed_fields: card.phrase_guarded_after_token.changed_fields,
      reference_losses: card.phrase_guarded_after_token.reference_losses,
      title_losses: card.phrase_guarded_after_token.title_losses,
      unbacked_numeric_additions: card.phrase_guarded_after_token.unbacked_numeric_additions,
      unsupported_numeric_field_changes: card.phrase_guarded_after_token.unsupported_numeric_field_changes,
      unrelated_field_drift: card.phrase_guarded_after_token.unrelated_field_drift,
      serial_mutation: card.phrase_guarded_after_token.serial_mutation,
      over_80: card.phrase_guarded_after_token.over_80
    }
  }))
};

writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  schema_version: result.schema_version,
  out: outPath,
  summaries: result.summaries,
  token_vs_phrase_contribution: result.token_vs_phrase_contribution,
  phrase_families: result.phrase_families,
  wrong_role_rejections: result.wrong_role_rejections,
  fresh150_schema_109_coverage: result.fresh150_schema_109_coverage.summary,
  old100_schema_73_coverage: result.old100_schema_73_coverage.summary
}, null, 2));
