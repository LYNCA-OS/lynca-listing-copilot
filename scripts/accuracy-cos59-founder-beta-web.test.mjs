#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  canonicalProjectionAtoms,
  COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1
} from "../experiments/csm-frontier/collectible-semantic-state-v1.mjs";
import {
  buildFounderBetaJointRequest,
  auditFounderBetaProviderResponse
} from "../experiments/csm-frontier/founder-beta-joint-request-v1.mjs";
import {
  buildFrontierModelCsmEnvelope,
  buildFrontierModelCsmRequest,
  FRONTIER_MODEL_CSM_EXECUTION_MODE_FOUNDER_BETA
} from "../experiments/csm-frontier/frontier-model-csm-harness-v1.mjs";
import {
  CARD_NAME_PREDICATE,
  CURRENT_CARD_CONCEPT,
  CURRENT_CARD_VALUE,
  SET_MEMBERSHIP_PREDICATE
} from "../experiments/csm-frontier/set-card-name-contract-v1.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function emptySchemaValue(schema) {
  if (schema.type === "string") return "";
  if (schema.type === "array") return [];
  if (schema.type === "object") {
    return Object.fromEntries(schema.required.map((key) => (
      [key, emptySchemaValue(schema.properties[key])]
    )));
  }
  throw new TypeError("unsupported_test_schema");
}

const imageBytes = Buffer.from("cos59-founder-beta-current-card");
const imageSha256 = sha256(imageBytes);
const envelope = buildFrontierModelCsmEnvelope({
  caseId: "founder-beta-web",
  executionMode: FRONTIER_MODEL_CSM_EXECUTION_MODE_FOUNDER_BETA,
  sources: [{
    source_id: "src_current_card",
    source_kind: "ORIGINAL_IMAGE",
    content_sha256: imageSha256,
    approval: "APPROVED_FOR_EVALUATION",
    payload: {
      image_ref: `data:image/webp;base64,${imageBytes.toString("base64")}`,
      image_sha256: imageSha256
    }
  }, {
    source_id: "src_approved_context",
    source_kind: "APPROVED_REFERENCE",
    content_sha256: sha256(JSON.stringify({ authority: "founder_beta_fixture" })),
    approval: "APPROVED_FOR_EVALUATION",
    payload: { authority: "founder_beta_fixture" }
  }]
});

// The approved-reference hash is canonical JSON, whose one-key object equals
// JSON.stringify here. Building the envelope above proves the bytes agree.
const projection = {
  ...emptySchemaValue(COLLECTIBLE_SEMANTIC_STATE_SCHEMA_V1.properties.canonical_projection),
  year: "2024",
  product: "Prizm",
  set: "Rookie Signatures",
  subjects: ["Jane Doe"],
  card_name: "Debut Designs",
  card_number: "RS-JD",
  grammar: "standard"
};
const webSetUrl = "https://cards.example/checklist?id=1#rookie-signatures";
const webConflictUrl = "https://market.example/evidence?utm_source=test";

function semanticState({ withWeb }) {
  const facts = canonicalProjectionAtoms(projection).map((atom, index) => ({
    fact_id: `fact_${index + 1}`,
    concept: `canonical.${atom.canonical_path.replace(/\[\]$/, "").split(".")[0]}`,
    canonical_path: atom.canonical_path,
    value: atom.value,
    status: "SUPPORTED",
    confidence: "HIGH",
    source_ids: ["src_current_card"]
  }));
  const setFact = facts.find((fact) => fact.canonical_path === "set");
  const cardNameFact = facts.find((fact) => fact.canonical_path === "card_name");
  if (withWeb) setFact.source_ids.push(webSetUrl);
  facts.push({
    fact_id: "fact_current_card",
    concept: CURRENT_CARD_CONCEPT,
    canonical_path: "",
    value: CURRENT_CARD_VALUE,
    status: "SUPPORTED",
    confidence: "HIGH",
    source_ids: ["src_current_card"]
  });
  if (withWeb) {
    facts.push({
      fact_id: "fact_finish_conflict",
      concept: "canonical.print_finish",
      canonical_path: "",
      value: "Gold Wave",
      status: "CONFLICTED",
      confidence: "LOW",
      source_ids: ["src_current_card", webConflictUrl]
    });
  }
  return {
    schema_version: "collectible-semantic-state-v1",
    state_id: withWeb ? "css_founder_beta_web" : "css_founder_beta_no_web",
    grammar: "standard",
    source_inventory_sha256: envelope.source_inventory_sha256,
    facts,
    relationships: [{
      relationship_id: "rel_current_set",
      predicate: SET_MEMBERSHIP_PREDICATE,
      subject_fact_id: "fact_current_card",
      object_fact_id: setFact.fact_id,
      source_ids: withWeb ? ["src_current_card", webSetUrl] : ["src_current_card"]
    }, {
      relationship_id: "rel_current_card_name",
      predicate: CARD_NAME_PREDICATE,
      subject_fact_id: "fact_current_card",
      object_fact_id: cardNameFact.fact_id,
      source_ids: ["src_current_card"]
    }],
    uncertainties: withWeb ? [{
      uncertainty_id: "unc_finish",
      concept: "print_finish",
      alternative_fact_ids: ["fact_finish_conflict"],
      source_ids: [webConflictUrl],
      reason_code: "CURRENT_CARD_WEB_CONFLICT"
    }] : [],
    canonical_projection: projection
  };
}

