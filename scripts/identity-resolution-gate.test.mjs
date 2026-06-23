import assert from "node:assert/strict";
import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields
} from "../lib/listing/evidence/evidence-schema.mjs";
import {
  applyIdentityResolutionGate,
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
assert.equal(agnesOnly.final_title, "");
assert.equal(agnesOnly.title_render_source, "identity_resolution_abstain");
assert.ok(agnesOnly.unresolved.includes("identity resolution abstain"));
assert.equal(agnesOnly.model_title_suggestion, "2024 Topps Chrome Shohei Ohtani Gold Refractor 31/50");

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

const pokemonCritical = criticalFieldsForIdentityResolution(normalizeResolvedFields({
  product: "Pokemon Scarlet Violet",
  character: "Pikachu"
}), []);
assert.ok(pokemonCritical.includes("year"));
assert.ok(pokemonCritical.includes("product"));
assert.ok(pokemonCritical.includes("character"));
assert.ok(!pokemonCritical.includes("players"));

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
assert.equal(missingYear.final_title, "");
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
assert.equal(serialFocusedFailure.final_title, "");
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
assert.equal(serialSingleFrontSource.final_title, "");
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
assert.equal(serialDoubleFrontSource.final_title, "");
assert.ok(serialDoubleFrontSource.conflict_map.some((conflict) => conflict.conflict_type === "SERIAL_REQUIRES_STRONG_CONFIRMATION"));

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
assert.equal(lowConfidenceYear.final_title, "");
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

console.log("identity resolution gate tests passed");
