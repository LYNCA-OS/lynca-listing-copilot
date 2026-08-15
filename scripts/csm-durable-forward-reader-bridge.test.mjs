#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V3
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import { SEM_STANDARD_VERSION } from "../lib/listing/csm/sem-definition.mjs";
import {
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  CSM_FORWARD_READER_BRIDGE_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_FORWARD_READER_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  readDurableProjectionReceipt,
  validateFounderBetaWebReceipt
} from "../lib/listing/thin/csm-forward-reader-bridge.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes
} from "../lib/listing/thin/csm-persistence.mjs";
import { replayFromRows, verifyReplay } from "../lib/listing/thin/csm-replay.mjs";
import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  resolveVerifiedOriginalObservation,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
} from "../lib/listing/thin/verified-original-observation-support.mjs";

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
const visualEvidenceRows = (sessionId, entries, prefix) => entries.map(
  ([bracket, raw_value], index) => ({
    id: `${prefix}-${index}`,
    modality: "WHOLE_CARD_VISUAL",
    bracket,
    raw_value,
    normalized_value: raw_value,
    source_ref: { images: sessionId },
    observation_confidence: 0.8,
    normalization_version: SEM_STANDARD_VERSION,
    normalization_outcome: "KEPT",
    normalization_reason_code: "DIRECT_OBSERVATION"
  })
);
const composed = composeFromCanonicalFields(fields, { features: {
  durable_lot_terminal_shared_only: true,
  publication_coverage: true
} });
const rows = {
  resolution: {
    contract_version: CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
    grammar: "NON_TCG"
  },
  resolved: [
    ["year", "2024"], ["manufacturer", "Topps"], ["product", "Chrome"],
    ["subject", ["Card A", "Card B"]], ["set", null], ["card_name", null]
  ].map(([bracket, canonical_value]) => ({
    bracket, selected_kind: canonical_value == null ? "EMPTY" : "VALUE",
    canonical_value, empty_reason: canonical_value == null ? "ABSENT" : null,
    semantic_confidence: 0.9
  })),
  output: {
    contract_version: CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
    recognition_session_id: "standard-session",
    marketplace: "EBAY",
    composer_version: "thin-marketplace-composer-v2",
    marketplace_profile_version: "ebay-profile-v1",
    title: composed.title,
    structured_output: {
      sem: {
        year: fields.year, manufacturer: fields.manufacturer,
        product: fields.product, subject: fields.subjects
      },
      composition_grammar: "lot",
      lot_count: "2",
      components: [],
      search_optimization: [],
      print_finish_layers: { parallel_exact: "", surface_color: "", parallel_family: "" },
      publication_coverage: composed.publication_coverage,
      founder_beta_web_receipt: {
        schema_version: "founder-beta-web-receipt-v1",
        provider_request_count: 1,
        isolated_model_call_count: 0,
        provider_model: "gpt-5.6-luna",
        reasoning_effort: "low",
        web_search_used: false,
        web_search_call_count: 0,
        queries: [],
        urls: [],
        field_evidence: [],
        semantic_state_sha256: "b".repeat(64)
      },
      set_card_name_relation_receipt: {
        schema_version: "set-card-name-relations-v1",
        set: null,
        card_name: null
      },
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
rows.evidence = visualEvidenceRows(rows.output.recognition_session_id, [
  ["year", fields.year], ["manufacturer", fields.manufacturer],
  ["product", fields.product], ["subject", fields.subjects]
], "lot-visual");

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
standardRows.evidence = visualEvidenceRows(standardRows.output.recognition_session_id, [
  ["year", standardFields.year], ["manufacturer", standardFields.manufacturer],
  ["product", standardFields.product], ["set", standardFields.set],
  ["card_name", standardFields.card_name], ["subject", standardFields.subjects]
], "standard-visual");
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
  publication_coverage: null,
  founder_beta_web_receipt:
    structuredClone(rows.output.structured_output.founder_beta_web_receipt)
};
standardRows.output.structured_output.sem = {
  year: standardFields.year,
  manufacturer: standardFields.manufacturer,
  product: standardFields.product,
  set: standardFields.set,
  card_name: standardFields.card_name,
  subject: standardFields.subjects
};
standardRows.output.structured_output.set_card_name_relation_receipt = {
  schema_version: "set-card-name-relations-v1",
  set: { predicate: "CURRENT_CARD_MEMBER_OF_SET", value: standardFields.set },
  card_name: {
    predicate: "CURRENT_CARD_NAMED_BY_DESIGN", value: standardFields.card_name
  }
};
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
  assert.throws(() => replayFromRows(invalid), /canonical_naming_trace/);
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
const exactV3Receipt = readDurableProjectionReceipt(standardRows);
assert.deepEqual(
  exactV3Receipt,
  {
    bridge_version: CSM_FORWARD_READER_BRIDGE_VERSION,
    publication_coverage: standardRows.output.structured_output.publication_coverage,
    lot_terminal: null,
    founder_beta_web_receipt: webReceipt,
    set_card_name_relation_receipt:
      standardRows.output.structured_output.set_card_name_relation_receipt
  },
  "the legal stage-v3 receipt projection must stay byte-shaped as reader-v1"
);
for (const mutate of [
  (receipt) => { receipt.provider_model = "gpt-5.6"; },
  (receipt) => { receipt.reasoning_effort = "medium"; },
  (receipt) => { receipt.queries = ["one", "one"]; },
  (receipt) => { receipt.field_evidence = [{ field: "set", support_urls: ["http://bad"],
    conflict_urls: [], unresolved_urls: [] }]; },
  (receipt) => { receipt.web_search_used = false; receipt.web_search_call_count = 0; },
  (receipt) => { receipt.web_search_call_count = 3; },
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

const twoCalls = structuredClone(webReceipt);
twoCalls.web_search_call_count = 2;
assert.doesNotThrow(
  () => validateFounderBetaWebReceipt(twoCalls),
  "one provider request may contain two bounded Web actions",
);

const openOnly = structuredClone(twoCalls);
openOnly.queries = [];
openOnly.field_evidence = [{
  field: "set",
  support_urls: [openOnly.urls[0]],
  conflict_urls: [],
  unresolved_urls: []
}];
assert.doesNotThrow(
  () => validateFounderBetaWebReceipt(openOnly),
  "a generic open/find trace is valid when durable field evidence uses its URL",
);
const ungovernedSupport = structuredClone(openOnly);
ungovernedSupport.urls = ["https://example.com/checklist"];
ungovernedSupport.field_evidence[0].support_urls = ungovernedSupport.urls;
assert.throws(() => validateFounderBetaWebReceipt(ungovernedSupport),
  /founder_beta_web_receipt_invalid/,
  "unknown hosts may not enter applied support_urls");
const ungovernedUnresolved = structuredClone(openOnly);
ungovernedUnresolved.urls = ["https://example.com/checklist"];
ungovernedUnresolved.field_evidence[0].support_urls = [];
ungovernedUnresolved.field_evidence[0].unresolved_urls = ungovernedUnresolved.urls;
assert.doesNotThrow(() => validateFounderBetaWebReceipt(ungovernedUnresolved),
  "unknown hosts remain durable unresolved evidence");

const usedWithoutTrace = structuredClone(twoCalls);
usedWithoutTrace.queries = [];
usedWithoutTrace.field_evidence = [];
assert.throws(() => validateFounderBetaWebReceipt(usedWithoutTrace),
  /founder_beta_web_receipt_invalid/,
  "the historical v1 validator must keep rejecting a used trace without a query or field row");

const withoutFieldEvidenceV2 = {
  schema_version: "founder-beta-web-receipt-v2",
  outcome: "USED_WITHOUT_FIELD_EVIDENCE",
  provider_request_count: 1,
  isolated_model_call_count: 0,
  provider_model: "gpt-5.6-luna",
  reasoning_effort: "low",
  web_search_used: true,
  web_search_call_count: 1,
  queries: [],
  urls: [],
  field_evidence: [],
  semantic_state_sha256: "c".repeat(64)
};
assert.doesNotThrow(() => validateFounderBetaWebReceipt(withoutFieldEvidenceV2),
  "durable replay must accept the exact v2 receipt without field evidence");
const queryRecordedWithoutFieldEvidenceV2 = structuredClone(withoutFieldEvidenceV2);
queryRecordedWithoutFieldEvidenceV2.queries = ["provider-owned trace wording"];
assert.doesNotThrow(() => validateFounderBetaWebReceipt(queryRecordedWithoutFieldEvidenceV2),
  "real provider queries remain durable even when no field records Web evidence");

const noSearchV2 = structuredClone(withoutFieldEvidenceV2);
Object.assign(noSearchV2, {
  outcome: "NOT_USED", web_search_used: false, web_search_call_count: 0
});
assert.doesNotThrow(() => validateFounderBetaWebReceipt(noSearchV2));

const fieldEvidenceV2 = {
  ...structuredClone(openOnly),
  schema_version: "founder-beta-web-receipt-v2",
  outcome: "USED_WITH_FIELD_EVIDENCE"
};
assert.doesNotThrow(() => validateFounderBetaWebReceipt(fieldEvidenceV2));

const currentCopySupportV1 = structuredClone(openOnly);
currentCopySupportV1.field_evidence[0].field = "card_number";
assert.doesNotThrow(() => validateFounderBetaWebReceipt(currentCopySupportV1),
  "the byte-frozen v1 reader retains its historical non-identity support boundary");

const mixedAuthorityV2 = structuredClone(fieldEvidenceV2);
mixedAuthorityV2.field_evidence = [{
  field: "card_number", support_urls: [], conflict_urls: [],
  unresolved_urls: [mixedAuthorityV2.urls[0]]
}, {
  field: "product", support_urls: [mixedAuthorityV2.urls[0]],
  conflict_urls: [], unresolved_urls: []
}];
assert.doesNotThrow(() => validateFounderBetaWebReceipt(mixedAuthorityV2),
  "one returned URL may support identity while remaining unresolved for current-copy evidence");

const currentCopySupportV2 = structuredClone(mixedAuthorityV2);
currentCopySupportV2.field_evidence[0].support_urls = currentCopySupportV2.urls;
currentCopySupportV2.field_evidence[0].unresolved_urls = [];
assert.throws(() => validateFounderBetaWebReceipt(currentCopySupportV2),
  /founder_beta_web_receipt_invalid/,
  "v2 must reject Web support authority for a non-identity current-copy field");
for (const [field, evidence] of [
  ["grammar", { support_urls: [], conflict_urls: [],
    unresolved_urls: fieldEvidenceV2.urls }],
  ["description", { support_urls: [], conflict_urls: fieldEvidenceV2.urls,
    unresolved_urls: [] }]
]) {
  const invalidLane = structuredClone(fieldEvidenceV2);
  invalidLane.field_evidence = [{ field, ...evidence }];
  assert.throws(() => validateFounderBetaWebReceipt(invalidLane),
    /founder_beta_web_receipt_invalid/,
    `${field} must reject its forbidden v2 Web evidence lane`);
}

const mixedAuthorityRows = structuredClone(standardRows);
mixedAuthorityRows.output.structured_output.founder_beta_web_receipt = mixedAuthorityV2;
assert.deepEqual(
  readDurableProjectionReceipt(mixedAuthorityRows).founder_beta_web_receipt,
  mixedAuthorityV2,
  "durable replay must preserve the exact mixed identity/current-copy v2 receipt"
);
assert.equal(replayFromRows(mixedAuthorityRows).title, mixedAuthorityRows.output.title);
const mixedAuthorityTamperRows = structuredClone(mixedAuthorityRows);
mixedAuthorityTamperRows.output.structured_output.founder_beta_web_receipt =
  currentCopySupportV2;
assert.throws(() => readDurableProjectionReceipt(mixedAuthorityTamperRows),
  /founder_beta_web_receipt_invalid/,
  "durable readback must reject current-copy evidence promoted from unresolved to support");

const crossRowSharedUrlV2 = structuredClone(fieldEvidenceV2);
crossRowSharedUrlV2.field_evidence = ["product", "set"].map((field) => ({
  field,
  support_urls: [crossRowSharedUrlV2.urls[0]],
  conflict_urls: [],
  unresolved_urls: []
}));
assert.doesNotThrow(() => validateFounderBetaWebReceipt(crossRowSharedUrlV2),
  "v2 receipt URLs are the unique union even when two rows share one evidence URL");

const extraSafeUrlV2 = structuredClone(fieldEvidenceV2);
extraSafeUrlV2.urls.push("https://www.topps.com/unreferenced");
extraSafeUrlV2.urls.sort();
assert.throws(() => validateFounderBetaWebReceipt(extraSafeUrlV2),
  /founder_beta_web_receipt_invalid/,
  "v2 may not persist an extra safe URL that no field-evidence row uses");

const missingEvidenceUrlV2 = structuredClone(fieldEvidenceV2);
missingEvidenceUrlV2.urls = [];
assert.throws(() => validateFounderBetaWebReceipt(missingEvidenceUrlV2),
  /founder_beta_web_receipt_invalid/,
  "v2 may not omit a URL used by a field-evidence row");

const unknownFieldV2 = structuredClone(fieldEvidenceV2);
unknownFieldV2.field_evidence[0].field = "not_a_canonical_field";
assert.throws(() => validateFounderBetaWebReceipt(unknownFieldV2),
  /founder_beta_web_receipt_invalid/,
  "v2 durable evidence rows must remain inside the canonical source-field vocabulary");
const historicalUnknownFieldV1 = structuredClone(openOnly);
historicalUnknownFieldV1.field_evidence[0].field = "not_a_canonical_field";
assert.doesNotThrow(() => validateFounderBetaWebReceipt(historicalUnknownFieldV1),
  "the historical v1 validator must retain its original unknown-field behavior");

for (const mutate of [
  (receipt) => { delete receipt.outcome; },
  (receipt) => { receipt.outcome = "UNKNOWN"; },
  (receipt) => { receipt.urls = ["https://www.topps.com/checklist"]; },
  (receipt) => { receipt.field_evidence = [{
    field: "set", support_urls: [], conflict_urls: [], unresolved_urls: []
  }]; },
  (receipt) => { receipt.outcome = "NOT_USED"; },
  (receipt) => { receipt.web_search_call_count = 3; }
]) {
  const invalidV2 = structuredClone(withoutFieldEvidenceV2);
  mutate(invalidV2);
  assert.throws(() => validateFounderBetaWebReceipt(invalidV2),
    /founder_beta_web_receipt_invalid/,
    "v2 outcome and bounded trace fields must remain exact and mutually consistent");
}

const durableWithoutFieldEvidenceRows = structuredClone(standardRows);
durableWithoutFieldEvidenceRows.output.structured_output.founder_beta_web_receipt =
  withoutFieldEvidenceV2;
assert.deepEqual(
  readDurableProjectionReceipt(durableWithoutFieldEvidenceRows).founder_beta_web_receipt,
  withoutFieldEvidenceV2,
  "the durable bridge must forward an exact v2 receipt without rewriting it"
);

const withheldReferenceReceipt = structuredClone(webReceipt);
withheldReferenceReceipt.field_evidence = [{
  field: "product", support_urls: [], conflict_urls: [], unresolved_urls: []
}];
const withheldReferenceRows = structuredClone(standardRows);
withheldReferenceRows.output.structured_output.founder_beta_web_receipt =
  withheldReferenceReceipt;
withheldReferenceRows.output.structured_output.sem.product = "";
withheldReferenceRows.evidence = withheldReferenceRows.evidence.filter(
  (row) => row.bracket !== "product"
);
Object.assign(withheldReferenceRows.resolved.find((row) => row.bracket === "product"), {
  selected_kind: "EMPTY", canonical_value: null, empty_reason: "ABSENT"
});
assert.deepEqual(
  readDurableProjectionReceipt(withheldReferenceRows).founder_beta_web_receipt,
  withheldReferenceReceipt,
  "an empty identity evidence row is the durable v1 unreturned-source withheld marker"
);
const withheldReferenceTamper = structuredClone(withheldReferenceRows);
withheldReferenceTamper.output.structured_output.sem.product = "Chrome";
assert.throws(() => readDurableProjectionReceipt(withheldReferenceTamper),
  /founder_beta_observed_identity_cardinality_invalid/,
  "an empty marker must be paired with an empty post-withhold canonical field");
const withheldResolvedTamper = structuredClone(withheldReferenceRows);
Object.assign(withheldResolvedTamper.resolved.find((row) => row.bracket === "product"), {
  selected_kind: "VALUE", canonical_value: "Chrome", empty_reason: null
});
assert.throws(() => readDurableProjectionReceipt(withheldResolvedTamper),
  /post_observation_resolved_identity_invalid/,
  "an empty marker must also bind the canonical resolved row, not only SEM");
const withheldResolvedMissing = structuredClone(withheldReferenceRows);
withheldResolvedMissing.resolved = withheldResolvedMissing.resolved.filter(
  (row) => row.bracket !== "product"
);
assert.throws(() => readDurableProjectionReceipt(withheldResolvedMissing),
  /post_observation_resolved_identity_cardinality_invalid/,
  "an empty marker cannot be paired with a missing canonical resolved row");
const withheldResolvedDuplicate = structuredClone(withheldReferenceRows);
withheldResolvedDuplicate.resolved.push({
  ...structuredClone(withheldResolvedDuplicate.resolved.find(
    (row) => row.bracket === "product"
  )),
  selected_kind: "VALUE", canonical_value: "Chrome", empty_reason: null
});
assert.throws(() => readDurableProjectionReceipt(withheldResolvedDuplicate),
  /post_observation_resolved_identity_cardinality_invalid/,
  "a duplicate VALUE row cannot hide behind an earlier EMPTY marker row");
for (const invalidReceipt of [
  {
    ...structuredClone(withheldReferenceReceipt),
    field_evidence: [{
      field: "card_number", support_urls: [], conflict_urls: [], unresolved_urls: []
    }]
  },
  {
    ...structuredClone(withheldReferenceReceipt),
    web_search_used: false,
    web_search_call_count: 0,
    queries: [],
    urls: []
  }
]) {
  assert.throws(() => validateFounderBetaWebReceipt(invalidReceipt),
    /founder_beta_web_receipt_invalid/,
    "an empty row is valid only for an identity field after a real Web call");
}

for (const [mutate, expected] of [
  [(value) => { delete value.output.structured_output.publication_coverage; }, /publication_coverage/],
  [(value) => { delete value.output.structured_output.lot_terminal; }, /lot_terminal/],
  [(value) => { delete value.output.structured_output.founder_beta_web_receipt; }, /founder_beta_web_receipt/],
  [(value) => { delete value.output.structured_output.set_card_name_relation_receipt; }, /set_card_name_relation_receipt/],
  [(value) => { value.output.structured_output.lot_terminal.publishable = false; }, /lot_terminal/]
]) {
  const tampered = structuredClone(rows);
  mutate(tampered);
  assert.throws(() => replayFromRows(tampered), expected);
}

const legacy = structuredClone(rows);
legacy.output.contract_version = "csm-stage-shadow-v2";
legacy.resolution.contract_version = "csm-stage-shadow-v2";
assert.throws(() => readDurableProjectionReceipt(legacy), /outside_contract/);
delete legacy.output.structured_output.publication_coverage;
delete legacy.output.structured_output.lot_terminal;
delete legacy.output.structured_output.founder_beta_web_receipt;
delete legacy.output.structured_output.set_card_name_relation_receipt;
assert.equal(readDurableProjectionReceipt(legacy), null);
assert.equal(replayFromRows(legacy).title, rows.output.title);

const unknown = structuredClone(legacy);
unknown.output.contract_version = "csm-stage-shadow-v5";
unknown.resolution.contract_version = "csm-stage-shadow-v5";
assert.throws(() => readDurableProjectionReceipt(unknown), /version_unsupported/);

const tcgGrammarObservedFields = {
  ...standardFields,
  grammar: "standard",
  lot_count: "",
  year: "",
  manufacturer: "",
  product: "",
  set: "Trainer Gallery",
  subjects: ["Eternatus"],
  card_name: "",
  card_number: "TG22/TG30",
  ip: ""
};
const tcgGrammarResolvedFields = { ...tcgGrammarObservedFields, grammar: "tcg" };
const tcgGrammarComposed = composeFromCanonicalFields(tcgGrammarResolvedFields, {
  features: { publication_coverage: true }
});
const tcgFieldSources = [
  { field: "set", source_ids: ["original_image_1"] },
  { field: "card_number", source_ids: ["original_image_1"] }
];
const tcgSourceExecution = {
  operationPayloadSha256: "e".repeat(64),
  originalImageFingerprints: [`sha256:${"1".repeat(64)}`],
  recognitionImageFingerprints: [`sha256:${"1".repeat(64)}`],
  providerClientRequestId: "forward-reader-tcg-client-request",
  providerResponseId: "forward-reader-tcg-provider-response",
  tenantId: "tcg-forward-reader-tenant",
  recognitionSessionId: "tcg-forward-reader-session"
};
const tcgFieldSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: tcgFieldSources,
  fields: tcgGrammarObservedFields,
  originalImageCount: 1,
  semanticStateSha256: webReceipt.semantic_state_sha256,
  founderBetaWebReceipt: webReceipt,
  sourceExecution: {
    ...tcgSourceExecution,
    tenantId: "future-reader-tenant",
    recognitionSessionId: "future-reader-session"
  }
});
const tcgClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: tcgGrammarObservedFields,
  fieldSourceAuthorityReceipt: tcgFieldSourceReceipt
});
assert.equal(tcgClaimReceipt.status, "APPLIED");
const tcgRows = buildCsmStageRows({
  tenantId: "tcg-forward-reader-tenant",
  recognitionSessionId: "tcg-forward-reader-session",
  fields: tcgGrammarResolvedFields,
  observedFields: tcgGrammarObservedFields,
  composed: tcgGrammarComposed,
  title: tcgGrammarComposed.title,
  founderBetaWebReceipt: webReceipt,
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: {
      predicate: "CURRENT_CARD_MEMBER_OF_SET",
      value: "Trainer Gallery"
    },
    card_name: null
  },
  tcgFieldSourceAuthorityReceipt: tcgFieldSourceReceipt,
  tcgGrammarContextClaimReceipt: tcgClaimReceipt,
  registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  createdAt: "2026-08-15T00:00:00.000Z"
});

