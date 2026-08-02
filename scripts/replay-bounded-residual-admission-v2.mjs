#!/usr/bin/env node

// Zero-provider replay: current frozen combined bundle -> bounded printed-marker
// admission. The source checkpoint may be partial, but only complete, identity-
// matched pairs enter scoring and the expected pair count is explicit.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS,
  applyBoundedResidualAdmissionV2
} from "../experiments/accuracy/bounded-residual-admission-v2.mjs";
import { runPaidResidualCombinedV1 } from "../experiments/accuracy/paid-residual-combined-v1.mjs";
import { ARM_SPECS, requestFingerprint } from "./run-thin-path-eval.mjs";

const CONTROL = "thin_canonical_high";
const TREATMENT = "thin_canonical_residual_v1_high";
const DEFAULT_INPUT = "artifacts/paid105-residual-v1-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_MANIFEST = "artifacts/paid105-residual-v1-2026-08-02/thin-path-gpt-5.6-luna.manifest.json";
const DEFAULT_JSON = "docs/evaluation/bounded-residual-admission-v2-partial-50-replay-2026-08-02.json";
const DEFAULT_MD = "docs/evaluation/bounded-residual-admission-v2-partial-50-replay-2026-08-02.md";
const EPSILON = 1e-12;

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback;
};
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const tokens = (value) => new Set(clean(value).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const numericTokens = (value) => new Set((clean(value)
  .replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ")
  .match(/\d+/g) || []).map((part) => String(Number(part))));
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const sameSet = (left, right) => left.size === right.size
  && [...left].every((value) => right.has(value));
const countBy = (values, selector) => Object.fromEntries([...values.reduce((map, value) => {
  const selected = clean(selector(value)) || "<empty>";
  map.set(selected, (map.get(selected) || 0) + 1);
  return map;
}, new Map())].sort(([left], [right]) => left.localeCompare(right)));
const score = (reference, title) => {
  const wanted = tokens(reference);
  const got = tokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const format = (value, digits = 6) => Number(value).toFixed(digits);
const mdCell = (value) => clean(value).replace(/\|/g, "\\|");

const inputPath = resolve(arg("--input", DEFAULT_INPUT));
const manifestPath = resolve(arg("--manifest", DEFAULT_MANIFEST));
const outJsonPath = resolve(arg("--out-json", DEFAULT_JSON));
const outMdPath = resolve(arg("--out-md", DEFAULT_MD));
const expectedPairs = Number(arg("--expected-pairs", "50"));
if (!Number.isInteger(expectedPairs) || expectedPairs <= 0) throw new Error("invalid_expected_pairs");

const [checkpointBody, manifestBody] = await Promise.all([readFile(inputPath), readFile(manifestPath)]);
const rows = checkpointBody.toString("utf8").split(/\n+/).filter((line) => line.trim()).map(JSON.parse);
const manifest = JSON.parse(manifestBody);
const checkpointSha256 = sha256(checkpointBody);
const expectedArms = [CONTROL, TREATMENT];
if (JSON.stringify(manifest?.contract?.arms?.map(({ key }) => key)) !== JSON.stringify(expectedArms)
    || manifest?.contract?.model !== "gpt-5.6-luna"
    || manifest?.contract?.effort !== "none"
    || manifest?.contract?.image_detail !== "high"
    || manifest?.contract?.cohort?.selection_role !== "disjoint105_learning") {
  throw new Error("partial_manifest_contract_mismatch");
}

const byArm = new Map(expectedArms.map((arm) => [arm, new Map()]));
for (const row of rows) {
  if (!byArm.has(row.arm)) throw new Error(`unexpected_arm:${row.arm}`);
  if (byArm.get(row.arm).has(row.asset_id)) throw new Error(`duplicate_row:${row.asset_id}:${row.arm}`);
  if (row.run_fingerprint !== manifest.fingerprint
      || row.model !== "gpt-5.6-luna"
      || row.requested_effort !== "none"
      || row.served_effort !== "none"
      || row.image_detail !== "high") {
    throw new Error(`row_contract_mismatch:${row.asset_id}:${row.arm}`);
  }
  const expectedRequest = ARM_SPECS[row.arm].buildRequest({
    imageUrls: Array.from({ length: row.image_count }, (_, index) => `https://contract.invalid/image-${index + 1}`),
    model: "gpt-5.6-luna",
    effort: "none",
    imageDetail: "high"
  });
  if (row.request_sha256 !== requestFingerprint(expectedRequest)) {
    throw new Error(`request_bytes_mismatch:${row.asset_id}:${row.arm}`);
  }
  byArm.get(row.arm).set(row.asset_id, row);
}

const pairedIds = [...byArm.get(CONTROL).keys()]
  .filter((assetId) => byArm.get(TREATMENT).has(assetId)).sort();
if (pairedIds.length !== expectedPairs) {
  throw new Error(`complete_pair_count_mismatch:${pairedIds.length}:${expectedPairs}`);
}
const singletonRows = rows.filter((row) => !pairedIds.includes(row.asset_id))
  .map((row) => ({ asset_id: row.asset_id, arm: row.arm })).sort((left, right) => (
    left.asset_id.localeCompare(right.asset_id) || left.arm.localeCompare(right.arm)
  ));

const allowedFields = new Set(BOUNDED_RESIDUAL_ADMISSION_V2_ALLOWED_FIELDS);
const numericIdentityFields = ["year", "card_number", "serial", "grade", "lot_count"];
const cards = [];
for (const assetId of pairedIds) {
  const control = byArm.get(CONTROL).get(assetId);
  const treatment = byArm.get(TREATMENT).get(assetId);
  if (control.reference !== treatment.reference
      || control.image_set_sha256 !== treatment.image_set_sha256
      || control.image_count !== treatment.image_count) {
    throw new Error(`pair_identity_mismatch:${assetId}`);
  }
  if (treatment.residual_source_present !== true
      || treatment.residual_canonical_fields_unchanged !== true) {
    throw new Error(`residual_parse_contract_missing:${assetId}`);
  }

  const combined = runPaidResidualCombinedV1(
    treatment.fields,
    treatment.residual_replay_candidates || [],
    { sourceFingerprint: checkpointSha256 }
  );
  const beforeFields = combined.bundle.candidate.fields;
  const beforeTitle = combined.bundle.candidate.title;
  const bounded = applyBoundedResidualAdmissionV2(beforeFields, treatment.residual_candidates || [], {
    baselineTitle: beforeTitle
  });
  const afterFields = bounded.fields;
  const afterTitle = bounded.title;
  const beforeScore = score(treatment.reference, beforeTitle);
  const afterScore = score(treatment.reference, afterTitle);
  const delta = afterScore.f1 - beforeScore.f1;
  const classification = delta > EPSILON ? "win" : delta < -EPSILON ? "loss" : "tie";
  const beforeTokens = tokens(beforeTitle);
  const afterTokens = tokens(afterTitle);
  const wantedTokens = tokens(treatment.reference);
  const subjectTokens = tokens((beforeFields.subjects || []).join(" "));
  const referenceLosses = difference(beforeTokens, afterTokens).filter((token) => wantedTokens.has(token));
  const referenceGains = difference(afterTokens, beforeTokens).filter((token) => wantedTokens.has(token));
  const numericFieldMutations = numericIdentityFields.filter((field) => (
    JSON.stringify(beforeFields[field] ?? "") !== JSON.stringify(afterFields[field] ?? "")
  ));
  const numericTitleMutation = !sameSet(numericTokens(beforeTitle), numericTokens(afterTitle));
  const subjectFieldMutation = JSON.stringify(beforeFields.subjects || []) !== JSON.stringify(afterFields.subjects || []);
  const subjectTitleLosses = difference(subjectTokens, afterTokens).filter((token) => beforeTokens.has(token));
  const unrelatedFieldDrift = bounded.changed_fields.filter((field) => !allowedFields.has(field));

  cards.push({
    asset_id: assetId,
    reference: treatment.reference,
    control_title: control.title,
    treatment_canonical_title: treatment.title,
    combined_title: beforeTitle,
    bounded_title: afterTitle,
    control_f1: score(control.reference, control.title).f1,
    treatment_canonical_f1: score(treatment.reference, treatment.title).f1,
    combined_f1: beforeScore.f1,
    bounded_f1: afterScore.f1,
    bounded_marginal_delta_f1: delta,
    classification,
    changed_title: bounded.changed_title,
    changed_fields: bounded.changed_fields,
    residual_candidate_count: (treatment.residual_candidates || []).length,
    residual_replay_candidate_count: (treatment.residual_replay_candidates || []).length,
    residual_candidates: treatment.residual_candidates || [],
    decisions: bounded.decisions,
    guards: bounded.guards,
    reference_losses: referenceLosses,
    reference_gains: referenceGains,
    numeric_field_mutations: numericFieldMutations,
    numeric_title_mutation: numericTitleMutation,
    subject_field_mutation: subjectFieldMutation,
    subject_title_losses: subjectTitleLosses,
    unrelated_field_drift: unrelatedFieldDrift,
    over_80: afterTitle.length > 80,
    before_length: beforeTitle.length,
    after_length: afterTitle.length
  });
}

const allCandidates = cards.flatMap((card) => card.residual_candidates.map((candidate) => ({
  asset_id: card.asset_id,
  ...candidate
})));
const markerCandidates = allCandidates.filter(({ target }) => target === "marker");
const approvedMarkerCandidates = markerCandidates.filter((candidate) => (
  candidate.replay_eligible === true
  && candidate.disposition === "resolver_candidate"
  && candidate.reason === "bounded_literal_marker"
  && candidate.automatic_csm_admission === false
  && candidate.automatic_renderer_admission === false
  && ["slab_text", "front_text", "front_symbol"].includes(candidate.anchor)
  && /^(?:RC|Rookie Card|Rated Rookie|SP|SSP|1st Bowman|1st Edition)$/i.test(clean(candidate.text))
));
const allDecisions = cards.flatMap((card) => card.decisions.map((decision) => ({
  asset_id: card.asset_id,
  ...decision
})));
const wins = cards.filter(({ classification }) => classification === "win");
const losses = cards.filter(({ classification }) => classification === "loss");
const ties = cards.filter(({ classification }) => classification === "tie");
const changedCards = cards.filter(({ changed_title, changed_fields }) => changed_title || changed_fields.length);

const fieldImpact = Object.fromEntries([...new Set(cards.flatMap(({ changed_fields }) => changed_fields))]
  .sort().map((field) => {
    const affected = cards.filter(({ changed_fields }) => changed_fields.includes(field));
    return [field, {
      cards: affected.length,
      wins: affected.filter(({ classification }) => classification === "win").length,
      losses: affected.filter(({ classification }) => classification === "loss").length,
      ties: affected.filter(({ classification }) => classification === "tie").length,
      mean_delta_f1: mean(affected.map(({ bounded_marginal_delta_f1 }) => bounded_marginal_delta_f1))
    }];
  }));

const summary = {
  complete_pairs: cards.length,
  excluded_singletons: singletonRows.length,
  control_macro_f1: mean(cards.map(({ control_f1 }) => control_f1)),
  treatment_canonical_macro_f1: mean(cards.map(({ treatment_canonical_f1 }) => treatment_canonical_f1)),
  current_combined_macro_f1: mean(cards.map(({ combined_f1 }) => combined_f1)),
  bounded_marker_macro_f1: mean(cards.map(({ bounded_f1 }) => bounded_f1)),
  bounded_marker_marginal_delta_f1: mean(cards.map(({ bounded_marginal_delta_f1 }) => bounded_marginal_delta_f1)),
  wins: wins.length,
  losses: losses.length,
  ties: ties.length,
  changed_cards: changedCards.length,
  reference_loss_cards: cards.filter(({ reference_losses }) => reference_losses.length).length,
  reference_gain_cards: cards.filter(({ reference_gains }) => reference_gains.length).length,
  numeric_mutation_cards: cards.filter((card) => card.numeric_field_mutations.length || card.numeric_title_mutation).length,
  subject_mutation_cards: cards.filter((card) => card.subject_field_mutation || card.subject_title_losses.length).length,
  unrelated_field_drift_cards: cards.filter(({ unrelated_field_drift }) => unrelated_field_drift.length).length,
  over_80_cards: cards.filter(({ over_80 }) => over_80).length,
  all_safety_guards_pass_cards: cards.filter(({ guards }) => Object.values(guards).every(Boolean)).length,
  field_impact: fieldImpact
};

const coverage = {
  checkpoint_rows: rows.length,
  arm_rows: Object.fromEntries([...byArm].map(([arm, values]) => [arm, values.size])),
  complete_pairs: pairedIds.length,
  excluded_singletons: singletonRows,
  cards_with_any_residual: cards.filter(({ residual_candidate_count }) => residual_candidate_count > 0).length,
  residual_candidates: allCandidates.length,
  residual_candidates_by_target: countBy(allCandidates, ({ target }) => target),
  residual_replay_candidates: cards.reduce((sum, card) => sum + card.residual_replay_candidate_count, 0),
  marker_candidates: markerCandidates.length,
  marker_candidates_by_text: countBy(markerCandidates, ({ text }) => text),
  marker_candidates_by_disposition: countBy(markerCandidates, ({ disposition }) => disposition),
  parser_approved_supported_marker_candidates: approvedMarkerCandidates.length,
  cards_with_parser_approved_supported_marker: new Set(approvedMarkerCandidates.map(({ asset_id }) => asset_id)).size,
  approved_marker_candidates_by_text: countBy(approvedMarkerCandidates, ({ text }) => text),
  decisions_by_disposition: countBy(allDecisions, ({ disposition }) => disposition),
  decisions_by_reason: countBy(allDecisions, ({ reason }) => reason),
  admission_ceiling_cards_in_this_checkpoint: new Set(approvedMarkerCandidates.map(({ asset_id }) => asset_id)).size
};

const gate = {
  marginal_macro_f1_at_least_0003: summary.bounded_marker_marginal_delta_f1 >= 0.003,
  at_least_8_wins_zero_losses: summary.wins >= 8 && summary.losses === 0,
  zero_reference_loss: summary.reference_loss_cards === 0,
  zero_numeric_mutation: summary.numeric_mutation_cards === 0,
  zero_subject_mutation: summary.subject_mutation_cards === 0,
  zero_unrelated_field_drift: summary.unrelated_field_drift_cards === 0,
  zero_over_80: summary.over_80_cards === 0,
  all_cards_pass_internal_safety_guards: summary.all_safety_guards_pass_cards === summary.complete_pairs
};
const stopReasons = [];
if (!gate.marginal_macro_f1_at_least_0003) stopReasons.push("marginal_macro_f1_below_0.003");
if (!gate.at_least_8_wins_zero_losses) stopReasons.push("fewer_than_8_wins_or_nonzero_losses");
if (coverage.admission_ceiling_cards_in_this_checkpoint < 8) {
  stopReasons.push("checkpoint_parser_approved_marker_support_ceiling_below_8_cards");
}
for (const [name, passed] of Object.entries(gate)) {
  if (!passed && !["marginal_macro_f1_at_least_0003", "at_least_8_wins_zero_losses"].includes(name)) {
    stopReasons.push(name.replace(/^zero_/, "nonzero_").replace(/^all_/, "not_all_"));
  }
}

const result = {
  schema_version: "bounded-residual-admission-v2-partial-paired-replay-v1",
  verdict: Object.values(gate).every(Boolean) ? "GO_FOR_INDEPENDENT_CONFIRMATION" : "STOP",
  authority: "evaluation_only",
  claim_boundary: "partial_disjoint105_learning_checkpoint_reuse_not_independent_confirmation",
  provider_calls_by_replay: 0,
  production_promoted: false,
  positive_mechanism_bank_eligible: Object.values(gate).every(Boolean),
  source: {
    checkpoint: relative(process.cwd(), inputPath),
    checkpoint_sha256: checkpointSha256,
    manifest: relative(process.cwd(), manifestPath),
    run_fingerprint: manifest.fingerprint,
    expected_complete_pairs: expectedPairs
  },
  comparison: "current_frozen_11_mechanism_combined_bundle_vs_same_bundle_plus_bounded_printed_marker_admission_v2",
  summary,
  coverage,
  gate,
  learning_gate_pass: Object.values(gate).every(Boolean),
  stop_reasons: stopReasons,
  subject_ground_truth_boundary: "reviewed titles are token-level labels, not structured subject ground truth; zero means no mechanism-introduced subject mutation",
  changed_cards: changedCards,
  all_cards: cards
};

const gateRows = Object.entries(gate).map(([name, passed]) => `| ${name} | ${passed ? "PASS" : "FAIL"} |`).join("\n");
const markerRows = Object.entries(coverage.marker_candidates_by_text)
  .map(([text, count]) => `| ${mdCell(text)} | ${count} |`).join("\n");
const fieldRows = Object.entries(fieldImpact).length
  ? Object.entries(fieldImpact).map(([field, impact]) => (
    `| ${field} | ${impact.cards} | ${impact.wins} | ${impact.losses} | ${impact.ties} | ${format(impact.mean_delta_f1)} |`
  )).join("\n")
  : "| none | 0 | 0 | 0 | 0 | 0.000000 |";
const changedRows = changedCards.length
  ? changedCards.map((card) => [
    `### ${card.asset_id} — ${card.classification.toUpperCase()} ${format(card.bounded_marginal_delta_f1)}`,
    "",
    `- Reference: ${card.reference}`,
    `- Before: ${card.combined_title}`,
    `- After: ${card.bounded_title}`,
    `- Fields: ${card.changed_fields.join(", ") || "none"}`,
    `- Marker decisions: ${card.decisions.filter(({ disposition }) => disposition === "admitted")
      .map(({ text, value, reason }) => `${text} -> ${value} (${reason})`).join("; ") || "none"}`,
    `- Drift: reference losses ${card.reference_losses.join(", ") || "none"}; numeric ${card.numeric_field_mutations.length || card.numeric_title_mutation ? "yes" : "no"}; subject ${card.subject_field_mutation || card.subject_title_losses.length ? "yes" : "no"}; unrelated ${card.unrelated_field_drift.join(", ") || "none"}; over80 ${card.over_80 ? "yes" : "no"}.`
  ].join("\n")).join("\n\n")
  : "No changed cards.";

const markdown = `# Bounded residual admission v2 — partial-50 zero-call replay

**Verdict: ${result.verdict}.** The mechanism changed ${summary.changed_cards}/${summary.complete_pairs} cards with ${summary.wins} win${summary.wins === 1 ? "" : "s"}, ${summary.losses} loss${summary.losses === 1 ? "" : "es"}, and ${summary.ties} tie${summary.ties === 1 ? "" : "s"}. Its marginal macro-F1 was ${format(summary.bounded_marker_marginal_delta_f1)} (${format(summary.current_combined_macro_f1)} -> ${format(summary.bounded_marker_macro_f1)}).

The measured mean is negative and the arm has one regression, so it cannot be banked or promoted. This checkpoint also contains only ${coverage.parser_approved_supported_marker_candidates} supported, parser-approved marker candidates across ${coverage.cards_with_parser_approved_supported_marker} cards, making the observed support ceiling lower than the required 8 wins. This is a **measured STOP with a severe coverage limit**; it does not establish that every narrower printed-marker rule is harmful.

## Boundary

- Zero provider calls; no model, catalog, vector, OCR, world-knowledge, persistence, or production path was invoked.
- Comparison: current frozen 11-mechanism combined bundle vs the same output plus bounded printed-marker admission.
- Source: ${coverage.checkpoint_rows} durable rows, ${summary.complete_pairs} identity-matched pairs; ${summary.excluded_singletons} singleton rows were excluded.
- Closed admission vocabulary: RC/Rookie Card/Rated Rookie -> CSM RC; SP/SSP/1st Bowman/1st Edition -> descriptive_rarity.
- Auto/Patch/Relic/Jersey and all serial evidence remain candidate-only.
- This is reused learning evidence from a partial disjoint-105 checkpoint, not independent confirmation and not production authority.

## Score and safety

| Metric | Result |
|---|---:|
| Current combined macro F1 | ${format(summary.current_combined_macro_f1)} |
| Bounded-marker macro F1 | ${format(summary.bounded_marker_macro_f1)} |
| Marginal macro F1 | ${format(summary.bounded_marker_marginal_delta_f1)} |
| Wins / losses / ties | ${summary.wins} / ${summary.losses} / ${summary.ties} |
| Reference-loss cards | ${summary.reference_loss_cards} |
| Numeric-mutation cards | ${summary.numeric_mutation_cards} |
| Subject-mutation cards | ${summary.subject_mutation_cards} |
| Unrelated-field-drift cards | ${summary.unrelated_field_drift_cards} |
| Titles over 80 | ${summary.over_80_cards} |

Numeric mutation excludes the sanctioned ordinal token in an exact printed marker such as \`1st Bowman\`; year, card number, serial, grade, lot quantity, and all other title numbers must remain unchanged.

## Gate

| Gate | Result |
|---|---|
${gateRows}

Stop reasons: ${stopReasons.map((reason) => `\`${reason}\``).join(", ")}.

