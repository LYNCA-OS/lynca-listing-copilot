#!/usr/bin/env node

import assert from "node:assert/strict";

import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { SEM_STANDARD_VERSION } from "../lib/listing/csm/sem-definition.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { composeLyncaStandardName } from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  buildCsmStageRows,
  CSM_DURABLE_PROJECTION_CONTRACT_VERSION,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION,
  computeCsmPacketHashes,
  EBAY_PROFILE_VERSION,
  LYNCA_STANDARD_PROFILE_VERSION,
  THIN_COMPOSER_VERSION,
  THIN_COMPOSER_VERSION_V1,
  THIN_COMPOSER_VERSION_V2
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt,
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";
import {
  composeCanonicalFieldsForStoredOutput,
  isCapturedE1aeReplayTuple,
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

function activeCompose(fields) {
  return composeFromCanonicalFields(fields, { features: {
    durable_lot_terminal_shared_only: true,
    publication_coverage: true
  } });
}

function durableReceipts(fields) {
  const relation = (field, predicate) => fields[field]
    ? { predicate, value: fields[field] } : null;
  return {
    founderBetaWebReceipt: {
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
      semantic_state_sha256: "c".repeat(64)
    },
    setCardNameRelationReceipt: {
      schema_version: "set-card-name-relations-v1",
      set: relation("set", "CURRENT_CARD_MEMBER_OF_SET"),
      card_name: relation("card_name", "CURRENT_CARD_NAMED_BY_DESIGN")
    }
  };
}

function stage(input, recognitionSessionId, compose = activeCompose) {
  const fields = parseCanonicalFields(input).fields;
  const composed = compose(fields);
  return {
    composed,
    rows: buildCsmStageRows({
      tenantId: "tenant-replay", recognitionSessionId, fields, composed,
      title: composed.title, ...durableReceipts(fields)
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

// Stage-v4 replay executes only the already validated stored transition. It
// never reclassifies a TG-looking number: the raw Standard grammar remains in
// its receipt while the resolved TCG grammar selects the exact v2/eBay tuple.
const tcgContextObserved = parseCanonicalFields({
  ...base,
  year: "", manufacturer: "", product: "", set: "Trainer Gallery",
  subjects: ["Eternatus"], team: "", card_name: "", card_number: "TG22/TG30",
  serial: "", attributes: [], grading_info: null, grade: "",
  grammar: "standard", language: "", ip: ""
}).fields;
const tcgContextResolved = { ...tcgContextObserved, grammar: "tcg" };
const tcgContextComposed = activeCompose(tcgContextResolved);
const tcgContextDurableReceipts = durableReceipts(tcgContextObserved);
const tcgContextSourceExecution = Object.freeze({
  operationPayloadSha256: "a".repeat(64),
  originalImageFingerprints: [`sha256:${"b".repeat(64)}`],
  recognitionImageFingerprints: [`sha256:${"c".repeat(64)}`],
  providerClientRequestId: "lynca-replay-test-attempt-1",
  providerResponseId: "resp_replay_test_1",
  tenantId: "tenant-replay",
  recognitionSessionId: "session-tcg-context-v4"
});
const tcgContextFieldSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: [
    { field: "set", source_ids: ["original_image_1"] },
    { field: "card_number", source_ids: ["original_image_1"] }
  ],
  fields: tcgContextObserved,
  originalImageCount: 1,
  semanticStateSha256:
    tcgContextDurableReceipts.founderBetaWebReceipt.semantic_state_sha256,
  founderBetaWebReceipt: tcgContextDurableReceipts.founderBetaWebReceipt,
  sourceExecution: tcgContextSourceExecution
});
const tcgContextClaimReceipt = buildTcgGrammarContextClaimReceipt({
  fields: tcgContextObserved,
  fieldSourceAuthorityReceipt: tcgContextFieldSourceReceipt
});
const tcgContextRows = buildCsmStageRows({
  tenantId: "tenant-replay",
  recognitionSessionId: "session-tcg-context-v4",
  fields: tcgContextResolved,
  observedFields: tcgContextObserved,
  composed: tcgContextComposed,
  title: tcgContextComposed.title,
  ...tcgContextDurableReceipts,
  tcgFieldSourceAuthorityReceipt: tcgContextFieldSourceReceipt,
  tcgGrammarContextClaimReceipt: tcgContextClaimReceipt,
  registryReleaseId: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
});
assert.equal(tcgContextClaimReceipt.status, "APPLIED");
assert.equal(tcgContextClaimReceipt.raw_grammar, "standard");
assert.equal(tcgContextRows.output.composer_version, THIN_COMPOSER_VERSION_V2);
assert.equal(tcgContextRows.output.marketplace_profile_version, EBAY_PROFILE_VERSION);
{
  const checked = verifyReplay(tcgContextRows, tcgContextComposed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "tcg");
  assert.equal(checked.replayed.fields.grammar, "tcg");
  assert.equal(
    tcgContextRows.output.structured_output.observed_composition_grammar,
    "standard"
  );
}

// The same TG-looking values must stay Standard when the stored claim
// abstains. This is the counterexample that prevents number-based inference
// from creeping into replay.
{
  const fieldSourceReceipt = buildTcgFieldSourceAuthorityReceipt({
    fieldSources: [
      { field: "card_number", source_ids: ["original_image_1"] }
    ],
    fields: tcgContextObserved,
    originalImageCount: 1,
    semanticStateSha256:
      tcgContextDurableReceipts.founderBetaWebReceipt.semantic_state_sha256,
    founderBetaWebReceipt: tcgContextDurableReceipts.founderBetaWebReceipt,
    sourceExecution: {
      ...tcgContextSourceExecution,
      recognitionSessionId: "session-tcg-context-v4-abstain"
    }
  });
  const claimReceipt = buildTcgGrammarContextClaimReceipt({
    fields: tcgContextObserved,
    fieldSourceAuthorityReceipt: fieldSourceReceipt
  });
  const composed = activeCompose(tcgContextObserved);
  const rows = buildCsmStageRows({
    tenantId: "tenant-replay",
    recognitionSessionId: "session-tcg-context-v4-abstain",
    fields: tcgContextObserved,
    observedFields: tcgContextObserved,
    composed,
    title: composed.title,
    ...tcgContextDurableReceipts,
    tcgFieldSourceAuthorityReceipt: fieldSourceReceipt,
    tcgGrammarContextClaimReceipt: claimReceipt,
    contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
  });
  assert.equal(claimReceipt.status, "ABSTAIN");
  const checked = verifyReplay(rows, composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "standard");
}

// A provider-observed TCG row is NOT_REQUIRED, and still replays through its
// existing stored TCG composer tuple without borrowing the contextual claim.
{
  const claimReceipt = buildTcgGrammarContextClaimReceipt({
    fields: tcgContextResolved,
    fieldSourceAuthorityReceipt: tcgContextFieldSourceReceipt
  });
  const rows = buildCsmStageRows({
    tenantId: "tenant-replay",
    recognitionSessionId: "session-tcg-context-v4-not-required",
    fields: tcgContextResolved,
    observedFields: tcgContextResolved,
    composed: tcgContextComposed,
    title: tcgContextComposed.title,
    ...tcgContextDurableReceipts,
    tcgFieldSourceAuthorityReceipt: tcgContextFieldSourceReceipt,
    tcgGrammarContextClaimReceipt: claimReceipt,
    contractVersion: CSM_TCG_GRAMMAR_CONTEXT_PROJECTION_CONTRACT_VERSION
  });
  assert.equal(claimReceipt.status, "NOT_REQUIRED");
  const checked = verifyReplay(rows, tcgContextComposed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, "tcg");
}

// Packet re-sealing cannot turn a mutated receipt into replay authority.
{
  const forged = clone(tcgContextRows);
  forged.output.structured_output.tcg_grammar_context_claim_receipt.raw_grammar = "tcg";
  reseal(forged);
  const checked = verifyReplay(forged, tcgContextComposed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some(({ kind }) => (
    kind === "tcg_grammar_context_claim_receipt_invalid"
  )), JSON.stringify(checked.problems));
}

// A v4 packet cannot be downgraded to stage-v3 while retaining its receipts.
{
  const downgraded = clone(tcgContextRows);
  downgraded.output.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  downgraded.resolution.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  for (const row of [...downgraded.evidence, ...downgraded.candidates]) {
    row.contract_version = CSM_DURABLE_PROJECTION_CONTRACT_VERSION;
  }
  reseal(downgraded);
  const checked = verifyReplay(downgraded, tcgContextComposed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some(({ kind }) => (
    kind === "tcg_grammar_context_receipt_outside_contract"
  )), JSON.stringify(checked.problems));
}

// The appended v4 dispatch leaves the already published v3 replay unchanged.
{
  const checked = verifyReplay(standard.rows, standard.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.title, standard.composed.title);
  assert.equal(checked.replayed.grammar, "standard");
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

  const composerV1Rows = clone(historicalRows);
  composerV1Rows.output.composer_version = THIN_COMPOSER_VERSION_V1;
  const composerV1 = composeCanonicalFieldsForStoredOutput(fields, composerV1Rows.output);
  const composerV1WriterTitle = composerV1.title.replace(/^Lot\*2 /, "Lotx2 ");
  composerV1Rows.output.title = composerV1WriterTitle;
  composerV1Rows.output.included_brackets = composerV1.brackets;
  composerV1Rows.output.dropped_trace = {
    dropped_for_budget: composerV1.dropped,
    suppressed_by_profile: composerV1.suppressed,
    restored: composerV1.restored,
    truncated: composerV1.truncated,
    empty_at_input: composerV1.input_empty_fields,
    normalization_reason_codes: composerV1.normalization_reasons,
    character_budget: composerV1.character_budget,
    rendered_length: composerV1.length
  };
  reseal(composerV1Rows);
  assert.match(composerV1Rows.output.title, /^Lotx2 /);
  assert.equal(composerV1.bracket_text[0].text, "Lot*2");
  const verifiedComposerV1 = verifyReplay(composerV1Rows, composerV1WriterTitle);
  assert.ok(verifiedComposerV1.ok, JSON.stringify(verifiedComposerV1.problems));
  assert.match(verifiedComposerV1.replayed.title, /^Lot\*2 /,
    "the public replay remains byte-compatible with the e1ae reader");
  assert.equal(verifyReplay(composerV1Rows, composerV1.title).ok, false,
    "the reader spelling cannot be resealed as the historical writer title");
  for (const [count, writerPrefix, readerPrefix] of [
    ["1", "Lotx1 ", ""],
    ["", "", ""]
  ]) {
    const boundaryFields = { ...fields, lot_count: count };
    const reader = composeCanonicalFieldsForStoredOutput(
      boundaryFields, composerV1Rows.output
    );
    const writer = composeFromCanonicalFields(boundaryFields, {
      features: {
        captured_composer_v1_lot_marker: true,
        exact_parallel_color_compaction: false,
        durable_lot_terminal_shared_only: false,
        publication_coverage: false
      }
    });
    const writerTitle = writer.title;
    // The current stage builder requires the newer in-memory routing state,
    // but stage-v2 omits it from the durable packet just as the old writer did.
    const writerForStage = {
      ...writer,
      lot_publishable: false,
      lot_publication_failure_code: count === "1"
        ? "LOT_SINGLE_CARD"
        : "LOT_QUANTITY_UNRESOLVED"
    };
    const rows = buildCsmStageRows({
      tenantId: "tenant-replay",
      recognitionSessionId: `session-composer-v1-lot-${count || "missing"}`,
      fields: boundaryFields,
      composed: writerForStage,
      title: writerTitle,
      contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
    });
    rows.output.composer_version = THIN_COMPOSER_VERSION_V1;
    reseal(rows);
    assert.equal(writerTitle.startsWith(writerPrefix), true);
    const checkedBoundary = verifyReplay(rows, writerTitle);
    assert.ok(checkedBoundary.ok, JSON.stringify(checkedBoundary.problems));
    assert.equal(checkedBoundary.replayed.title.startsWith(readerPrefix), true);
    assert.doesNotMatch(checkedBoundary.replayed.title, /^Lot/,
      "the e1ae public reader omitted single-card and missing lot markers");
    if (!count) assert.equal(checkedBoundary.replayed.composed.lot_quantity_unresolved, true);
  }

  for (const [label, mutate] of [
    ["revision", (resolution) => { resolution.revision = 2; }],
    ["status", (resolution) => { resolution.resolution_status = "FUTURE_COMPLETE"; }],
    ["registry", (resolution) => { resolution.registry_release_id = "future-registry"; }],
    ["resolver", (resolution) => { resolution.resolver_version = "future-resolver"; }],
    ["conflict", (resolution) => { resolution.conflict_policy_version = "future-conflict"; }]
  ]) {
    const forged = clone(historicalRows);
    mutate(forged.resolution);
    reseal(forged);
    assert.equal(isCapturedE1aeReplayTuple(forged.output, forged.resolution), false,
      `captured replay must bind its ${label}`);
    const rejected = verifyReplay(forged, expected);
    assert.equal(rejected.ok, false);
    assert.ok(rejected.problems.some(({ kind }) => kind === "unsupported_stage_v2_replay_tuple"));
  }
}

// A newly persisted non-publishable Lot cannot be downgraded into legacy mode
// by deleting its terminal receipt and re-sealing the remaining packet.
{
  const unresolved = stage({
    ...base, subjects: ["A", "B"], team: "", card_number: "", serial: "",
    attributes: [], grading_info: null, grade: "", grammar: "lot", lot_count: ""
  }, "session-lot-missing-terminal", (fields) => {
    const composed = activeCompose(fields);
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
  legacy.output.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  legacy.resolution.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  for (const row of [...legacy.evidence, ...legacy.candidates]) {
    row.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  }
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
  delete legacy.output.structured_output.publication_coverage;
  delete legacy.output.structured_output.founder_beta_web_receipt;
  delete legacy.output.structured_output.set_card_name_relation_receipt;
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
for (const visualValue of ["  High   Risers  ", "   "]) {
  const driftedVisual = clone(canonicalNaming.rows);
  const setVisual = driftedVisual.evidence.find((row) => (
    row.modality === "WHOLE_CARD_VISUAL" && row.bracket === "set"
  ));
  if (setVisual) {
    setVisual.raw_value = visualValue;
    setVisual.normalized_value = visualValue;
  } else {
    driftedVisual.evidence.push({
      modality: "WHOLE_CARD_VISUAL", bracket: "set",
      raw_value: visualValue, normalized_value: visualValue,
      source_ref: { images: driftedVisual.output.recognition_session_id },
      observation_confidence: 0.8,
      normalization_version: SEM_STANDARD_VERSION,
      normalization_outcome: "KEPT",
      normalization_reason_code: "DIRECT_OBSERVATION"
    });
  }
  reseal(driftedVisual);
  assert.throws(() => replayFromRows(driftedVisual),
    /founder_beta_observed_identity_cardinality_invalid/,
    "durable relation observations must already be exact canonical strings");
}

{
  const arraySet = clone(canonicalNaming.rows);
  arraySet.resolved.find((row) => row.bracket === "set").canonical_value =
    arraySet.output.structured_output.sem.set
      ? [arraySet.output.structured_output.sem.set]
      : ["Forged Set"];
  reseal(arraySet);
  assert.throws(() => replayFromRows(arraySet),
    /post_observation_resolved_identity_invalid/,
    "a relation-bearing resolved value cannot be an array that replay joins into a string");

  const invalidSem = clone(standard.rows);
  invalidSem.output.structured_output.sem = [];
  reseal(invalidSem);
  assert.throws(() => replayFromRows(invalidSem),
    /founder_beta_observed_identity_cardinality_invalid/,
    "even an empty relation projection requires a plain SEM object");

  for (const field of ["set", "card_name"]) {
    for (const mode of ["missing", "duplicate"]) {
      const cardinalityDrift = clone(canonicalNaming.rows);
      const row = cardinalityDrift.resolved.find((entry) => entry.bracket === field);
      cardinalityDrift.resolved = mode === "missing"
        ? cardinalityDrift.resolved.filter((entry) => entry.bracket !== field)
        : [...cardinalityDrift.resolved, clone(row)];
      reseal(cardinalityDrift);
      assert.throws(() => replayFromRows(cardinalityDrift),
        /post_observation_resolved_identity_cardinality_invalid/,
        `durable ${field} resolved rows must be exactly one`);
    }
  }
}

{
  const releases = Object.values(EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases);
  const external = releases.at(-1);
  const signalMutations = [
    (rows) => { rows.resolution.registry_release_id = external.resolution.registry_release_id; },
    (rows) => { rows.resolution.resolver_version = external.resolution.resolver_version; },
    (rows) => {
      rows.resolution.conflict_policy_version = external.resolution.conflict_policy_version;
    },
    (rows) => { Object.assign(rows.resolution, external.resolution); },
    (rows) => {
      rows.evidence.push({
        bracket: "set", raw_value: "High Risers", normalized_value: "High Risers",
        modality: "REGISTRY",
        source_ref: { support_type: "EXACT_EXTERNAL_IDENTITY" }
      });
    },
    (rows) => {
      rows.candidates.push({ source_trust: "REVIEWED_REGISTRY_EXACT" });
    },
    (rows) => {
      rows.resolved.find((row) => row.bracket === "set").rationale_codes =
        ["EXACT_EXTERNAL_IDENTITY_SUPPORT"];
    }
  ];
  for (const mutate of signalMutations) {
    const erasedAuthority = clone(canonicalNaming.rows);
    mutate(erasedAuthority);
    reseal(erasedAuthority);
    assert.throws(() => replayFromRows(erasedAuthority),
      /external_identity_receipt_missing_or_unexpected/,
      "any durable external-only signal requires the full private receipt");
    assert.equal(verifyReplay(erasedAuthority, canonicalNaming.composed.title).ok, false);
  }

  const verifiedSignalMutations = [
    (rows) => {
      rows.resolution.resolver_version = VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION;
    },
    (rows) => {
      rows.resolution.conflict_policy_version =
        VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION;
    },
    (rows) => {
      rows.evidence.push({
        bracket: "set", raw_value: "High Risers", normalized_value: "High Risers",
        modality: "REGISTRY",
        source_ref: { support_type: "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION" }
      });
    },
    (rows) => {
      rows.candidates.push({ source_trust: "REVIEWED_CLOSED_PROJECTION_EXACT" });
    },
    (rows) => {
      rows.resolved.find((row) => row.bracket === "set").rationale_codes =
        ["EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"];
    }
  ];
  for (const mutate of verifiedSignalMutations) {
    const erasedVerifiedAuthority = clone(canonicalNaming.rows);
    mutate(erasedVerifiedAuthority);
    reseal(erasedVerifiedAuthority);
    assert.throws(() => replayFromRows(erasedVerifiedAuthority),
      /verified_original_receipt_missing_or_unexpected/,
      "any durable verified-only signal requires the full private receipt");
    assert.equal(verifyReplay(
      erasedVerifiedAuthority, canonicalNaming.composed.title
    ).ok, false);
  }

  const visualAuthoritySignals = [
    (row) => { row.normalization_reason_code = "EXTERNAL_IDENTITY_FILL"; },
    (row) => { row.normalization_version = external.receipt.index_version; },
    (row) => {
      row.normalization_reason_code = "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION";
    },
    (row) => {
      row.normalization_version = "verified_original_closed_projection_subset_a_v2";
    },
    (row) => { row.source_ref.release_id = "verified_original_closed_projection_subset_a_v2"; },
    (row) => { row.source_ref.registry_release_id = external.receipt.registry_release_id; },
    (row) => { row.source_ref.pack_id = external.receipt.pack_id; },
    (row) => { row.source_ref.sources = [{ source_id: "tcdb.set.2551" }]; }
  ];
  for (const mutate of visualAuthoritySignals) {
    const residualAuthority = clone(canonicalNaming.rows);
    mutate(residualAuthority.evidence.find((row) => row.modality === "WHOLE_CARD_VISUAL"));
    reseal(residualAuthority);
    assert.throws(() => replayFromRows(residualAuthority),
      /founder_beta_observed_identity_evidence_invalid/,
      "a resolver-only marker cannot survive inside ordinary visual evidence");
    assert.equal(verifyReplay(residualAuthority, canonicalNaming.composed.title).ok, false);
  }

  const unclaimedRegistry = clone(canonicalNaming.rows);
  unclaimedRegistry.evidence.push({
    bracket: "set", raw_value: "High Risers", normalized_value: "High Risers",
    modality: "REGISTRY", source_ref: { registry_release_id: "unknown" }
  });
  reseal(unclaimedRegistry);
  assert.throws(() => replayFromRows(unclaimedRegistry),
    /durable_registry_evidence_unclaimed/,
    "durable v3 has no anonymous third Registry authority lane");
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
    fields: youngGunsFields, composed: naming, title: naming.title,
    ...durableReceipts(youngGunsFields)
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
  legacy.output.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  legacy.resolution.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  for (const row of [...legacy.evidence, ...legacy.candidates]) {
    row.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  }
  delete legacy.output.structured_output.composition_grammar;
  delete legacy.output.structured_output.publication_coverage;
  delete legacy.output.structured_output.lot_terminal;
  delete legacy.output.structured_output.founder_beta_web_receipt;
  delete legacy.output.structured_output.set_card_name_relation_receipt;
  reseal(legacy);
  const checked = verifyReplay(legacy, fixture.composed.title);
  assert.ok(checked.ok, JSON.stringify(checked.problems));
  assert.equal(checked.replayed.grammar, expectedGrammar);
}
{
  const ambiguous = clone(standard.rows);
  ambiguous.output.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  ambiguous.resolution.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  for (const row of [...ambiguous.evidence, ...ambiguous.candidates]) {
    row.contract_version = CSM_STAGE_LEGACY_CONTRACT_VERSION;
  }
  delete ambiguous.output.structured_output.composition_grammar;
  delete ambiguous.output.structured_output.publication_coverage;
  delete ambiguous.output.structured_output.founder_beta_web_receipt;
  delete ambiguous.output.structured_output.set_card_name_relation_receipt;
  ambiguous.output.included_brackets = [];
  reseal(ambiguous);
  const checked = verifyReplay(ambiguous, standard.composed.title);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some((problem) => problem.kind === "unsupported_stage_v2_replay_tuple"));
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
