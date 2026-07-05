import assert from "node:assert/strict";
import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields
} from "../lib/listing/evidence/evidence-schema.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";
import {
  applyIdentityResolutionGate,
  applyIdentityResolutionGateWithConvergence,
  criticalFieldsForIdentityResolution,
  evidenceDocumentToIdentityEvidenceItems
} from "../lib/identity-resolution/listing-resolution-gate.mjs";

function printedSource(sourceType, side, observedText) {
  return {
    source_type: sourceType,
    side,
    observed_text: observedText,
    trust_tier: 1
  };
}

function groundedEvidence(value) {
  return createEvidenceField({
    value,
    status: "CONFIRMED",
    confidence: 0.96,
    sources: [
      printedSource("CARD_FRONT", "front", Array.isArray(value) ? value.join(" / ") : value),
      printedSource("CARD_BACK", "back", Array.isArray(value) ? value.join(" / ") : value)
    ]
  });
}

function frontOnlyEvidence(value) {
  return createEvidenceField({
    value,
    status: "CONFIRMED",
    confidence: 0.96,
    sources: [
      printedSource("CARD_FRONT", "front", Array.isArray(value) ? value.join(" / ") : value)
    ]
  });
}

function visionOnlyEvidence(value) {
  return createEvidenceField({
    value,
    status: "CONFIRMED",
    confidence: 0.96,
    sources: [
      createVisionSource({ observedText: Array.isArray(value) ? value.join(" / ") : value })
    ]
  });
}

function modelInferenceEvidence(value) {
  return createEvidenceField({
    value,
    status: "CONFIRMED",
    confidence: 0.96,
    sources: [
      {
        source_type: "MODEL_INFERENCE",
        observed_text: Array.isArray(value) ? value.join(" / ") : value,
        trust_tier: 7
      }
    ]
  });
}

const modelInferenceOnly = applyIdentityResolutionGate({
  title: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50",
  model_title_suggestion: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50",
  confidence: "HIGH",
  reason: "Provider inferred card identity from the image.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Gold Refractor",
    serial_number: "31/50"
  }),
  evidence: {
    year: createEvidenceField({
      value: "2024",
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [{ source_type: "MODEL_INFERENCE", observed_text: "2024", trust_tier: 7 }]
    }),
    product: modelInferenceEvidence("Topps Chrome"),
    players: modelInferenceEvidence(["Shohei Ohtani"])
  },
  unresolved: []
});
assert.equal(modelInferenceOnly.identity_resolution_status, "ABSTAIN");
assert.equal(modelInferenceOnly.final_title, "2024 Topps Chrome Shohei Ohtani");
assert.equal(modelInferenceOnly.title_render_source, "identity_resolution_partial_writer_draft");
assert.equal(modelInferenceOnly.publication_gate.auto_publish_allowed, false);
assert.equal(modelInferenceOnly.publication_gate.writer_review_ready, true);
assert.equal(modelInferenceOnly.publication_gate.workflow_route, "DEEP_REVIEW");
assert.deepEqual(modelInferenceOnly.publication_gate.writer_required_fields.sort(), ["parallel", "serial_number", "year"]);
assert.equal(modelInferenceOnly.draft_gate.by_field.year.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(modelInferenceOnly.draft_gate.by_field.year.requires_writer_confirmation, true);
assert.equal(modelInferenceOnly.accuracy_governor.enabled, true);
assert.ok(modelInferenceOnly.accuracy_governor.risk_flags.some((flag) => {
  return flag.field === "year" && flag.critical === true;
}));
assert.ok(modelInferenceOnly.unresolved.includes("identity resolution requires writer review before upload"));
assert.equal(modelInferenceOnly.model_title_suggestion, "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50");

const nonSlabGradeIsCandidateOnly = applyIdentityResolutionGate({
  title: "2024 Topps Chrome Shohei Ohtani PSA 10",
  confidence: "HIGH",
  reason: "Model inferred a grade from the image, but no slab label evidence exists.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    grade_company: visionOnlyEvidence("PSA"),
    card_grade: visionOnlyEvidence("10"),
    grade_type: visionOnlyEvidence("CARD_ONLY")
  },
  unresolved: []
});
assert.match(nonSlabGradeIsCandidateOnly.final_title, /\bPSA 10\b/);
assert.equal(nonSlabGradeIsCandidateOnly.draft_gate.by_field.grade_company.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(nonSlabGradeIsCandidateOnly.draft_gate.by_field.card_grade.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(nonSlabGradeIsCandidateOnly.draft_gate.by_field.grade_company.requires_writer_confirmation, true);
assert.ok(nonSlabGradeIsCandidateOnly.publication_gate.writer_required_fields.includes("grade_company"));
assert.ok(!nonSlabGradeIsCandidateOnly.accuracy_governor.high_risk_fields_omitted_from_title.includes("grade_company"));

const cardNamePreservedThroughIdentityGate = applyIdentityResolutionGate({
  title: "2018-19 Panini Status Trae Young New Breed 20/99 PSA 10",
  confidence: "HIGH",
  reason: "Front and back images support the product, subject and New Breed card name.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2018-19",
    manufacturer: "Panini",
    product: "Status Basketball",
    players: ["Trae Young"],
    card_name: "New Breed",
    serial_number: "20/99",
    numerical_rarity: "20/99",
    rc: true,
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  }),
  evidence: {
    year: groundedEvidence("2018-19"),
    manufacturer: groundedEvidence("Panini"),
    product: groundedEvidence("Status Basketball"),
    players: groundedEvidence(["Trae Young"]),
    card_name: frontOnlyEvidence("New Breed"),
    serial_number: frontOnlyEvidence("20/99"),
    numerical_rarity: frontOnlyEvidence("20/99"),
    rc: frontOnlyEvidence(true),
    grade_company: visionOnlyEvidence("PSA"),
    card_grade: visionOnlyEvidence("10"),
    grade_type: visionOnlyEvidence("CARD_ONLY")
  },
  unresolved: []
}, {
  maxLength: 85
});
assert.ok(cardNamePreservedThroughIdentityGate.identity_resolution.field_states.some((field) => field.field === "card_name"));
assert.match(cardNamePreservedThroughIdentityGate.final_title, /\bStatus\b/i);
assert.match(cardNamePreservedThroughIdentityGate.final_title, /\bNew Breed\b/i);
assert.match(cardNamePreservedThroughIdentityGate.final_title, /20\/99/);
assert.doesNotMatch(cardNamePreservedThroughIdentityGate.final_title, /#\/99/);
assert.ok(nonSlabGradeIsCandidateOnly.publication_gate.writer_required_fields.includes("grade_company"));

const visualExactParallelKeepsNarrowColorOnly = applyIdentityResolutionGate({
  title: "2024 Topps Chrome Shohei Ohtani Purple Wave Refractor",
  confidence: "HIGH",
  reason: "Model saw a purple surface but exact taxonomy is not printed or catalog-backed.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Purple Wave Refractor"
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    parallel: visionOnlyEvidence("Purple Wave Refractor")
  },
  unresolved: []
});
assert.match(visualExactParallelKeepsNarrowColorOnly.final_title, /\bPurple\b/);
assert.doesNotMatch(visualExactParallelKeepsNarrowColorOnly.final_title, /Purple Wave Refractor/i);
assert.equal(visualExactParallelKeepsNarrowColorOnly.draft_gate.by_field.parallel.selected_value, "Purple");
assert.equal(visualExactParallelKeepsNarrowColorOnly.draft_gate.by_field.parallel.accuracy_governor_action, "KEEP_NARROW_SAFE_VALUE");