## Coverage

| Funnel | Count |
|---|---:|
| Complete pairs | ${coverage.complete_pairs} |
| Cards with any residual candidate | ${coverage.cards_with_any_residual} |
| All residual candidates | ${coverage.residual_candidates} |
| Parser replay candidates | ${coverage.residual_replay_candidates} |
| Marker candidates | ${coverage.marker_candidates} |
| Supported parser-approved marker candidates | ${coverage.parser_approved_supported_marker_candidates} |
| Cards with supported parser-approved marker | ${coverage.cards_with_parser_approved_supported_marker} |
| Admission ceiling in this checkpoint | ${coverage.admission_ceiling_cards_in_this_checkpoint} |

Residual targets: ${Object.entries(coverage.residual_candidates_by_target).map(([name, count]) => `${name} ${count}`).join(", ")}.

| Marker text | Count |
|---|---:|
${markerRows}

Decision dispositions: ${Object.entries(coverage.decisions_by_disposition).map(([name, count]) => `${name} ${count}`).join(", ")}.

## Field-level impact

| Field | Cards | Wins | Losses | Ties | Mean delta F1 |
|---|---:|---:|---:|---:|---:|
${fieldRows}

Only \`attributes\`, \`components\`, and \`descriptive_rarity\` are writable by the isolated mechanism. No unrelated field moved.

## Changed cards

${changedRows}

## Interpretation

Both observed changes are the narrow specialization \`1st Edition -> 1st Bowman\` backed by exact front text. Because Composer already carried “Bowman” in Product, duplicate suppression rendered the new marker as “1st”. One card gained by removing the unsupported extra token “Edition”; the other lost because that same token happened to match the missing product phrase “Sapphire Edition” in the reviewed title. The label-free internal guards therefore passed, while the external reference-loss gate correctly failed. With one win, one loss, a negative macro delta, and only two eligible paired cards, this rule is not a positive asset. Keep it evaluation-only; do not add it to the 10-mechanism bank. A future experiment must split empty-field admission from \`1st Edition -> 1st Bowman\` replacement and must first improve same-call RC/SP/SSP marker capture coverage.

The JSON companion contains all ${summary.complete_pairs} card classifications and every marker decision, including all ties and candidate-only rows.
`;

await Promise.all([
  mkdir(dirname(outJsonPath), { recursive: true }),
  mkdir(dirname(outMdPath), { recursive: true })
]);
await Promise.all([
  writeFile(outJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
  writeFile(outMdPath, markdown, "utf8")
]);
process.stdout.write(`${JSON.stringify({
  verdict: result.verdict,
  summary,
  coverage: {
    complete_pairs: coverage.complete_pairs,
    excluded_singletons: coverage.excluded_singletons,
    residual_candidates: coverage.residual_candidates,
    marker_candidates: coverage.marker_candidates,
    parser_approved_supported_marker_candidates: coverage.parser_approved_supported_marker_candidates,
    admission_ceiling_cards_in_this_checkpoint: coverage.admission_ceiling_cards_in_this_checkpoint
  },
  gate,
  stop_reasons: stopReasons,
  outputs: [relative(process.cwd(), outJsonPath), relative(process.cwd(), outMdPath)]
}, null, 2)}\n`);
