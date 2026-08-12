#!/usr/bin/env node

import assert from "node:assert/strict";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { composeLyncaStandardName } from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  buildCsmStageRows,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  computeCsmPacketHashes,
  EBAY_PROFILE_VERSION,
  LYNCA_STANDARD_PROFILE_VERSION,
  THIN_COMPOSER_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  replayFromRows,
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";

const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "",
  subjects: ["Victor Wembanyama"], team: "Spurs", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
  parallel_exact: "", descriptive_rarity: "", card_number: "221",
  serial: "17/50", attributes: ["RC"], grading_info: {
    company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
  },
  grammar: "standard", lot_count: "", language: "", ip: "",
  unreadable: [], low_confidence: []
};

function stage(input, recognitionSessionId, compose = composeFromCanonicalFields) {
  const fields = parseCanonicalFields(input).fields;
  const composed = compose(fields);
  return {
    composed,
    rows: buildCsmStageRows({
      tenantId: "tenant-replay", recognitionSessionId, fields, composed,
      title: composed.title
    })
  };
}

const clone = (value) => structuredClone(value);

// Re-seal a deliberately modified fixture in dependency order. Tests use this
// only when exercising the version/grammar dispatcher rather than corruption.
function reseal(rows) {
  rows.resolution.recognition_packet_sha256 = computeCsmPacketHashes(rows).csm_recognition_packet_sha256;
  rows.output.resolution_packet_sha256 = computeCsmPacketHashes(rows).csm_resolution_packet_sha256;
  rows.session_hashes = computeCsmPacketHashes(rows);
  return rows;
}

const standard = stage(base, "session-standard");
assert.equal(standard.rows.output.composer_version, THIN_COMPOSER_VERSION_V2);
assert.equal(standard.rows.output.marketplace_profile_version, EBAY_PROFILE_VERSION);
assert.ok(verifyReplay(standard.rows, standard.composed.title).ok);
assert.match(standard.composed.title, /PSA 9\/10$/);
assert.deepEqual(standard.rows.output.structured_output.sem.grading_info, {
  company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
});

// Identity grammar and composition grammar are different contracts. Uppercase
// TCG is persisted for identity; lowercase tcg selects the TCG composer.
const tcg = stage({
  ...base,
  year: "2025", manufacturer: "", product: "Pokemon", set: "Mega Brave",
  subjects: ["Mega Absol Ex"], card_number: "089/063", serial: "",
  attributes: [], grading_info: {
    company: "CGC", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  }, grammar: "tcg", language: "JP", ip: "Pokemon"
}, "session-tcg");
assert.equal(tcg.rows.resolution.grammar, "TCG");
assert.equal(tcg.rows.output.structured_output.composition_grammar, "tcg");
{
  const checked = verifyReplay(tcg.rows, tcg.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "tcg");
  assert.match(checked.replayed.title, /^2025 Pokemon JP /);
}

// Lot is NON_TCG identity, but must retain its own composition grammar and
// quantity. Collapsing both to NON_TCG would replay this as a Standard card.
const lot = stage({
  ...base,
  year: "2023", manufacturer: "Panini", product: "Prizm", set: "",
  subjects: ["Victor Wembanyama", "LeBron James"], team: "", card_number: "",
  serial: "", attributes: [], grading_info: null, grade: "", grammar: "lot", lot_count: "2"
}, "session-lot");
assert.equal(lot.rows.resolution.grammar, "NON_TCG");
assert.equal(lot.rows.output.structured_output.composition_grammar, "lot");
assert.deepEqual(lot.rows.output.structured_output.lot_terminal, {
  lot_quantity_unresolved: false,
  lot_single_card: false,
  lot_unshared_attributes: [],
  publishable: true,
  failure_code: null
});
{
  const checked = verifyReplay(lot.rows, lot.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "lot");
  assert.match(checked.replayed.title, /^Lot\*2 /);
  assert.equal(checked.replayed.composed.lot_terminal_durable, true);
}

