#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  readDurableProjectionReceipt,
  validateFounderBetaWebReceipt
} from "../lib/listing/thin/csm-forward-reader-bridge.mjs";
import { replayFromRows } from "../lib/listing/thin/csm-replay.mjs";

// Fresh v2 keeps the exact 17ef behavior. Future upper-bound enforcement and
// grading-info reconstruction are gated by a stored v3 contract only.
assert.equal(composeFromCanonicalFields({
  grammar: "lot", lot_count: "10000", subjects: ["A", "B"], components: []
}).title, "Lot*10000 A B");
for (const lotCount of ["2.5", "02"]) {
  assert.equal(composeFromCanonicalFields({
    grammar: "lot", lot_count: lotCount, subjects: ["A", "B"], components: []
  }).title, "A B");
}
assert.equal(composeFromCanonicalFields({
  grammar: "standard", subjects: ["A"], grade: "", grading_info: {
    company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  }, components: []
}).title, "A");

// Complete-object differential oracle captured from Production baseline 17ef8c3.
// It protects the entire fresh-v2 input space touched by the dormant v3 flags,
// not only the visible title examples above.
const lotCounts = [
  null, undefined, "", " ", "0", "00", "01", "1", "2", "2.5", "2-3", " 2 ",
  "10000", "9".repeat(256)
];
const gradingCases = [
  null, "", { company: "", card_grade: "", auto_grade: "", grade_type: "" },
  { company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY" },
  { company: "PSA", card_grade: "", auto_grade: "10", grade_type: "AUTO_ONLY" },
  { company: "PSA", card_grade: "Authentic", auto_grade: "10",
    grade_type: "AUTHENTIC_WITH_AUTO" },
  { company: "BGS", card_grade: "9.5", auto_grade: "10", grade_type: "CARD_AND_AUTO" }
];
let seed = 173;
const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const freshV2Corpus = [
  ...lotCounts.map((lot_count) => ({
    grammar: "lot", lot_count, subjects: ["A", "B"], components: []
  })),
  ...gradingCases.map((grading_info) => ({
    grammar: "standard", subjects: ["A"], grade: "", grading_info, components: []
  }))
];
const tokens = [
  "", "Topps", "Chrome", "Gold", "A / B", "A; B", "A | B", "#123", "/99", "RC", "Auto"
];
for (let index = 0; index < 256; index += 1) {
  const pick = () => tokens[Math.floor(next() * tokens.length)];
  freshV2Corpus.push({
    grammar: next() < 0.34 ? "lot" : next() < 0.5 ? "tcg" : "standard",
    lot_count: lotCounts[Math.floor(next() * lotCounts.length)],
    year: next() < 0.5 ? String(1900 + Math.floor(next() * 200)) : pick(),
    manufacturer: pick(), product: pick(), set: pick(), card_name: pick(),
    subjects: [pick(), pick()].filter(Boolean), release_variant: pick(), print_finish: pick(),
    parallel_exact: pick(), parallel_family: pick(), surface_color: pick(),
    descriptive_rarity: pick(), card_number: pick(), serial: pick(),
    components: [pick(), pick()].filter(Boolean), attributes: [pick()].filter(Boolean),
    team: pick(), search_optimization: [pick()].filter(Boolean), grade: pick(),
    grading_info: gradingCases[Math.floor(next() * gradingCases.length)],
    unreadable: [], low_confidence: []
  });
}
const freshV2Json = JSON.stringify(freshV2Corpus.map((input) => ({
  input, output: composeFromCanonicalFields(input)
})));
assert.equal(
  createHash("sha256").update(freshV2Json).digest("hex"),
  "fb6998548707627ba44f7dcf76ef59c851234a24a40f0e553510c3a80beefda1",
  "fresh v2 complete Composer JSON must remain byte-equivalent to 17ef8c3"
);

const fields = {
  grammar: "lot", lot_count: "2", subjects: ["Card A", "Card B"],
  year: "2024", manufacturer: "Topps", product: "Chrome", set: "",
  card_name: "", release_variant: "", print_finish: "", parallel_exact: "",
  parallel_family: "", surface_color: "", descriptive_rarity: "",
  card_number: "", serial: "", components: [], attributes: [], team: "",
  search_optimization: [], grading_info: null, grade: "", unreadable: [], low_confidence: []
};
const composed = composeFromCanonicalFields(fields, { features: {
  durable_lot_terminal_shared_only: true,
  publication_coverage: true
} });
const rows = {
  resolution: { grammar: "NON_TCG" },
  resolved: [
    ["year", "2024"], ["manufacturer", "Topps"], ["product", "Chrome"],
    ["subject", ["Card A", "Card B"]]
  ].map(([bracket, canonical_value]) => ({
    bracket, selected_kind: "VALUE", canonical_value, empty_reason: null,
    semantic_confidence: 0.9
  })),
  output: {
    contract_version: CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
    marketplace: "EBAY",
    composer_version: "thin-marketplace-composer-v2",
    marketplace_profile_version: "ebay-profile-v1",
    title: composed.title,
    structured_output: {
      composition_grammar: "lot",
      lot_count: "2",
      components: [],
      search_optimization: [],
      print_finish_layers: { parallel_exact: "", surface_color: "", parallel_family: "" },
      publication_coverage: composed.publication_coverage,
      lot_terminal: {
        failure_code: null,
        lot_quantity_unresolved: false,
        lot_single_card: false,
        lot_unshared_attributes: [],
        publishable: true
      }
    }
  }
};

const replayed = replayFromRows(rows);
assert.equal(replayed.title, rows.output.title);
assert.equal(replayed.composed.publication_coverage_durable, true);
assert.equal(replayed.composed.lot_terminal_durable, true);

const standardFields = {
  ...fields, grammar: "standard", lot_count: "", set: "Chrome Update",
  card_name: "Future Stars", subjects: ["Shohei Ohtani"]
};
const standardComposed = composeFromCanonicalFields(standardFields, {
  features: { publication_coverage: true }
});
const standardRows = structuredClone(rows);
standardRows.resolution.grammar = "NON_TCG";
standardRows.resolved = [
  ["year", standardFields.year], ["manufacturer", standardFields.manufacturer],
  ["product", standardFields.product],
  ["set", standardFields.set], ["card_name", standardFields.card_name],
  ["subject", standardFields.subjects]
].map(([bracket, canonical_value]) => ({
  bracket, selected_kind: "VALUE", canonical_value, empty_reason: null,
  semantic_confidence: 0.9
}));
standardRows.output.structured_output = {
  composition_grammar: "standard", lot_count: "", components: [],
  search_optimization: [],
  print_finish_layers: { parallel_exact: "", surface_color: "", parallel_family: "" },
  publication_coverage: null
};
standardRows.output.structured_output.sem = {};
standardRows.output.title = standardComposed.title;
standardRows.output.marketplace_profile_version = "lynca-standard-name-v0.3";
standardRows.output.composer_version = "thin-marketplace-composer-v3";
const v03Projection = (await import("../lib/listing/thin/canonical-naming-adapter.mjs"))
  .composeLyncaStandardNameForProfile(standardFields, {
    marketplaceProfileVersion: "lynca-standard-name-v0.3",
    publicationCoverage: true
  });
standardRows.output.structured_output.publication_coverage = v03Projection.publication_coverage;
standardRows.output.title = v03Projection.title;
standardRows.output.dropped_trace = {
  character_budget: v03Projection.character_budget,
  rendered_length: v03Projection.length,
  canonical_naming: v03Projection.canonical_naming_trace
};
const v03 = replayFromRows(standardRows);
assert.match(v03.title, /Chrome Update Future Stars Shohei Ohtani/);
assert.ok(v03.title.indexOf("Future Stars") < v03.title.indexOf("Shohei Ohtani"));
for (const mutate of [
  (output) => { delete output.dropped_trace.canonical_naming; },
  (output) => { output.dropped_trace.canonical_naming.selected[0].display_value += " tampered"; }
]) {
  const invalid = structuredClone(standardRows);
  mutate(invalid.output);
  assert.throws(() => replayFromRows(invalid), /canonical_naming_v03_trace_invalid/);
}

const webReceipt = {
  schema_version: "founder-beta-web-receipt-v1",
  provider_request_count: 1,
  isolated_model_call_count: 0,
  provider_model: "gpt-5.6-luna",
  reasoning_effort: "low",
  web_search_used: true,
  web_search_call_count: 1,
  queries: ["Topps Chrome Update Future Stars"],
  urls: ["https://www.topps.com/checklist"],
  field_evidence: [],
  semantic_state_sha256: "a".repeat(64)
};
standardRows.output.structured_output.founder_beta_web_receipt = webReceipt;
assert.deepEqual(
  readDurableProjectionReceipt(standardRows).founder_beta_web_receipt,
  webReceipt
);
for (const mutate of [
  (receipt) => { receipt.provider_model = "gpt-5.6"; },
  (receipt) => { receipt.reasoning_effort = "medium"; },
  (receipt) => { receipt.queries = ["one", "one"]; },
  (receipt) => { receipt.field_evidence = [{ field: "set", support_urls: ["http://bad"],
    conflict_urls: [], unresolved_urls: [] }]; },
  (receipt) => { receipt.web_search_used = false; receipt.web_search_call_count = 0; },
  (receipt) => { receipt.queries = []; },
  (receipt) => { receipt.urls = [`${receipt.urls[0]}?utm_source=forged`]; },
  (receipt) => { receipt.field_evidence = [{ field: "set",
    support_urls: [receipt.urls[0]], conflict_urls: [receipt.urls[0]], unresolved_urls: [] }]; }
]) {
  const invalid = structuredClone(standardRows);
  mutate(invalid.output.structured_output.founder_beta_web_receipt);
  assert.throws(() => readDurableProjectionReceipt(invalid), /founder_beta_web_receipt_invalid/);
}

const multipleQueries = structuredClone(webReceipt);
multipleQueries.queries = ["Topps Chrome Future Stars", "Topps Chrome Update Future Stars"];
assert.doesNotThrow(
  () => validateFounderBetaWebReceipt(multipleQueries),
  "one web tool call may contain multiple unique provider queries",
);

for (const mutate of [
  (value) => { delete value.output.structured_output.publication_coverage; },
  (value) => { delete value.output.structured_output.lot_terminal; },
  (value) => { value.output.structured_output.lot_terminal.publishable = false; }
]) {
  const tampered = structuredClone(rows);
  mutate(tampered);
  assert.throws(() => replayFromRows(tampered), /publication_coverage|lot_terminal/);
}

const legacy = structuredClone(rows);
legacy.output.contract_version = "csm-stage-shadow-v2";
assert.throws(() => readDurableProjectionReceipt(legacy), /outside_contract/);
delete legacy.output.structured_output.publication_coverage;
delete legacy.output.structured_output.lot_terminal;
assert.equal(readDurableProjectionReceipt(legacy), null);
assert.equal(replayFromRows(legacy).title, rows.output.title);

const unknown = structuredClone(legacy);
unknown.output.contract_version = "csm-stage-shadow-v4";
assert.throws(() => readDurableProjectionReceipt(unknown), /version_unsupported/);

const v03Downgrade = structuredClone(standardRows);
v03Downgrade.output.contract_version = "csm-stage-shadow-v2";
delete v03Downgrade.output.structured_output.publication_coverage;
delete v03Downgrade.output.structured_output.founder_beta_web_receipt;
assert.throws(() => replayFromRows(v03Downgrade), /v03_stage_contract_mismatch/);

const coverageTamper = structuredClone(rows);
coverageTamper.output.structured_output.publication_coverage.atoms[0].canonical_value += " extra";
assert.throws(() => replayFromRows(coverageTamper), /publication_coverage_replay_mismatch/);

process.stdout.write("CSM durable forward-reader bridge: ok\n");