// A v3 row may never gain v4 semantics through receipt cross-splicing, even
// when the injected receipts are each authentic and mutually linked.
for (const [key, receipt] of [
  ["tcg_field_source_authority_receipt", tcgFieldSourceReceipt],
  ["tcg_grammar_context_claim_receipt", tcgClaimReceipt]
]) {
  const forgedV3 = structuredClone(standardRows);
  forgedV3.output.structured_output[key] = receipt;
  assert.throws(
    () => readDurableProjectionReceipt(forgedV3),
    /tcg_grammar_context_receipt_outside_contract/,
    `stage-v3 must reject forged ${key}`
  );
  const forgedNullV3 = structuredClone(standardRows);
  forgedNullV3.output.structured_output[key] = null;
  assert.throws(
    () => readDurableProjectionReceipt(forgedNullV3),
    /tcg_grammar_context_receipt_outside_contract/,
    `stage-v3 must reject even a null ${key} splice`
  );
}

const exactV4Receipt = readDurableProjectionReceipt(tcgRows);
assert.deepEqual(exactV4Receipt, {
  bridge_version: CSM_TCG_GRAMMAR_CONTEXT_FORWARD_READER_VERSION,
  publication_coverage: tcgRows.output.structured_output.publication_coverage,
  lot_terminal: null,
  founder_beta_web_receipt: webReceipt,
  set_card_name_relation_receipt:
    tcgRows.output.structured_output.set_card_name_relation_receipt,
  tcg_field_source_authority_receipt: tcgFieldSourceReceipt,
  tcg_grammar_context_claim_receipt: tcgClaimReceipt
});

