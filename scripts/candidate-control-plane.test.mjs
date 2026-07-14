import assert from "node:assert/strict";
import {
  candidateFieldPermissions,
  fieldPermissions
} from "../lib/listing/candidates/candidate-application-policy.mjs";
import {
  applyCandidateDecisionStage,
  candidateDecisionHeuristicVersion
} from "../lib/listing/candidates/candidate-decision-stage.mjs";
import { buildCandidateSelectionPass } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import {
  buildVectorCandidatePacket,
  rebindCandidateToObservedFields,
  vectorCandidatePacketAssistEligibility
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { buildV4CandidateControlPlaneTrace } from "../lib/listing/v4/candidates/control-plane-adapter.mjs";

function packet(candidates = [], assistFilter = {}) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: assistFilter
    }
  };
}

const REQUIRED_TRACE_FIELDS = [
  "candidate_id",
  "source_type",
  "source_trust",
  "participation_level",
  "anchor_agreement",
  "direct_conflicts",
  "field_permissions",
  "applied_fields",
  "blocked_fields",
  "reason_per_field"
];

function assertCandidateTraceContract(trace) {
  for (const field of REQUIRED_TRACE_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(trace, field), `candidate trace missing ${field}`);
  }
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
      manufacturer: "Bowman",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      card_name: "Spotlights",
      collector_number: "BS-4",
      parallel_exact: "Red Refractor",
      serial_number: "12/50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
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
  assert.equal(control.decision_eligible_candidate_count, 1);
  assert.equal(control.shadow_only_candidate_count, 1);
  assert.deepEqual(control.shadow_only_candidate_ids, ["vector-lookalike"]);
  assert.equal(
    control.candidate_application_trace.find((row) => row.candidate_id === "vector-lookalike")?.participation_level,
    "LEVEL_0_SHADOW"
  );
  assert.equal(control.selected_candidate_safe_field_application.status, "ready_fill_missing");
  assert.ok(control.selected_candidate_safe_field_application.eligible_fields.includes("manufacturer"));
  assert.ok(control.selected_candidate_safe_field_application.eligible_fields.includes("card_name"));
  assert.equal(control.selected_candidate_safe_field_application.eligible_fields.includes("parallel_exact"), false);
  assert.equal(control.selected_candidate_safe_field_application.eligible_fields.includes("serial_number"), false);
  assert.equal(control.selected_candidate_safe_field_application.eligible_fields.includes("grade_company"), false);
  assert.equal(control.selected_candidate_safe_field_application.eligible_fields.includes("cert_number"), false);
}

function testDuplicateRowsForSameIdentityDoNotCreateFalseLowMargin() {
  const catalogCandidate = {
    candidate_id: "catalog-same-identity",
    candidate_identity_id: "identity-shared",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.72,
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
      collector_number: "CPA-TP"
    }
  };
  const vectorCandidate = {
    ...catalogCandidate,
    candidate_id: "vector-same-identity",
    source_type: "VISUAL_VECTOR",
    source_trust: "APPROVED_REFERENCE",
    similarity: 0.99
  };
  const control = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([catalogCandidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["identity-shared"]
      }),
      vector_candidate_packet: packet([vectorCandidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["identity-shared"]
      })
    }
  });

  assert.equal(control.decision_eligible_candidate_count, 2);
  assert.equal(control.selected_candidate_decision.viable_identity_group_count, 1);
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "catalog-same-identity");
  assert.deepEqual(
    new Set(control.selected_candidate_decision.selected_candidate_group_ids),
    new Set(["catalog-same-identity", "vector-same-identity"])
  );
  assert.equal(control.selected_candidate_decision.low_margin_candidate_id, "");
}

