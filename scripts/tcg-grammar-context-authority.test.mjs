#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT,
  applyTcgGrammarContextClaim,
  buildTcgFieldSourceAuthorityReceipt,
  buildTcgGrammarContextClaimReceipt,
  validateTcgFieldSourceAuthorityReceipt,
  validateTcgGrammarContextClaimReceipt
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";

const decisionText = readFileSync(new URL(
  "../docs/csm/decision-proposals/tcg-grammar-context-authority-v1.md",
  import.meta.url
), "utf8");
assert.match(decisionText, /Approved by the owner/);
assert.equal(createHash("sha256").update(decisionText, "utf8").digest("hex"),
  "e3bdcbee1b37c17fda2446b1f877ee652b230b35e9e089290433c50410b63705");
assert.equal(TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.decision_document_sha256,
  "e3bdcbee1b37c17fda2446b1f877ee652b230b35e9e089290433c50410b63705");
assert.equal(TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.registry_release_id,
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id);
assert.equal(TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  "registry_tcg_grammar_context_trainer_gallery_v1");
assert.equal(TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.transition.mutable_fields.length, 1);
assert.equal(TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.transition.mutable_fields[0], "grammar");
assert.match(TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256, /^[0-9a-f]{64}$/);

const webReceipt = Object.freeze({
  schema_version: "founder-beta-web-receipt-v2",
  semantic_state_sha256: "1".repeat(64)
});
const sourceExecution = Object.freeze({
  operationPayloadSha256: "a".repeat(64),
  originalImageFingerprints: [`sha256:${"b".repeat(64)}`],
  recognitionImageFingerprints: [`sha256:${"c".repeat(64)}`],
  providerClientRequestId: "lynca-authority-test-attempt-1",
  providerResponseId: "resp_authority_test_1",
  tenantId: "tenant-authority-test",
  recognitionSessionId: "session-authority-test"
});
const imageFieldSources = [
    { field: "set", source_ids: ["original_image_1", "https://pokemon.com/list"] },
    { field: "card_number", source_ids: ["original_image_1"] }
];
const sourceReceiptFor = (fields, fieldSources = imageFieldSources) => (
  buildTcgFieldSourceAuthorityReceipt({
  fieldSources,
  fields,
  originalImageCount: 1,
  semanticStateSha256: webReceipt.semantic_state_sha256,
  founderBetaWebReceipt: webReceipt,
  sourceExecution
  })
);
const approvedFields = {
  grammar: "standard", set: "Trainer Gallery", card_number: "TG22/TG30"
};
const sourceReceipt = sourceReceiptFor(approvedFields);
assert.equal(validateTcgFieldSourceAuthorityReceipt(sourceReceipt, {
  founderBetaWebReceipt: webReceipt,
  fields: approvedFields,
  sourceExecution
}), sourceReceipt);
assert.equal(sourceReceipt.authority_used, "CURRENT_IMAGE");
assert.equal(sourceReceipt.session_identity_sha256, createHash("sha256").update(
  JSON.stringify({
    recognition_session_id: sourceExecution.recognitionSessionId,
    tenant_id: sourceExecution.tenantId
  })
).digest("hex"));
assert.equal(sourceReceipt.field_authority.find((row) => row.field === "set")
  .web_source_present, true);

for (const cardNumber of ["TG1/TG30", "TG22/TG30", "TG30/TG30"]) {
  const fields = { grammar: "standard", set: "Trainer Gallery", card_number: cardNumber };
  const exactSourceReceipt = sourceReceiptFor(fields);
  const receipt = buildTcgGrammarContextClaimReceipt({
    fields,
    fieldSourceAuthorityReceipt: exactSourceReceipt
  });
  assert.equal(receipt.status, "APPLIED", cardNumber);
  assert.equal(receipt.resolved_grammar, "tcg");
  assert.equal(receipt.web_authority_used, false);
  assert.equal(receipt.ip_action, "UNCHANGED");
  assert.equal(validateTcgGrammarContextClaimReceipt(receipt, {
    fields,
    fieldSourceAuthorityReceipt: exactSourceReceipt
  }), receipt);
  assert.equal(applyTcgGrammarContextClaim({
    grammar: "standard", set: "Trainer Gallery", card_number: cardNumber, ip: ""
  }, receipt, { fieldSourceAuthorityReceipt: exactSourceReceipt }).grammar, "tcg");
}