function providerBody(state, { withWeb }) {
  return {
    id: withWeb ? "resp_web" : "resp_no_web",
    model: "gpt-5.6-luna",
    reasoning: { effort: "low" },
    status: "completed",
    output_text: "",
    output: [
      ...(withWeb ? [{
        type: "web_search_call",
        action: {
          query: "2024 Prizm Rookie Signatures checklist",
          sources: [
            { url: webSetUrl, title: "Checklist" },
            { url: webConflictUrl, title: "Market evidence" }
          ]
        }
      }] : []),
      {
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify(state),
          annotations: withWeb ? [{ type: "url_citation", url: webSetUrl }] : []
        }]
      }
    ]
  };
}

const request = buildFounderBetaJointRequest(envelope);
assert.equal(request.model, "gpt-5.6-luna");
assert.equal(request.reasoning.effort, "low");
assert.deepEqual(request.tools, [{ type: "web_search" }]);
assert.equal(request.tool_choice, "auto");
assert.equal(request.max_tool_calls, 1);
assert.deepEqual(request.include, ["web_search_call.action.sources"]);
assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 1);
assert.match(request.input[0].content[0].text, /CURRENT_CARD_MEMBER_OF_SET/);
assert.match(request.input[0].content[0].text, /CURRENT_CARD_NAMED_BY_DESIGN/);
assert.throws(() => buildFrontierModelCsmRequest(envelope),
  /frontier_harness_request_builder_mode_mismatch/,
  "the old no-network builder must fail closed on the opt-in Web mode");

const withWebState = semanticState({ withWeb: true });
const audited = auditFounderBetaProviderResponse(
  envelope,
  providerBody(withWebState, { withWeb: true })
);
assert.equal(audited.web_receipt.provider_request_count, 1);
assert.equal(audited.web_receipt.isolated_model_call_count, 0);
assert.equal(audited.web_receipt.provider_model, "gpt-5.6-luna");
assert.equal(audited.web_receipt.reasoning_effort, "low");
assert.equal(audited.web_receipt.web_search_used, true);
assert.equal(audited.web_receipt.web_search_call_count, 1);
assert.deepEqual(audited.web_receipt.queries,
  ["2024 Prizm Rookie Signatures checklist"]);
assert.deepEqual(audited.web_receipt.urls, [
  "https://cards.example/checklist",
  "https://market.example/evidence"
]);
assert.deepEqual(
  audited.web_receipt.field_evidence.find((row) => row.field === "set"),
  {
    field: "set",
    support_urls: ["https://cards.example/checklist"],
    conflict_urls: [],
    unresolved_urls: []
  }
);
assert.deepEqual(
  audited.web_receipt.field_evidence.find((row) => row.field === "print_finish"),
  {
    field: "print_finish",
    support_urls: [],
    conflict_urls: ["https://market.example/evidence"],
    unresolved_urls: ["https://market.example/evidence"]
  }
);
assert.equal(audited.set_card_name_contract.set.value, "Rookie Signatures");
assert.equal(audited.set_card_name_contract.card_name.value, "Debut Designs");

