import assert from "node:assert/strict";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence
} from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import {
  buildRetrievalApplicationLayer,
  finalizeRetrievalApplicationOutcome
} from "../lib/listing/candidates/retrieval-application-layer.mjs";

function packet(candidates = [], promptCandidateIds = []) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: {
        raw_candidate_count: candidates.length,
        approved_candidate_count: candidates.length,
        prompt_candidate_count: promptCandidateIds.length,
        prompt_candidate_ids: promptCandidateIds
      }
    }
  };
}

function trustedCatalogCandidate(overrides = {}) {
  return {
    candidate_id: "catalog-exact",
    candidate_identity_id: "identity-exact",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.92,
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy", "year"],
      contradicted: []
    },
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Test Player"],
      card_name: "Autograph",
      collector_number: "CPA-TP",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    },
    ...overrides
  };
}

function resultWithCandidate(candidate = trustedCatalogCandidate()) {
  return {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    },
    catalog_candidate_packet: packet([candidate], [candidate.candidate_id])
  };
}

function buildLayer(result, enabled = true) {
  const control = buildCandidateSelectionPass({ result });
  const application = buildRetrievalApplicationLayer({ result, candidateControl: control, enabled });
  return { control, application };
}

function testSelectedCandidateBecomesFieldEvidenceWithoutCopyingInstanceFields() {
  const result = resultWithCandidate();
  const { control, application } = buildLayer(result);
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "catalog-exact");
  assert.ok(control.candidate_field_inventory.some((row) => row.field_name === "card_grade"));

  const product = application.decisions.find((row) => row.field === "product");
  const cardName = application.decisions.find((row) => row.field === "card_name");
  const year = application.decisions.find((row) => row.field === "year");
  const grade = application.decisions.find((row) => row.field === "card_grade");
  const cert = application.decisions.find((row) => row.field === "cert_number");
  assert.equal(product.decision, "APPLY");
  assert.equal(cardName.decision, "APPLY");
  assert.equal(year.decision, "SUPPORT");
  assert.equal(grade.decision, "BLOCK");
  assert.equal(cert.decision, "BLOCK");
  assert.ok(application.identity_evidence_items.some((item) => item.field === "product"));
  assert.equal(application.identity_evidence_items.some((item) => item.field === "card_grade"), false);
  assert.equal(application.identity_evidence_items.every((item) => item.metadata.candidate_is_evidence_not_truth === true), true);
}

function testVectorReferenceCanSupportButCannotFillMissingIdentity() {
  const vector = trustedCatalogCandidate({
    candidate_id: "vector-approved",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE"
  });
  const result = {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    },
    vector_candidate_packet: packet([vector], ["vector-approved"])
  };
  const { application } = buildLayer(result);
  const year = application.decisions.find((row) => row.field === "year");
  const product = application.decisions.find((row) => row.field === "product");
  assert.equal(year.decision, "SUPPORT");
  assert.equal(product.decision, "BLOCK");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), false);
  assert.equal(application.identity_evidence_items.find((item) => item.field === "year")?.source, "VECTOR_APPROVED_REFERENCE");
}

function testCandidateResolvedShapeStillProducesFieldEvidence() {
  const base = trustedCatalogCandidate();
  const candidate = {
    ...base,
    fields: undefined,
    resolved: base.fields
  };
  const result = resultWithCandidate(candidate);
  const { control, application } = buildLayer(result);
  assert.ok(control.candidate_field_inventory.some((row) => row.field_name === "product"));
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "APPLY");
}

function testCandidateFieldShapesMergeWithoutDroppingEvidence() {
  const candidate = trustedCatalogCandidate({
    identity: {
      manufacturer: "Topps",
      product: "Topps Chrome"
    },
    resolved: {
      card_name: "Autograph",
      collector_number: "CPA-TP"
    },
    fields: {
      year: "2024",
      players: ["Test Player"],
      product: "Topps Chrome Basketball"
    }
  });
  const result = resultWithCandidate(candidate);
  const { control } = buildLayer(result);
  const inventory = control.candidate_field_inventory
    .filter((row) => row.candidate_id === "catalog-exact");
  assert.ok(inventory.some((row) => row.field_name === "manufacturer"));
  assert.ok(inventory.some((row) => row.field_name === "card_name"));
  assert.equal(inventory.find((row) => row.field_name === "product")?.value, "Topps Chrome Basketball");
}

function testEveryCandidateProducesAuditableDecisionRows() {
  const selected = trustedCatalogCandidate();
  const rejected = trustedCatalogCandidate({
    candidate_id: "catalog-other",
    candidate_identity_id: "identity-other",
    fields: {
      year: "2023",
      product: "Panini Prizm",
      players: ["Other Player"],
      card_grade: "9"
    },
    anchor_agreement: {
      prompt_hard_filter_pass: false,
      agreed: [],
      contradicted: ["year", "players", "product_hierarchy"]
    }
  });
  const result = {
    ...resultWithCandidate(selected),
    catalog_candidate_packet: packet([selected, rejected], [selected.candidate_id])
  };
  const { application } = buildLayer(result);
  const rejectedRows = application.decisions.filter((row) => row.candidate_id === "catalog-other");
  assert.ok(rejectedRows.length >= 4);
  assert.ok(rejectedRows.some((row) => row.field === "card_grade" && row.decision === "REJECT"));
  assert.equal(rejectedRows.every((row) => row.decision === "REJECT"), true);
  for (const row of application.decisions) {
    assert.ok(row.candidate_id);
    assert.ok(row.field);
    assert.ok(Object.hasOwn(row, "old_value"));
    assert.ok(Object.hasOwn(row, "candidate_value"));
    assert.ok(Number.isFinite(row.confidence));
    assert.ok(row.source);
    assert.ok(["APPLY", "SUPPORT", "BLOCK", "REJECT"].includes(row.decision));
  }
}

