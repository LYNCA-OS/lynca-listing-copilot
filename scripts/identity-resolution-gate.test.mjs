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

const agnesOnly = applyIdentityResolutionGate({
  title: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50",
  model_title_suggestion: "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50",
  confidence: "HIGH",
  reason: "Provider inferred card identity from the image.",
  provider: "agnes",
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
      sources: [createVisionSource({ observedText: "2024" })]
    }),
    product: createEvidenceField({
      value: "Topps Chrome",
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [createVisionSource({ observedText: "Topps Chrome" })]
    }),
    players: createEvidenceField({
      value: ["Shohei Ohtani"],
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [createVisionSource({ observedText: "Shohei Ohtani" })]
    })
  },
  unresolved: []
});
assert.equal(agnesOnly.identity_resolution_status, "ABSTAIN");
assert.equal(agnesOnly.final_title, "Topps Chrome Shohei Ohtani");
assert.equal(agnesOnly.title_render_source, "identity_resolution_partial_writer_draft");
assert.equal(agnesOnly.publication_gate.auto_publish_allowed, false);
assert.equal(agnesOnly.publication_gate.writer_review_ready, true);
assert.equal(agnesOnly.publication_gate.workflow_route, "DEEP_REVIEW");
assert.deepEqual(agnesOnly.publication_gate.writer_required_fields.sort(), ["parallel", "serial_number", "year"]);
assert.equal(agnesOnly.draft_gate.by_field.year.display_policy, "SUGGEST_ONLY");
assert.equal(agnesOnly.draft_gate.by_field.year.requires_writer_confirmation, true);
assert.ok(agnesOnly.unresolved.includes("identity resolution requires writer review before upload"));
assert.equal(agnesOnly.model_title_suggestion, "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50");

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
assert.doesNotMatch(fastVisionNoRisk.final_title, /2024/);
assert.match(fastVisionNoRisk.final_title, /Topps Chrome/);
assert.equal(fastVisionNoRisk.publication_gate.identity_gate_status, "CORE_RESOLVED");
assert.equal(fastVisionNoRisk.publication_gate.workflow_route, "STANDARD_REVIEW");
assert.equal(fastVisionNoRisk.publication_gate.field_publication_states.year, "REVIEW_REQUIRED");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.mode, "PARTIAL_WRITER_DRAFT");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.publishable_fields.product.value, "Topps Chrome");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.publishable_fields.product.publishability, "PUBLISHABLE_NARROW");
assert.equal(fastVisionNoRisk.publication_gate.field_level_publication.review_required_fields[0].field, "year");
assert.equal(fastVisionNoRisk.draft_gate.by_field.year.display_policy, "SUGGEST_ONLY");
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
assert.equal(fastVisionSerialWithoutFocusedVerification.final_title, "Topps Chrome Shohei Ohtani 31/50");
assert.equal(fastVisionSerialWithoutFocusedVerification.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(fastVisionSerialWithoutFocusedVerification.writer_required_fields, ["year", "serial_number"]);
assert.match(fastVisionSerialWithoutFocusedVerification.final_title, /31\/50/);
assert.equal(fastVisionSerialWithoutFocusedVerification.draft_gate.by_field.serial_number.display_policy, "INCLUDE_HIGHLIGHTED");

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
assert.match(fastVisionSerialWithFocusedVerification.final_title, /31\/50/);

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

const groundedMultiView = applyIdentityResolutionGate({
  title: "provider title must not decide final facts",
  confidence: "HIGH",
  reason: "Provider result should be replaced by deterministic renderer.",
  provider: "agnes",
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
assert.match(groundedMultiView.final_title, /31\/50/);
assert.equal(groundedMultiView.title_render_source, "identity_resolution_deterministic_renderer");
assert.notEqual(groundedMultiView.final_title, "provider title must not decide final facts");

const marketplaceOnly = applyIdentityResolutionGate({
  title: "marketplace title must not become final truth",
  confidence: "HIGH",
  reason: "Marketplace candidate matched.",
  provider: "agnes",
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
const providerInvariantGemini = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "gemini"
}, {
  providerId: "gemini"
});
const providerInvariantGpt = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "openai_legacy"
}, {
  providerId: "openai_legacy"
});
const providerInvariantAgnes = applyIdentityResolutionGate({
  ...providerInvariantInput,
  provider: "agnes"
}, {
  providerId: "agnes"
});
assert.equal(providerInvariantGemini.identity_resolution_status, providerInvariantGpt.identity_resolution_status);
assert.equal(providerInvariantGemini.identity_resolution_status, providerInvariantAgnes.identity_resolution_status);
assert.deepEqual(providerInvariantGemini.writer_required_fields.sort(), providerInvariantGpt.writer_required_fields.sort());
assert.deepEqual(providerInvariantGemini.writer_required_fields.sort(), providerInvariantAgnes.writer_required_fields.sort());
assert.equal(providerInvariantGemini.final_title, providerInvariantGpt.final_title);
assert.equal(providerInvariantGemini.final_title, providerInvariantAgnes.final_title);

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

const structuredGeminiGate = structuredHighRiskProviderResult("gemini");
const structuredGptGate = structuredHighRiskProviderResult("openai_legacy");
assert.equal(structuredGeminiGate.publication_gate.field_publication_states.year, "REVIEW_REQUIRED");
assert.equal(structuredGeminiGate.publication_gate.field_publication_states.grade_company, "PUBLISHABLE_EXACT");
assert.equal(structuredGeminiGate.publication_gate.field_publication_states.card_grade, "PUBLISHABLE_EXACT");
assert.equal(structuredGeminiGate.publication_gate.field_publication_states.rc, "PUBLISHABLE_EXACT");
assert.equal(structuredGeminiGate.publication_gate.field_publication_states.auto, "PUBLISHABLE_NARROW");
assert.deepEqual(structuredGeminiGate.writer_required_fields, ["year"]);
assert.deepEqual(structuredGeminiGate.writer_required_fields, structuredGptGate.writer_required_fields);
assert.equal(structuredGeminiGate.final_title, structuredGptGate.final_title);

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
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
assert.equal(serialFocusedFailure.final_title, "2022 Gold Standard Hunter Renfrow #/299");
assert.equal(serialFocusedFailure.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialFocusedFailure.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialFocusedFailure.final_title, /196\/299/);
assert.match(serialFocusedFailure.final_title, /#\/299/);
assert.equal(serialFocusedFailure.draft_gate.by_field.serial_number.selected_value, "#/299");
assert.ok(serialFocusedFailure.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_FOCUSED_VERIFICATION_FAILED"));
assert.ok(serialFocusedFailure.resolution_trace.some((entry) => entry.step === "high_risk_verification_guard"));

const serialSingleFrontSource = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Focused serial reread repeated one front-image serial value.",
  provider: "agnes",
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
assert.equal(serialSingleFrontSource.final_title, "2022 Gold Standard Hunter Renfrow #/299");
assert.equal(serialSingleFrontSource.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialSingleFrontSource.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialSingleFrontSource.final_title, /196\/299/);
assert.match(serialSingleFrontSource.final_title, /#\/299/);
assert.ok(serialSingleFrontSource.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

const serialDoubleFrontSource = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Initial read and focused serial crop agree on the same serial.",
  provider: "agnes",
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
assert.equal(serialDoubleFrontSource.final_title, "2022 Gold Standard Hunter Renfrow #/299");
assert.equal(serialDoubleFrontSource.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(serialDoubleFrontSource.writer_required_fields, ["serial_number"]);
assert.doesNotMatch(serialDoubleFrontSource.final_title, /196\/299/);
assert.match(serialDoubleFrontSource.final_title, /#\/299/);
assert.ok(serialDoubleFrontSource.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

const serialFocusedVisionConfirmed = applyIdentityResolutionGate({
  title: "2022 Panini Gold Standard Hunter Renfrow 196/299",
  confidence: "HIGH",
  reason: "Focused serial crop confirmed the same serial.",
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
assert.equal(lowConfidenceYear.final_title, "Star Wars Chrome Black Paul Kasey Auto");
assert.equal(lowConfidenceYear.title_render_source, "identity_resolution_partial_writer_draft");
assert.deepEqual(lowConfidenceYear.writer_required_fields, ["year"]);
assert.doesNotMatch(lowConfidenceYear.final_title, /2017/);
assert.equal(lowConfidenceYear.draft_gate.by_field.year.display_policy, "SUGGEST_ONLY");
assert.ok(lowConfidenceYear.conflict_map.some((conflict) => conflict.conflict_type === "CRITICAL_FIELD_BELOW_PUBLISH_CONFIDENCE"));

const frontOnlyColorDescriptorDropped = applyIdentityResolutionGate({
  title: "2024 Topps Heritage Jackson Chourio White Border RC",
  confidence: "HIGH",
  reason: "Front image suggested white border, but no independent source confirmed it.",
  provider: "agnes",
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
  provider: "agnes",
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
  provider: "agnes",
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
  providerId: "agnes",
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