// A receipt-strip attacker can re-seal every packet after relabelling v4 as
// v3. The v3 tuple itself must reject v4 Registry/resolver/policy authority;
// receipt-key guards alone cannot distinguish this downgrade from legal v3.
const downgradedTcgV3 = structuredClone(tcgRows);
for (const collection of [
  downgradedTcgV3.evidence,
  downgradedTcgV3.candidates,
  downgradedTcgV3.resolved
]) {
  for (const row of collection) {
    row.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  }
}
downgradedTcgV3.resolution.contract_version =
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
downgradedTcgV3.output.contract_version =
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
delete downgradedTcgV3.output.structured_output.observed_composition_grammar;
delete downgradedTcgV3.output.structured_output.tcg_field_source_authority_receipt;
delete downgradedTcgV3.output.structured_output.tcg_grammar_context_claim_receipt;
downgradedTcgV3.resolution.recognition_packet_sha256 =
  computeCsmPacketHashes(downgradedTcgV3).csm_recognition_packet_sha256;
downgradedTcgV3.output.resolution_packet_sha256 =
  computeCsmPacketHashes(downgradedTcgV3).csm_resolution_packet_sha256;
downgradedTcgV3.session_hashes = computeCsmPacketHashes(downgradedTcgV3);
assert.throws(
  () => readDurableProjectionReceipt(downgradedTcgV3),
  /tcg_grammar_context_authority_outside_contract/
);
const downgradedTcgV3Replay = verifyReplay(
  downgradedTcgV3, downgradedTcgV3.output.title
);
assert.equal(downgradedTcgV3Replay.ok, false);
assert.ok(downgradedTcgV3Replay.problems.some(
  ({ kind }) => kind === "tcg_grammar_context_authority_outside_contract"
));

