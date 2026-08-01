import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildCsmStageRows, CSM_BRACKETS, MODALITIES, EMPTY_REASONS, VALUE_KINDS
} from "../lib/listing/thin/csm-persistence.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";

// The schema is the migration, not a copy of it in this file. Parsing the real
// SQL is what makes drift a test failure instead of an insert-time constraint
// violation on a table nothing writes to yet.
const MIGRATION = resolve(
  import.meta.dirname, "..", "supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql"
);
const sql = readFileSync(MIGRATION, "utf8");

function columnsOf(table) {
  const match = sql.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  assert.ok(match, `${table} must exist in the migration`);
  return new Set(match[1].split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(constraint|primary key|unique|foreign key|check|\)|references|on delete)/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    // Digits are legal in a column name and `resolution_packet_sha256` has
    // three of them. The first version of this pattern excluded it and the
    // test failed on a column that exists -- a false failure, which is the
    // safe direction, but still a bug in the checker rather than the code.
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name)));
}

// Every bracket the schema allows is a CSM canonical field, and vice versa.
// If those two lists ever diverge, one of them is wrong and this says which.
{
  const allowed = new Set([...sql.matchAll(/bracket in \(([^)]*)\)/gi)]
    .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1])));
  assert.ok(allowed.size > 0, "the migration must constrain bracket");
  for (const bracket of allowed) {
    assert.ok(semCanonicalEditableFields.includes(bracket), `${bracket} must be a CSM canonical field`);
  }
  for (const field of CSM_BRACKETS) assert.ok(allowed.has(field), `${field} must be allowed by the schema`);
}

const fields = parseCanonicalFields({
  year: "2025-26", manufacturer: "Topps", product: "Chrome", set: "",
  card_name: "", release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
  parallel_exact: "", descriptive_rarity: "", subjects: ["Victor Wembanyama"], team: "Spurs",
  card_number: "221", serial: "17/50", attributes: ["RC"], grade: "PSA 10",
  grammar: "standard", lot_count: "",
  // One field the card has but could not be read, one it has and we are unsure
  // of: the two states the schema calls INSUFFICIENT_EVIDENCE and a low
  // observation confidence.
  unreadable: ["card_name"], low_confidence: ["surface_color"]
}).fields;
const composed = composeFromCanonicalFields(fields);
const rows = buildCsmStageRows({
  tenantId: "t1", recognitionSessionId: "s1", fields, composed,
  title: composed.title, createdAt: "2026-08-01T00:00:00Z"
});

// Every key we emit is a column that exists.
for (const [table, produced] of [
  ["csm_evidence_observations", rows.evidence],
  ["csm_bracket_candidates", rows.candidates],
  ["csm_candidate_evidence_links", rows.links],
  ["csm_resolved_brackets", rows.resolved],
  ["csm_marketplace_outputs", [rows.output]],
  ["csm_identity_resolutions", [rows.resolution]]
]) {
  const columns = columnsOf(table);
  for (const row of produced) {
    for (const key of Object.keys(row)) {
      assert.ok(columns.has(key), `${table} has no column ${key}`);
    }
  }
}

// Enum values are the schema's, not ours.
for (const row of rows.evidence) assert.ok(MODALITIES.includes(row.modality));
for (const row of rows.candidates) {
  assert.ok(VALUE_KINDS.includes(row.value_kind));
  if (row.empty_reason) assert.ok(EMPTY_REASONS.includes(row.empty_reason));
}

// The check constraint the schema actually writes: VALUE means a value and no
// empty_reason; EMPTY means the reverse.
for (const row of rows.candidates) {
  if (row.value_kind === "VALUE") {
    assert.notEqual(row.canonical_value, null);
    assert.equal(row.empty_reason, null);
  } else {
    assert.equal(row.canonical_value, null);
    assert.ok(row.empty_reason);
  }
}

// ABSENT and INSUFFICIENT_EVIDENCE are different answers and both are used.
// A path that could not tell them apart would have to guess, which is why the
// third state exists upstream.
{
  const byBracket = Object.fromEntries(rows.candidates.map((row) => [row.bracket, row]));
  assert.equal(byBracket.card_name.empty_reason, "INSUFFICIENT_EVIDENCE");
  assert.equal(byBracket.language.empty_reason, "ABSENT");
}

// A flagged field is lower confidence, not a different modality: the model saw
// it and is unsure of it.
{
  const finish = rows.evidence.find((row) => row.bracket === "print_finish");
  assert.equal(finish.observation_confidence, 0.5);
  assert.equal(finish.normalization_reason_code, "LOW_CONFIDENCE_OBSERVATION");
  const year = rows.evidence.find((row) => row.bracket === "year");
  assert.equal(year.observation_confidence, 0.8);
}

// Replayability: every layer references the one before it, and the packet
// hashes let a replay prove it is reading the same input.
assert.ok(rows.resolution.recognition_packet_sha256);
assert.ok(rows.output.resolution_packet_sha256);
assert.equal(rows.output.resolution_id, rows.resolution.id);
for (const row of rows.resolved) assert.equal(row.resolution_id, rows.resolution.id);
for (const link of rows.links) {
  assert.ok(rows.candidates.some((row) => row.id === link.candidate_id));
  assert.ok(rows.evidence.some((row) => row.id === link.evidence_observation_id));
}

// The projection ledger distinguishes a budget drop from a profile suppression.
// Collapsing them would make a replay unable to say why a bracket is absent.
assert.ok(Array.isArray(rows.output.dropped_trace.dropped_for_budget));
assert.ok(rows.output.dropped_trace.suppressed_by_profile.includes("card_number"));

process.stdout.write("csm persistence: ok\n");
