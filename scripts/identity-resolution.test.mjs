import assert from "node:assert/strict";
import { resolveIdentity, resolveIdentityWithConvergence } from "../lib/identity-resolution/solver.mjs";
import { validateIdentity } from "../lib/identity-resolution/constraint-engine.mjs";

const baseAnchors = [
  { field: "year", value: "2024", source: "OCR_FRONT", confidence: 0.98 },
  { field: "product", value: "Topps Chrome", source: "OCR_FRONT", confidence: 0.98 },
  { field: "players", value: "Shohei Ohtani", source: "OCR_FRONT", confidence: 0.98 }
];

function fieldState(result, field) {
  return result.field_states.find((item) => item.field === field);
}

function traceSteps(result, field) {
  return result.resolution_trace
    .filter((entry) => entry.field === field)
    .map((entry) => entry.step);
}

const ocrConflict = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "31/50", source: "OCR_ONLY", confidence: 0.9 },
    { field: "serial_number", value: "37/50", source: "OCR", confidence: 0.88 }
  ]
});
assert.ok(ocrConflict.conflict_map.some((conflict) => conflict.field === "serial_number" && conflict.conflict_type === "OCR_CONFLICT"));
assert.equal(fieldState(ocrConflict, "serial_number").conflicts, true);
assert.equal(ocrConflict.ambiguity_status, "AMBIGUOUS");
assert.equal(ocrConflict.status, "ABSTAIN");
assert.equal(ocrConflict.identity_state.status, "ABSTAIN");
assert.equal(ocrConflict.canonical_evidence.schema_version, "identity_evidence_v1");
assert.ok(ocrConflict.canonical_evidence.source_counts.CARD_FRONT_PRINTED_TEXT > 0);
assert.ok(ocrConflict.canonical_evidence.source_counts.OCR_ONLY > 0);
assert.ok(ocrConflict.canonical_evidence.field_names.includes("serial_number"));
assert.ok(ocrConflict.canonical_evidence.canonical_items.every((item) => item.canonical_key && Number.isFinite(item.source_rank)));
assert.equal(ocrConflict.canonical_evidence.source_aliases.OCR_FRONT, "CARD_FRONT_PRINTED_TEXT");
assert.ok(ocrConflict.canonical_evidence.field_source_matrix.serial_number.OCR_ONLY > 0);
assert.ok(ocrConflict.identity_state.field_states.serial_number);
assert.ok(ocrConflict.field_uncertainty.serial_number.entropy > 0);
assert.ok(ocrConflict.field_uncertainty.serial_number.conflict_intensity > 0);
assert.ok(ocrConflict.conflict_graph.nodes.some((node) => node.type === "OCR_RESULT"));
assert.ok(ocrConflict.conflict_graph.edges.some((edge) => edge.edge_type === "contradict" && edge.field === "serial_number"));
assert.ok(Array.isArray(fieldState(ocrConflict, "serial_number").supporting_sources));
assert.ok(Array.isArray(fieldState(ocrConflict, "serial_number").conflicting_sources));

const slabOverride = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "card_grade", value: "9", source: "OCR_FRONT", confidence: 0.92 },
    { field: "card_grade", value: "10", source: "SLAB", confidence: 0.96 }
  ]
});
assert.equal(slabOverride.identity.card_grade, "10");
assert.equal(fieldState(slabOverride, "card_grade").resolution_reason, "slab_override_ocr_conflict");
assert.ok(slabOverride.conflict_map.some((conflict) => conflict.field === "card_grade" && conflict.resolved === true));
assert.equal(slabOverride.ambiguity_status, "RESOLVED");
assert.equal(slabOverride.status, "RESOLVED");
assert.ok(slabOverride.conflict_graph.edges.some((edge) => edge.edge_type === "override" && edge.field === "card_grade"));

const slabAutoTextIsNotAutoGrade = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "grade_company", value: "PSA/DNA", source: "SLAB", confidence: 0.96 },
    { field: "card_grade", value: "10", source: "SLAB", confidence: 0.96 },
    { field: "auto_grade", value: "SIGAUTO", source: "SLAB", confidence: 0.96 },
    { field: "grade_type", value: "CARD_AND_AUTO", source: "SLAB", confidence: 0.96 }
  ]
});
assert.equal(slabAutoTextIsNotAutoGrade.identity.grade_company, "PSA/DNA");
assert.equal(slabAutoTextIsNotAutoGrade.identity.card_grade, "10");
assert.equal(slabAutoTextIsNotAutoGrade.identity.auto_grade, null);

