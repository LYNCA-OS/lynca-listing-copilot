import assert from "node:assert/strict";

import {
  knowledgeFirstRoutes,
  planKnowledgeFirstRecognition
} from "../lib/listing/v4/route-planner/knowledge-first-route-policy.mjs";
import { createEvidenceField } from "../lib/listing/evidence/evidence-schema.mjs";

function evidence(resolved = {}, evidence = {}) {
  return { resolved, evidence };
}

function confirmed(value) {
  return {
    value,
    normalized_value: value,
    status: "CONFIRMED",
    sources: [{ source_type: "CARD_FRONT", observed_text: Array.isArray(value) ? value.join(" / ") : String(value) }]
  };
}

function enumerated(field, status, value = null, candidates = []) {
  const reason = status === "EMPTY" ? "sport_has_no_teams" : `test_${field}_${status.toLowerCase()}`;
  return {
    field,
    status,
    value,
    candidates,
    reason,
    provenance: {
      source: "CATALOG_CONSTRAINT_SNAPSHOT",
      trust: "CONSENSUS_FACT",
      version: "test-constraint-model-v1",
      source_sha256: "b".repeat(64),
      rule_id: reason,
      team_value_contract: field === "team" && status === "VALUE"
        ? "team-identity-semantics-v1"
        : null
    }
  };
}

const teamValueTrace = [enumerated("team", "VALUE", "San Antonio Spurs", ["San Antonio Spurs"])];

const replay = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  higherAuthorityRoute: "WRITER_FINAL_REPLAY"
});
assert.equal(replay.route, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);
assert.equal(replay.model_call_budget, 0);
assert.equal(replay.full_provider_required, false);
assert.equal(replay.production_effect, "SHADOW_ONLY");
assert.equal(replay.production_action, "RUN_FULL_PROVIDER");
assert.equal(replay.counterfactual_action, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);

const writerReplayOverridesConflictingSensor = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  higherAuthorityRoute: "WRITER_FINAL_REPLAY",
  evidenceDocument: evidence({ year: "2025" }, {
    year: { ...confirmed("2025"), status: "CONFLICT" }
  })
});
assert.equal(writerReplayOverridesConflictingSensor.route, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);

const recognitionFinalDoesNotOverrideConflict = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  higherAuthorityRoute: "RECOGNITION_WORKER_DETERMINISTIC_FINAL",
  evidenceDocument: evidence({ year: "2025" }, {
    year: { ...confirmed("2025"), status: "CONFLICT" }
  })
});
assert.equal(recognitionFinalDoesNotOverrideConflict.route, knowledgeFirstRoutes.WRITER_REVIEW);

const rescan = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  higherAuthorityRoute: "PRE_PROVIDER_RESCAN"
});
assert.equal(rescan.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.equal(rescan.model_call_budget, 0);

const exactAnchor = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  exactAnchorShadow: { eligible: true }
});
assert.equal(exactAnchor.route, knowledgeFirstRoutes.HIGHER_AUTHORITY_FINAL);
assert.equal(exactAnchor.higher_authority_route, "EXACT_ANCHOR_FINAL");

