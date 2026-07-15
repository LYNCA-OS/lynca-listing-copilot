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

function testRawRetrievalEvidenceCannotBypassApplicationOwner() {
  const selected = trustedCatalogCandidate({
    fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome Sapphire",
      players: ["Shohei Ohtani"]
    }
  });
  const result = resultWithCandidate(selected);
  result.resolved_fields = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Sapphire",
    players: ["Shohei Ohtani"]
  };
  const { control, application } = buildLayer(result);
  assert.equal(application.decisions.find((row) => row.field === "product")?.decision, "APPLY");

  const directSource = {
    source_type: "SLAB_LABEL",
    observed_text: "2025 TOPPS SAPPHIRE",
    raw_text: "2025 TOPPS SAPPHIRE",
    evidence_kind: "PRODUCT_TEXT",
    direct_observation: true,
    trust_tier: 1
  };
  const leakedCandidateSource = {
    source_type: "STRUCTURED_DATABASE",
    source_url: "supabase://catalog-cards/unselected-platinum",
    domain: "supabase-catalog",
    title: "2025 Topps Chrome Platinum Shohei Ohtani",
    evidence_kind: "catalog_identity_field_lock",
    trust_tier: 4
  };
  const gated = applyIdentityResolutionGate({
    ...result,
    ...control,
    retrieval_application: application,
    resolved: result.resolved_fields,
    evidence: {
      product: {
        value: "Topps Sapphire",
        status: "CONFLICT",
        confidence: 0.5,
        candidates: [
          { value: "Topps Sapphire", confidence: 0.95, sources: [directSource] },
          { value: "Topps Chrome Platinum", confidence: 0.86 },
          { value: "Topps Chrome Platinum", confidence: 0.86 }
        ],
        sources: [directSource, leakedCandidateSource, leakedCandidateSource],
        conflicts: [{
          field: "product",
          existing_value: "Topps Sapphire",
          candidate_value: "Topps Chrome Platinum",
          reason: "independent trusted retrieval candidates disagree"
        }]
      }
    }
  });

  assert.notEqual(gated.identity_resolution?.identity?.product, "Topps Chrome Platinum");
  assert.equal(gated.identity_resolution?.identity?.product, "Topps Chrome Sapphire");
  assert.equal(gated.retrieval_evidence_isolation?.enabled, true);
  assert.ok(gated.retrieval_evidence_isolation?.blocked_raw_candidate_evidence_count >= 1);
  assert.ok(gated.retrieval_application?.actual_applied_fields.includes("product"));
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

function testProductSemanticWrappersSupportWithoutReplacement() {
  const candidate = trustedCatalogCandidate({
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true
    },
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "product_hierarchy", "serial_denominator"],
      contradicted: []
    },
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Test Player"]
    }
  });
  const result = resultWithCandidate(candidate);
  result.resolved_fields = {
    year: "2024",
    manufacturer: "Topps",
    product: "2024 Topps Chrome Basketball",
    players: ["Test Player"]
  };
  const { application } = buildLayer(result);
  const product = application.decisions.find((row) => row.field === "product");
  assert.equal(product.decision, "SUPPORT");
  assert.equal(product.reason, "selected_identity_matches_current_field");
}

function testReviewedProductCanonicalizationCanReplaceOnlyProduct() {
  const candidate = trustedCatalogCandidate({
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true
    },
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "manufacturer", "product_hierarchy", "serial_denominator"],
      contradicted: []
    },
    fields: {
      year: "2023",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Disney Anna"],
      serial_denominator: "100",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  });
  const result = resultWithCandidate(candidate);
  result.resolved_fields = {
    year: "2023",
    manufacturer: "Topps",
    product: "Disney100 Chrome",
    players: ["Disney Anna"],
    serial_denominator: "100"
  };
  const { application } = buildLayer(result);
  const product = application.decisions.find((row) => row.field === "product");
  assert.equal(product.decision, "APPLY");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), true);
  assert.equal(application.identity_evidence_items.some((item) => item.field === "card_grade"), false);
  assert.equal(application.identity_evidence_items.some((item) => item.field === "cert_number"), false);
}