const slabGradePhraseIsNotCompany = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "grade_company", value: "GEM MT 10", source: "SLAB", confidence: 0.96 },
    { field: "card_grade", value: "10", source: "SLAB", confidence: 0.96 }
  ]
});
assert.equal(slabGradePhraseIsNotCompany.identity.grade_company, null);
assert.equal(slabGradePhraseIsNotCompany.identity.card_grade, "10");

const backPrintedSerialOverride = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "37/50", source: "OCR_FRONT", confidence: 0.95 },
    { field: "serial_number", value: "31/50", source: "OCR_BACK", confidence: 0.91 }
  ]
});
assert.equal(backPrintedSerialOverride.identity.serial_number, "31/50");
assert.equal(fieldState(backPrintedSerialOverride, "serial_number").resolution_reason, "card_back_printed_text_override_front_ocr_conflict");
assert.equal(backPrintedSerialOverride.status, "RESOLVED");
assert.ok(backPrintedSerialOverride.conflict_map.some((conflict) => conflict.field === "serial_number" && conflict.resolved === true));

const registryOverride = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2024", source: "OCR_FRONT", confidence: 0.98 },
    { field: "product", value: "Topps Chrome", source: "OCR_FRONT", confidence: 0.98 },
    { field: "players", value: "S Ohtani", source: "OCR_FRONT", confidence: 0.82 }
  ],
  registryRecords: [
    {
      fields: {
        players: ["Shohei Ohtani"]
      },
      source_type: "STRUCTURED_DATABASE",
      confidence: 0.94
    }
  ]
});
assert.deepEqual(registryOverride.identity.players, ["Shohei Ohtani"]);
assert.equal(fieldState(registryOverride, "players").resolution_reason, "registry_override_ocr_conflict");
assert.ok(registryOverride.conflict_map.some((conflict) => conflict.field === "players" && conflict.conflict_type === "REGISTRY_OCR_CONFLICT"));

const multiViewOcr = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "31 / 50", source: "OCR_FRONT", confidence: 0.94 },
    { field: "serial_number", value: "31/50", source: "OCR_BACK", confidence: 0.93 }
  ]
});
assert.equal(multiViewOcr.identity.serial_number, "31/50");
assert.equal(fieldState(multiViewOcr, "serial_number").conflicts, false);
assert.ok(fieldState(multiViewOcr, "serial_number").resolution_confidence >= 0.86);

const ambiguousCriticalFields = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2023", source: "OCR_FRONT", confidence: 0.9 },
    { field: "year", value: "2024", source: "OCR_BACK", confidence: 0.9 },
    { field: "product", value: "Topps Chrome", source: "OCR_FRONT", confidence: 0.9 },
    { field: "product", value: "Bowman Chrome", source: "OCR_BACK", confidence: 0.9 },
    { field: "players", value: "Shohei Ohtani", source: "OCR_FRONT", confidence: 0.98 }
  ]
});
assert.equal(ambiguousCriticalFields.ambiguity_status, "AMBIGUOUS");
assert.equal(ambiguousCriticalFields.status, "ABSTAIN");
assert.equal(fieldState(ambiguousCriticalFields, "year").ambiguity, true);
assert.equal(fieldState(ambiguousCriticalFields, "product").ambiguity, true);

multiViewOcr.field_states.forEach((state) => {
  const steps = traceSteps(multiViewOcr, state.field);
  assert.ok(steps.includes("candidate_generation"));
  assert.ok(steps.includes("conflict_detection"));
  assert.ok(steps.includes("constraint_validation"));
  assert.ok(steps.includes("scoring"));
  assert.ok(steps.includes("solver_selection"));
  assert.ok(steps.includes("ambiguity_routing"));
});

multiViewOcr.field_states
  .filter((state) => state.resolved_value !== null)
  .forEach((state) => {
    assert.ok(state.source_summary.length > 0);
    assert.ok(state.candidates.some((candidate) => candidate.evidence_items.length > 0));
  });

const validSerial = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "31/50", source: "OCR_FRONT", confidence: 0.94 }
  ]
});
assert.equal(validSerial.identity.serial_number, "31/50");

const denominatorOnlySerial = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "/10", source: "OCR_FRONT", confidence: 0.94 }
  ]
});
assert.equal(denominatorOnlySerial.identity.serial_number, "/10");