function primaryFastVisionResult({
  resolved,
  evidence,
  verificationFields = [],
  trace = []
}) {
  return applyIdentityResolutionGate({
    title: "",
    model_title_suggestion: "",
    confidence: "HIGH",
    reason: "GPT primary fast vision extracted compact evidence.",
    provider: "cascade_fast",
    source: "openai_legacy",
    resolved: normalizeResolvedFields(resolved),
    evidence,
    unresolved: [],
    fast_vision_policy: {
      role: "PRIMARY_FAST_VISION",
      allow_single_source_publish: true,
      secondary_verification_required_fields: verificationFields
    },
    resolution_trace: trace
  }, {
    providerId: "primary_fast_vision"
  });
}

const gptVisionItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: visionOnlyEvidence("2025")
  }
}, {
  providerId: "openai_vector"
});
assert.equal(gptVisionItems[0].source, "PRIMARY_FAST_VISION");

const primaryFastVisionItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: visionOnlyEvidence("2025")
  }
}, {
  providerId: "primary_fast_vision"
});
assert.equal(primaryFastVisionItems[0].source, "PRIMARY_FAST_VISION");

const modelInferenceItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: modelInferenceEvidence("2025")
  }
}, {
  providerId: "legacy_removed_provider"
});
assert.equal(modelInferenceItems[0].source, "MODEL_INFERENCE");

const exactVisualVectorItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: createEvidenceField({
      value: "2025-26",
      confidence: 0.85,
      sources: [
        {
          source_type: "VISUAL_VECTOR",
          visual_similarity: 1,
          visual_margin_to_next: 0.26,
          title: "2025-26 Topps Chrome Victor Wembanyama Gold Refractor 17/50"
        }
      ]
    })
  }
});
assert.equal(exactVisualVectorItems[0].source, "STRUCTURED_DATABASE");
assert.equal(exactVisualVectorItems[0].metadata.original_source, "VISUAL_VECTOR");

const nearVisualVectorItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: createEvidenceField({
      value: "2025-26",
      confidence: 0.85,
      sources: [
        {
          source_type: "VISUAL_VECTOR",
          visual_similarity: 0.9,
          visual_margin_to_next: 0.04
        }
      ]
    })
  }
});
assert.equal(nearVisualVectorItems[0].source, "VISUAL_GUESS");

const multiCandidateSourceBindingItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    year: createEvidenceField({
      value: "2025-26",
      confidence: 0.85,
      candidates: [
        { value: "2024", confidence: 0.42 },
        { value: "2025-26", confidence: 0.85 }
      ],
      sources: [
        {
          source_type: "VISUAL_VECTOR",
          visual_similarity: 1,
          visual_margin_to_next: 0.26
        }
      ]
    })
  }
});
const sourceByValue = Object.fromEntries(multiCandidateSourceBindingItems.map((item) => [item.value, item.source]));
assert.equal(sourceByValue["2024"], "VISUAL_GUESS");
assert.equal(sourceByValue["2025-26"], "STRUCTURED_DATABASE");

const sourceTextCandidateBindingItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: {
    product: createEvidenceField({
      value: "Topps Sapphire",
      confidence: 0.58,
      candidates: [
        { value: "Topps Sapphire", confidence: 0.99 },
        { value: "Topps Chrome Sapphire", confidence: 0.86 }
      ],
      sources: [
        {
          source_type: "SLAB_LABEL",
          observed_text: "2025 TOPPS SAPPHIRE"
        },
        {
          source_type: "VISUAL_VECTOR",
          visual_similarity: 1,
          visual_margin_to_next: 0.23,
          title: "2025 Topps Chrome Sapphire Shohei Ohtani Variation-Gold 05/50 PSA 9"
        }
      ]
    })
  }
});
const productSourcesByValue = Object.fromEntries(sourceTextCandidateBindingItems.map((item) => [item.value, item.source]));
assert.equal(productSourcesByValue["Topps Sapphire"], "SLAB_LABEL");
assert.equal(productSourcesByValue["Topps Chrome Sapphire"], "STRUCTURED_DATABASE");

const fastVisionNoRisk = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"]
  },
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"])
  }
});
assert.equal(fastVisionNoRisk.identity_resolution_status, "RESOLVED");
assert.equal(fastVisionNoRisk.publication_gate.auto_publish_allowed, false);
assert.equal(fastVisionNoRisk.publication_gate.writer_review_ready, true);
assert.deepEqual(fastVisionNoRisk.writer_required_fields, ["year"]);
assert.match(fastVisionNoRisk.final_title, /Topps Chrome/);
assert.equal(fastVisionNoRisk.publication_gate.identity_gate_status, "CORE_RESOLVED");
assert.equal(fastVisionNoRisk.publication_gate.workflow_route, "STANDARD_REVIEW");
assert.equal(fastVisionNoRisk.publication_gate.field_publication_states.year, "REVIEW_REQUIRED");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.mode, "PARTIAL_WRITER_DRAFT");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.publishable_fields.product.value, "Topps Chrome");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.publishable_fields.product.publishability, "PUBLISHABLE_NARROW");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.review_required_fields[0].field, "year");
assert.equal(fastVisionNoRisk.draft_gate.by_field.year.display_policy, "INCLUDE_HIGHLIGHTED");
assert.match(fastVisionNoRisk.final_title, /2024/);
assert.ok(fastVisionNoRisk.accuracy_governor.risk_flags.some((flag) => {
  return flag.field === "year" && flag.critical === true;
}));
assert.ok(fastVisionNoRisk.conflict_map.every((conflict) => {
  return conflict.conflict_type !== "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE" || conflict.resolved === true;
}));