for (const [key, expected] of [
  ["tcg_field_source_authority_receipt", /tcg_field_source_authority_receipt_missing/],
  ["tcg_grammar_context_claim_receipt", /tcg_grammar_context_claim_receipt_missing/]
]) {
  const missing = structuredClone(tcgRows);
  delete missing.output.structured_output[key];
  assert.throws(() => readDurableProjectionReceipt(missing), expected);
}

const otherWebReceipt = {
  ...structuredClone(webReceipt),
  queries: ["different but internally valid provider query"]
};
const otherWebBoundSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: tcgFieldSources,
  fields: tcgGrammarObservedFields,
  originalImageCount: 1,
  semanticStateSha256: otherWebReceipt.semantic_state_sha256,
  founderBetaWebReceipt: otherWebReceipt,
  sourceExecution: tcgSourceExecution
});
const otherWebBoundClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: tcgGrammarObservedFields,
  fieldSourceAuthorityReceipt: otherWebBoundSourceReceipt
});
const webCrossSplice = structuredClone(tcgRows);
webCrossSplice.output.structured_output.tcg_field_source_authority_receipt =
  otherWebBoundSourceReceipt;
webCrossSplice.output.structured_output.tcg_grammar_context_claim_receipt =
  otherWebBoundClaimReceipt;