function testUnselectedConflictingCandidateSupportsOnlyMatchingFields() {
  const candidate = trustedCatalogCandidate({
    candidate_id: "reviewed-field-support-only",
    candidate_identity_id: "identity-reviewed-field-support-only",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    conflicting_fields: ["surface_color"],
    direct_evidence_conflicts: ["surface_color"],
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_applicable: true,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      surface_color: "Red"
    }
  });
  const result = {
    resolved_fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      surface_color: "Blue"
    },
    catalog_candidate_packet: packet([candidate], [])
  };
  const { control, application } = buildLayer(result);
  const trace = control.candidate_application_trace[0];
  const product = application.decisions.find((row) => row.field === "product");
  const color = application.decisions.find((row) => row.field === "surface_color");

  assert.equal(control.selected_candidate_decision.selected_candidate_id, "");
  assert.equal(trace.identity_decision_eligible, false);
  assert.equal(trace.field_evidence_eligible, true);
  assert.equal(product.decision, "SUPPORT");
  assert.equal(product.reason, "unselected_trusted_candidate_matches_current_field");
  assert.equal(color.decision, "BLOCK");
  assert.equal(color.reason, "candidate_or_field_conflict");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), true);
  assert.equal(application.identity_evidence_items.some((item) => item.field === "surface_color"), false);
}

function testUnselectedFieldEvidenceCannotFillMissingProduct() {
  const candidate = trustedCatalogCandidate({
    candidate_id: "reviewed-no-missing-fill",
    candidate_identity_id: "identity-reviewed-no-missing-fill",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    conflicting_fields: ["surface_color"],
    direct_evidence_conflicts: ["surface_color"],
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_applicable: true,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "collector_number"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "CPA-TP",
      surface_color: "Red"
    }
  });
  const result = {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"],
      collector_number: "CPA-TP",
      surface_color: "Blue"
    },
    catalog_candidate_packet: packet([candidate], [])
  };
  const { application } = buildLayer(result);
  const product = application.decisions.find((row) => row.field === "product");

  assert.equal(product.decision, "REJECT");
  assert.equal(product.reason, "candidate_not_selected");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), false);
}

function testUnselectedFieldEvidenceCanSupportRawCurrentImageObservation() {
  const candidate = trustedCatalogCandidate({
    candidate_id: "reviewed-raw-observation-support",
    candidate_identity_id: "identity-reviewed-raw-observation-support",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    conflicting_fields: ["surface_color"],
    direct_evidence_conflicts: ["surface_color"],
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_applicable: true,
      prompt_hard_filter_pass: true,
      agreed: ["year", "subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      surface_color: "Red"
    }
  });
  const result = {
    resolved_fields: {
      year: "2024",
      players: ["Test Player"]
    },
    raw_provider_fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      surface_color: "Blue"
    },
    catalog_candidate_packet: packet([candidate], [])
  };
  const { control, application } = buildLayer(result);
  const product = application.decisions.find((row) => row.field === "product");

  assert.equal(control.selected_candidate_decision.selected_candidate_id, "");
  assert.equal(control.candidate_observation_snapshot.product, "Topps Chrome");
  assert.equal(product.old_value ?? null, null);
  assert.equal(product.observed_value, "Topps Chrome");
  assert.equal(product.decision, "SUPPORT");
  assert.equal(product.reason, "unselected_trusted_candidate_matches_current_field");
  assert.equal(application.identity_evidence_items.some((item) => item.field === "product"), true);
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
testRawRetrievalEvidenceCannotBypassApplicationOwner();
testResolvedRetrievalOutcomeOwnsRenderedFieldContainer();
testCandidateCannotOverrideContradictingCurrentImageIdentity();
testProductSemanticWrappersSupportWithoutReplacement();
testReviewedProductCanonicalizationCanReplaceOnlyProduct();
testUnselectedConflictingCandidateSupportsOnlyMatchingFields();
testUnselectedFieldEvidenceCannotFillMissingProduct();
testUnselectedFieldEvidenceCanSupportRawCurrentImageObservation();
testOutcomeRecordsResolverBlockInsteadOfPretendingApplication();
await testConvergenceCannotReinjectRawCandidates();

console.log("retrieval application layer tests passed");