// Durable `lot_terminal` is the feature marker for the stronger shared-only
// rules. A Composer v2/eBay Lot written before that receipt existed must keep
// the pre-change component title byte-for-byte instead of being reinterpreted
// by the current Composer.
{
  const fields = parseCanonicalFields({
    ...base,
    year: "2023", manufacturer: "Panini", product: "Prizm", set: "",
    subjects: ["Victor Wembanyama", "LeBron James"], team: "", card_number: "",
    serial: "", attributes: ["RC", "Auto"], grading_info: null, grade: "",
    grammar: "lot", lot_count: "2"
  }).fields;
  const historicalComposed = composeFromCanonicalFields(fields, {
    features: {
      durable_lot_terminal_shared_only: false,
      publication_coverage: false
    }
  });
  const historicalRows = buildCsmStageRows({
    tenantId: "tenant-replay", recognitionSessionId: "session-historical-lot-v2",
    fields, composed: historicalComposed, title: historicalComposed.title,
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  delete historicalRows.output.structured_output.lot_terminal;
  reseal(historicalRows);
  const expected = "Lot*2 2023 Panini Prizm Victor Wembanyama LeBron James RC Auto";
  assert.equal(historicalRows.output.title, expected);
  const checked = verifyReplay(historicalRows, expected);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.title, expected);
  assert.equal(checked.replayed.composed.lot_terminal_durable, undefined);
}

// A newly persisted non-publishable Lot cannot be downgraded into legacy mode
// by deleting its terminal receipt and re-sealing the remaining packet.
{
  const unresolved = stage({
    ...base, subjects: ["A", "B"], team: "", card_number: "", serial: "",
    attributes: [], grading_info: null, grade: "", grammar: "lot", lot_count: ""
  }, "session-lot-missing-terminal", (fields) => {
    const composed = composeFromCanonicalFields(fields);
    return {
      ...composed,
      lot_publishable: false,
      lot_publication_failure_code: "LOT_QUANTITY_UNRESOLVED"
    };
  });
  const forged = clone(unresolved.rows);
  delete forged.output.structured_output.lot_terminal;
  reseal(forged);
  const checked = verifyReplay(forged, unresolved.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "lot_terminal_receipt_missing"),
    JSON.stringify(checked.problems));
}

// The same activation marker protects a publishable Lot. Receipt deletion is
// not a downgrade path merely because no failure code was present.
{
  const forged = clone(lot.rows);
  delete forged.output.structured_output.lot_terminal;
  reseal(forged);
  const checked = verifyReplay(forged, lot.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "lot_terminal_receipt_missing"));
}

// The terminal receipt is hash-sealed and semantically replayed. Re-sealing a
// forged state proves this is not merely packet-integrity coverage.
{
  const forged = clone(lot.rows);
  forged.output.structured_output.lot_terminal.publishable = false;
  forged.output.structured_output.lot_terminal.failure_code = "LOT_SINGLE_CARD";
  reseal(forged);
  const checked = verifyReplay(forged, lot.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "lot_terminal_receipt_invalid"));
}

for (const mutate of [
  (terminal) => { terminal.extra_key = true; },
  (terminal) => { delete terminal.failure_code; },
  (terminal) => { terminal.publishable = "true"; },
  (terminal) => { terminal.lot_quantity_unresolved = 0; },
  (terminal) => { terminal.lot_unshared_attributes = "set"; },
  (terminal) => { terminal.lot_unshared_attributes = ["set", "set"]; },
  (terminal) => { terminal.lot_unshared_attributes = ["not_a_canonical_lot_field"]; },
  (terminal) => { terminal.lot_unshared_attributes = ["team", "set"]; }
]) {
  const forged = clone(lot.rows);
  mutate(forged.output.structured_output.lot_terminal);
  reseal(forged);
  const checked = verifyReplay(forged, lot.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "lot_terminal_receipt_invalid"),
    JSON.stringify(checked.problems));
}