function testCandidateOnlyPacketCannotEnterProductionDecision() {
  const candidate = {
    candidate_id: "candidate-only",
    candidate_identity_id: "identity-candidate-only",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REFERENCE_CANDIDATE",
    match_score: 1,
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: false,
      agreed: ["collector_number", "subjects", "product_hierarchy"],
      contradicted: []
    },
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      collector_number: "CPA-TP"
    }
  };
  const control = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([candidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 0,
        trust_blocked_count: 1,
        prompt_candidate_count: 0,
        prompt_candidate_ids: []
      })
    }
  });

  assert.equal(control.decision_eligible_candidate_count, 0);
  assert.equal(control.selected_candidate_decision.selected_candidate_id, "");
  assert.equal(control.candidate_field_evidence.length, 0);
  assert.equal(control.candidate_application_trace[0].participation_level, "LEVEL_0_SHADOW");
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
  for (const trace of control.candidate_application_trace) assertCandidateTraceContract(trace);
  assert.ok(conflictTrace.blocked_fields.includes("collector_number"));
  assert.ok(conflictTrace.forbidden_fields.includes("grade_company"));
  assert.ok(conflictTrace.forbidden_fields.includes("card_grade"));
  assert.equal(control.catalog_activation_funnel.participation_level, "LEVEL_2_EVIDENCE_SUPPORT");
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
        card_name: "Spotlights",
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
  assert.ok(control.low_margin_safe_field_application.supported_fields.includes("card_name"));
  assert.ok(control.low_margin_safe_field_application.supported_fields.includes("parallel_exact"));
  assert.ok(control.candidate_field_evidence.some((row) => row.field_name === "card_name" && row.value === "Spotlights"));
  assert.ok(control.low_margin_safe_field_application.verifier_required_fields.includes("collector_number"));
}

function testTrustBlockedCountPropagatesToActivationFunnel() {
  const control = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([], {
        raw_candidate_count: 1,
        approved_candidate_count: 0,
        trust_blocked_count: 1,
        conflict_blocked_count: 0,
        prompt_candidate_count: 0,
        prompt_candidate_ids: []
      }),
      vector_candidate_packet: packet([], {
        raw_candidate_count: 2,
        approved_candidate_count: 0,
        trust_blocked_count: 2,
        conflict_blocked_count: 0,
        prompt_candidate_count: 0,
        prompt_candidate_ids: []
      })
    }
  });
  assert.equal(control.catalog_activation_funnel.trust_blocked_count, 1);
  assert.equal(control.vector_activation_funnel.trust_blocked_count, 2);
}