for (const [set, cardNumber] of [
  ["", "TG22/TG30"],
  ["Trainer Galleries", "TG22/TG30"],
  ["Trainer Gallery Insert", "TG22/TG30"],
  ["Trainer Gallery", "TG0/TG30"],
  ["Trainer Gallery", "TG01/TG30"],
  ["Trainer Gallery", "TG31/TG30"],
  ["Trainer Gallery", "TG99/TG999"],
  ["Trainer Gallery", "RC1/RC100"],
  ["Trainer Gallery", "SP1/SP50"],
  ["Trainer Gallery", "AU1/AU25"],
  ["Trainer Gallery", "TT1/TT99"],
  ["Trainer Gallery", "17/50"],
  ["Trainer Gallery", "086/070"]
]) {
  const fields = { grammar: "standard", set, card_number: cardNumber };
  const receipt = buildTcgGrammarContextClaimReceipt({
    fields,
    fieldSourceAuthorityReceipt: sourceReceiptFor(fields)
  });
  assert.equal(receipt.status, "ABSTAIN", `${set}\0${cardNumber}`);
  assert.equal(receipt.resolved_grammar, "standard");
}

const webOnlySource = buildTcgFieldSourceAuthorityReceipt({
  fieldSources: [
    { field: "set", source_ids: ["https://pokemon.com/list"] },
    { field: "card_number", source_ids: ["original_image_1"] }
  ],
  fields: approvedFields,
  originalImageCount: 1,
  semanticStateSha256: webReceipt.semantic_state_sha256,
  founderBetaWebReceipt: webReceipt,
  sourceExecution
});
const webOnlyClaim = buildTcgGrammarContextClaimReceipt({
  fields: { grammar: "standard", set: "Trainer Gallery", card_number: "TG22/TG30" },
  fieldSourceAuthorityReceipt: webOnlySource
});
assert.equal(webOnlyClaim.status, "ABSTAIN");
assert.deepEqual(webOnlyClaim.conflict_codes, ["SET_CURRENT_IMAGE_SOURCE_MISSING"]);

const lowConfidenceClaim = buildTcgGrammarContextClaimReceipt({
  fields: {
    grammar: "standard", set: "Trainer Gallery", card_number: "TG22/TG30",
    low_confidence: ["card_number"]
  },
  fieldSourceAuthorityReceipt: sourceReceipt
});
assert.equal(lowConfidenceClaim.status, "ABSTAIN");
assert.deepEqual(lowConfidenceClaim.conflict_codes,
  ["CARD_NUMBER_OBSERVATION_UNCERTAIN"]);

for (const grammar of ["tcg", "lot"]) {
  const receipt = buildTcgGrammarContextClaimReceipt({
    fields: { grammar, set: "Trainer Gallery", card_number: "TG22/TG30" },
    fieldSourceAuthorityReceipt: sourceReceipt
  });
  assert.equal(receipt.status, "NOT_REQUIRED");
  assert.equal(receipt.resolved_grammar, grammar);
}

assert.throws(() => validateTcgFieldSourceAuthorityReceipt({
  ...sourceReceipt,
  authority_used: "ABSTAIN"
}), /tcg_field_source_authority_receipt_invalid/);
assert.throws(() => validateTcgFieldSourceAuthorityReceipt(sourceReceipt, {
  founderBetaWebReceipt: { ...webReceipt, semantic_state_sha256: "2".repeat(64) }
}), /tcg_field_source_authority_web_receipt_mismatch/);
assert.throws(() => validateTcgFieldSourceAuthorityReceipt(sourceReceipt, {
  sourceExecution: { ...sourceExecution, operationPayloadSha256: "d".repeat(64) }
}), /tcg_field_source_authority_execution_mismatch/);
assert.throws(() => validateTcgFieldSourceAuthorityReceipt(sourceReceipt, {
  sourceExecution: { ...sourceExecution, recognitionSessionId: "session-other" }
}), /tcg_field_source_authority_execution_mismatch/);
assert.throws(() => validateTcgFieldSourceAuthorityReceipt(sourceReceipt, {
  fields: { ...approvedFields, card_number: "TG21/TG30" }
}), /tcg_field_source_authority_values_mismatch/);
assert.throws(() => validateTcgGrammarContextClaimReceipt({
  ...webOnlyClaim,
  status: "APPLIED"
}, {
  fields: { grammar: "standard", set: "Trainer Gallery", card_number: "TG22/TG30" },
  fieldSourceAuthorityReceipt: webOnlySource
}), /tcg_grammar_context_claim_receipt_invalid/);

console.log("tcg grammar context authority: ok");