// Withheld unshared fields survive persistence and are re-derived on replay;
// no reader needs the original in-memory Composer result.
{
  const unshared = stage({
    ...base,
    manufacturer: "Panini", product: "Impeccable",
    set: "Stats Autograph; Jersey Numbers Auto",
    subjects: ["A", "B"], team: "Warriors; Cavaliers",
    serial: "", grade: "", grading_info: null,
    grammar: "lot", lot_count: "2"
  }, "session-lot-unshared");
  assert.deepEqual(unshared.rows.output.structured_output.lot_terminal
    .lot_unshared_attributes, ["components", "set", "team"]);
  const checked = verifyReplay(unshared.rows, unshared.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.deepEqual(checked.replayed.composed.lot_unshared_attributes,
    ["components", "set", "team"]);
}

// Composer versions are executable behavior. Ordinary v2 rows keep their
// display-only exact-parallel colour compaction, while a persisted v1 row must
// keep the old dropped-finish title forever after v3 becomes current.
{
  const versionedFields = {
    ...base,
    year: "2018",
    manufacturer: "Topps",
    product: "Topps Silver Pack",
    subjects: ["Shohei Ohtani"],
    card_name: "1983 Chrome Promo",
    surface_color: "Blue",
    parallel_family: "Refractor",
    parallel_exact: "Blue Refractor",
    print_finish: "Blue Refractor",
    serial: "018/150",
    attributes: ["RC"],
    grading_info: { company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY" }
  };
  const v2 = stage(versionedFields, "session-composer-v2");
  assert.equal(v2.rows.output.composer_version, THIN_COMPOSER_VERSION_V2);
  assert.match(v2.composed.title, /\bBlue\b/);
  assert.ok(verifyReplay(v2.rows, v2.composed.title).ok);

  const parsed = parseCanonicalFields(versionedFields).fields;
  const legacyComposed = composeFromCanonicalFields(parsed, {
    features: { exact_parallel_color_compaction: false }
  });
  assert.doesNotMatch(legacyComposed.title, /\bBlue\b/);
  const legacy = clone(v2.rows);
  legacy.output.composer_version = THIN_COMPOSER_VERSION_V1;
  legacy.output.title = legacyComposed.title;
  legacy.output.included_brackets = legacyComposed.brackets;
  legacy.output.dropped_trace = {
    dropped_for_budget: legacyComposed.dropped,
    suppressed_by_profile: legacyComposed.suppressed,
    restored: legacyComposed.restored,
    truncated: legacyComposed.truncated,
    empty_at_input: legacyComposed.input_empty_fields,
    normalization_reason_codes: legacyComposed.normalization_reasons,
    character_budget: legacyComposed.character_budget,
    rendered_length: legacyComposed.length
  };
  legacy.output.structured_output.publication_coverage = legacyComposed.publication_coverage;
  reseal(legacy);
  const checked = verifyReplay(legacy, legacyComposed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.composed.title_render_source, "csm_marketplace_composer_v1");
}

// Canonical Naming v3 is a new pair, not a relabelled ordinary v2 output. Its
// complete machine trace is persisted and must be reproduced from resolved
// rows before a prepared packet is accepted.
const canonicalNaming = stage(
  { ...base, descriptive_rarity: "SSP" },
  "session-canonical-naming-v3",
  composeLyncaStandardName
);
assert.equal(canonicalNaming.rows.output.composer_version, THIN_COMPOSER_VERSION);
assert.equal(
  canonicalNaming.rows.output.marketplace_profile_version,
  LYNCA_STANDARD_PROFILE_VERSION
);
assert.deepEqual(
  canonicalNaming.rows.output.dropped_trace.canonical_naming,
  canonicalNaming.composed.canonical_naming_trace
);
assert.match(canonicalNaming.composed.title, /\bSSP\b/);
assert.ok(canonicalNaming.composed.canonical_naming_trace.selected.some((token) => (
  token.field === "descriptive_rarity" && token.canonical_value === "SSP"
)));
{
  const checked = verifyReplay(canonicalNaming.rows, canonicalNaming.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.deepEqual(
    checked.replayed.composed.canonical_naming_trace,
    canonicalNaming.composed.canonical_naming_trace
  );
}
{
  const tampered = clone(canonicalNaming.rows);
  tampered.output.dropped_trace.canonical_naming.selected[0].display_value += " altered";
  reseal(tampered);
  const checked = verifyReplay(tampered, canonicalNaming.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "canonical_naming_trace_mismatch"));
}
{
  const missing = clone(canonicalNaming.rows);
  delete missing.output.dropped_trace.canonical_naming;
  reseal(missing);
  const checked = verifyReplay(missing, canonicalNaming.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "canonical_naming_trace_missing"));
}
{
  const invalid = clone(canonicalNaming.rows);
  invalid.resolved.find((row) => row.bracket === "card_number").canonical_value = "X".repeat(80);
  const invalidReplay = replayFromRows(invalid, { allowUnsealedMutation: true }).composed;
  assert.equal(invalidReplay.canonical_naming_publishable, false);
  invalid.output.title = "";
  invalid.output.included_brackets = invalidReplay.brackets;
  invalid.output.dropped_trace = {
    dropped_for_budget: invalidReplay.dropped,
    suppressed_by_profile: invalidReplay.suppressed,
    restored: invalidReplay.restored,
    truncated: invalidReplay.truncated,
    empty_at_input: invalidReplay.input_empty_fields,
    normalization_reason_codes: invalidReplay.normalization_reasons,
    character_budget: invalidReplay.character_budget,
    rendered_length: invalidReplay.length,
    canonical_naming: invalidReplay.canonical_naming_trace
  };
  invalid.output.structured_output.publication_coverage =
    invalidReplay.publication_coverage;
  reseal(invalid);
  const checked = verifyReplay(invalid, "");
  assert.equal(checked.ok, false, "a self-consistent empty P0-overbudget packet must fail closed");
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "canonical_naming_output_not_publishable"
  )));
}
{
  const wrongBudget = clone(canonicalNaming.rows);
  wrongBudget.output.dropped_trace.character_budget = 60;
  reseal(wrongBudget);
  const checked = verifyReplay(wrongBudget, canonicalNaming.composed.title);
  assert.equal(checked.ok, false, "the profile version cannot silently replay a different budget");
  assert.ok(checked.problems.some((problem) => (
    problem.kind === "canonical_naming_character_budget_mismatch"
  )));
}
assert.throws(
  () => composeLyncaStandardName(parseCanonicalFields(base).fields, { limit: 60 }),
  /canonical_naming_character_budget_must_match_profile/
);