const exactAnchorRevokedByLateConflict = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  exactAnchorShadow: { eligible: true },
  evidenceDocument: evidence({ year: "2025" }, {
    year: { ...confirmed("2025"), status: "CONFLICT" }
  })
});
assert.equal(exactAnchorRevokedByLateConflict.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.ok(exactAnchorRevokedByLateConflict.reason_codes.includes("BLOCKED_year"));

const deterministic = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    players: ["Victor Wembanyama"],
    card_name: "Fade To Black",
    product: "Phoenix"
  }, {
    year: confirmed("2025"),
    manufacturer: confirmed("Panini"),
    players: confirmed(["Victor Wembanyama"]),
    card_name: confirmed("Fade To Black"),
    product: confirmed("Phoenix")
  })
});
assert.equal(deterministic.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(deterministic.model_call_budget, 0);

const conflictingManufacturerAliases = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    brand: "Topps",
    players: ["Victor Wembanyama"],
    card_name: "Fade To Black",
    product: "Phoenix"
  }, {
    year: confirmed("2025"),
    manufacturer: confirmed("Panini"),
    brand: confirmed("Topps"),
    players: confirmed(["Victor Wembanyama"]),
    card_name: confirmed("Fade To Black"),
    product: confirmed("Phoenix")
  })
});
assert.equal(conflictingManufacturerAliases.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.ok(conflictingManufacturerAliases.evidence_snapshot.blocked_fields.includes("manufacturer"));

const conflicted = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    players: ["Victor Wembanyama"],
    card_name: "Fade To Black",
    product: "Phoenix"
  }, {
    year: { ...confirmed("2025"), status: "CONFLICT" },
    manufacturer: confirmed("Panini"),
    players: confirmed(["Victor Wembanyama"]),
    card_name: confirmed("Fade To Black"),
    product: confirmed("Phoenix")
  })
});
assert.equal(conflicted.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.equal(conflicted.model_call_budget, 0);
assert.deepEqual(conflicted.evidence_snapshot.blocked_fields, ["year"]);
assert.ok(conflicted.reason_codes.includes("BLOCKED_year"));

const unsourcedResolved = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({
    year: "2025",
    manufacturer: "Panini",
    players: ["Victor Wembanyama"],
    card_name: "Fade To Black",
    product: "Phoenix"
  })
});
assert.notEqual(unsourcedResolved.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.ok(unsourcedResolved.evidence_snapshot.unpublishable_fields.includes("year"));

const modelOnlyEvidence = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: evidence({}, {
    year: {
      ...confirmed("2025"),
      sources: [{ source_type: "VISION_MODEL", observed_text: "2025" }]
    }
  })
});
assert.notEqual(modelOnlyEvidence.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(modelOnlyEvidence.evidence_snapshot.field_states.year, "UNTRUSTED_PROVENANCE");

const sharedDeterministicEvidence = {
  manufacturer: confirmed("Panini"),
  players: confirmed(["Victor Wembanyama"]),
  card_name: confirmed("Fade To Black"),
  product: confirmed("Phoenix")
};
const mismatchedTrustedCandidate = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, {
    ...sharedDeterministicEvidence,
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [
        { source_type: "VISION_MODEL", observed_text: "2025" },
        // Real mergeEvidenceField shape: sources from every candidate are
        // flattened here and therefore cannot be trusted without value binding.
        { source_type: "OFFICIAL_CHECKLIST", observed_text: "2024" }
      ],
      candidates: [{
        value: "2024",
        sources: [{ source_type: "OFFICIAL_CHECKLIST", observed_text: "2024" }]
      }]
    }
  })
});
assert.notEqual(mismatchedTrustedCandidate.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(mismatchedTrustedCandidate.evidence_snapshot.field_states.year, "UNTRUSTED_PROVENANCE");

const mismatchedRootSourceText = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, {
    ...sharedDeterministicEvidence,
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "OFFICIAL_CHECKLIST", observed_text: "2024" }]
    }
  })
});
assert.notEqual(mismatchedRootSourceText.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(mismatchedRootSourceText.evidence_snapshot.field_states.year, "UNTRUSTED_PROVENANCE");

const matchingCandidateWithMismatchedSourceText = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, {
    ...sharedDeterministicEvidence,
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "VISION_MODEL", observed_text: "2025" }],
      candidates: [{
        value: "2025",
        sources: [{ source_type: "OFFICIAL_CHECKLIST", observed_text: "2024" }]
      }]
    }
  })
});
assert.notEqual(matchingCandidateWithMismatchedSourceText.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(matchingCandidateWithMismatchedSourceText.evidence_snapshot.field_states.year, "UNTRUSTED_PROVENANCE");

const matchingTrustedCandidate = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, {
    ...sharedDeterministicEvidence,
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      sources: [{ source_type: "VISION_MODEL", observed_text: "2025" }],
      candidates: [{
        value: "2025",
        sources: [{ source_type: "OFFICIAL_CHECKLIST", observed_text: "2025" }]
      }]
    }
  })
});
assert.equal(matchingTrustedCandidate.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);

const schemaNativeDirectEvidence = Object.fromEntries(Object.entries({
  year: "2025",
  manufacturer: "Panini",
  players: ["Victor Wembanyama"],
  card_name: "Fade To Black",
  product: "Phoenix"
}).map(([field, value]) => [field, createEvidenceField({
  value,
  status: "CONFIRMED",
  confidence: 0.95,
  sources: [{ source_type: "CARD_FRONT", observed_text: Array.isArray(value) ? value.join(" / ") : value }]
})]));
const schemaNativeDirectRoute = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, schemaNativeDirectEvidence)
});
assert.equal(schemaNativeDirectRoute.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);

const visibleColorDoesNotCreateProperNameModelWork = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: teamValueTrace,
  evidenceDocument: evidence({}, {
    ...schemaNativeDirectEvidence,
    surface_color: confirmed("Silver")
  })
});
assert.equal(visibleColorDoesNotCreateProperNameModelWork.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.deepEqual(visibleColorDoesNotCreateProperNameModelWork.knowledge_field_targets, []);
assert.equal(visibleColorDoesNotCreateProperNameModelWork.model_call_budget, 0);

const targeted = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "UNKNOWN"),
    enumerated("team", "UNKNOWN")
  ],
  evidenceDocument: evidence(
    { manufacturer: "Panini" },
    { manufacturer: confirmed("Panini") }
  )
});
assert.equal(targeted.route, knowledgeFirstRoutes.TARGETED_VISUAL_AND_KNOWLEDGE);
assert.deepEqual(targeted.visual_field_targets, ["year", "players", "card_name_or_insert_or_code"]);
assert.deepEqual(targeted.knowledge_field_targets, ["product", "team"]);
assert.equal(targeted.model_call_budget, 1);
assert.equal(targeted.complete_title_output_allowed, false);