function testAtomicCandidateDecisionAppliesIdentityWithoutCopyingInstanceData() {
  const candidate = {
    candidate_id: "catalog-atomic",
    candidate_identity_id: "identity-atomic",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy", "year"],
      contradicted: []
    },
    fields: {
      year: "2024",
      manufacturer: "Bowman",
      product: "Bowman Chrome",
      players: ["Jesus Made"],
      card_name: "Spotlights",
      collector_number: "BS-4",
      serial_number: "12/50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  };
  const selection = buildCandidateSelectionPass({
    result: {
      catalog_candidate_packet: packet([candidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-atomic"]
      })
    }
  });
  const decision = applyCandidateDecisionStage({
    result: selection,
    resolvedBefore: {
      year: "2024",
      players: ["Jesus Made"],
      collector_number: "BS-4"
    }
  });

  assert.equal(decision.heuristic_version, candidateDecisionHeuristicVersion);
  assert.equal(decision.selected_candidate_id, "catalog-atomic");
  assert.ok(decision.field_application.applied_fields.includes("manufacturer"));
  assert.ok(decision.field_application.applied_fields.includes("product"));
  assert.ok(decision.field_application.applied_fields.includes("card_name"));
  assert.equal(decision.resolved_after.manufacturer, "Bowman");
  assert.equal(decision.resolved_after.product, "Bowman Chrome");
  assert.equal(decision.resolved_after.card_name, "Spotlights");
  assert.ok(decision.resolved_after.print_run_numerator == null);
  assert.ok(decision.resolved_after.grade_company == null);
  assert.ok(decision.resolved_after.card_grade == null);
  assert.ok(decision.resolved_after.cert_number == null);
  assert.notEqual(decision.title_after, decision.title_before);
  assert.equal(
    decision.result_patch.candidate_activation_funnel.applied_field_count,
    decision.field_application.applied_fields.length
  );
  assert.ok(decision.field_application.applied_fields.length >= 3);
  assert.equal(decision.result_patch.candidate_activation_funnel.title_changed, true);
  const appliedTrace = decision.result_patch.candidate_application_trace
    .find((row) => row.candidate_id === "catalog-atomic");
  assert.equal(appliedTrace.participation_level, "LEVEL_3_FIELD_APPLICATION");
}

function testSanitizedReferenceInstanceDoesNotRejectCleanIdentityCandidate() {
  const candidate = {
    candidate_id: "catalog-reference-instance-sanitized",
    candidate_identity_id: "identity-reference-instance-sanitized",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE",
    reference_print_run_numerator_copy_violation_count: 1,
    catalog_full_print_run_copy_violation_count: 1,
    fields: {
      year: "2024-25",
      manufacturer: "Topps",
      product: "Topps Finest Basketball",
      players: ["Josh Hart"],
      card_name: "Common Geometric Refractor",
      serial_number: "17/50",
      print_run_numerator: "17",
      print_run_denominator: "50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  };
  const result = {
    resolved_fields: {
      year: "2024-25",
      manufacturer: "Topps",
      product: "Finest",
      players: ["Josh Hart"]
    },
    catalog_candidate_packet: packet([candidate], {
      raw_candidate_count: 1,
      approved_candidate_count: 1,
      prompt_candidate_count: 1,
      prompt_candidate_ids: ["catalog-reference-instance-sanitized"]
    })
  };
  const selection = buildCandidateSelectionPass({ result });
  const decision = applyCandidateDecisionStage({ result: selection, resolvedBefore: result.resolved_fields });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "catalog-reference-instance-sanitized");
  assert.ok(selection.selected_candidate_decision.selected_reason_codes.includes("reference_instance_fields_sanitized"));
  assert.equal(
    selection.selected_candidate_decision.rejected_candidate_reasons[0].reasons.includes("reference_print_run_numerator_forbidden"),
    false
  );
  const trace = selection.candidate_application_trace[0];
  assert.deepEqual(trace.reference_instance_fields_sanitized, ["serial_number", "print_run_numerator"]);
  assert.ok(trace.blocked_fields.includes("serial_number"));
  assert.ok(trace.blocked_fields.includes("print_run_numerator"));
  assert.equal(decision.resolved_after.product, "Topps Finest Basketball");
  assert.ok(decision.resolved_after.serial_number == null);
  assert.ok(decision.resolved_after.print_run_numerator == null);
  assert.ok(decision.resolved_after.grade_company == null);
  assert.ok(decision.resolved_after.card_grade == null);
  assert.ok(decision.resolved_after.cert_number == null);
}

function testLowMarginDecisionOnlyAppliesCurrentImageSupportedFields() {
  const candidateA = {
    candidate_id: "low-margin-a",
    candidate_identity_id: "identity-low-margin-a",
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
      surface_color: "Gold",
      parallel_exact: "Gold Refractor"
    }
  };
  const candidateB = {
    ...candidateA,
    candidate_id: "low-margin-b",
    candidate_identity_id: "identity-low-margin-b",
    fields: {
      ...candidateA.fields,
      parallel_exact: "Gold Wave Refractor"
    }
  };
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: {
        year: "2025",
        product: "Bowman Chrome",
        players: ["Jesus Made"]
      },
      evidence: {
        surface_color: "Gold"
      },
      catalog_candidate_packet: packet([candidateA, candidateB], {
        raw_candidate_count: 2,
        approved_candidate_count: 2,
        prompt_candidate_count: 2,
        prompt_candidate_ids: ["low-margin-a", "low-margin-b"]
      })
    }
  });
  const decision = applyCandidateDecisionStage({
    result: {
      ...selection,
      evidence: { surface_color: "Gold" }
    },
    resolvedBefore: {
      year: "2025",
      product: "Bowman Chrome",
      players: ["Jesus Made"]
    }
  });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "");
  assert.deepEqual(decision.field_application.low_margin_supported_fields, ["surface_color"]);
  assert.equal(decision.resolved_after.surface_color, "Gold");
  assert.ok(decision.resolved_after.parallel_exact == null);
  assert.ok(decision.field_application.blocked_fields.includes("parallel_exact"));
}