// `search_optimization` has an independent lane in CNL. It must survive the
// stage packet without being confused with components or team, and historical
// ordinary v1/v2 composers must continue ignoring that lane exactly as before.
{
  const youngGunsFields = parseCanonicalFields({
    ...base,
    year: "2023-24",
    manufacturer: "Upper Deck",
    product: "Series 2",
    set: "",
    subjects: ["Connor Bedard"],
    team: "Blackhawks",
    card_number: "451",
    serial: "",
    surface_color: "",
    parallel_family: "",
    attributes: ["RC"],
    grading_info: null,
    grade: ""
  }).fields;
  youngGunsFields.search_optimization = ["Young Guns"];

  const naming = composeLyncaStandardName(youngGunsFields);
  const namingRows = buildCsmStageRows({
    tenantId: "tenant-replay", recognitionSessionId: "session-independent-search-v3",
    fields: youngGunsFields, composed: naming, title: naming.title
  });
  const replayed = replayFromRows(namingRows);
  assert.deepEqual(replayed.fields.search_optimization, ["Young Guns"]);
  assert.deepEqual(replayed.fields.components, ["RC"]);
  assert.equal(replayed.fields.team, "Blackhawks");
  assert.equal(replayed.title, naming.title);
  assert.match(replayed.title, /\bYoung Guns\b/);
  assert.ok(verifyReplay(namingRows, naming.title).ok);
  const lostIndependentSearch = clone(namingRows);
  delete lostIndependentSearch.output.structured_output.search_optimization;
  reseal(lostIndependentSearch);
  const lostCheck = verifyReplay(lostIndependentSearch, naming.title);
  assert.equal(lostCheck.ok, false);
  assert.ok(lostCheck.problems.some((problem) => (
    problem.kind === "canonical_naming_trace_mismatch"
      || problem.kind === "publication_coverage_replay_mismatch"
  )));

  const withoutIndependentSearch = { ...youngGunsFields, search_optimization: [] };
  const ordinaryV2 = composeFromCanonicalFields(youngGunsFields, {
    features: { publication_coverage: false }
  });
  assert.equal(ordinaryV2.title, composeFromCanonicalFields(withoutIndependentSearch).title);
  const ordinaryRows = buildCsmStageRows({
    tenantId: "tenant-replay", recognitionSessionId: "session-independent-search-v2",
    fields: youngGunsFields, composed: ordinaryV2, title: ordinaryV2.title,
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  assert.equal(Object.hasOwn(
    ordinaryRows.output.structured_output,
    "search_optimization"
  ), false, "the bridge must not change de55 v2 packet bytes");
  assert.deepEqual(replayFromRows(ordinaryRows).fields.search_optimization, [],
    "historical v2 never published an independent search lane");
  assert.ok(verifyReplay(ordinaryRows, ordinaryV2.title).ok);

  const ordinaryV1 = composeFromCanonicalFields(youngGunsFields, {
    features: { exact_parallel_color_compaction: false }
  });
  assert.equal(ordinaryV1.title, composeFromCanonicalFields(withoutIndependentSearch, {
    features: { exact_parallel_color_compaction: false }
  }).title);
  const historicalV1Rows = clone(ordinaryRows);
  historicalV1Rows.output.composer_version = THIN_COMPOSER_VERSION_V1;
  historicalV1Rows.output.title = ordinaryV1.title;
  historicalV1Rows.output.included_brackets = ordinaryV1.brackets;
  historicalV1Rows.output.dropped_trace = {
    dropped_for_budget: ordinaryV1.dropped,
    suppressed_by_profile: ordinaryV1.suppressed,
    restored: ordinaryV1.restored,
    truncated: ordinaryV1.truncated,
    empty_at_input: ordinaryV1.input_empty_fields,
    normalization_reason_codes: ordinaryV1.normalization_reasons,
    character_budget: ordinaryV1.character_budget,
    rendered_length: ordinaryV1.length
  };
  reseal(historicalV1Rows);
  assert.ok(verifyReplay(historicalV1Rows, ordinaryV1.title).ok);
}

// External identity v1/v2 remain literal executable history. Adding ordinary
// v3 must not route either receipt through the new Standard adapter.
{
  const fields = parseCanonicalFields(base).fields;
  const externalTitle =
    "2025 Topps Chrome #221 Victor Wembanyama Gold Refractor 17/50 Spurs RC PSA 9/10";
  for (const release of Object.values(EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases)) {
    const composed = composeCanonicalFieldsForStoredOutput(fields, {
      marketplace: "EBAY",
      ...release.output
    });
    assert.equal(composed.title, externalTitle);
    assert.match(composed.title_render_source, /verified_external_identity/);
  }
}

// Legacy rows can be replayed only when old persisted facts make the grammar
// unambiguous: identity identifies TCG; composer-v1's mandatory `lot` ledger
// entry identifies Lot. A NON_TCG row without a usable ledger fails closed.
for (const [fixture, expectedGrammar] of [
  [standard, "standard"], [tcg, "tcg"], [lot, "lot"]
]) {
  const legacy = clone(fixture.rows);
  delete legacy.output.structured_output.composition_grammar;
  reseal(legacy);
  const checked = verifyReplay(legacy, fixture.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, expectedGrammar);
}
{
  const ambiguous = clone(standard.rows);
  delete ambiguous.output.structured_output.composition_grammar;
  ambiguous.output.included_brackets = [];
  reseal(ambiguous);
  const checked = verifyReplay(ambiguous, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "composition_grammar_missing_or_ambiguous"));
}

// Version references are executable contracts, not labels. Even a correctly
// re-hashed row cannot fall through to today's composer/profile.
for (const [key, value] of [
  ["composer_version", "thin-marketplace-composer-unknown"],
  ["marketplace_profile_version", "ebay-profile-unknown"]
]) {
  const unknown = clone(standard.rows);
  unknown.output[key] = value;
  reseal(unknown);
  assert.throws(
    () => replayFromRows(unknown),
    (error) => error?.code === "unsupported_replay_version"
  );
  const checked = verifyReplay(unknown, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "unsupported_replay_version"));
}

