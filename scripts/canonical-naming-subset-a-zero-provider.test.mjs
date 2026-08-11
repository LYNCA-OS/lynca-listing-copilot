#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "..",
  "fixtures/csm/subset-a-low-canonical-v1.json"
);
const ADAPTER_PATH = resolve(
  import.meta.dirname,
  "..",
  "lib/listing/thin/canonical-naming-adapter.mjs"
);
const CORE_PATH = resolve(
  import.meta.dirname,
  "..",
  "lib/listing/thin/canonical-naming-layer.mjs"
);
const rawFixture = readFileSync(FIXTURE_PATH, "utf8");
const fixture = JSON.parse(rawFixture);
const hex64 = /^[a-f0-9]{64}$/;
const EXPECTED_SOURCE_EVIDENCE_CONTENT_SHA256 =
  "5edcf9c43d2a840f5480dd8bd980cdaf7db6f0d34c25bbca1ee5b8f69049fd78";
const EXPECTED_PROJECTION_CONTENT_SHA256 =
  "b4f0e4e78632b38e060b1d7708e86e4e451c49ea303803cb8522eade74e52a6d";

// This committed asset is deliberately insufficient to contact Production.
assert.doesNotMatch(rawFixture, /csmsess_|asset_[a-f0-9]{8}-|cookie|jwt|owner[_-](?:execution[_-])?receipt/i);
assert.doesNotMatch(rawFixture, /"(?:recognition_session_id|session_id|asset_id)"\s*:/i);
assert.equal(fixture.schema_version, "lynca-subset-a-low-canonical-v1");
assert.equal(fixture.contract.provider_calls, 0);
assert.equal(fixture.cases.length, 16);
assert.deepEqual(fixture.cases.map((entry) => entry.id), "abcdefghijklmnop".split(""));