function testDisabledLayerRejectsAllCandidateFieldsAndBlocksRawBypass() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result, false);
  assert.equal(application.identity_evidence_items.length, 0);
  assert.equal(application.decisions.every((row) => row.decision === "REJECT"), true);

  const gated = applyIdentityResolutionGate({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  }, {
    retrievalCandidates: [{
      candidate_id: "raw-bypass",
      source_type: "OFFICIAL_CHECKLIST",
      match_score: 1,
      fields: {
        year: "1999",
        product: "Wrong Product",
        players: ["Wrong Player"]
      }
    }]
  });
  assert.notEqual(gated.identity_resolution?.identity?.product, "Wrong Product");
  assert.notDeepEqual(gated.identity_resolution?.identity?.players, ["Wrong Player"]);
}

function testIdentityResolutionConsumesRetrievalFieldEvidence() {
  const result = resultWithCandidate();
  const { control, application } = buildLayer(result);
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.identity_resolution?.identity?.product, "Topps Chrome");
  assert.equal(gated.identity_resolution?.identity?.card_name, "Autograph");
  assert.equal(gated.retrieval_application?.resolver_consumed, true);
  assert.ok(gated.retrieval_application?.actual_applied_fields.includes("product"));
  assert.equal(gated.candidate_decision_stage?.application_owner, "retrieval_application_layer");
  assert.ok(gated.candidate_application_trace
    ?.find((trace) => trace.candidate_id === "catalog-exact")
    ?.applied_fields.includes("product"));
}

function testResolvedRetrievalOutcomeOwnsRenderedFieldContainer() {
  const result = {
    ...resultWithCandidate(),
    rendered_fields: {
      title: "2024 Test Player",
      fields: {
        year: "2024",
        players: ["Test Player"],
        collector_number: "CPA-TP"
      }
    }
  };
  const { control, application } = buildLayer(result);
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });

  assert.equal(gated.resolved_fields.product, "Topps Chrome");
  assert.equal(gated.rendered_fields.fields.product, "Topps Chrome");
  assert.equal(gated.rendered_fields.fields.card_name, "Autograph");
  assert.match(gated.rendered_fields.rendered_title, /Topps Chrome/);
}

function testCandidateCannotOverrideContradictingCurrentImageIdentity() {
  const result = resultWithCandidate();
  result.resolved_fields = {
    ...result.resolved_fields,
    product: "Panini Prizm"
  };
  const { application } = buildLayer(result);
  const productDecision = application.decisions.find((row) => row.field === "product");
  assert.ok(["BLOCK", "REJECT"].includes(productDecision.decision));
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), false);

  const gated = applyIdentityResolutionGate({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  });
  assert.equal(gated.identity_resolution?.identity?.product, "Panini Prizm");
}

function testOutcomeRecordsResolverBlockInsteadOfPretendingApplication() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result);
  const outcome = finalizeRetrievalApplicationOutcome({
    result: { ...result, retrieval_application: application },
    resolvedAfter: result.resolved_fields,
    titleAfter: "2024 Test Player"
  });
  const product = outcome.retrieval_application.decisions.find((row) => row.field === "product");
  assert.equal(product.outcome, "BLOCKED_BY_IDENTITY_RESOLUTION");
  assert.equal(outcome.retrieval_application.actual_application_count, 0);
}

async function testConvergenceCannotReinjectRawCandidates() {
  const result = resultWithCandidate();
  const { application } = buildLayer(result, false);
  let retrieverCalled = false;
  const gated = await applyIdentityResolutionGateWithConvergence({
    ...result,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {}
  }, {
    retrieveEvidence: async () => {
      retrieverCalled = true;
      return {
        retrievalCandidates: [{
          candidate_id: "convergence-bypass",
          source_type: "OFFICIAL_CHECKLIST",
          fields: { product: "Wrong Product" }
        }]
      };
    }
  });
  assert.equal(retrieverCalled, false);
  assert.notEqual(gated.identity_resolution?.identity?.product, "Wrong Product");
}

testSelectedCandidateBecomesFieldEvidenceWithoutCopyingInstanceFields();
testVectorReferenceCanSupportButCannotFillMissingIdentity();
testCandidateResolvedShapeStillProducesFieldEvidence();
testCandidateFieldShapesMergeWithoutDroppingEvidence();
testEveryCandidateProducesAuditableDecisionRows();
testDisabledLayerRejectsAllCandidateFieldsAndBlocksRawBypass();
testIdentityResolutionConsumesRetrievalFieldEvidence();
testResolvedRetrievalOutcomeOwnsRenderedFieldContainer();
testCandidateCannotOverrideContradictingCurrentImageIdentity();
testOutcomeRecordsResolverBlockInsteadOfPretendingApplication();
await testConvergenceCannotReinjectRawCandidates();

console.log("retrieval application layer tests passed");