assert.throws(() => readDurableProjectionReceipt(webCrossSplice),
  /tcg_field_source_authority_receipt_binding_invalid/);

const semanticCrossSpliceSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: tcgFieldSources,
  fields: tcgGrammarObservedFields,
  originalImageCount: 1,
  semanticStateSha256: "c".repeat(64),
  founderBetaWebReceipt: webReceipt,
  sourceExecution: tcgSourceExecution
});
const semanticCrossSpliceClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: tcgGrammarObservedFields,
  fieldSourceAuthorityReceipt: semanticCrossSpliceSourceReceipt
});
const semanticCrossSplice = structuredClone(tcgRows);
semanticCrossSplice.output.structured_output.tcg_field_source_authority_receipt =
  semanticCrossSpliceSourceReceipt;
semanticCrossSplice.output.structured_output.tcg_grammar_context_claim_receipt =
  semanticCrossSpliceClaimReceipt;
assert.throws(() => readDurableProjectionReceipt(semanticCrossSplice),
  /tcg_field_source_authority_receipt_binding_invalid/);

const wrongRowFamily = structuredClone(tcgRows);
wrongRowFamily.candidates[0].contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
assert.throws(() => readDurableProjectionReceipt(wrongRowFamily),
  /durable_projection_row_family_mismatch/);