const invalidSerial = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "51/50", source: "OCR_FRONT", confidence: 0.94 }
  ]
});
assert.equal(invalidSerial.identity.serial_number, null);
assert.ok(invalidSerial.conflict_map.some((conflict) => conflict.field === "serial_number" && conflict.conflict_type === "INVALID_SERIAL_NUMBER"));
assert.equal(invalidSerial.ambiguity_status, "AMBIGUOUS");
assert.equal(invalidSerial.status, "ABSTAIN");
assert.equal(fieldState(invalidSerial, "serial_number").candidates[0].constraint_result.constraint_score, 0);
assert.equal(fieldState(invalidSerial, "serial_number").candidates[0].constraint_result.violations[0].weight, 1);
assert.equal(invalidSerial.constraint_score_report.per_field_constraint_score.serial_number, 0);
assert.equal(invalidSerial.constraint_score_report.scoring_model, "weighted_constraint_rules");

const certificateNumberIsNotSerial = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "0015583391", source: "OCR_FRONT", confidence: 0.94 }
  ]
});
assert.equal(certificateNumberIsNotSerial.identity.serial_number, null);
assert.equal(fieldState(certificateNumberIsNotSerial, "serial_number"), undefined);

const oneOfOne = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "1 / 1", source: "OCR_FRONT", confidence: 0.96 }
  ]
});
assert.equal(oneOfOne.identity.serial_number, "1/1");
assert.equal(oneOfOne.identity.one_of_one, true);

const checklistMismatch = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "checklist_code", value: "BAD-1", source: "OCR_FRONT", confidence: 0.95 }
  ],
  productSchemas: [
    {
      product: "Topps Chrome",
      checklist_codes: ["TC-1"]
    }
  ]
});
assert.equal(checklistMismatch.identity.checklist_code, null);
assert.ok(checklistMismatch.conflict_map.some((conflict) => conflict.field === "checklist_code" && conflict.conflict_type === "CHECKLIST_REGISTRY_MISMATCH"));

const marketplaceCannotOverride = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "31/50", source: "OCR_FRONT", confidence: 0.94 },
    { field: "serial_number", value: "99/99", source: "MARKETPLACE", confidence: 0.99 }
  ]
});
assert.equal(marketplaceCannotOverride.identity.serial_number, "31/50");
assert.notEqual(fieldState(marketplaceCannotOverride, "serial_number").source_summary[0].source, "MARKETPLACE");

const visualOnlyParallelRejected = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "parallel", value: "Blue Prizm", source: "AGNES", confidence: 0.96 }
  ]
});
assert.equal(visualOnlyParallelRejected.identity.parallel, null);
assert.equal(visualOnlyParallelRejected.status, "RESOLVED");
assert.equal(fieldState(visualOnlyParallelRejected, "parallel").resolution_reason, "rejected_unsupported_optional_candidate");
assert.equal(fieldState(visualOnlyParallelRejected, "parallel").decision_route, "DROP");
assert.equal(fieldState(visualOnlyParallelRejected, "parallel").candidates[0].constraint_result.constraint_score, 0);
assert.ok(visualOnlyParallelRejected.conflict_map.some((conflict) => {
  return conflict.field === "parallel"
    && conflict.conflict_type === "PARALLEL_WITHOUT_GROUNDED_SOURCE"
    && conflict.resolved === true;
}));

const focusedVisualParallelAccepted = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    {
      field: "parallel",
      value: "Purple Refractor",
      source: "AGNES",
      confidence: 0.92,
      region: "CROP_AND_READ_PARALLEL",
      metadata: {
        capture_role: "focused_reread"
      }
    }
  ]
});
assert.equal(focusedVisualParallelAccepted.identity.parallel, "Purple Refractor");
assert.equal(fieldState(focusedVisualParallelAccepted, "parallel").resolution_reason, "highest_scoring_candidate");
assert.equal(fieldState(focusedVisualParallelAccepted, "parallel").decision_route, "USE");
assert.ok(fieldState(focusedVisualParallelAccepted, "parallel").candidates[0].constraint_result.evaluated_rules.every((rule) => rule.passed));

const focusedVisualParallelReviewWithoutBlockerAccepted = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    {
      field: "parallel",
      value: "Purple Refractor",
      source: "AGNES",
      confidence: 0.8,
      region: "CROP_AND_READ_PARALLEL",
      metadata: {
        capture_role: "focused_reread",
        field_status: "REVIEW"
      }
    }
  ]
});
assert.equal(focusedVisualParallelReviewWithoutBlockerAccepted.identity.parallel, "Purple Refractor");
assert.equal(fieldState(focusedVisualParallelReviewWithoutBlockerAccepted, "parallel").decision_route, "USE");