function testShadowRerankerCannotChangeProductionDecision() {
  const trace = buildV4CandidateControlPlaneTrace({
    selected_candidate_decision: {
      selected_candidate_id: "heuristic-winner",
      heuristic_version: candidateDecisionHeuristicVersion,
      participation_level: "LEVEL_2_EVIDENCE_SUPPORT"
    },
    workflow_sidecars: {
      lightgbm: {
        status: "COMPLETED",
        mode: "lightgbm-reranker-v0",
        selected_candidate_id: "shadow-challenger",
        shadow_score: 0.87,
        candidate_count: 4,
        reason: "shadow_reranker_completed"
      }
    }
  });

  assert.equal(trace.heuristic_baseline.selected_candidate_id, "heuristic-winner");
  assert.equal(trace.shadow_reranker.shadow_only, true);
  assert.equal(trace.shadow_reranker.selected_candidate_id, "shadow-challenger");
  assert.equal(trace.shadow_reranker.would_change_candidate, true);
  assert.equal(trace.shadow_reranker.production_decision_affected, false);
  assert.equal(trace.selected_candidate_decision.selected_candidate_id, "heuristic-winner");
}

function testAtomicDecisionNeverMixesDifferentCandidateIds() {
  const decision = applyCandidateDecisionStage({
    resolvedBefore: {},
    result: {
      selected_candidate_safe_field_application: {
        status: "ready_fill_missing",
        renderer_application_allowed: true,
        candidate_id: "catalog-approved",
        eligible_fields: ["product"]
      },
      low_margin_safe_field_application: {
        status: "evidence_support_only",
        candidate_id: "vector-other",
        supported_fields: ["surface_color"]
      },
      candidate_field_evidence: [
        {
          candidate_id: "catalog-approved",
          field_name: "product",
          value: "Topps Chrome",
          permission: "can_apply"
        },
        {
          candidate_id: "vector-other",
          field_name: "surface_color",
          value: "Gold",
          permission: "can_apply"
        }
      ]
    }
  });

  assert.equal(decision.resolved_after.product, "Topps Chrome");
  assert.ok(decision.resolved_after.surface_color == null);
  assert.equal(decision.field_application.candidate_id_mismatch_blocked, true);
  assert.ok(decision.field_application.blocked_fields.includes("candidate_id_mismatch"));
}

function testFinalObservationRebindsStaleEarlyAnchorAndCorrectsYear() {
  const candidate = {
    candidate_id: "catalog-final-observation",
    candidate_identity_id: "identity-final-observation",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "APPROVED_REFERENCE",
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number"],
      contradicted: [],
      query_anchor_dimensions: 1
    },
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Topps Chrome",
      set: "Topps Chrome Basketball",
      players: ["Victor Wembanyama"],
      collector_number: "221",
      serial_number: "17/50",
      grade_company: "PSA",
      card_grade: "10"
    }
  };
  const result = {
    resolved_fields: {
      year: "2024-25",
      manufacturer: "Topps",
      product: "Topps Chrome",
      set: "Chrome",
      players: ["Victor Wembanyama"],
      collector_number: "221"
    },
    catalog_candidate_packet: packet([candidate], {
      raw_candidate_count: 1,
      approved_candidate_count: 1,
      prompt_candidate_count: 1,
      prompt_candidate_ids: ["catalog-final-observation"]
    })
  };
  const selection = buildCandidateSelectionPass({ result });
  const trace = selection.candidate_application_trace[0];
  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "catalog-final-observation");
  assert.ok(trace.anchor_agreement.agreed.includes("subjects"));
  assert.ok(trace.anchor_agreement.agreed.includes("product_hierarchy"));
  assert.deepEqual(trace.anchor_agreement.authoritative_overrides, ["year"]);
  assert.equal(trace.anchor_agreement.contradicted.includes("year"), false);

  const decision = applyCandidateDecisionStage({
    result: selection,
    resolvedBefore: result.resolved_fields
  });
  assert.equal(decision.resolved_after.year, "2025-26");
  assert.equal(decision.resolved_after.set, "Topps Chrome Basketball");
  assert.ok(decision.field_application.applied_fields.includes("year"));
  assert.ok(decision.field_application.applied_fields.includes("set"));
  assert.ok(decision.resolved_after.serial_number == null);
  assert.ok(decision.resolved_after.grade_company == null);
  assert.ok(decision.resolved_after.card_grade == null);
}