// Composer/profile versions form one executable identity. Cross-pairing the
// new profile with ordinary v2, or the old profile with v3, fails closed even
// after all packet hashes have been recomputed.
for (const [fixture, profile] of [
  [canonicalNaming, EBAY_PROFILE_VERSION],
  [standard, LYNCA_STANDARD_PROFILE_VERSION]
]) {
  const crossed = clone(fixture.rows);
  crossed.output.marketplace_profile_version = profile;
  reseal(crossed);
  assert.throws(
    () => replayFromRows(crossed),
    (error) => error?.code === "unsupported_replay_version"
  );
  const checked = verifyReplay(crossed, fixture.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "unsupported_replay_version"));
}
{
  const wrongGrammar = clone(tcg.rows);
  wrongGrammar.output.composer_version = THIN_COMPOSER_VERSION;
  wrongGrammar.output.marketplace_profile_version = LYNCA_STANDARD_PROFILE_VERSION;
  reseal(wrongGrammar);
  assert.throws(
    () => replayFromRows(wrongGrammar),
    (error) => error?.code === "unsupported_composition_grammar_for_version"
  );
}

// A self-consistent but semantically impossible identity/composition pair is
// rejected rather than silently routed to Standard.
{
  const mismatch = clone(tcg.rows);
  mismatch.resolution.grammar = "NON_TCG";
  reseal(mismatch);
  const checked = verifyReplay(mismatch, tcg.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "identity_composition_grammar_mismatch"));
}

