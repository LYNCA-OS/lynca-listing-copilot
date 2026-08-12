import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildCsmStageRows, CSM_BRACKETS, MODALITIES, EMPTY_REASONS, VALUE_KINDS,
  CSM_STAGE_LEGACY_CONTRACT_VERSION, THIN_REGISTRY_RELEASE_ID
} from "../lib/listing/thin/csm-persistence.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { composeLyncaStandardName } from "../lib/listing/thin/canonical-naming-adapter.mjs";
import { semCanonicalEditableFields } from "../lib/listing/csm/sem-definition.mjs";

// The schema is the migration, not a copy of it in this file. Parsing the real
// SQL is what makes drift a test failure instead of an insert-time constraint
// violation on a table nothing writes to yet.
const MIGRATION = resolve(
  import.meta.dirname, "..", "supabase/migrations/20260728190000_csm_stage_shadow_foundation_v1.sql"
);
const sql = readFileSync(MIGRATION, "utf8");
const ADDITIVE_MIGRATION = resolve(
  import.meta.dirname, "..", "supabase/migrations/20260801094353_csm_atomic_stage_packet_v1.sql"
);
const additiveSql = readFileSync(ADDITIVE_MIGRATION, "utf8");

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

// Active Canonical Naming is one exact executable identity: v3, its named
// profile, and the profile's 80-character budget. A missing version must not
// silently relabel a CNL receipt as historical v2, and a shorter ad-hoc budget
// must not share the v0.1 profile id.
{
  const naming = composeLyncaStandardName(fields);
  assert.doesNotThrow(() => buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "cnl-valid", fields,
    composed: naming, title: naming.title
  }));

  const missingSubjectFields = { ...structuredClone(fields), subjects: [] };
  const missingSubject = composeLyncaStandardName(missingSubjectFields);
  assert.equal(missingSubject.canonical_naming_publishable, false);
  assert.equal(missingSubject.canonical_naming_failure_code,
    "canonical_naming_mandatory_subject_identity_missing");
  assert.throws(() => buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "cnl-missing-subject",
    fields: missingSubjectFields, composed: missingSubject, title: missingSubject.title
  }), /canonical_naming_output_not_publishable/);

  const wrongBudget = structuredClone(naming);
  wrongBudget.character_budget = 60;
  assert.throws(() => buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "cnl-wrong-budget", fields,
    composed: wrongBudget, title: naming.title
  }), /canonical_naming_output_not_publishable/);

  const missingPair = structuredClone(naming);
  delete missingPair.composer_version;
  delete missingPair.marketplace_profile_version;
  assert.throws(() => buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "cnl-missing-pair", fields,
    composed: missingPair, title: naming.title
  }), /canonical_naming_composition_contract_mismatch/);
}