function testDenominatorAloneCannotOverrideConflictingYear() {
  const candidate = {
    candidate_id: "catalog-denominator-only",
    candidate_identity_id: "identity-denominator-only",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2025-26",
      product: "Topps Chrome",
      players: ["Victor Wembanyama"],
      expected_serial_denominator: "50"
    }
  };
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: {
        year: "2024-25",
        product: "Topps Chrome",
        players: ["Victor Wembanyama"],
        expected_serial_denominator: "50"
      },
      catalog_candidate_packet: packet([candidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-denominator-only"]
      })
    }
  });
  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "");
  const trace = selection.candidate_application_trace[0];
  assert.ok(trace.anchor_agreement.contradicted.includes("year"));
  assert.equal(trace.provider_prompt_eligible, true, "the candidate was present in the earlier provider packet");
  assert.equal(trace.prompt_eligible, false, "live observation must revoke stale prompt eligibility");
  assert.equal(trace.shadow_only_reason, "post_observation_anchor_filter_blocked");
  assert.equal(selection.catalog_activation_funnel.provider_prompt_candidate_count, 1);
  assert.equal(selection.catalog_activation_funnel.prompt_candidate_count, 0);
  assert.equal(selection.catalog_activation_funnel.post_observation_blocked_count, 1);
}

function testEvidenceFieldObjectsCannotOverwriteFinalObservedScalars() {
  const candidate = {
    candidate_id: "catalog-evidence-object-guard",
    candidate_identity_id: "identity-evidence-object-guard",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Heritage High Number",
      set: "Topps Heritage High Number",
      players: ["Jackson Chourio"],
      collector_number: "632"
    }
  };
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: {
        year: "2024",
        manufacturer: "Topps",
        product: "Topps Heritage High Number",
        set: "Topps Heritage High Number",
        players: ["Jackson Chourio"],
        collector_number: "632"
      },
      normalized_evidence: {
        year: {
          value: "2023",
          normalized_value: "2023",
          status: "REVIEW",
          sources: [{ source_type: "VISION_MODEL" }]
        },
        product: {
          value: "Topps Heritage",
          status: "REVIEW",
          sources: [{ source_type: "VISION_MODEL" }]
        }
      },
      catalog_candidate_packet: packet([candidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-evidence-object-guard"]
      })
    }
  });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "catalog-evidence-object-guard");
  assert.deepEqual(selection.candidate_observation_snapshot, {
    year: "2024",
    manufacturer: "Topps",
    product: "Topps Heritage High Number",
    set: "Topps Heritage High Number",
    players: ["Jackson Chourio"],
    collector_number: "632"
  });
  assert.deepEqual(selection.candidate_application_trace[0].anchor_agreement.contradicted, []);
  assert.ok(selection.candidate_application_trace[0].anchor_agreement.agreed.includes("year"));
  assert.ok(selection.candidate_application_trace[0].anchor_agreement.agreed.includes("product_hierarchy"));
}

function testEvidenceScalarOnlyFillsMissingObservedField() {
  const candidate = {
    candidate_id: "catalog-evidence-gap-fill",
    candidate_identity_id: "identity-evidence-gap-fill",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2025",
      product: "Topps Chrome",
      players: ["Tyler Booker"],
      collector_number: "381"
    }
  };
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: {
        product: "Topps Chrome",
        players: ["Tyler Booker"],
        collector_number: "381"
      },
      normalized_evidence: {
        year: {
          value: "2025",
          normalized_value: "2025",
          status: "CONFIRMED",
          sources: [{ source_type: "CARD_BACK_PRINTED_TEXT" }]
        }
      },
      catalog_candidate_packet: packet([candidate], {
        raw_candidate_count: 1,
        approved_candidate_count: 1,
        prompt_candidate_count: 1,
        prompt_candidate_ids: ["catalog-evidence-gap-fill"]
      })
    }
  });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "catalog-evidence-gap-fill");
  assert.ok(selection.candidate_application_trace[0].anchor_agreement.agreed.includes("year"));
}