const rawGrammarTamper = structuredClone(tcgRows);
rawGrammarTamper.output.structured_output.observed_composition_grammar = "tcg";
assert.throws(() => readDurableProjectionReceipt(rawGrammarTamper),
  /tcg_grammar_context_claim_receipt_invalid/);
const cardTransitionTamper = structuredClone(tcgRows);
const resolvedCard = cardTransitionTamper.resolved.find(
  (row) => row.bracket === "card_number"
);
resolvedCard.canonical_value = "TG21/TG30";
assert.throws(() => readDurableProjectionReceipt(cardTransitionTamper),
  /tcg_grammar_context_applied_fields_changed|founder_beta_observed_identity_evidence_invalid/);
const ipTransitionTamper = structuredClone(tcgRows);
const resolvedIp = ipTransitionTamper.resolved.find((row) => row.bracket === "ip_sport");
resolvedIp.selected_kind = "VALUE";
resolvedIp.canonical_value = "Pokemon";
resolvedIp.empty_reason = null;
assert.throws(() => readDurableProjectionReceipt(ipTransitionTamper),
  /founder_beta_observed_identity_cardinality_invalid/);
const semTransitionTamper = structuredClone(tcgRows);
semTransitionTamper.output.structured_output.sem.language = "Japanese";
assert.throws(() => readDurableProjectionReceipt(semTransitionTamper),
  /tcg_grammar_context_applied_fields_changed/);

const rawTcgClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: tcgGrammarResolvedFields,
  fieldSourceAuthorityReceipt: tcgFieldSourceReceipt
});
assert.equal(rawTcgClaimReceipt.status, "NOT_REQUIRED");
const rawTcgRows = buildCsmStageRows({
  tenantId: "tcg-forward-reader-tenant",
  recognitionSessionId: "tcg-forward-reader-not-required-session",
  fields: tcgGrammarResolvedFields,
  observedFields: tcgGrammarResolvedFields,
  composed: tcgGrammarComposed,
  title: tcgGrammarComposed.title,
  founderBetaWebReceipt: webReceipt,
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: {
      predicate: "CURRENT_CARD_MEMBER_OF_SET",
      value: "Trainer Gallery"
    },
    card_name: null
  },
  tcgFieldSourceAuthorityReceipt: tcgFieldSourceReceipt,
  tcgGrammarContextClaimReceipt: rawTcgClaimReceipt,
  contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  createdAt: "2026-08-15T00:00:00.000Z"
});
assert.equal(
  readDurableProjectionReceipt(rawTcgRows)
    .tcg_grammar_context_claim_receipt.status,
  "NOT_REQUIRED"
);
const legalRawTcgV3 = structuredClone(rawTcgRows);
for (const collection of [
  legalRawTcgV3.evidence,
  legalRawTcgV3.candidates,
  legalRawTcgV3.resolved
]) {
  for (const row of collection) {
    row.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  }
}
legalRawTcgV3.resolution.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
legalRawTcgV3.output.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
delete legalRawTcgV3.output.structured_output.observed_composition_grammar;
delete legalRawTcgV3.output.structured_output.tcg_field_source_authority_receipt;
delete legalRawTcgV3.output.structured_output.tcg_grammar_context_claim_receipt;
assert.equal(
  readDurableProjectionReceipt(legalRawTcgV3).bridge_version,
  CSM_FORWARD_READER_BRIDGE_VERSION,
  "raw TCG remains a legal v3 grammar without v4-only authority"
);

const v03Downgrade = structuredClone(standardRows);
v03Downgrade.output.contract_version = "csm-stage-shadow-v2";
v03Downgrade.resolution.contract_version = "csm-stage-shadow-v2";
delete v03Downgrade.output.structured_output.publication_coverage;
delete v03Downgrade.output.structured_output.founder_beta_web_receipt;
assert.throws(() => replayFromRows(v03Downgrade), /v03_stage_contract_mismatch/);

const coverageTamper = structuredClone(rows);
coverageTamper.output.structured_output.publication_coverage.atoms[0].canonical_value += " extra";
assert.throws(() => replayFromRows(coverageTamper), /publication_coverage_replay_mismatch/);