const fastVisionYearWithAuthoritativeBack = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"]
  },
  evidence: {
    year: groundedEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"])
  }
});
assert.equal(fastVisionYearWithAuthoritativeBack.identity_resolution_status, "RESOLVED");
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.auto_publish_allowed, false);
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.model_auto_publish_recommended, false);
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.model_quick_review_recommended, true);
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.writer_quick_approval_ready, true);
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.workflow_route, "LOW_TOUCH_REVIEW");
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.human_approval_required, true);
assert.equal(fastVisionYearWithAuthoritativeBack.publication_gate.upload_blocked_until_writer_approval, true);
assert.match(fastVisionYearWithAuthoritativeBack.final_title, /2024/);

const fastVisionSurfaceColorWithoutCatalog = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    surface_color: "Purple"
  },
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"]),
    surface_color: visionOnlyEvidence("Purple")
  }
});
assert.equal(fastVisionSurfaceColorWithoutCatalog.identity_resolution_status, "RESOLVED");
assert.equal(fastVisionSurfaceColorWithoutCatalog.publication_gate.auto_publish_allowed, false);
assert.equal(fastVisionSurfaceColorWithoutCatalog.publication_gate.writer_review_ready, true);
assert.equal(fastVisionSurfaceColorWithoutCatalog.publication_gate.field_publication_states.surface_color, "PUBLISHABLE_NARROW");
assert.ok(!fastVisionSurfaceColorWithoutCatalog.writer_required_fields.includes("surface_color"));
assert.ok(fastVisionSurfaceColorWithoutCatalog.writer_required_fields.includes("year"));

const fastVisionExactParallelWithoutCatalog = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Purple Wave Refractor"
  },
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"]),
    parallel: visionOnlyEvidence("Purple Wave Refractor")
  }
});
assert.equal(fastVisionExactParallelWithoutCatalog.identity_resolution_status, "RESOLVED");
assert.equal(fastVisionExactParallelWithoutCatalog.publication_gate.auto_publish_allowed, false);
assert.equal(fastVisionExactParallelWithoutCatalog.publication_gate.writer_review_ready, true);
assert.equal(fastVisionExactParallelWithoutCatalog.publication_gate.partial_writer_draft, true);
assert.deepEqual([...fastVisionExactParallelWithoutCatalog.writer_required_fields].sort(), ["parallel", "year"]);
assert.equal(fastVisionExactParallelWithoutCatalog.publication_gate.field_publication_states.parallel, "REVIEW_REQUIRED");
assert.match(fastVisionExactParallelWithoutCatalog.final_title, /\bPurple\b/i);
assert.doesNotMatch(fastVisionExactParallelWithoutCatalog.final_title, /Wave|Refractor/i);
assert.equal(fastVisionExactParallelWithoutCatalog.draft_gate.by_field.parallel.selected_value, "Purple");
assert.equal(fastVisionExactParallelWithoutCatalog.draft_gate.by_field.parallel.display_policy, "INCLUDE_HIGHLIGHTED");
assert.ok(fastVisionExactParallelWithoutCatalog.publication_gate.writer_review_items.some((item) => {
  return item.field === "parallel"
    && item.current_value === "Purple Wave Refractor"
    && item.publishability === "REVIEW_REQUIRED"
    && item.resolution_reason === "catalog_required_for_exact_taxonomy";
}));

const fastVisionSerialWithoutFocusedVerification = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  },
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"]),
    serial_number: visionOnlyEvidence("31/50")
  },
  verificationFields: ["serial_number"]
});
assert.equal(fastVisionSerialWithoutFocusedVerification.identity_resolution_status, "ABSTAIN");
assert.equal(fastVisionSerialWithoutFocusedVerification.final_title, "2024 Topps Chrome Shohei Ohtani");
assert.equal(fastVisionSerialWithoutFocusedVerification.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(fastVisionSerialWithoutFocusedVerification.writer_required_fields, ["year", "serial_number"]);
assert.doesNotMatch(fastVisionSerialWithoutFocusedVerification.final_title, /31\/50/);
assert.doesNotMatch(fastVisionSerialWithoutFocusedVerification.final_title, /\/50/);
assert.equal(fastVisionSerialWithoutFocusedVerification.draft_gate.by_field.serial_number.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(fastVisionSerialWithoutFocusedVerification.draft_gate.by_field.serial_number.selected_value, "/50");

const fastVisionSerialWithFocusedVerification = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  },
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"]),
    serial_number: visionOnlyEvidence("31/50")
  },
  verificationFields: ["serial_number"],
  trace: [
    {
      action: "CROP_AND_READ_SERIAL",
      status: "executed",
      output: {
        focused_vision: {
          focus_fields: ["serial_number"],
          updated_fields: ["serial_number"],
          conflicting_fields: []
        }
      }
    }
  ]
});
assert.equal(fastVisionSerialWithFocusedVerification.identity_resolution_status, "RESOLVED");
assert.doesNotMatch(fastVisionSerialWithFocusedVerification.final_title, /\/50/);

const visualOnlyGradeRequiresReview = primaryFastVisionResult({
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  evidence: {
    year: groundedEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"]),
    grade_company: visionOnlyEvidence("PSA"),
    card_grade: visionOnlyEvidence("10"),
    grade_type: visionOnlyEvidence("CARD_ONLY")
  }
});
assert.equal(visualOnlyGradeRequiresReview.publication_gate.field_publication_states.grade_company, "REVIEW_REQUIRED");
assert.equal(visualOnlyGradeRequiresReview.publication_gate.field_publication_states.card_grade, "REVIEW_REQUIRED");
assert.ok(visualOnlyGradeRequiresReview.writer_required_fields.includes("grade_company"));
assert.match(visualOnlyGradeRequiresReview.final_title, /\bPSA 10\b/);
assert.equal(visualOnlyGradeRequiresReview.draft_gate.by_field.grade_company.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(visualOnlyGradeRequiresReview.draft_gate.by_field.card_grade.display_policy, "INCLUDE_HIGHLIGHTED");
assert.equal(visualOnlyGradeRequiresReview.draft_gate.by_field.grade_company.requires_writer_confirmation, true);
assert.ok(!visualOnlyGradeRequiresReview.accuracy_governor.high_risk_fields_omitted_from_title.includes("grade_company"));

const groundedMultiView = applyIdentityResolutionGate({
  title: "provider title must not decide final facts",
  confidence: "HIGH",
  reason: "Provider result should be replaced by deterministic renderer.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    serial_number: groundedEvidence("31/50")
  },
  unresolved: []
});
assert.equal(groundedMultiView.identity_resolution_status, "CONFIRMED");
assert.match(groundedMultiView.final_title, /2024/);
assert.match(groundedMultiView.final_title, /Topps Chrome/);
assert.match(groundedMultiView.final_title, /Shohei Ohtani/);
// Grounded (printed front+back) current-card serial backfills the exact print
// run when the provider omitted numerical_rarity. Reference/catalog candidates
// still cannot contribute a numerator.
assert.match(groundedMultiView.final_title, /31\/50/);
assert.doesNotMatch(groundedMultiView.final_title, /#\/50/);
assert.equal(groundedMultiView.title_render_source, "identity_resolution_deterministic_renderer");
assert.notEqual(groundedMultiView.final_title, "provider title must not decide final facts");

const marketplaceOnly = applyIdentityResolutionGate({
  title: "marketplace title must not become final truth",
  confidence: "HIGH",
  reason: "Marketplace candidate matched.",
  provider: "openai_legacy",
  resolved: {},
  evidence: {},
  unresolved: []
}, {
  retrievalCandidates: [
    {
      source_type: "MARKETPLACE",
      title: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50",
      confidence: 0.99,
      fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Shohei Ohtani"],
        serial_number: "31/50"
      }
    }
  ]
});
assert.equal(marketplaceOnly.identity_resolution_status, "ABSTAIN");
assert.equal(marketplaceOnly.final_title, "");
assert.ok(marketplaceOnly.conflict_graph.nodes.some((node) => node.type === "MARKETPLACE_RESULT"));

