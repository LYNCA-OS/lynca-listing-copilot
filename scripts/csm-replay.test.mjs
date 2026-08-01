#!/usr/bin/env node

import assert from "node:assert/strict";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  replayFromRows,
  verifyReplay
} from "../lib/listing/thin/csm-replay.mjs";

const base = {
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "",
  subjects: ["Victor Wembanyama"], team: "Spurs", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
  parallel_exact: "", descriptive_rarity: "", card_number: "221",
  serial: "17/50", attributes: ["RC"], grade: "PSA 10",
  grammar: "standard", lot_count: "", language: "", ip: "",
  unreadable: [], low_confidence: []
};

function stage(input, recognitionSessionId) {
  const fields = parseCanonicalFields(input).fields;
  const composed = composeFromCanonicalFields(fields);
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
assert.ok(verifyReplay(standard.rows, standard.composed.title).ok);

// Identity grammar and composition grammar are different contracts. Uppercase
// TCG is persisted for identity; lowercase tcg selects the TCG composer.
const tcg = stage({
  ...base,
  year: "2025", manufacturer: "", product: "Pokemon", set: "Mega Brave",
  subjects: ["Mega Absol Ex"], card_number: "089/063", serial: "",
  attributes: [], grade: "CGC 10", grammar: "tcg", language: "JP", ip: "Pokemon"
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
  serial: "", attributes: [], grade: "", grammar: "lot", lot_count: "2"
}, "session-lot");
assert.equal(lot.rows.resolution.grammar, "NON_TCG");
assert.equal(lot.rows.output.structured_output.composition_grammar, "lot");
{
  const checked = verifyReplay(lot.rows, lot.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "lot");
  assert.match(checked.replayed.title, /^2 Card Lot /);
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