const focusedVisualParallelReviewRejected = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    {
      field: "parallel",
      value: "Purple Refractor",
      source: "AGNES",
      confidence: 0.92,
      region: "CROP_AND_READ_PARALLEL",
      metadata: {
        capture_role: "focused_reread",
        field_status: "REVIEW",
        field_unresolved_reason: "operator_review_requested"
      }
    }
  ]
});
assert.equal(focusedVisualParallelReviewRejected.identity.parallel, null);
assert.equal(fieldState(focusedVisualParallelReviewRejected, "parallel").resolution_reason, "rejected_unsupported_optional_candidate");

const printedRookieMarkersAccepted = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "rc", value: true, source: "CARD_FRONT", confidence: 0.94 },
    { field: "first_bowman", value: "1st Bowman", source: "CARD_FRONT", confidence: 0.94 }
  ]
});
assert.equal(printedRookieMarkersAccepted.identity.rc, true);
assert.equal(printedRookieMarkersAccepted.identity.first_bowman, true);
assert.equal(fieldState(printedRookieMarkersAccepted, "rc").resolution_reason, "highest_scoring_candidate");

const seasonRangeWinsCompatibleYear = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2020", source: "AGNES", confidence: 0.9 },
    { field: "year", value: "2020-21", source: "CARD_BACK", confidence: 0.9 },
    { field: "product", value: "Contenders", source: "CARD_BACK", confidence: 0.94 },
    { field: "players", value: "Anthony Edwards", source: "CARD_FRONT", confidence: 0.94 }
  ]
});
assert.equal(seasonRangeWinsCompatibleYear.identity.year, "2020-21");
assert.ok([
  "card_design_override_label_or_inference_conflict",
  "more_specific_compatible_descriptor"
].includes(fieldState(seasonRangeWinsCompatibleYear, "year").resolution_reason));

const moreSpecificInsertWins = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "insert", value: "Propulsion", source: "CARD_BACK", confidence: 0.94 },
    { field: "insert", value: "Red Propulsion", source: "CARD_BACK", confidence: 0.94 }
  ]
});
assert.equal(moreSpecificInsertWins.identity.insert, "Red Propulsion");
assert.equal(fieldState(moreSpecificInsertWins, "insert").resolution_reason, "more_specific_compatible_descriptor");

const insertCannotDuplicateProductIdentity = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2025-26", source: "CARD_BACK", confidence: 0.94 },
    { field: "product", value: "Topps Cosmic Chrome", source: "CARD_BACK", confidence: 0.94 },
    { field: "players", value: "Stephen Curry", source: "CARD_BACK", confidence: 0.94 },
    { field: "insert", value: "Red Propulsion", source: "CARD_BACK", confidence: 0.94 },
    { field: "insert", value: "Topps Cosmic Chrome", source: "STRUCTURED_DATABASE", confidence: 0.94 }
  ]
});
assert.equal(insertCannotDuplicateProductIdentity.identity.insert, "Red Propulsion");
assert.ok(fieldState(insertCannotDuplicateProductIdentity, "insert").conflict_items.some((conflict) => {
  return conflict.conflict_type === "INSERT_COLLIDES_WITH_PRODUCT_IDENTITY" && conflict.resolved === true;
}));

const duplicateOnlyInsertDropped = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2025-26", source: "CARD_BACK", confidence: 0.94 },
    { field: "product", value: "Prizm FIFA Soccer", source: "CARD_BACK", confidence: 0.94 },
    { field: "set", value: "Club Legends", source: "CARD_BACK", confidence: 0.94 },
    { field: "players", value: "Lionel Messi", source: "CARD_FRONT", confidence: 0.94 },
    { field: "insert", value: "Club Legends", source: "CARD_BACK", confidence: 0.94 }
  ]
});
assert.equal(duplicateOnlyInsertDropped.identity.insert, null);
assert.equal(duplicateOnlyInsertDropped.identity.set, "Club Legends");
assert.equal(duplicateOnlyInsertDropped.status, "RESOLVED");
assert.equal(fieldState(duplicateOnlyInsertDropped, "insert").decision_route, "DROP");