const identityItems = evidenceDocumentToIdentityEvidenceItems({
  evidence: groundedMultiView.evidence
});
assert.ok(identityItems.some((item) => item.source === "CARD_FRONT"));
assert.ok(identityItems.some((item) => item.source === "CARD_BACK"));

const providerInvariantInput = {
  title: "2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "Same evidence should gate the same way regardless of raw model provider.",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"]
  }),
  evidence: {
    year: visionOnlyEvidence("2024"),
    product: visionOnlyEvidence("Topps Chrome"),
    players: visionOnlyEvidence(["Shohei Ohtani"])
  },
  unresolved: []
};
const providerInvariantPrimaryFast = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "primary_fast_vision"
}, {
  providerId: "primary_fast_vision"
});
const providerInvariantGpt = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "openai_legacy"
}, {
  providerId: "openai_legacy"
});
const providerInvariantRemoved = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "openai_legacy"
}, {
  providerId: "removed_legacy_provider"
});
assert.equal(providerInvariantPrimaryFast.identity_resolution_status, providerInvariantGpt.identity_resolution_status);
assert.equal(providerInvariantPrimaryFast.identity_resolution_status, providerInvariantRemoved.identity_resolution_status);
assert.deepEqual(providerInvariantPrimaryFast.writer_required_fields.sort(), providerInvariantGpt.writer_required_fields.sort());
assert.deepEqual(providerInvariantPrimaryFast.writer_required_fields.sort(), providerInvariantRemoved.writer_required_fields.sort());
assert.equal(providerInvariantPrimaryFast.final_title, providerInvariantGpt.final_title);
assert.equal(providerInvariantPrimaryFast.final_title, providerInvariantRemoved.final_title);

function structuredHighRiskProviderResult(provider) {
  const evidenceDocument = providerPayloadToEvidenceDocument({
    title: "",
    confidence: "HIGH",
    fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Test Player"],
      grade_company: "PSA",
      card_grade: "10",
      grade_type: "CARD_ONLY",
      rc: true,
      auto: true
    },
    field_evidence: {
      year: {
        value: "2024",
        support_type: "VISION_ONLY",
        visible_text: "2024",
        confidence: 0.82,
        review_required: true
      },
      grade: {
        grade_company: "PSA",
        card_grade: "10",
        grade_type: "CARD_ONLY",
        support_type: "SLAB_LABEL",
        evidence_kind: "GRADE_LABEL",
        visible_text: "PSA GEM MT 10",
        confidence: 0.96,
        review_required: false
      },
      rc: {
        value: true,
        support_type: "CARD_FRONT_PRINTED_TEXT",
        evidence_kind: "RC_LOGO",
        visible_text: "RC",
        visible_marker: true,
        confidence: 0.9,
        review_required: false
      },
      auto: {
        value: true,
        support_type: "VISIBLE_SIGNATURE",
        evidence_kind: "SIGNATURE",
        signature_visible: true,
        confidence: 0.86,
        review_required: false
      }
    },
    unresolved: []
  }, {
    images: [{ id: "image-front", side: "front" }]
  });
  return applyIdentityResolutionGate({
    title: "",
    model_title_suggestion: "",
    confidence: "HIGH",
    reason: "Structured field evidence should control year, grade, RC, and auto decisions.",
    provider,
    resolved: evidenceDocument.resolved,
    evidence: evidenceDocument.evidence,
    unresolved: evidenceDocument.unresolved
  }, {
    providerId: provider
  });
}

const structuredPrimaryFastGate = structuredHighRiskProviderResult("primary_fast_vision");
const structuredGptGate = structuredHighRiskProviderResult("openai_legacy");
assert.equal(structuredPrimaryFastGate.publication_gate.field_publication_states.year, "REVIEW_REQUIRED");
assert.equal(structuredPrimaryFastGate.publication_gate.field_publication_states.grade_company, "PUBLISHABLE_EXACT");
assert.equal(structuredPrimaryFastGate.publication_gate.field_publication_states.card_grade, "PUBLISHABLE_EXACT");
assert.equal(structuredPrimaryFastGate.publication_gate.field_publication_states.rc, "PUBLISHABLE_EXACT");
assert.equal(structuredPrimaryFastGate.publication_gate.field_publication_states.auto, "PUBLISHABLE_NARROW");
assert.deepEqual(structuredPrimaryFastGate.writer_required_fields, ["year"]);
assert.deepEqual(structuredPrimaryFastGate.writer_required_fields, structuredGptGate.writer_required_fields);
assert.equal(structuredPrimaryFastGate.final_title, structuredGptGate.final_title);