const noWeb = auditFounderBetaProviderResponse(
  envelope,
  providerBody(semanticState({ withWeb: false }), { withWeb: false })
);
assert.equal(noWeb.web_receipt.web_search_used, false);
assert.equal(noWeb.web_receipt.web_search_call_count, 0);
assert.deepEqual(noWeb.web_receipt.queries, []);
assert.deepEqual(noWeb.web_receipt.urls, []);
assert.deepEqual(noWeb.web_receipt.field_evidence, []);

const wrongModel = providerBody(withWebState, { withWeb: true });
wrongModel.model = "gpt-5.6";
assert.throws(() => auditFounderBetaProviderResponse(envelope, wrongModel),
  /founder_beta_provider_model_mismatch/);

const wrongEffort = providerBody(withWebState, { withWeb: true });
wrongEffort.reasoning.effort = "medium";
assert.throws(() => auditFounderBetaProviderResponse(envelope, wrongEffort),
  /founder_beta_provider_reasoning_effort_mismatch/);

const missingEffort = providerBody(withWebState, { withWeb: true });
delete missingEffort.reasoning;
assert.throws(() => auditFounderBetaProviderResponse(envelope, missingEffort),
  /founder_beta_provider_reasoning_effort_mismatch/);

const tooManyCalls = providerBody(withWebState, { withWeb: true });
tooManyCalls.output.unshift(clone(tooManyCalls.output[0]));
assert.throws(() => auditFounderBetaProviderResponse(envelope, tooManyCalls),
  /founder_beta_web_call_budget_exceeded/);

const unsafe = providerBody(withWebState, { withWeb: true });
unsafe.output[0].action.sources[0].url = "http://cards.example/checklist";
assert.throws(() => auditFounderBetaProviderResponse(envelope, unsafe),
  /founder_beta_web_url_unsafe/);

const unreturnedState = semanticState({ withWeb: true });
const unreturnedUrl = "https://cards.example/checklist?id=2";
unreturnedState.facts.find((fact) => fact.canonical_path === "set").source_ids = [
  "src_current_card", unreturnedUrl
];
unreturnedState.relationships[0].source_ids = ["src_current_card", unreturnedUrl];
assert.throws(() => auditFounderBetaProviderResponse(
  envelope,
  providerBody(unreturnedState, { withWeb: true })
), /founder_beta_web_url_not_returned/);

const webOnlyCardNumber = semanticState({ withWeb: true });
webOnlyCardNumber.facts.find((fact) => fact.canonical_path === "card_number").source_ids = [
  webSetUrl
];
assert.throws(() => auditFounderBetaProviderResponse(
  envelope,
  providerBody(webOnlyCardNumber, { withWeb: true })
), /founder_beta_current_copy_source_required:card_number/);

const webOnlyPrintFinish = semanticState({ withWeb: true });
webOnlyPrintFinish.canonical_projection.print_finish = "Gold Wave";
webOnlyPrintFinish.facts.push({
  fact_id: "fact_projected_finish",
  concept: "canonical.print_finish",
  canonical_path: "print_finish",
  value: "Gold Wave",
  status: "SUPPORTED",
  confidence: "LOW",
  source_ids: [webConflictUrl]
});
assert.throws(() => auditFounderBetaProviderResponse(
  envelope,
  providerBody(webOnlyPrintFinish, { withWeb: true })
), /founder_beta_current_copy_source_required:print_finish/);

for (const field of ["surface_color", "parallel_family", "parallel_exact"]) {
  const webOnlyOpenPhysicalFact = semanticState({ withWeb: true });
  webOnlyOpenPhysicalFact.facts.push({
    fact_id: `fact_web_only_${field}`,
    concept: `canonical.${field}`,
    canonical_path: "",
    value: "Gold Wave",
    status: "SUPPORTED",
    confidence: "LOW",
    source_ids: [webConflictUrl]
  });
  assert.throws(() => auditFounderBetaProviderResponse(
    envelope,
    providerBody(webOnlyOpenPhysicalFact, { withWeb: true })
  ), new RegExp(`founder_beta_current_copy_source_required:${field}`));
}

const moduleSource = await readFile(
  new URL("../experiments/csm-frontier/founder-beta-joint-request-v1.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/,
  "the seam builds/audits one provider request; it must not dispatch an app-side search");

process.stdout.write("COS-59 Founder Beta one-request governed Web contract: ok\n");