// DB result order and default created_at values are non-semantic. They must not
// change any of the three packet hashes or prevent a valid replay.
{
  const reordered = clone(standard.rows);
  for (const name of ["evidence", "candidates", "links", "resolved"]) {
    reordered[name].reverse();
    reordered[name].forEach((row, index) => { row.created_at = `2026-08-01T00:00:${String(index).padStart(2, "0")}Z`; });
  }
  reordered.resolution.created_at = "2026-08-01T01:00:00Z";
  reordered.output.created_at = "2026-08-01T02:00:00Z";
  assert.deepEqual(computeCsmPacketHashes(reordered), standard.rows.session_hashes);
  assert.ok(verifyReplay(reordered, standard.composed.title).ok);
}

// Canonical-value tampering is detected even when that bracket is suppressed
// and therefore would not change the marketplace title.
{
  const tampered = clone(standard.rows);
  tampered.resolved.find((row) => row.bracket === "card_number").canonical_value = "999";
  const checked = verifyReplay(tampered, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.equal(checked.replayed, null);
  assert.ok(checked.problems.some((problem) => problem.kind === "packet_hash_mismatch"
    && problem.packet === "resolution"));
}

// Each stage is independently bound to the corresponding persisted rows.
// Changing an upstream candidate does not need a title change to break the
// recognition hash; changing only the output trace breaks the marketplace hash.
{
  const tampered = clone(standard.rows);
  tampered.candidates.find((row) => row.bracket === "card_number").canonical_value = "999";
  const checked = verifyReplay(tampered, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "packet_hash_mismatch"
    && problem.packet === "recognition"));
}
{
  const tampered = clone(standard.rows);
  tampered.output.dropped_trace.truncated = !tampered.output.dropped_trace.truncated;
  const checked = verifyReplay(tampered, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "packet_hash_mismatch"
    && problem.packet === "marketplace"));
}

// Stored-hash corruption and a missing session hash chain both fail closed.
{
  const corrupted = clone(standard.rows);
  corrupted.output.resolution_packet_sha256 = "0".repeat(64);
  const checked = verifyReplay(corrupted, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "packet_hash_mismatch"
    && problem.source === "output.resolution_packet_sha256"));
}
{
  const incomplete = clone(standard.rows);
  delete incomplete.session_hashes;
  const checked = verifyReplay(incomplete, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "session_packet_hashes_missing"));
}

process.stdout.write("csm replay: ok\n");