const observedMultiSubjectWriterDraft = applyIdentityResolutionGate({
  title: "",
  model_title_suggestion: "",
  confidence: "HIGH",
  reason: "Provider saw a triple-subject card, but the resolved hint only retained one subject.",
  provider: "cascade_fast",
  raw_provider_fields: {
    players: ["Hank Aaron", "Ken Griffey Jr.", "Mike Trout"]
  },
  resolved: normalizeResolvedFields({
    year: "2020",
    product: "Topps Triple Threads",
    set: "Historic Ties",
    players: ["Mike Trout"],
    card_type: "Autograph Relic",
    insert: "Triple Autograph Relic",
    auto: true
  }),
  evidence: {
    year: visionOnlyEvidence("2020"),
    product: groundedEvidence("Topps Triple Threads"),
    set: groundedEvidence("Historic Ties"),
    players: visionOnlyEvidence(["Mike Trout"]),
    card_type: groundedEvidence("Autograph Relic"),
    insert: groundedEvidence("Triple Autograph Relic"),
    auto: groundedEvidence(true)
  },
  unresolved: []
}, {
  maxLength: 140,
  providerId: "primary_fast_vision"
});
assert.equal(observedMultiSubjectWriterDraft.publication_gate.writer_review_ready, true);
assert.deepEqual(observedMultiSubjectWriterDraft.resolved.players, ["Mike Trout", "Hank Aaron", "Ken Griffey Jr."]);
assert.deepEqual(observedMultiSubjectWriterDraft.identity_resolution.identity.players, ["Mike Trout", "Hank Aaron", "Ken Griffey Jr."]);
assert.deepEqual(
  observedMultiSubjectWriterDraft.field_states.find((fieldState) => fieldState.field === "players")?.resolved_value,
  ["Mike Trout", "Hank Aaron", "Ken Griffey Jr."]
);
assert.match(observedMultiSubjectWriterDraft.final_title, /Hank Aaron/);
assert.match(observedMultiSubjectWriterDraft.final_title, /Ken Griffey Jr/);
assert.match(observedMultiSubjectWriterDraft.final_title, /Mike Trout/);

const compatibleProductConflictDraft = applyIdentityResolutionGate({
  title: "",
  model_title_suggestion: "",
  confidence: "HIGH",
  reason: "Product conflict is a same-family granularity issue and serial is a single direct low-confidence read.",
  provider: "cascade_fast",
  resolved: normalizeResolvedFields({
    year: "2025",
    manufacturer: "Topps",
    brand: "Topps Sapphire",
    product: "Topps Chrome Sapphire",
    players: ["Shohei Ohtani"],
    insert: "Variation-Gold",
    parallel: "Gold",
    serial_number: "05/50",
    numerical_rarity: "05/50",
    collector_number: "1",
    grade_company: "PSA",
    card_grade: "9",
    grade_type: "CARD_ONLY"
  }),
  evidence: {
    year: groundedEvidence("2025"),
    manufacturer: groundedEvidence("Topps"),
    brand: createEvidenceField({
      value: "Topps Sapphire",
      status: "CONFLICT",
      confidence: 0.78,
      candidates: [
        { value: "Topps Sapphire", confidence: 0.78 },
        { value: "Topps", confidence: 0.77 }
      ],
      sources: [{ source_type: "SLAB_LABEL", observed_text: "2025 TOPPS SAPPHIRE" }],
      conflicts: [{
        field: "brand",
        conflict_type: "PRODUCT_MISMATCH",
        conflicting_values: ["Topps", "Topps Sapphire"],
        severity: "HIGH"
      }]
    }),
    product: createEvidenceField({
      value: "Topps Chrome Sapphire",
      status: "CONFLICT",
      confidence: 0.78,
      candidates: [
        { value: "Topps Chrome Sapphire", confidence: 0.78 },
        { value: "Topps Sapphire", confidence: 0.99 }
      ],
      sources: [{ source_type: "SLAB_LABEL", observed_text: "2025 TOPPS SAPPHIRE" }],
      conflicts: [{
        field: "product",
        conflict_type: "PRODUCT_MISMATCH",
        conflicting_values: ["Topps Sapphire", "Topps Chrome Sapphire"],
        severity: "HIGH"
      }]
    }),
    players: groundedEvidence(["Shohei Ohtani"]),
    insert: groundedEvidence("Variation-Gold"),
    parallel: visionOnlyEvidence("Gold"),
    serial_number: visionOnlyEvidence("05/50"),
    numerical_rarity: visionOnlyEvidence("05/50"),
    collector_number: groundedEvidence("1"),
    grade_company: groundedEvidence("PSA"),
    card_grade: groundedEvidence("9"),
    grade_type: groundedEvidence("CARD_ONLY")
  },
  unresolved: []
}, {
  maxLength: 120,
  providerId: "primary_fast_vision"
});
assert.equal(compatibleProductConflictDraft.publication_gate.writer_review_ready, true);
assert.equal(compatibleProductConflictDraft.publication_gate.draft_gate.by_field.product.selected_value, "Topps Sapphire");
assert.equal(compatibleProductConflictDraft.publication_gate.draft_gate.by_field.product.display_policy, "INCLUDE_NORMAL");
assert.equal(compatibleProductConflictDraft.publication_gate.draft_gate.by_field.serial_number.selected_value, "05/50");
assert.match(compatibleProductConflictDraft.final_title, /Topps Sapphire/i);
assert.match(compatibleProductConflictDraft.final_title, /05\/50/);

const directProductEvidenceBeatsSetFallback = applyIdentityResolutionGate({
  title: "",
  confidence: "HIGH",
  reason: "Direct back text includes product; visual candidate creates product ambiguity.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2025-26",
    manufacturer: "Panini",
    brand: "Prizm",
    product: "Prizm FIFA Soccer",
    set: "Club Legends",
    players: ["Lionel Messi"],
    serial_number: "029/199",
    collector_number: "CL-LM",
    auto: true
  }),
  evidence: {
    year: groundedEvidence("2025-26"),
    manufacturer: groundedEvidence("Panini"),
    brand: createEvidenceField({
      value: "Prizm",
      status: "CONFLICT",
      confidence: 0.58,
      candidates: [
        { value: "Prizm", confidence: 0.99 },
        { value: "Panini", confidence: 0.83 }
      ],
      sources: [printedSource("CARD_FRONT_PRINTED_TEXT", "front", "PRIZM")],
      conflicts: [{
        field: "brand",
        conflict_type: "PRODUCT_MISMATCH",
        conflicting_values: ["Prizm", "Panini"],
        severity: "MEDIUM"
      }]
    }),
    product: createEvidenceField({
      value: "Prizm FIFA Soccer",
      status: "CONFLICT",
      confidence: 0.58,
      candidates: [
        { value: "Prizm FIFA Soccer", confidence: 0.99 },
        { value: "Panini Prizm", confidence: 0.83 }
      ],
      sources: [printedSource("CARD_BACK_PRINTED_TEXT", "back", "2025-26 PANINI - PRIZM FIFA SOCCER")],
      conflicts: [{
        field: "product",
        conflict_type: "PRODUCT_MISMATCH",
        conflicting_values: ["Prizm FIFA Soccer", "Panini Prizm"],
        severity: "MEDIUM"
      }]
    }),
    set: frontOnlyEvidence("Club Legends"),
    players: groundedEvidence(["Lionel Messi"]),
    serial_number: groundedEvidence("029/199"),
    collector_number: groundedEvidence("CL-LM"),
    auto: groundedEvidence(true)
  },
  unresolved: []
}, {
  maxLength: 120,
  providerId: "primary_fast_vision"
});
assert.equal(directProductEvidenceBeatsSetFallback.publication_gate.draft_gate.by_field.product.selected_value, "Prizm FIFA Soccer");
assert.equal(directProductEvidenceBeatsSetFallback.publication_gate.draft_gate.by_field.product.display_policy, "INCLUDE_HIGHLIGHTED");
assert.ok(directProductEvidenceBeatsSetFallback.writer_required_fields.includes("product"));
assert.notEqual(directProductEvidenceBeatsSetFallback.publication_gate.draft_gate.by_field.product.selected_value, "Club Legends");
assert.match(directProductEvidenceBeatsSetFallback.final_title, /Prizm FIFA Soccer/i);
assert.match(directProductEvidenceBeatsSetFallback.final_title, /Club Legends/i);
const directProductState = directProductEvidenceBeatsSetFallback.identity_resolution.field_states.find((state) => state.field === "product");
assert.equal(directProductState.resolved_value, "Prizm FIFA Soccer");
assert.notEqual(directProductEvidenceBeatsSetFallback.publication_gate.draft_gate.by_field.product.selected_value, "Club Legends");

