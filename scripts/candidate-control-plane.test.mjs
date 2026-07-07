import assert from "node:assert/strict";
import {
  candidateFieldPermissions,
  fieldPermissions
} from "../lib/listing/candidates/candidate-application-policy.mjs";
import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";

function packet(candidates = [], assistFilter = {}) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: assistFilter
    }
  };
}

function testVectorOnlyCannotApplyIdentityOrInstanceFields() {
  const candidate = {
    candidate_id: "vector-1",
    candidate_identity_id: "identity-1",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Shohei Ohtani"],
      serial_number: "12/50",
      print_run_numerator: "12",
      print_run_denominator: "50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  };
  const permissions = candidateFieldPermissions(candidate);
  assert.equal(permissions.year, fieldPermissions.SUPPORT_ONLY);
  assert.equal(permissions.product, fieldPermissions.SUPPORT_ONLY);
  assert.equal(permissions.print_run_denominator, fieldPermissions.SUPPORT_ONLY);
  assert.equal(permissions.print_run_numerator, fieldPermissions.FORBIDDEN);
  assert.equal(permissions.grade_company, fieldPermissions.FORBIDDEN);
  assert.equal(permissions.card_grade, fieldPermissions.FORBIDDEN);
  assert.equal(permissions.cert_number, fieldPermissions.FORBIDDEN);
}

function testExactCodeCatalogCandidateBeatsVectorSimilarity() {
  const exactCatalogCandidate = {
    candidate_id: "catalog-exact",
    candidate_identity_id: "identity-exact",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.2,
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy", "year"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      collector_number: "BS-4"
    }
  };
  const lookalikeVectorCandidate = {
    candidate_id: "vector-lookalike",
    candidate_identity_id: "identity-lookalike",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE",
    similarity: 0.99,
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      collector_number: "BS-9"
    }
  };
  const control = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([exactCatalogCandidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-exact"]
      }),
      vector_candidate_packet: packet([lookalikeVectorCandidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 0,
        prompt_candidate_ids: []
      })
    }
  });
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "catalog-exact");
  assert.equal(control.selected_candidate_decision.match_level, "EXACT_CARD_MATCH");
  assert.equal(control.catalog_activation_funnel.prompt_candidate_count, 1);
  assert.equal(control.vector_activation_funnel.prompt_candidate_count, 0);
}

function testFunnelAndEvidenceTraceFailClosedOnConflict() {
  const safeCandidate = {
    candidate_id: "safe-candidate",
    candidate_identity_id: "identity-safe",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "OFFICIAL_CHECKLIST",
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      product: "Panini Prizm",
      players: ["Stephen Curry"],
      collector_number: "119",
      print_run_denominator: "5"
    }
  };
  const conflictingCandidate = {
    candidate_id: "conflict-candidate",
    candidate_identity_id: "identity-conflict",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "OFFICIAL_CHECKLIST",
    conflicting_fields: ["collector_number"],
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: false,
      agreed: ["subjects"],
      contradicted: ["collector_number"]
    },
    fields: {
      product: "Panini Prizm",
      players: ["Stephen Curry"],
      collector_number: "120",
      grade_company: "PSA",
      card_grade: "10"
    }
  };
  const control = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([safeCandidate, conflictingCandidate], {
        raw_candidate_count: 2,
        approved_candidate_count: 2,
        conflict_blocked_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["safe-candidate"]
      })
    },
    catalogContext: {
      retrieval_phase: "provider_observation_catalog_lookup",
      catalog_assist_eligibility: {
        raw_candidate_count: 2,
        approved_candidate_count: 2,
        conflict_blocked_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["safe-candidate"]
      }
    }
  });
  assert.equal(control.catalog_activation_funnel.post_observation_query_attempted, true);
  assert.equal(control.catalog_activation_funnel.conflict_blocked_count, 1);
  assert.equal(control.post_observation_candidate_count, 2);
  assert.ok(control.candidate_field_evidence.some((row) => row.candidate_id === "safe-candidate" && row.permission === fieldPermissions.CAN_APPLY));
  assert.equal(control.candidate_field_evidence.some((row) => row.candidate_id === "conflict-candidate"), false);
  const conflictTrace = control.candidate_application_trace.find((row) => row.candidate_id === "conflict-candidate");
  assert.ok(conflictTrace.blocked_fields.includes("collector_number"));
  assert.ok(conflictTrace.forbidden_fields.includes("grade_company"));
  assert.ok(conflictTrace.forbidden_fields.includes("card_grade"));
}

function testLowMarginCandidateOnlySupportsCurrentImageFields() {
  const topCandidate = {
    candidate_id: "catalog-low-margin-a",
    candidate_identity_id: "identity-low-a",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.8,
    anchor_agreement: {
      exact_code_match: false,
      prompt_hard_filter_pass: true,
      agreed: ["subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2025",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      card_name: "Spotlights",
      parallel_exact: "Red Refractor",
      collector_number: "BS-4"
    }
  };
  const closeCandidate = {
    ...topCandidate,
    candidate_id: "catalog-low-margin-b",
    candidate_identity_id: "identity-low-b",
    fields: {
      ...topCandidate.fields,
      card_name: "Spotlight Signatures",
      collector_number: "BSA-JM"
    }
  };
  const control = buildCandidateSelectionPass({
    result: {
      resolved_fields: {
        year: "2025",
        product: "Bowman Chrome",
        players: ["Jesus Made"],
        parallel_exact: "Red Refractor"
      },
      catalog_candidate_packet: packet([topCandidate, closeCandidate], {
        raw_candidate_count: 2,
        approved_candidate_count: 2,
        conflict_blocked_count: 0,
        prompt_candidate_count: 2,
        prompt_candidate_ids: ["catalog-low-margin-a", "catalog-low-margin-b"]
      })
    }
  });
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "");
  assert.deepEqual(control.selected_candidate_decision.selected_reason_codes, ["low_margin_no_application"]);
  assert.equal(control.selected_candidate_verifier.enabled, true);
  assert.equal(control.selected_candidate_verifier.status, "current_image_support_only");
  assert.equal(control.low_margin_safe_field_application.status, "evidence_support_only");
  assert.equal(control.low_margin_safe_field_application.renderer_application_allowed, false);
  assert.ok(control.low_margin_safe_field_application.supported_fields.includes("product"));
  assert.ok(control.low_margin_safe_field_application.supported_fields.includes("parallel_exact"));
  assert.ok(control.low_margin_safe_field_application.verifier_required_fields.includes("collector_number"));
}

testVectorOnlyCannotApplyIdentityOrInstanceFields();
testExactCodeCatalogCandidateBeatsVectorSimilarity();
testFunnelAndEvidenceTraceFailClosedOnConflict();
testLowMarginCandidateOnlySupportsCurrentImageFields();

console.log("candidate-control-plane tests passed");