const executableSource = [ADAPTER_PATH, CORE_PATH]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
assert.doesNotMatch(executableSource, /from\s+["'][^"']*(?:provider|openai|https?:)/i);
assert.doesNotMatch(executableSource, /\bfetch\s*\(/);

const allImageNames = fixture.cases.flatMap((entry) => entry.images.map((image) => image.name));
const allImageHashes = fixture.cases.flatMap((entry) => entry.images.map((image) => image.sha256));
const expectedImageNames = fixture.cases.flatMap((entry) => [
  `${entry.id}.webp`,
  `${entry.id}${entry.id}.webp`
]);
assert.deepEqual(allImageNames, expectedImageNames);
assert.equal(new Set(allImageNames).size, 32);
assert.equal(new Set(allImageHashes).size, 32);
assert.ok(allImageHashes.every((value) => hex64.test(value)));
assert.ok(hex64.test(fixture.contract.formal_evidence_sha256));
assert.ok(hex64.test(fixture.contract.recovery_evidence_sha256));
const sourceEvidence = fixture.cases.map(({
  id, evidence_partition, images, anchors, canonical_fields
}) => ({ id, evidence_partition, images, anchors, canonical_fields }));
const projection = fixture.cases.map(({ id, expected }) => ({ id, expected }));
const digest = (domain, value) => createHash("sha256")
  .update(`${domain}\0`)
  .update(JSON.stringify(value))
  .digest("hex");
assert.equal(fixture.contract.source_evidence_content_sha256,
  EXPECTED_SOURCE_EVIDENCE_CONTENT_SHA256);
assert.equal(
  digest("lynca-subset-a-low-source-evidence-v1", sourceEvidence),
  EXPECTED_SOURCE_EVIDENCE_CONTENT_SHA256,
  "the cloud-derived fields, redacted anchors, and image hashes must not drift with projection edits"
);
assert.equal(
  digest("lynca-subset-a-cnl-projection-v1", projection),
  EXPECTED_PROJECTION_CONTENT_SHA256,
  "the local expected titles and traces are a separately versioned projection snapshot"
);
assert.equal(fixture.contract.projection_content_sha256, EXPECTED_PROJECTION_CONTENT_SHA256);

const sessionAnchors = fixture.cases.map((entry) => entry.anchors.session_sha256);
const assetAnchors = fixture.cases.map((entry) => entry.anchors.asset_sha256);
assert.ok([...sessionAnchors, ...assetAnchors].every((value) => hex64.test(value)));
assert.equal(new Set(sessionAnchors).size, 16);
assert.equal(new Set(assetAnchors).size, 16);

for (const entry of fixture.cases) {
  const expectedPartition = entry.id <= "j" ? "formal_a_j" : "recovery_k_p";
  assert.equal(entry.evidence_partition, expectedPartition, `${entry.id}: evidence partition`);
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("zero_provider_gate_network_forbidden");
};

const uniqueFields = (rows, reason) => [...new Set(rows
  .filter((row) => row.reason === reason)
  .map((row) => row.field))];
const titleTokens = (title) => title.split(/\s+/).filter(Boolean);

try {
  const { composeLyncaStandardName } = await import(
    "../lib/listing/thin/canonical-naming-adapter.mjs"
  );

  for (const entry of fixture.cases) {
    const { canonical_fields: fields, expected } = entry;
    const result = composeLyncaStandardName(fields);
    const trace = result.canonical_naming_trace;
    const label = `Subset A ${entry.id}`;

    assert.equal(result.title, expected.title, `${label}: exact title`);
    assert.equal(result.length, expected.length, `${label}: frozen length`);
    assert.equal(result.length, result.title.length, `${label}: measured length`);
    assert.ok(result.length <= fixture.contract.character_budget, `${label}: 80-char budget`);
    assert.equal(result.canonical_naming_publishable, true, `${label}: publishable`);
    assert.equal(result.truncated, false, `${label}: no truncation`);
    assert.equal(result.title_render_source, "canonical_naming_layer_v0.1", `${label}: renderer`);
    assert.equal(result.composer_version, fixture.contract.composer_version, `${label}: composer`);
    assert.equal(
      result.marketplace_profile_version,
      fixture.contract.marketplace_profile,
      `${label}: profile`
    );

    assert.deepEqual(
      uniqueFields(trace.omitted, "budget_lexicographic_selection"),
      expected.trace.budget_omitted,
      `${label}: budget trace`
    );
    assert.deepEqual(
      uniqueFields(trace.omitted, "source_derived_redundancy"),
      expected.trace.redundant_omitted,
      `${label}: redundancy trace`
    );
    assert.deepEqual(
      trace.abbreviated.map(({ before, after }) => ({ before, after })),
      expected.trace.abbreviated,
      `${label}: abbreviation trace`
    );

    const aliases = trace.transformed
      .filter((row) => row.operation === "profile_year_alias")
      .map(({ before, after }) => ({ before, after }));
    assert.deepEqual(
      aliases,
      expected.trace.year_alias ? [expected.trace.year_alias] : [],
      `${label}: year alias trace`
    );
    const displayAliases = trace.transformed
      .filter((row) => row.operation === "profile_display_alias")
      .map(({ field, before, after }) => ({ field, before, after }));
    assert.deepEqual(
      displayAliases,
      expected.trace.display_aliases || [],
      `${label}: profile display alias trace`
    );
    const overlaps = trace.transformed
      .filter((row) => row.operation === "source_derived_overlap_trim")
      .map(({ before, after, removed_prefix, redundant_with }) => ({
        before, after, removed_prefix, redundant_with
      }));
    assert.deepEqual(
      overlaps,
      expected.trace.overlap_trim ? [expected.trace.overlap_trim] : [],
      `${label}: source-derived overlap trace`
    );

    // A redundancy decision is valid only while its covering owner is selected.
    const selectedKeys = new Set(trace.selected.map((row) => row.key));
    for (const row of trace.omitted.filter((item) => item.reason === "source_derived_redundancy")) {
      assert.ok(selectedKeys.has(row.redundant_with), `${label}: selected redundancy owner`);
    }
    for (const row of trace.transformed.filter((item) => (
      item.operation === "source_derived_overlap_trim"
    ))) {
      assert.ok(selectedKeys.has(row.redundant_with), `${label}: selected overlap owner`);
    }

    assert.ok(!fields.card_number.includes("#"), `${label}: canonical Card Number has no #`);
    const cardTokens = trace.selected.filter((row) => row.field === "card_number");
    assert.equal(cardTokens.length, 1, `${label}: one selected Card Number`);
    assert.equal(cardTokens[0].canonical_value, fields.card_number, `${label}: canonical Card Number`);
    assert.equal(cardTokens[0].display_value, `#${fields.card_number}`, `${label}: display Card Number`);
    assert.equal(cardTokens[0].priority, "P0", `${label}: Card Number priority`);
    assert.equal(
      titleTokens(result.title).filter((token) => token === `#${fields.card_number}`).length,
      1,
      `${label}: one rendered Card Number`
    );
    assert.ok(trace.transformed.some((row) => (
      row.field === "card_number"
      && row.operation === "display_prefix_added"
      && row.after === `#${fields.card_number}`
    )), `${label}: Card Number display transform`);

    const serialTokens = trace.selected.filter((row) => row.field === "serial");
    if (fields.serial) {
      assert.equal(serialTokens.length, 1, `${label}: one selected serial`);
      assert.equal(serialTokens[0].canonical_value, fields.serial, `${label}: full serial`);
      assert.equal(serialTokens[0].display_value, fields.serial, `${label}: serial byte equality`);
      assert.equal(serialTokens[0].priority, "P0", `${label}: serial priority`);
      assert.ok(titleTokens(result.title).includes(fields.serial), `${label}: rendered serial`);
    } else {
      assert.equal(serialTokens.length, 0, `${label}: no invented serial`);
    }

    if (fields.grading_info) {
      assert.ok(trace.transformed.some((row) => (
        row.field === "grading_info" && row.operation === "structured_grade_display"
      )), `${label}: structured grade trace`);
    }

    for (const token of expected.required_tokens || []) {
      assert.ok(titleTokens(result.title).includes(token), `${label}: required token ${token}`);
    }
    for (const token of expected.forbidden_tokens || []) {
      assert.ok(!titleTokens(result.title).includes(token), `${label}: forbidden token ${token}`);
    }
    for (const text of expected.required_substrings || []) {
      assert.ok(result.title.includes(text), `${label}: required text ${text}`);
    }
    for (const text of expected.forbidden_substrings || []) {
      assert.ok(!result.title.includes(text), `${label}: forbidden text ${text}`);
    }
    for (const field of expected.trace.required_selected || []) {
      assert.ok(trace.selected.some((row) => row.field === field), `${label}: selected ${field}`);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(networkCalls, 0, "the 16-case replay must perform zero network/provider calls");
process.stdout.write("Subset A Canonical Naming zero-provider gate: 16/16 passed\n");