function testProductHierarchyCandidateCanOnlyUpgradeSpecificity() {
  const candidate = {
    candidate_id: "catalog-product-specificity",
    candidate_identity_id: "identity-product-specificity",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Heritage High Number",
      set: "Topps Heritage High Number",
      players: ["Jackson Chourio"],
      card_name: "Dark Blue Bordered"
    }
  };
  const result = {
    resolved_fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Heritage",
      set: "Topps Heritage",
      players: ["Jackson Chourio"],
      card_name: "Base Card"
    },
    catalog_candidate_packet: packet([candidate], {
      raw_candidate_count: 1,
      approved_candidate_count: 1,
      prompt_candidate_count: 1,
      prompt_candidate_ids: ["catalog-product-specificity"]
    })
  };
  const selection = buildCandidateSelectionPass({ result });
  const decision = applyCandidateDecisionStage({ result: selection, resolvedBefore: result.resolved_fields });
  assert.equal(decision.resolved_after.product, "Topps Heritage High Number");
  assert.equal(decision.resolved_after.set, "Topps Heritage High Number");
  assert.equal(decision.resolved_after.card_name, "Base Card", "card name needs exact code or direct image evidence");
  assert.ok(decision.field_application.applied_fields.includes("product"));
  assert.ok(decision.field_application.applied_fields.includes("set"));
}

function testPacketRebindPreservesPlayersAsSubjectAnchor() {
  const candidate = {
    candidate_id: "catalog-chourio-packet-rebind",
    candidate_identity_id: "identity-chourio-packet-rebind",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    normalized_score: 0.48,
    fields: {
      year: "2024",
      manufacturer: "Topps",
      product: "Topps Heritage High Number",
      set: "Dark Blue Bordered",
      players: ["Jackson Chourio"],
      card_name: "Dark Blue Bordered",
      surface_color: "Dark Blue"
    }
  };
  const observed = {
    manufacturer: "Topps",
    brand: "Topps Heritage",
    players: ["Jackson Chourio"],
    collector_number: "632"
  };
  const catalogPacket = buildVectorCandidatePacket({ sources: [candidate] }, {
    limit: 5,
    queryFields: observed
  });
  const catalogEligibility = vectorCandidatePacketAssistEligibility(catalogPacket);

  assert.equal(catalogEligibility.prompt_candidate_count, 1, "the approved candidate should enter the provider-safe packet");
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: observed,
      catalog_candidate_packet: catalogPacket,
      catalog_assist_eligibility: catalogEligibility
    }
  });

  assert.equal(selection.selected_candidate_decision.selected_candidate_id, "catalog-chourio-packet-rebind");
  assert.ok(selection.candidate_application_trace[0].anchor_agreement.agreed.includes("subjects"));
  assert.ok(selection.candidate_application_trace[0].anchor_agreement.agreed.includes("product_hierarchy"));
  assert.equal(selection.candidate_application_trace[0].prompt_eligible, true);
}

function testNumericYearMayBeOmittedButCannotHideDifferentProductBranch() {
  const baseCandidate = {
    candidate_id: "bowman-base",
    candidate_identity_id: "bowman-base-identity",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2000",
      product: "Bowman",
      players: ["Tom Brady"]
    }
  };
  const chromeCandidate = {
    ...baseCandidate,
    candidate_id: "bowman-chrome",
    candidate_identity_id: "bowman-chrome-identity",
    fields: {
      ...baseCandidate.fields,
      product: "Bowman Chrome"
    }
  };
  const observed = {
    year: "2000",
    product: "2000 Bowman",
    players: ["Tom Brady"]
  };

  const baseRebound = rebindCandidateToObservedFields(baseCandidate, observed);
  const chromeRebound = rebindCandidateToObservedFields(chromeCandidate, observed);

  assert.ok(baseRebound.anchor_agreement.agreed.includes("product_hierarchy"));
  assert.equal(baseRebound.anchor_agreement.contradicted.includes("product"), false);
  assert.ok(chromeRebound.anchor_agreement.contradicted.includes("product_hierarchy"));
  assert.ok(chromeRebound.conflicting_fields.includes("product"));
}