// An independent marketplace search phrase is not a component and is not the
// team. Keep the three lanes separate so replay does not turn `Young Guns`
// into part of `Blackhawks`, while CNL can still publish the phrase.
{
  const youngGunsFields = {
    ...structuredClone(fields),
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
    parallel_exact: "",
    print_finish: "",
    components: ["RC"],
    attributes: ["RC"],
    search_optimization: ["Young Guns"]
  };
  const naming = composeLyncaStandardName(youngGunsFields);
  const namingRows = buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "cnl-independent-search",
    fields: youngGunsFields, composed: naming, title: naming.title
  });
  assert.match(naming.title, /\bYoung Guns\b/);
  assert.deepEqual(namingRows.output.structured_output.sem.search_optimization, [
    "RC", "Blackhawks"
  ]);
  assert.deepEqual(
    namingRows.output.structured_output.search_optimization,
    ["Young Guns"]
  );

  // The bridge's active writer is still v2/eBay. Even when a caller carries a
  // future independent search lane, its complete stage packet must stay
  // byte-identical to de55; only registered CNL v3 profiles may persist it.
  const legacyComposed = composeFromCanonicalFields(youngGunsFields, {
    features: { publication_coverage: false }
  });
  const legacyRows = buildCsmStageRows({
    tenantId: "tenant-legacy",
    recognitionSessionId: "session-legacy",
    fields: youngGunsFields,
    composed: legacyComposed,
    title: legacyComposed.title,
    createdAt: "2026-08-11T00:00:00.000Z",
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  assert.equal(Object.hasOwn(
    legacyRows.output.structured_output,
    "search_optimization"
  ), false);
  assert.deepEqual(legacyRows.output.structured_output.sem.search_optimization,
    ["RC", "Blackhawks"]);
  assert.equal(
    createHash("sha256").update(JSON.stringify(legacyRows)).digest("hex"),
    "87ef4d746dc0d50aed0b11b72a5f764d1a3e7bbb060ff72b3c234ad4f81e0df2",
    "the full v2 packet matches the archived de55 writer bytes"
  );
}
assert.equal(rows.resolution.registry_release_id, THIN_REGISTRY_RELEASE_ID);
assert.equal(rows.resolution.grammar, "NON_TCG");
assert.equal(rows.output.marketplace, "EBAY");
assert.ok(rows.evidence.every((row) => row.normalization_outcome === "KEPT"));
assert.match(additiveSql, new RegExp(`'${THIN_REGISTRY_RELEASE_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`),
  "the default resolution Registry release must be seeded by a new additive migration");
assert.doesNotMatch(sql, new RegExp(`'${THIN_REGISTRY_RELEASE_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`),
  "the already-applied foundation migration must remain unchanged");
{
  const normalizationConstraint = sql.match(/normalization_outcome in \(([^)]*)\)/i)?.[1] || "";
  const allowedOutcomes = new Set([...normalizationConstraint.matchAll(/'([^']+)'/g)].map((match) => match[1]));
  for (const row of rows.evidence) {
    assert.ok(allowedOutcomes.has(row.normalization_outcome),
      `${row.normalization_outcome} must be accepted by the migration`);
  }
}

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

// COS-9 Language is not only a title token. It is a primary canonical bracket,
// so it must survive into the persisted candidate/resolution rows as well.
{
  const tcgFields = parseCanonicalFields({
    ...fields, grammar: "tcg", ip: "Pokemon", language: "JP",
    manufacturer: "", product: "", set: "Mega Brave",
    subjects: ["Mega Absol Ex"], card_number: "089/063"
  }).fields;
  const tcgComposed = composeFromCanonicalFields(tcgFields);
const tcgRows = buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "tcg-language", fields: tcgFields,
    composed: tcgComposed, title: tcgComposed.title
});
assert.equal(tcgRows.resolution.grammar, "TCG");
  const languageCandidate = tcgRows.candidates.find((row) => row.bracket === "language");
  const languageResolved = tcgRows.resolved.find((row) => row.bracket === "language");
  assert.equal(languageCandidate.canonical_value, "JP");
  assert.equal(languageResolved.canonical_value, "JP");
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
assert.deepEqual(rows.output.dropped_trace.empty_at_input, composed.input_empty_fields);
assert.deepEqual(
  rows.output.dropped_trace.normalization_reason_codes,
  composed.normalization_reasons
);
assert.equal(rows.output.dropped_trace.character_budget, composed.character_budget);
assert.equal(rows.output.dropped_trace.rendered_length, composed.length);

// Inferred parents are a Composer normalization, not an observed input. The
// trace must still say that Manufacturer was empty at input even though the
// normalized bracket later renders a parent inferred from Product.
{
  const inferredFields = { ...fields, manufacturer: "", product: "Prizm" };
  const inferredComposition = composeFromCanonicalFields(inferredFields);
  assert.ok(inferredComposition.input_empty_fields.includes("manufacturer"));
  assert.equal(inferredComposition.empty_fields.includes("manufacturer"), false);
  const inferredRows = buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "inferred-parent-trace",
    fields: inferredFields, composed: inferredComposition, title: inferredComposition.title
  });
  assert.ok(inferredRows.output.dropped_trace.empty_at_input.includes("manufacturer"));
}

process.stdout.write("csm persistence: ok\n");

// ------------------------------------------------------------------- replay

// COS-25: "every downstream layer can be replayed from stored evidence and
// version references". Rebuilt from the ROWS alone -- no provider payload, no
// in-memory fields object.
{
  const { verifyReplay } = await import("../lib/listing/thin/csm-replay.mjs");
  const check = verifyReplay(rows, composed.title);
  assert.ok(check.ok, `replay must reproduce the shipped title: ${JSON.stringify(check.problems)}`);

  // The two empties survive the round trip as different things. A replay that
  // collapsed them would claim the card lacks a field the record says was
  // merely unreadable.
  assert.ok(check.replayed.fields.unreadable.includes("card_name"));
}

// Idempotency: row ids are content-derived, so re-emitting the same run
// produces the same ids rather than duplicate rows on retry.
{
  const again = buildCsmStageRows({
    tenantId: "t1", recognitionSessionId: "s1", fields, composed,
    title: composed.title, createdAt: "2026-08-01T00:00:00Z"
  });
  assert.deepEqual(again.evidence.map((row) => row.id), rows.evidence.map((row) => row.id));
  assert.equal(again.resolution.id, rows.resolution.id);
  assert.equal(again.output.id, rows.output.id);
  assert.equal(again.resolution.recognition_packet_sha256, rows.resolution.recognition_packet_sha256);
}