const completeKnownEvidenceWithoutProduct = evidence({
  year: "2025",
  manufacturer: "Panini",
  players: ["Victor Wembanyama"],
  set: "Fade To Black"
}, {
  year: confirmed("2025"),
  manufacturer: confirmed("Panini"),
  players: confirmed(["Victor Wembanyama"]),
  set: confirmed("Fade To Black")
});

const knowledgeOnly = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "UNKNOWN", null, ["Panini Phoenix"]),
    ...teamValueTrace
  ],
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.equal(knowledgeOnly.route, knowledgeFirstRoutes.KNOWLEDGE_ASSIST);
assert.deepEqual(knowledgeOnly.knowledge_field_targets, ["product"]);
assert.equal(knowledgeOnly.image_policy, "NONE");

const productAndTeamValue = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "VALUE", "Panini Phoenix", ["Panini Phoenix"]),
    ...teamValueTrace
  ],
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.equal(productAndTeamValue.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(productAndTeamValue.model_call_budget, 0);
assert.deepEqual(productAndTeamValue.knowledge_field_targets, []);

const teamEmptyForTcg = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [enumerated("team", "EMPTY")],
  evidenceDocument: evidence({
    year: "2024",
    manufacturer: "Pokemon",
    character: ["Pikachu"],
    card_number: "025/165",
    product: "Scarlet & Violet 151"
  }, {
    year: confirmed("2024"),
    manufacturer: confirmed("Pokemon"),
    character: confirmed(["Pikachu"]),
    card_number: confirmed("025/165"),
    product: confirmed("Scarlet & Violet 151")
  })
});
assert.equal(teamEmptyForTcg.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.equal(teamEmptyForTcg.model_call_budget, 0);
assert.deepEqual(teamEmptyForTcg.knowledge_field_targets, []);

const onlyUnknownFieldsReachModel = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "UNKNOWN", null, ["Panini Phoenix", "Panini Prizm"]),
    enumerated("team", "UNKNOWN", null, ["San Antonio Spurs"])
  ],
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.equal(onlyUnknownFieldsReachModel.route, knowledgeFirstRoutes.KNOWLEDGE_ASSIST);
assert.deepEqual(onlyUnknownFieldsReachModel.knowledge_field_targets, ["product", "team"]);
assert.equal(onlyUnknownFieldsReachModel.model_call_budget, 1);
assert.equal(onlyUnknownFieldsReachModel.complete_title_output_allowed, false);

const missingEnumerationCannotPretendFinal = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.notEqual(missingEnumerationCannotPretendFinal.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.ok(missingEnumerationCannotPretendFinal.reason_codes.includes("FORWARD_ENUMERATION_REQUIRED"));

const duplicateEnumerationFailsClosed = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "VALUE", "Panini Phoenix", ["Panini Phoenix"]),
    enumerated("product", "UNKNOWN"),
    ...teamValueTrace
  ],
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.notEqual(duplicateEnumerationFailsClosed.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.ok(duplicateEnumerationFailsClosed.reason_codes.includes("FORWARD_ENUMERATION_REQUIRED"));

for (const malformedProductRow of [
  enumerated("product", "VALUE", null, []),
  { ...enumerated("product", "VALUE", "Panini Phoenix", ["Panini Phoenix"]), provenance: null },
  enumerated("product", "EMPTY")
]) {
  const malformedRoute = planKnowledgeFirstRecognition({
    usableImageCount: 2,
    forwardEnumerationTrace: [malformedProductRow, enumerated("team", "EMPTY")],
    evidenceDocument: completeKnownEvidenceWithoutProduct
  });
  assert.notEqual(malformedRoute.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
  assert.ok(malformedRoute.reason_codes.includes("FORWARD_ENUMERATION_REQUIRED"));
}

const uncontractedTeamValue = planKnowledgeFirstRecognition({
  usableImageCount: 2,
  forwardEnumerationTrace: [
    enumerated("product", "VALUE", "Panini Phoenix", ["Panini Phoenix"]),
    {
      ...teamValueTrace[0],
      provenance: { ...teamValueTrace[0].provenance, team_value_contract: null }
    }
  ],
  evidenceDocument: completeKnownEvidenceWithoutProduct
});
assert.notEqual(uncontractedTeamValue.route, knowledgeFirstRoutes.DETERMINISTIC_FINAL);
assert.ok(uncontractedTeamValue.reason_codes.includes("FORWARD_ENUMERATION_REQUIRED"));

const noImage = planKnowledgeFirstRecognition({ usableImageCount: 0 });
assert.equal(noImage.route, knowledgeFirstRoutes.WRITER_REVIEW);
assert.equal(noImage.model_call_budget, 0);

console.log("knowledge-first route policy tests passed");