function testDifferentProductFamiliesCannotShareAChromeAnchor() {
  const rebound = rebindCandidateToObservedFields({
    candidate_id: "bowman-sapphire-wemby",
    candidate_identity_id: "bowman-sapphire-wemby-identity",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Bowman Chrome Sapphire",
      players: ["Victor Wembanyama"],
      serial_denominator: "50"
    }
  }, {
    year: "2025-26",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"],
    serial_denominator: "50"
  });

  assert.ok(rebound.anchor_agreement.contradicted.includes("product_hierarchy"));
  assert.equal(rebound.anchor_agreement.prompt_hard_filter_pass, false);
  assert.ok(rebound.conflicting_fields.includes("product"));
}

function testReviewedCompositeIdentityCanCorrectVariantWithoutCopyingInstanceData() {
  const observed = {
    year: "2025-26",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Victor Wembanyama"],
    surface_color: "Green",
    serial_number: "17/50",
    serial_denominator: "50"
  };
  const candidate = {
    candidate_id: "reviewed-wemby-gold",
    candidate_identity_id: "reviewed-wemby-gold-identity",
    provider_id: "catalog",
    source_type: "STRUCTURED_DATABASE",
    source_trust: "APPROVED_REFERENCE",
    reference_metadata: {
      corrected_title_is_reviewed_title_ground_truth: true
    },
    fields: {
      year: "2025-26",
      manufacturer: "Topps",
      product: "Topps Chrome",
      players: ["Victor Wembanyama"],
      surface_color: "Gold",
      parallel_family: "Refractor",
      serial_number: "31/50",
      serial_denominator: "50",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  };
  const catalogPacket = buildVectorCandidatePacket({ sources: [candidate] }, {
    limit: 5,
    queryFields: observed
  });
  const catalogEligibility = vectorCandidatePacketAssistEligibility(catalogPacket);
  const selection = buildCandidateSelectionPass({
    result: {
      resolved_fields: observed,
      catalog_candidate_packet: catalogPacket,
      catalog_assist_eligibility: catalogEligibility
    }
  });
  const decision = applyCandidateDecisionStage({ result: selection, resolvedBefore: observed });

  assert.equal(decision.resolved_after.surface_color, "Gold");
  assert.equal(decision.resolved_after.parallel_family, "Refractor");
  assert.equal(decision.resolved_after.serial_number, "17/50");
  assert.equal(decision.resolved_after.grade_company ?? null, null);
  assert.equal(decision.resolved_after.cert_number ?? null, null);
}

testVectorOnlyCannotApplyIdentityOrInstanceFields();
testExactCodeCatalogCandidateBeatsVectorSimilarity();
testDuplicateRowsForSameIdentityDoNotCreateFalseLowMargin();
testCandidateOnlyPacketCannotEnterProductionDecision();
testFunnelAndEvidenceTraceFailClosedOnConflict();
testLowMarginCandidateOnlySupportsCurrentImageFields();
testTrustBlockedCountPropagatesToActivationFunnel();
testAtomicCandidateDecisionAppliesIdentityWithoutCopyingInstanceData();
testSanitizedReferenceInstanceDoesNotRejectCleanIdentityCandidate();
testLowMarginDecisionOnlyAppliesCurrentImageSupportedFields();
testShadowRerankerCannotChangeProductionDecision();
testAtomicDecisionNeverMixesDifferentCandidateIds();
testFinalObservationRebindsStaleEarlyAnchorAndCorrectsYear();
testDenominatorAloneCannotOverrideConflictingYear();
testEvidenceFieldObjectsCannotOverwriteFinalObservedScalars();
testEvidenceScalarOnlyFillsMissingObservedField();
testProductHierarchyCandidateCanOnlyUpgradeSpecificity();
testPacketRebindPreservesPlayersAsSubjectAnchor();
testNumericYearMayBeOmittedButCannotHideDifferentProductBranch();
testDifferentProductFamiliesCannotShareAChromeAnchor();
testReviewedCompositeIdentityCanCorrectVariantWithoutCopyingInstanceData();

console.log("candidate-control-plane tests passed");