const pokemonCritical = criticalFieldsForIdentityResolution(normalizeResolvedFields({
  product: "Pokemon Scarlet Violet",
  character: "Pikachu"
}), []);
assert.ok(pokemonCritical.includes("year"));
assert.ok(pokemonCritical.includes("product"));
assert.ok(pokemonCritical.includes("character"));
assert.ok(!pokemonCritical.includes("players"));

const parallelCritical = criticalFieldsForIdentityResolution(normalizeResolvedFields({
  year: "2025-26",
  product: "Topps Chrome",
  players: ["Cooper Flagg"],
  parallel: "Purple"
}), []);
assert.ok(parallelCritical.includes("parallel"));

const duplicateVariationLowConfidence = applyIdentityResolutionGate({
  title: "2025 Topps Chrome Sapphire Shohei Ohtani Variation-Gold 05/50 PSA 9",
  confidence: "HIGH",
  reason: "Parallel is slab-supported; variation is a duplicate weak focused read.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2025",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    parallel: "Variation-Gold",
    variation: "Variation-Gold",
    serial_number: "05/50",
    grade_company: "PSA",
    card_grade: "9",
    grade_type: "CARD_ONLY"
  }),
  evidence: {
    year: groundedEvidence("2025"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    parallel: createEvidenceField({
      value: "Variation-Gold",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [{ source_type: "SLAB_LABEL", observed_text: "Variation-Gold" }]
    }),
    variation: createEvidenceField({
      value: "Variation-Gold",
      status: "REVIEW",
      confidence: 0.35
    }),
    serial_number: groundedEvidence("05/50"),
    grade_company: groundedEvidence("PSA"),
    card_grade: groundedEvidence("9"),
    grade_type: groundedEvidence("CARD_ONLY")
  },
  unresolved: []
});
assert.notEqual(duplicateVariationLowConfidence.identity_resolution_status, "ABSTAIN");
assert.match(duplicateVariationLowConfidence.final_title, /Variation-Gold/);

const weakVisualParallelDropsWithoutBlocking = applyIdentityResolutionGate({
  title: "2025-26 Panini Prizm FIFA Club Legends Lionel Messi Auto 029/199",
  confidence: "HIGH",
  reason: "Parallel is weak visual inference, but auto and serial are printed.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2025-26",
    product: "Prizm FIFA Soccer",
    set: "Club Legends",
    players: ["Lionel Messi"],
    card_type: "auto",
    parallel: "Blue Prizm",
    serial_number: "029/199",
    auto: true
  }),
  evidence: {
    year: groundedEvidence("2025-26"),
    product: groundedEvidence("Prizm FIFA Soccer"),
    set: groundedEvidence("Club Legends"),
    players: groundedEvidence(["Lionel Messi"]),
    card_type: groundedEvidence("auto"),
    parallel: createEvidenceField({
      value: "Blue Prizm",
      status: "REVIEW",
      confidence: 0.35
    }),
    serial_number: groundedEvidence("029/199"),
    auto: groundedEvidence(true)
  },
  unresolved: []
});
assert.notEqual(weakVisualParallelDropsWithoutBlocking.identity_resolution_status, "ABSTAIN");
assert.match(weakVisualParallelDropsWithoutBlocking.final_title, /\bBlue\b/i);
assert.doesNotMatch(weakVisualParallelDropsWithoutBlocking.final_title, /Blue Prizm/i);
assert.equal(weakVisualParallelDropsWithoutBlocking.draft_gate.by_field.parallel.selected_value, "Blue");
assert.match(weakVisualParallelDropsWithoutBlocking.final_title, /Auto/i);

const setFallbackSatisfiesProductIdentity = applyIdentityResolutionGate({
  title: "2025 Topps Sapphire Shohei Ohtani Gold 05/50 PSA 9",
  confidence: "HIGH",
  reason: "Product family is ambiguous, but set text is stable.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2025",
    product: "Topps Chrome",
    set: "Topps Sapphire",
    players: ["Shohei Ohtani"],
    parallel: "Gold",
    serial_number: "05/50",
    grade_company: "PSA",
    card_grade: "9",
    grade_type: "CARD_ONLY"
  }),
  evidence: {
    year: groundedEvidence("2025"),
    product: createEvidenceField({
      value: "Topps Chrome",
      status: "CONFLICT",
      confidence: 0.75,
      candidates: [
        { value: "Topps Chrome", confidence: 0.75 },
        { value: "Topps Sapphire", confidence: 0.74 }
      ],
      conflicts: [{
        field: "product",
        conflict_type: "OCR_CONFLICT",
        severity: "HIGH",
        resolved: false
      }]
    }),
    set: groundedEvidence("Topps Sapphire"),
    players: groundedEvidence(["Shohei Ohtani"]),
    parallel: groundedEvidence("Gold"),
    serial_number: groundedEvidence("05/50"),
    grade_company: groundedEvidence("PSA"),
    card_grade: groundedEvidence("9"),
    grade_type: groundedEvidence("CARD_ONLY")
  },
  unresolved: []
});
assert.notEqual(setFallbackSatisfiesProductIdentity.identity_resolution_status, "ABSTAIN");
assert.match(setFallbackSatisfiesProductIdentity.final_title, /Topps Sapphire/);