// A future v3 row may persist the provider's empty Web identity marker and
// then resolve that field through exactly one independently sealed authority.
// Reconstruct the observed state from visual evidence before checking the Web
// receipt; validating against final SEM would reject this legal transition.
const subsetA = JSON.parse(readFileSync(
  new URL("../fixtures/csm/subset-a-low-canonical-v1.json", import.meta.url),
  "utf8"
));
const subsetAEntry = subsetA.cases.find(({ id }) => id === "a");
const futureObserved = {
  year: "2025", language: "", manufacturer: "Topps", product: "", set: "",
  subjects: ["Cooper Flagg"], team: "Mavericks", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
  parallel_exact: "Gold Refractor", print_finish: "Gold Refractor",
  descriptive_rarity: "", card_number: "251", serial: "30/50",
  attributes: ["RC"], components: ["RC"], grading_info: null, grade: "",
  grammar: "standard", lot_count: "", ip: "", special_stamp: "",
  description: "", search_optimization: [], unreadable: [], low_confidence: []
};
const futureVerified = resolveVerifiedOriginalObservation(futureObserved, {
  originalImageSha256: subsetAEntry.images.map(({ sha256: value }) => value)
}, { releaseId: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID });
assert.equal(futureVerified.receipt.field_decisions.product.action, "FILL");
const futureComposed = composeLyncaStandardNameForProfile(futureVerified.fields, {
  marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V3,
  publicationCoverage: true
});
const futureRows = buildCsmStageRows({
  tenantId: "future-reader-tenant",
  recognitionSessionId: "future-reader-session",
  fields: futureVerified.fields,
  observedFields: futureObserved,
  externalIdentitySupport: { status: "ABSTAINED" },
  verifiedOriginalObservationSupport: futureVerified.receipt,
  composed: futureComposed,
  title: futureComposed.title,
  founderBetaWebReceipt: {
    schema_version: "founder-beta-web-receipt-v2",
    outcome: "USED_WITH_FIELD_EVIDENCE",
    provider_request_count: 1,
    isolated_model_call_count: 0,
    provider_model: "gpt-5.6-luna",
    reasoning_effort: "low",
    web_search_used: true,
    web_search_call_count: 1,
    queries: ["Topps Chrome Basketball"],
    urls: [],
    field_evidence: [{
      field: "product", support_urls: [], conflict_urls: [], unresolved_urls: []
    }],
    semantic_state_sha256: "a".repeat(64)
  },
  setCardNameRelationReceipt: {
    schema_version: "set-card-name-relations-v1",
    set: null,
    card_name: null
  },
  createdAt: "2026-08-14T00:00:00.000Z"
});
assert.equal(
  readDurableProjectionReceipt(futureRows).founder_beta_web_receipt.outcome,
  "USED_WITH_FIELD_EVIDENCE"
);
assert.equal(verifyReplay(futureRows, futureComposed.title).ok, true);

// ABSTAIN does not steal authority from an independently valid verified-
// original transition. The claim binds the observed Set/Card Number while the
// existing v3 validator remains solely responsible for the resolved identity.
const futureV4WebReceipt = futureRows.output.structured_output
  .founder_beta_web_receipt;
const futureV4SourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: [{ field: "card_number", source_ids: ["original_image_1"] }],
  fields: futureObserved,
  originalImageCount: 1,
  semanticStateSha256: futureV4WebReceipt.semantic_state_sha256,
  founderBetaWebReceipt: futureV4WebReceipt,
  sourceExecution: tcgSourceExecution
});
const futureV4ClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: futureObserved,
  fieldSourceAuthorityReceipt: futureV4SourceReceipt
});
assert.equal(futureV4ClaimReceipt.status, "ABSTAIN");
const futureV4Rows = structuredClone(futureRows);
futureV4Rows.output.contract_version =
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
futureV4Rows.resolution.contract_version =
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
for (const row of [...futureV4Rows.evidence, ...futureV4Rows.candidates]) {
  row.contract_version = CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION;
}
futureV4Rows.output.structured_output.observed_composition_grammar = "standard";
futureV4Rows.output.structured_output.tcg_field_source_authority_receipt =
  futureV4SourceReceipt;
futureV4Rows.output.structured_output.tcg_grammar_context_claim_receipt =
  futureV4ClaimReceipt;
assert.equal(
  readDurableProjectionReceipt(futureV4Rows)
    .tcg_grammar_context_claim_receipt.status,
  "ABSTAIN"
);

const sparseFutureEvidence = structuredClone(futureRows);
sparseFutureEvidence.evidence = sparseFutureEvidence.evidence.filter(
  ({ bracket }) => bracket !== "year"
);
assert.throws(
  () => readDurableProjectionReceipt(sparseFutureEvidence),
  /founder_beta_observed_identity_cardinality_invalid/,
  "a final identity value cannot substitute for missing observed visual evidence"
);
const abstainedAuthority = structuredClone(futureRows);
abstainedAuthority.output.structured_output.verified_original_observation_support = {
  status: "ABSTAINED"
};
assert.throws(
  () => readDurableProjectionReceipt(abstainedAuthority),
  /verified_original_receipt_invalid/,
  "non-null metadata is not an APPLIED authority transition"
);
const overlappingAuthority = structuredClone(futureRows);
overlappingAuthority.output.structured_output.external_identity_support = {
  status: "APPLIED"
};
assert.throws(
  () => readDurableProjectionReceipt(overlappingAuthority),
  /post_observation_resolution_overlap/,
  "exactly one post-observation authority may resolve the identity state"
);

process.stdout.write("CSM durable forward-reader bridge: ok\n");