const cardDesignSeasonOverridesSlabYear = resolveIdentity({
  evidenceItems: [
    { field: "year", value: "2025-26", source: "CARD_BACK", confidence: 0.96 },
    { field: "year", value: "2025", source: "SLAB", confidence: 0.98 },
    { field: "product", value: "Topps Chrome Basketball", source: "CARD_BACK", confidence: 0.96 },
    { field: "players", value: "Cooper Flagg", source: "CARD_FRONT", confidence: 0.96 }
  ]
});
assert.equal(cardDesignSeasonOverridesSlabYear.identity.year, "2025-26");
assert.equal(fieldState(cardDesignSeasonOverridesSlabYear, "year").resolution_reason, "card_design_override_label_or_inference_conflict");

const officialCardTypeBeatsGenericInference = resolveIdentity({
  evidenceItems: [
    ...baseAnchors,
    { field: "card_type", value: "Dual Signatures", source: "CARD_FRONT", confidence: 0.94 },
    { field: "card_type", value: "Dual Auto", source: "AGNES", confidence: 0.94 }
  ]
});
assert.equal(officialCardTypeBeatsGenericInference.identity.card_type, "Dual Signatures");
assert.equal(fieldState(officialCardTypeBeatsGenericInference, "card_type").resolution_reason, "card_design_override_label_or_inference_conflict");

const unicodeCharacterEvidence = resolveIdentity({
  evidenceItems: [
    { field: "product", value: "Pokemon Scarlet Violet", source: "CARD_FRONT", confidence: 0.9 },
    { field: "character", value: "琉琪亚的展现", source: "CARD_FRONT", confidence: 0.9 },
    { field: "collector_number", value: "257/208", source: "CARD_FRONT", confidence: 0.9 }
  ],
  options: {
    criticalFields: ["product", "character", "collector_number"]
  }
});
assert.equal(unicodeCharacterEvidence.identity.character, "琉琪亚的展现");
assert.equal(fieldState(unicodeCharacterEvidence, "character").resolution_reason, "highest_scoring_candidate");

const identityConstraintScore = validateIdentity({
  serial_number: "51/50"
});
assert.equal(identityConstraintScore[0].conflict_type, "SERIAL_CONSTRAINT_VIOLATION");
assert.equal(identityConstraintScore[0].rule_weight, 1);
assert.equal(identityConstraintScore[0].score_penalty, 1);
assert.equal(identityConstraintScore[0].identity_constraint_score, 0);
assert.ok(identityConstraintScore[0].evaluated_rules.some((rule) => rule.code === "serial_constraint_violation"));

let convergenceRetrievalCalls = 0;
const convergedSerial = await resolveIdentityWithConvergence({
  evidenceItems: [
    ...baseAnchors,
    { field: "serial_number", value: "31/50", source: "OCR_ONLY", confidence: 0.91 },
    { field: "serial_number", value: "37/50", source: "OCR", confidence: 0.9 }
  ],
  options: {
    convergence: {
      maxIterations: 2
    }
  },
  retrieveEvidence: async (request) => {
    convergenceRetrievalCalls += 1;
    assert.equal(request.status, "ABSTAIN");
    assert.ok(request.unresolved_fields.includes("serial_number"));
    return {
      evidenceItems: [
        { field: "serial_number", value: "31/50", source: "SLAB", confidence: 0.98 }
      ]
    };
  }
});
assert.equal(convergenceRetrievalCalls, 1);
assert.equal(convergedSerial.identity.serial_number, "31/50");
assert.equal(convergedSerial.status, "RESOLVED");
assert.equal(convergedSerial.convergence.enabled, true);
assert.equal(convergedSerial.convergence.converged, true);
assert.equal(convergedSerial.convergence_report.loop, "detect_conflict_retrieve_reevaluate_converge");
assert.deepEqual(convergedSerial.convergence_report.phase_sequence, ["detect_conflict", "retrieve", "re_evaluate", "converge"]);
assert.equal(convergedSerial.convergence_report.retrieval_attempts, 1);
assert.ok(convergedSerial.convergence_trace.some((entry) => entry.step === "detect_conflict"));
assert.ok(convergedSerial.convergence_trace.some((entry) => entry.step === "retrieve"));
assert.ok(convergedSerial.convergence_trace.some((entry) => entry.step === "re_evaluate"));
assert.ok(convergedSerial.convergence_trace.some((entry) => entry.step === "converged"));
assert.equal(fieldState(convergedSerial, "serial_number").resolution_reason, "slab_override_ocr_conflict");

console.log("identity resolution tests passed");