const missingYear = applyIdentityResolutionGate({
  title: "Topps Chrome Shohei Ohtani 31/50",
  confidence: "HIGH",
  reason: "Year is not visible.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  }),
  evidence: {
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    serial_number: groundedEvidence("31/50")
  },
  unresolved: []
});
assert.equal(missingYear.identity_resolution_status, "ABSTAIN");
assert.equal(missingYear.final_title, "Topps Chrome Shohei Ohtani 31/50");
assert.equal(missingYear.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(missingYear.writer_required_fields, ["year"]);
assert.ok(missingYear.unresolved.some((item) => /identity year/i.test(item)));

const serialFocusedFailure = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Initial serial read exists, but focused reread could not verify serial.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2022",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  }),
  evidence: {
    year: groundedEvidence("2022"),
    product: groundedEvidence("Gold Standard"),
    players: groundedEvidence(["Hunter Renfrow"]),
    serial_number: groundedEvidence("196/299")
  },
  unresolved: [],
  resolution_trace: [
    {
      action: "CROP_AND_READ_SERIAL",
      status: "no_information"
    }
  ]
});
assert.equal(serialFocusedFailure.identity_resolution_status, "ABSTAIN");
assert.equal(serialFocusedFailure.final_title, "2022 Gold Standard Hunter Renfrow");
assert.equal(serialFocusedFailure.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialFocusedFailure.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialFocusedFailure.final_title, /196\/299/);
assert.doesNotMatch(serialFocusedFailure.final_title, /\/299/);
assert.equal(serialFocusedFailure.draft_gate.by_field.serial_number.selected_value, "/299");
assert.ok(serialFocusedFailure.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_FOCUSED_VERIFICATION_FAILED"));
assert.ok(serialFocusedFailure.resolution_trace.some((entry) => entry.step === "high_risk_verification_guard"));

const serialSingleFrontSource = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Focused serial reread repeated one front-image serial value.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2022",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  }),
  evidence: {
    year: groundedEvidence("2022"),
    product: groundedEvidence("Gold Standard"),
    players: groundedEvidence(["Hunter Renfrow"]),
    serial_number: frontOnlyEvidence("196/299")
  },
  unresolved: [],
  resolution_trace: [
    {
      action: "CROP_AND_READ_SERIAL",
      status: "executed"
    }
  ]
});
assert.equal(serialSingleFrontSource.identity_resolution_status, "ABSTAIN");
assert.equal(serialSingleFrontSource.final_title, "2022 Gold Standard Hunter Renfrow");
assert.equal(serialSingleFrontSource.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialSingleFrontSource.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialSingleFrontSource.final_title, /196\/299/);
assert.doesNotMatch(serialSingleFrontSource.final_title, /\/299/);
assert.ok(serialSingleFrontSource.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

const serialDoubleFrontSource = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Initial read and focused serial crop agree on the same serial.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2022",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  }),
  evidence: {
    year: groundedEvidence("2022"),
    product: groundedEvidence("Gold Standard"),
    players: groundedEvidence(["Hunter Renfrow"]),
    serial_number: createEvidenceField({
      value: "196/299",
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [
        printedSource("CARD_FRONT", "front", "196/299"),
        { ...printedSource("CARD_FRONT", "front", "196/299"), capture_role: "focused_reread", region: "CROP_AND_READ_SERIAL" }
      ]
    })
  },
  unresolved: [],
  resolution_trace: [
    {
      action: "CROP_AND_READ_SERIAL",
      status: "executed"
    }
  ]
});
assert.equal(serialDoubleFrontSource.identity_resolution_status, "ABSTAIN");
assert.equal(serialDoubleFrontSource.final_title, "2022 Gold Standard Hunter Renfrow");
assert.equal(serialDoubleFrontSource.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialDoubleFrontSource.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialDoubleFrontSource.final_title, /196\/299/);
assert.doesNotMatch(serialDoubleFrontSource.final_title, /\/299/);
assert.ok(serialDoubleFrontSource.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

const serialFocusedVisionConfirmed = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Focused serial crop confirmed the same serial.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2022",
    product: "Gold Standard",
    players: ["Hunter Renfrow"],
    serial_number: "196/299"
  }),
  evidence: {
    year: groundedEvidence("2022"),
    product: groundedEvidence("Gold Standard"),
    players: groundedEvidence(["Hunter Renfrow"]),
    serial_number: frontOnlyEvidence("196/299")
  },
  unresolved: [],
  resolution_trace: [
    {
      action: "CROP_AND_READ_SERIAL",
      status: "executed",
      output: {
        focused_vision: {
          focus_fields: ["serial_number"],
          updated_fields: ["serial_number"],
          conflicting_fields: []
        }
      }
    }
  ]
});
assert.notEqual(serialFocusedVisionConfirmed.identity_resolution_status, "ABSTAIN");
assert.match(serialFocusedVisionConfirmed.final_title, /196\/299/);
assert.ok(!serialFocusedVisionConfirmed.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

const localizedOnlyGrounded = applyIdentityResolutionGate({
  title: "provider localized title must not become final title",
  confidence: "HIGH",
  reason: "Card text is localized and needs English title evidence before publishing.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    brand: "Pokemon TCG",
    product: "Pokemon Scarlet Violet",
    set: "SV9C",
    character: "琉琪亚的展现",
    subset: "SAR",
    collector_number: "257/208"
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Pokemon Scarlet Violet"),
    character: groundedEvidence("琉琪亚的展现"),
    collector_number: groundedEvidence("257/208")
  },
  unresolved: []
});
assert.equal(localizedOnlyGrounded.identity_resolution_status, "CONFIRMED");
assert.equal(localizedOnlyGrounded.final_title, "");
assert.equal(localizedOnlyGrounded.confidence, "LOW");
assert.equal(localizedOnlyGrounded.title_render_source, "identity_resolution_abstain");
assert.ok(localizedOnlyGrounded.unresolved.includes("title blocked: required identity text is not English"));
assert.ok(localizedOnlyGrounded.title_length_policy.blocked_required_terms.some((term) => term.key === "subject"));

const multiCardLot = applyIdentityResolutionGate({
  title: "2024 Topps Chrome Shohei Ohtani and Aaron Judge Lot",
  confidence: "HIGH",
  reason: "Multiple cards visible in the image.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    multi_card: true,
    card_count: 2,
    lot_type: "two card lot",
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"]
  }),
  fields: {
    multi_card: true,
    card_count: 2,
    lot_type: "two card lot"
  },
  evidence: {
    multi_card: createEvidenceField({
      value: true,
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [createVisionSource({ observedText: "two cards visible" })]
    }),
    card_count: createEvidenceField({
      value: 2,
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [createVisionSource({ observedText: "2 cards visible" })]
    }),
    year: groundedEvidence("2024"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"])
  },
  unresolved: []
});
assert.equal(multiCardLot.identity_resolution_status, "ABSTAIN");
assert.equal(multiCardLot.route, "NON_STANDARD_MANUAL");
assert.equal(multiCardLot.final_title, "");
assert.ok(multiCardLot.unresolved.includes("multi-card lot requires single-card split or manual lot workflow"));
assert.ok(multiCardLot.conflict_map.some((conflict) => conflict.conflict_type === "MULTI_CARD_LOT_REQUIRES_SINGLE_CARD_SPLIT"));
assert.ok(multiCardLot.resolution_trace.some((entry) => entry.step === "lot_guard"));

const lowConfidenceYear = applyIdentityResolutionGate({
  title: "2017 Star Wars Chrome Black Paul Kasey Auto",
  confidence: "MEDIUM",
  reason: "Year was weakly inferred from front text.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2017",
    product: "Star Wars Chrome Black",
    players: ["Paul Kasey"],
    auto: true
  }),
  evidence: {
    year: createEvidenceField({
      value: "2017",
      status: "REVIEW",
      confidence: 0.6,
      sources: [printedSource("CARD_FRONT", "front", "2017")]
    }),
    product: groundedEvidence("Star Wars Chrome Black"),
    players: groundedEvidence(["Paul Kasey"]),
    auto: groundedEvidence(true)
  },
  unresolved: []
});
assert.equal(lowConfidenceYear.identity_resolution_status, "ABSTAIN");
assert.equal(lowConfidenceYear.final_title, "2017 Star Wars Chrome Black Paul Kasey Auto");
assert.equal(lowConfidenceYear.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(lowConfidenceYear.writer_required_fields, ["year"]);
assert.match(lowConfidenceYear.final_title, /2017/);
assert.equal(lowConfidenceYear.draft_gate.by_field.year.display_policy, "INCLUDE_HIGHLIGHTED");
assert.ok(lowConfidenceYear.conflict_map.some((conflict) => conflict.conflict_type === "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE"));

const frontOnlyColorDescriptorDropped = applyIdentityResolutionGate({
  title: "2024 Topps Heritage Jackson Chourio White Border RC",
  confidence: "HIGH",
  reason: "Front image suggested white border, but no independent source confirmed it.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Heritage",
    players: ["Jackson Chourio"],
    set: "White Border",
    rc: true
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Heritage"),
    players: groundedEvidence(["Jackson Chourio"]),
    set: frontOnlyEvidence("White Border"),
    rc: groundedEvidence(true)
  },
  unresolved: []
});
assert.equal(frontOnlyColorDescriptorDropped.identity_resolution_status, "RESOLVED");
assert.equal(frontOnlyColorDescriptorDropped.resolved.set, null);
assert.doesNotMatch(frontOnlyColorDescriptorDropped.final_title, /White Border/i);
assert.ok(frontOnlyColorDescriptorDropped.conflict_map.some((conflict) => conflict.conflict_type === "OPTIONAL_COLOR_DESCRIPTOR_REQUIRES_STRONG_CONFIRMATION"));

const weakOcrOnlyChecklistDropped = applyIdentityResolutionGate({
  title: "2010 Panini Absolute Kobe Bryant Auto 08/25 PSA 10",
  confidence: "HIGH",
  reason: "Checklist-like OCR text is weak and not required for the listing title.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2010-11",
    product: "Absolute Memorabilia",
    players: ["Kobe Bryant"],
    serial_number: "08/25",
    checklist_code: "20EB-04-30",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY",
    auto: true
  }),
  evidence: {
    year: groundedEvidence("2010-11"),
    product: groundedEvidence("Absolute Memorabilia"),
    players: groundedEvidence(["Kobe Bryant"]),
    serial_number: groundedEvidence("08/25"),
    checklist_code: createEvidenceField({
      value: "20EB-04-30",
      status: "REVIEW",
      confidence: 0.7,
      sources: [
        printedSource("OCR", "back", "20EB-04-30")
      ]
    }),
    grade_company: groundedEvidence("PSA"),
    card_grade: groundedEvidence("10"),
    grade_type: groundedEvidence("CARD_ONLY"),
    auto: groundedEvidence(true)
  },
  unresolved: []
});
assert.equal(weakOcrOnlyChecklistDropped.identity_resolution_status, "RESOLVED");
assert.equal(weakOcrOnlyChecklistDropped.resolved.checklist_code, null);
assert.ok(weakOcrOnlyChecklistDropped.final_title);
assert.ok(weakOcrOnlyChecklistDropped.conflict_map.some((conflict) => conflict.conflict_type === "WEAK_OCR_ONLY_OPTIONAL_CODE_DROPPED"));

let convergenceGateRetrievalCalls = 0;
const convergedGate = await applyIdentityResolutionGateWithConvergence({
  title: "provider title must not decide serial conflict",
  confidence: "HIGH",
  reason: "Provider had conflicting serial evidence.",
  provider: "openai_legacy",
  resolved: normalizeResolvedFields({
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "31/50"
  }),
  evidence: {
    year: groundedEvidence("2024"),
    product: groundedEvidence("Topps Chrome"),
    players: groundedEvidence(["Shohei Ohtani"]),
    serial_number: createEvidenceField({
      value: "31/50",
      status: "CONFLICT",
      confidence: 0.9,
      candidates: [
        {
          value: "31/50",
          confidence: 0.9,
          sources: [printedSource("OCR", "front", "31/50")]
        },
        {
          value: "37/50",
          confidence: 0.88,
          sources: [printedSource("OCR", "front_crop", "37/50")]
        }
      ],
      sources: [
        printedSource("OCR", "front", "31/50"),
        printedSource("OCR", "front_crop", "37/50")
      ],
      conflicts: [
        {
          source_type: "OCR",
          current_value: "31/50",
          focused_value: "37/50",
          reason: "serial_ocr_conflict"
        }
      ]
    })
  },
  unresolved: []
}, {
  maxLength: 80,
  providerId: "removed_legacy_provider",
  retrieveEvidence: async (request) => {
    convergenceGateRetrievalCalls += 1;
    assert.equal(request.status, "ABSTAIN");
    assert.ok(request.unresolved_fields.includes("serial_number"));
    return {
      evidenceItems: [
        { field: "serial_number", value: "31/50", source: "SLAB", confidence: 0.99 }
      ]
    };
  },
  convergenceOptions: {
    maxIterations: 1
  }
});
assert.equal(convergenceGateRetrievalCalls, 1);
assert.equal(convergedGate.identity_resolution_status, "RESOLVED");
assert.equal(convergedGate.resolved.serial_number, "31/50");
assert.equal(convergedGate.convergence_report.loop, "detect_conflict_retrieve_reevaluate_converge");
assert.deepEqual(convergedGate.convergence_report.phase_sequence, ["detect_conflict", "retrieve", "re_evaluate", "converge"]);
assert.equal(convergedGate.canonical_evidence.schema_version, "identity_evidence_v1");
assert.equal(convergedGate.constraint_score_report.scoring_model, "weighted_constraint_rules");

console.log("identity resolution gate tests passed");
