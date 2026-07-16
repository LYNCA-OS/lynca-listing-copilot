import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  issueTrustedOperatorEvidenceEnvelope,
  parseProviderMessagePayload,
  validateProviderEvidencePayload
} from "../lib/listing/providers/provider-response-normalizer.mjs";
import {
  expandOpenAiCompactProviderPayload,
  expandOpenAiUltraCompactProviderPayload,
  openAiCompactProviderResponseSchema,
  openAiProviderResponseSchema,
  openAiUltraCompactProviderResponseSchema
} from "../lib/listing/providers/openai-emergency-provider.mjs";
import { resolvedFieldNames } from "../lib/listing/evidence/evidence-schema.mjs";
import { providerPayloadToEvidenceDocument } from "../lib/listing/evidence/provider-evidence-normalizer.mjs";

const schema = JSON.parse(await readFile("lib/listing/schemas/provider-evidence-response.schema.json", "utf8"));
assert.equal(schema.title, "Listing ProviderEvidenceResponse");
assert.ok(schema.anyOf.some((entry) => entry.required?.includes("evidence")));
assert.ok(schema.properties.unresolved.items.type === "string");

const structuredOutputFields = Object.keys(openAiProviderResponseSchema().properties.fields.properties);
assert.deepEqual(
  structuredOutputFields.filter((field) => !resolvedFieldNames.includes(field)),
  [],
  "Every model field must survive the shared resolved/evidence contract."
);
const standardModelSourceTypes = openAiProviderResponseSchema()
  .properties.field_evidence.items.properties.source_type.enum;
assert.ok(!standardModelSourceTypes.includes("OPERATOR"));
assert.ok(!standardModelSourceTypes.includes("HUMAN_OPERATOR"));
assert.ok(!standardModelSourceTypes.includes("MANUAL_OPERATOR"));

const compactSchema = openAiCompactProviderResponseSchema();
assert.deepEqual(compactSchema.required, [
  "recognition_status",
  "field_values",
  "field_evidence",
  "unresolved",
  "vector_candidate_decision"
]);
assert.equal(compactSchema.properties.fields, undefined, "compact transport must not serialize every empty canonical field");
assert.deepEqual(compactSchema.properties.field_values.required, ["strings", "booleans", "numbers", "lists"]);
assert.ok(!compactSchema.properties.field_evidence.items.properties.source_type.enum.includes("OPERATOR"));

const expandedCompactPayload = expandOpenAiCompactProviderPayload({
  recognition_status: "RESOLVED",
  field_values: {
    strings: [
      { field: "year", value: "2024-25" },
      { field: "product", value: "Topps Chrome" },
      { field: "print_run_number", value: "2/3" }
    ],
    booleans: [{ field: "auto", value: true }],
    numbers: [{ field: "card_count", value: 1 }],
    lists: [
      { field: "players", values: ["Lamine Yamal"] },
      { field: "observable_components", values: ["auto"] }
    ]
  },
  field_evidence: [{
    field: "print_run_number",
    value: "2/3",
    source_type: "CARD_FRONT_PRINTED_TEXT",
    source_image_id: "image-1",
    source_region: "print_run_number",
    visible_text: "2/3",
    review_required: false,
    directly_observed: true
  }],
  unresolved: ["parallel_exact"],
  vector_candidate_decision: {
    selected_candidate_id: null,
    decision: "NOT_AVAILABLE",
    supported_fields: [],
    rejected_fields: [],
    conflicts: []
  }
});
assert.equal(expandedCompactPayload.fields.year, "2024-25");
assert.deepEqual(expandedCompactPayload.fields.players, ["Lamine Yamal"]);
assert.equal(expandedCompactPayload.fields.auto, true);
assert.equal(expandedCompactPayload.field_evidence[0].raw_text, "2/3");
assert.equal(expandedCompactPayload.field_evidence[0].evidence_kind, "PRINTED_LIMITED_NUMBERING");
assert.equal(expandedCompactPayload.field_evidence[0].direct_observation, true);
assert.equal(validateProviderEvidencePayload("openai_legacy", expandedCompactPayload).fields.product, "Topps Chrome");

const ultraCompactSchema = openAiUltraCompactProviderResponseSchema();
assert.deepEqual(ultraCompactSchema.required, ["r", "v", "e", "u"]);
assert.equal(ultraCompactSchema.properties.c, undefined, "cold-path transport must omit unused candidate scaffolding");
assert.ok(!ultraCompactSchema.properties.e.items.properties.s.enum.includes("OPERATOR"));
const ultraCompactCandidateSchema = openAiUltraCompactProviderResponseSchema({ includeVectorDecision: true });
assert.deepEqual(ultraCompactCandidateSchema.required, ["r", "v", "e", "u", "c"]);

const expandedUltraCompactPayload = expandOpenAiUltraCompactProviderPayload({
  r: "RESOLVED",
  v: {
    s: [
      { f: "year", v: "2024-25" },
      { f: "product", v: "Topps Chrome" },
      { f: "print_run_number", v: "2/3" }
    ],
    b: [{ f: "auto", v: true }],
    n: [],
    l: [{ f: "players", v: ["Lamine Yamal"] }]
  },
  e: [{
    f: "print_run_number",
    v: "2/3",
    s: "CARD_FRONT_PRINTED_TEXT",
    i: "image-1",
    t: "2/3"
  }],
  u: ["parallel_exact"]
});
assert.equal(expandedUltraCompactPayload.fields.product, "Topps Chrome");
assert.equal(expandedUltraCompactPayload.field_evidence[0].source_region, "print_run_number");
assert.equal(expandedUltraCompactPayload.field_evidence[0].directly_observed, true);
assert.equal(expandedUltraCompactPayload.field_evidence[0].review_required, false);
assert.equal(expandedUltraCompactPayload.vector_candidate_decision.decision, "NOT_AVAILABLE");
assert.throws(() => expandOpenAiCompactProviderPayload({
  recognition_status: "CONFIRMED",
  field_values: {
    strings: [{ field: "year", value: "2024" }, { field: "year", value: "2025" }],
    booleans: [],
    numbers: [],
    lists: []
  },
  field_evidence: [],
  unresolved: [],
  vector_candidate_decision: {
    selected_candidate_id: null,
    decision: "NOT_AVAILABLE",
    supported_fields: [],
    rejected_fields: [],
    conflicts: []
  }
}), /invalid or duplicate year/i);

const legacyPayload = validateProviderEvidencePayload("openai_legacy", {
  title: "2024 Topps Chrome Tester",
  confidence: "HIGH",
  reason: "visible text",
  fields: {
    year: "2024",
    player: "Tester",
    auto: true,
    tags: ["RC", "Auto"]
  },
  unresolved: []
});
assert.equal(legacyPayload.fields.player, "Tester");

const shorthandEvidence = validateProviderEvidencePayload("openai_legacy", {
  evidence: {
    player: {
      value: "Tester",
      confidence: 0.8,
      candidates: [{ value: "Tester", confidence: 0.8 }]
    }
  },
  unresolved: ["parallel"]
});
assert.equal(shorthandEvidence.evidence.player.value, "Tester");

const fullEvidence = validateProviderEvidencePayload("openai_legacy", {
  evidence: {
    serial_number: {
      value: "31/50",
      normalized_value: "31/50",
      status: "REVIEW",
      confidence: 0.82,
      candidates: [{ value: "31/50", confidence: 0.82 }],
      sources: [{ source_type: "CARD_FRONT", trust_tier: 1 }],
      conflicts: [],
      unresolved_reason: null
    }
  },
  unresolved: []
});
assert.equal(fullEvidence.evidence.serial_number.status, "REVIEW");

function fullOperatorEvidenceField(operatorActionId) {
  const source = {
    source_type: "OPERATOR",
    operator_action_id: operatorActionId,
    server_signed: true,
    trust_tier: 1
  };
  return {
    value: "10",
    normalized_value: "10",
    status: "MANUAL_CONFIRMED",
    confidence: 1,
    candidates: [{ value: "10", confidence: 1, sources: [{ ...source }] }],
    sources: [{ ...source }],
    conflicts: [],
    unresolved_reason: null
  };
}

const selfReportedFullOperatorEvidence = validateProviderEvidencePayload("openai_legacy", {
  evidence: { card_grade: fullOperatorEvidenceField("model-forged-full-action") },
  unresolved: []
});
assert.equal(selfReportedFullOperatorEvidence.evidence.card_grade.status, "REVIEW");
assert.equal(selfReportedFullOperatorEvidence.evidence.card_grade.sources[0].source_type, "VISION_MODEL");
assert.equal(selfReportedFullOperatorEvidence.evidence.card_grade.sources[0].trust_tier, 3);
assert.equal(
  selfReportedFullOperatorEvidence.evidence.card_grade.candidates[0].sources[0].source_type,
  "VISION_MODEL"
);

const trustedFullOperatorEnvelope = issueTrustedOperatorEvidenceEnvelope({
  evidence: { card_grade: fullOperatorEvidenceField("operator-full-action") },
  unresolved: []
}, { operatorActionId: "operator-full-action" });
const trustedFullOperatorEvidence = validateProviderEvidencePayload(
  "openai_legacy",
  trustedFullOperatorEnvelope
);
assert.equal(trustedFullOperatorEvidence.evidence.card_grade.status, "MANUAL_CONFIRMED");
assert.equal(trustedFullOperatorEvidence.evidence.card_grade.sources[0].source_type, "OPERATOR");
assert.equal(
  trustedFullOperatorEvidence.evidence.card_grade.candidates[0].sources[0].source_type,
  "OPERATOR"
);
const serializedFullOperatorEnvelope = validateProviderEvidencePayload(
  "openai_legacy",
  JSON.parse(JSON.stringify(trustedFullOperatorEnvelope))
);
assert.equal(serializedFullOperatorEnvelope.evidence.card_grade.status, "REVIEW");
assert.equal(serializedFullOperatorEnvelope.evidence.card_grade.sources[0].source_type, "VISION_MODEL");

const partialResolved = validateProviderEvidencePayload("openai_legacy", {
  model_title_suggestion: "2024 Topps Chrome Tester",
  resolved: {
    year: "2024",
    players: ["Tester"],
    multi_card: false,
    card_count: 1,
    lot_type: null,
    auto: true,
    grade_type: "UNKNOWN"
  },
  unresolved: []
});
assert.equal(partialResolved.resolved.players[0], "Tester");
assert.equal(partialResolved.resolved.card_count, 1);

const structuredFieldEvidence = validateProviderEvidencePayload("openai_legacy", {
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
    },
    card_name: {
      value: "Best Performance",
      support_type: "CARD_BACK_PRINTED_TEXT",
      evidence_kind: "PRINTED_CARD_NAME",
      visible_text: "BEST PERFORMANCE",
      confidence: 0.9,
      review_required: false
    }
  },
  unresolved: []
});
assert.equal(structuredFieldEvidence.field_evidence.grade.grade_company, "PSA");
assert.equal(structuredFieldEvidence.field_evidence.card_name.value, "Best Performance");

const aliasedSubjectEvidence = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    players: ["Lamine Yamal"]
  },
  field_evidence: {
    players_name_on_card: {
      value: ["Lamine Yamal"],
      source_type: "CARD_BACK_PRINTED_TEXT",
      visible_text: "LAMINE YAMAL",
      directly_observed: true,
      confidence: 0.98,
      review_required: false
    }
  },
  unresolved: []
});
assert.deepEqual(aliasedSubjectEvidence.field_evidence.players.value, ["Lamine Yamal"]);
assert.equal(aliasedSubjectEvidence.field_evidence.players_name_on_card, undefined);

const canonicalSubjectEvidenceWinsAlias = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    players: ["Lamine Yamal"]
  },
  field_evidence: {
    players: {
      value: ["Lamine Yamal"],
      source_type: "CARD_FRONT_PRINTED_TEXT",
      visible_text: "LAMINE YAMAL",
      directly_observed: true,
      confidence: 0.99,
      review_required: false
    },
    players_name_on_card: {
      value: ["Wrong Alias Value"],
      source_type: "VISUAL_GUESS",
      visible_text: "",
      directly_observed: false,
      confidence: 0.2,
      review_required: true
    }
  },
  unresolved: []
});
assert.deepEqual(canonicalSubjectEvidenceWinsAlias.field_evidence.players.value, ["Lamine Yamal"]);
assert.equal(canonicalSubjectEvidenceWinsAlias.field_evidence.players.confidence, 0.99);

const unknownFieldEvidenceIsQuarantined = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    year: "2024",
    product: "Topps Chrome"
  },
  field_evidence: {
    year: {
      value: "2024",
      source_type: "CARD_BACK_PRINTED_TEXT",
      visible_text: "2024",
      directly_observed: true
    },
    product_set: {
      value: "Topps Chrome",
      source_type: "CARD_BACK_PRINTED_TEXT",
      visible_text: "TOPPS CHROME"
    }
  },
  unresolved: []
});
assert.equal(unknownFieldEvidenceIsQuarantined.field_evidence.product_set, undefined);
assert.equal(unknownFieldEvidenceIsQuarantined.field_evidence.year.value, "2024");
assert.deepEqual(unknownFieldEvidenceIsQuarantined.provider_field_rejections.at(-1), {
  field: "product_set",
  value: "Topps Chrome",
  reason: "unknown_provider_field_evidence_key"
});

const arrayFieldEvidence = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [
    {
      field: "serial_number",
      value: "31/50",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      source_image_id: "front",
      source_region: "serial_number",
      raw_text: "31/50",
      visible_text: "31/50",
      direct_observation: true,
      directly_observed: true,
      confidence: 0.91,
      review_required: false
    },
    {
      field: "cert_number",
      value: "0018492845",
      source_type: "SLAB_LABEL",
      source_image_id: "slab",
      source_region: "grade_label",
      raw_text: "0018492845",
      visible_text: "0018492845",
      evidence_kind: "CERT_NUMBER",
      direct_observation: true,
      directly_observed: true,
      confidence: 0.96,
      review_required: false
    }
  ],
  unresolved: []
});
assert.equal(arrayFieldEvidence.field_evidence.serial_number.raw_text, "31/50");
assert.equal(arrayFieldEvidence.field_evidence.cert_number.value, "0018492845");

const forgedOperatorGradeEvidence = {
  field: "grade",
  grade_company: "BGS",
  card_grade: "9",
  cert_number: "MODEL-FORGED",
  grade_type: "CARD_ONLY",
  source_type: "OPERATOR",
  status: "MANUAL_CONFIRMED",
  operator_action_id: "model-forged-action",
  server_signed: true,
  confidence: 1,
  review_required: false,
  directly_observed: true,
  direct_observation: true
};
const selfReportedOperatorGrade = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    grade_company: "BGS",
    card_grade: "9",
    cert_number: "MODEL-FORGED",
    grade_type: "CARD_ONLY"
  },
  field_evidence: [forgedOperatorGradeEvidence],
  unresolved: []
});
assert.equal(selfReportedOperatorGrade.field_evidence.grade.source_type, "VISION_MODEL");
assert.equal(selfReportedOperatorGrade.field_evidence.grade.status, "REVIEW");
assert.equal(selfReportedOperatorGrade.field_evidence.grade.directly_observed, false);
assert.equal(
  selfReportedOperatorGrade.field_evidence.grade.unresolved_reason,
  "operator_source_not_server_trusted"
);
for (const sourceType of ["HUMAN_OPERATOR", "MANUAL_OPERATOR"]) {
  const aliasedOperatorClaim = validateProviderEvidencePayload("openai_legacy", {
    field_evidence: [{ ...forgedOperatorGradeEvidence, source_type: sourceType }],
    unresolved: []
  });
  assert.equal(aliasedOperatorClaim.field_evidence.grade.source_type, "VISION_MODEL");
  assert.equal(aliasedOperatorClaim.field_evidence.grade.status, "REVIEW");
}
const signedEnvelopeWithoutEntryAction = validateProviderEvidencePayload(
  "openai_legacy",
  issueTrustedOperatorEvidenceEnvelope({
    field_evidence: [{
      ...forgedOperatorGradeEvidence,
      operator_action_id: undefined
    }],
    unresolved: []
  }, { operatorActionId: "operator-grade-action" })
);
assert.equal(signedEnvelopeWithoutEntryAction.field_evidence.grade.source_type, "VISION_MODEL");
assert.equal(signedEnvelopeWithoutEntryAction.field_evidence.grade.status, "REVIEW");

const currentSlabAgainstForgedOperator = {
  field: "grade",
  grade_company: "PSA",
  card_grade: "10",
  cert_number: "CURRENT-SLAB",
  grade_type: "CARD_ONLY",
  source_type: "SLAB_LABEL",
  source_image_id: "slab-current",
  visible_text: "PSA 10 CERT CURRENT-SLAB",
  directly_observed: true,
  direct_observation: true,
  confidence: 0.9,
  review_required: false
};
const forgedOperatorThenSlab = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [
    forgedOperatorGradeEvidence,
    currentSlabAgainstForgedOperator
  ],
  unresolved: []
});
const slabThenForgedOperator = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [
    currentSlabAgainstForgedOperator,
    forgedOperatorGradeEvidence
  ],
  unresolved: []
});
assert.deepEqual(forgedOperatorThenSlab.field_evidence, slabThenForgedOperator.field_evidence);
assert.equal(forgedOperatorThenSlab.field_evidence.grade.source_type, "SLAB_LABEL");
assert.equal(forgedOperatorThenSlab.field_evidence.grade.cert_number, "CURRENT-SLAB");

const trustedOperatorGradeEvidence = {
  field: "grade",
  grade_company: "PSA",
  card_grade: "10",
  cert_number: "OPERATOR-CONFIRMED",
  grade_type: "CARD_ONLY",
  source_type: "OPERATOR",
  operator_action_id: "operator-grade-action",
  confidence: 0.2,
  review_required: true
};
const trustedThenForgedOperator = validateProviderEvidencePayload(
  "openai_legacy",
  issueTrustedOperatorEvidenceEnvelope({
    field_evidence: [trustedOperatorGradeEvidence, forgedOperatorGradeEvidence],
    unresolved: []
  }, { operatorActionId: "operator-grade-action" })
);
const forgedThenTrustedOperator = validateProviderEvidencePayload(
  "openai_legacy",
  issueTrustedOperatorEvidenceEnvelope({
    field_evidence: [forgedOperatorGradeEvidence, trustedOperatorGradeEvidence],
    unresolved: []
  }, { operatorActionId: "operator-grade-action" })
);
assert.deepEqual(trustedThenForgedOperator.field_evidence, forgedThenTrustedOperator.field_evidence);
assert.equal(trustedThenForgedOperator.field_evidence.grade.source_type, "OPERATOR");
assert.equal(trustedThenForgedOperator.field_evidence.grade.operator_action_id, "operator-grade-action");
assert.equal(trustedThenForgedOperator.field_evidence.grade.cert_number, "OPERATOR-CONFIRMED");

const currentSerialRead = {
  field: "serial_number",
  value: "31/50",
  source_type: "CARD_FRONT_PRINTED_TEXT",
  source_image_id: "front-current",
  visible_text: "31/50",
  directly_observed: true,
  direct_observation: true,
  confidence: 0.91,
  review_required: false
};
const unboundOfficialSerialReference = {
  field: "serial_number",
  value: "44/50",
  source_type: "OFFICIAL_GRADING_DATA",
  visible_text: "44/50",
  directly_observed: true,
  direct_observation: true,
  confidence: 1,
  review_required: false
};
const currentThenOfficialSerial = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [currentSerialRead, unboundOfficialSerialReference],
  unresolved: []
});
const officialThenCurrentSerial = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [unboundOfficialSerialReference, currentSerialRead],
  unresolved: []
});
assert.deepEqual(currentThenOfficialSerial.field_evidence, officialThenCurrentSerial.field_evidence);
assert.equal(currentThenOfficialSerial.field_evidence.serial_number.value, "31/50");
assert.equal(currentThenOfficialSerial.field_evidence.serial_number.source_image_id, "front-current");
assert.notEqual(currentThenOfficialSerial.field_evidence.serial_number.status, "CONFLICT");
assert.deepEqual(currentThenOfficialSerial.field_evidence.serial_number.conflicts || [], []);

const currentSlabGrade = {
  field: "grade",
  grade_company: "PSA",
  card_grade: "10",
  cert_number: "33333333",
  grade_type: "CARD_ONLY",
  source_type: "SLAB_LABEL",
  source_image_id: "slab-current",
  visible_text: "PSA 10 CERT 33333333",
  directly_observed: true,
  direct_observation: true,
  confidence: 0.91,
  review_required: false
};
const unboundOfficialGradeReference = {
  field: "grade",
  grade_company: "BGS",
  card_grade: "9",
  cert_number: "44444444",
  grade_type: "CARD_ONLY",
  source_type: "OFFICIAL_GRADING_DATA",
  visible_text: "BGS 9 CERT 44444444",
  directly_observed: true,
  direct_observation: true,
  confidence: 1,
  review_required: false
};
const currentThenOfficialGrade = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [currentSlabGrade, unboundOfficialGradeReference],
  unresolved: []
});
const officialThenCurrentGrade = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [unboundOfficialGradeReference, currentSlabGrade],
  unresolved: []
});
assert.deepEqual(currentThenOfficialGrade.field_evidence, officialThenCurrentGrade.field_evidence);
assert.equal(currentThenOfficialGrade.field_evidence.grade.grade_company, "PSA");
assert.equal(currentThenOfficialGrade.field_evidence.grade.card_grade, "10");
assert.equal(currentThenOfficialGrade.field_evidence.grade.cert_number, "33333333");
assert.notEqual(currentThenOfficialGrade.field_evidence.grade.status, "CONFLICT");
assert.deepEqual(currentThenOfficialGrade.field_evidence.grade.conflicts || [], []);

const slabGradeReadA = [
  ["grade_company", "PSA", 0.99],
  ["card_grade", "10", 0.4],
  ["auto_grade", "9", 0.4],
  ["cert_number", "11111111", 0.4]
].map(([field, value, confidence]) => ({
  field,
  value,
  source_type: "SLAB_LABEL",
  source_image_id: "slab-a",
  source_region: "grade_label",
  visible_text: "PSA 10 AUTO 9 CERT 11111111",
  directly_observed: true,
  direct_observation: true,
  confidence,
  review_required: false
}));
const slabGradeReadB = [
  ["grade_company", "BGS", 0.4],
  ["card_grade", "9", 0.99],
  ["auto_grade", "10", 0.99],
  ["cert_number", "22222222", 0.99]
].map(([field, value, confidence]) => ({
  field,
  value,
  source_type: "SLAB_LABEL",
  source_image_id: "slab-b",
  source_region: "grade_label",
  visible_text: "BGS 9 AUTO 10 CERT 22222222",
  directly_observed: true,
  direct_observation: true,
  confidence,
  review_required: false
}));
const gradeTupleConflictForward = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [...slabGradeReadA, ...slabGradeReadB],
  unresolved: []
});
const gradeTupleConflictReverse = validateProviderEvidencePayload("openai_legacy", {
  field_evidence: [...slabGradeReadB, ...slabGradeReadA].reverse(),
  unresolved: []
});
assert.deepEqual(gradeTupleConflictForward.field_evidence, gradeTupleConflictReverse.field_evidence);
assert.deepEqual(
  Object.fromEntries(["grade_company", "card_grade", "auto_grade", "cert_number"]
    .map((field) => [field, gradeTupleConflictForward.field_evidence[field].value])),
  {
    grade_company: "BGS",
    card_grade: "9",
    auto_grade: "10",
    cert_number: "22222222"
  },
  "a grade tuple must come from one observation instead of per-field confidence winners"
);
for (const field of ["grade_company", "card_grade", "auto_grade", "cert_number"]) {
  const evidence = gradeTupleConflictForward.field_evidence[field];
  assert.equal(evidence.source_image_id, "slab-b");
  assert.equal(evidence.status, "CONFLICT");
  assert.equal(evidence.review_required, true);
  assert.equal(evidence.unresolved_reason, "conflicting_current_instance_grade_tuple");
  assert.deepEqual(
    new Set(evidence.conflicts.map((conflict) => conflict.field)),
    new Set(["grade_company", "card_grade", "auto_grade", "cert_number"])
  );
}

const unsupportedCodeReview = validateProviderEvidencePayload("openai_legacy", {
  fields: { collector_number: "RS-TYG" },
  field_evidence: [],
  unresolved: []
});
assert.deepEqual(unsupportedCodeReview.unresolved, ["collector_number"], "a provider code without direct current-image evidence must be reviewable");
assert.equal(unsupportedCodeReview.fields.collector_number, null, "an unsupported printed code must not survive into title fields");
assert.equal(unsupportedCodeReview.provider_field_rejections[0].reason, "printed_code_not_literally_supported_by_visible_text");

const directlySupportedCode = validateProviderEvidencePayload("openai_legacy", {
  fields: { collector_number: "RS-TYG" },
  field_evidence: [{
    field: "collector_number",
    value: "RS-TYG",
    source_type: "CARD_BACK_PRINTED_TEXT",
    source_image_id: "image-2",
    source_region: "collector_number",
    raw_text: "RS-TYG",
    visible_text: "RS-TYG",
    evidence_kind: "PRINTED_CARD_CODE",
    confidence: null,
    review_required: false,
    directly_observed: true,
    direct_observation: true
  }],
  unresolved: []
});
assert.deepEqual(directlySupportedCode.unresolved, [], "directly visible printed codes must remain eligible for resolution");

const unsupportedAutoReview = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    auto: true,
    observable_components: ["auto", "patch"],
    tags: ["Auto", "RC"]
  },
  resolved: {
    auto: true,
    observable_components: ["auto", "patch"],
    attributes: ["Auto", "RC"]
  },
  field_evidence: [],
  unresolved: []
});
assert.equal(unsupportedAutoReview.fields.auto, false, "model-only auto claims must fail closed");
assert.deepEqual(unsupportedAutoReview.fields.observable_components, ["patch"]);
assert.deepEqual(unsupportedAutoReview.fields.tags, ["RC"]);
assert.equal(unsupportedAutoReview.resolved.auto, false);
assert.ok(unsupportedAutoReview.unresolved.includes("auto"));
assert.equal(unsupportedAutoReview.provider_field_rejections.at(-1).reason, "auto_not_directly_supported_by_current_image");

const genericVisibleSignatureIsNotEnough = validateProviderEvidencePayload("openai_legacy", {
  fields: { auto: true, observable_components: ["auto"] },
  field_evidence: [{
    field: "auto",
    value: true,
    source_type: "VISIBLE_SIGNATURE",
    source_image_id: "image-1",
    source_region: "signature",
    evidence_kind: "SIGNATURE",
    visible_text: "",
    directly_observed: true,
    direct_observation: true,
    review_required: false
  }],
  unresolved: []
});
assert.equal(genericVisibleSignatureIsNotEnough.fields.auto, false, "a generic signature graphic may be a printed facsimile and must fail closed");
assert.ok(genericVisibleSignatureIsNotEnough.unresolved.includes("auto"));

const directlySupportedInkAuto = validateProviderEvidencePayload("openai_legacy", {
  fields: { auto: true, observable_components: ["auto"] },
  field_evidence: [{
    field: "auto",
    value: true,
    source_type: "CARD_FRONT_PRINTED_TEXT",
    source_image_id: "image-1",
    source_region: "signature",
    evidence_kind: "HANDWRITTEN_INK_SIGNATURE",
    visible_text: "",
    signature_visible: true,
    directly_observed: true,
    direct_observation: true,
    review_required: false
  }],
  unresolved: []
});
assert.equal(directlySupportedInkAuto.fields.auto, true, "directly visible handwritten ink may support Auto");
assert.deepEqual(directlySupportedInkAuto.unresolved, []);

const directlySupportedPrintedAuto = validateProviderEvidencePayload("openai_legacy", {
  fields: { auto: true, observable_components: ["auto"] },
  field_evidence: [{
    field: "auto",
    value: true,
    source_type: "CARD_BACK_PRINTED_TEXT",
    source_image_id: "image-2",
    source_region: "autograph_label",
    evidence_kind: "PRINTED_CARD_TEXT",
    visible_text: "TOPPS CERTIFIED AUTOGRAPH ISSUE",
    directly_observed: true,
    direct_observation: true,
    review_required: false
  }],
  unresolved: []
});
assert.equal(directlySupportedPrintedAuto.fields.auto, true, "directly printed autograph wording may support Auto");
assert.deepEqual(directlySupportedPrintedAuto.unresolved, []);

const prefixOnlyCodeIsRejected = validateProviderEvidencePayload("openai_legacy", {
  fields: { collector_number: "CMP124" },
  field_evidence: [{
    field: "collector_number",
    value: "CMP124",
    source_type: "CARD_BACK_PRINTED_TEXT",
    source_image_id: "image-2",
    source_region: "collector_number",
    raw_text: "CODE#CMP124820",
    visible_text: "CODE#CMP124820",
    evidence_kind: "PRINTED_CARD_CODE",
    review_required: false,
    directly_observed: true,
    direct_observation: true
  }],
  unresolved: []
});
assert.equal(prefixOnlyCodeIsRejected.fields.collector_number, null, "a product-code prefix is not the printed collector number");
assert.ok(prefixOnlyCodeIsRejected.unresolved.includes("collector_number"));

const unsupportedSubjectCountLot = validateProviderEvidencePayload("openai_legacy", {
  fields: {
    players: ["Garrett Nussmeier", "Anderson", "Aaron Anderson"],
    multi_card: true,
    card_count: 3,
    lot_type: "multi_card_lot"
  },
  field_evidence: [],
  unresolved: []
});
assert.equal(unsupportedSubjectCountLot.fields.multi_card, false);
assert.equal(unsupportedSubjectCountLot.fields.card_count, null);
assert.equal(unsupportedSubjectCountLot.fields.lot_type, null);
assert.ok(unsupportedSubjectCountLot.unresolved.includes("multi_card"));

const directlyObservedLot = validateProviderEvidencePayload("openai_legacy", {
  fields: { multi_card: true, card_count: 3, lot_type: "multi_card_lot" },
  field_evidence: [
    {
      field: "multi_card",
      value: true,
      source_type: "VISION_ONLY",
      source_image_id: "image-1",
      source_region: "multi_card_layout",
      evidence_kind: "PHYSICAL_CARD_COUNT",
      visible_text: "3 separate cards",
      review_required: true,
      directly_observed: true,
      direct_observation: true
    },
    {
      field: "card_count",
      value: 3,
      source_type: "VISION_ONLY",
      source_image_id: "image-1",
      source_region: "multi_card_layout",
      evidence_kind: "PHYSICAL_CARD_COUNT",
      visible_text: "3 separate cards",
      review_required: true,
      directly_observed: true,
      direct_observation: true
    },
    {
      field: "lot_type",
      value: "multi_card_lot",
      source_type: "VISION_ONLY",
      source_image_id: "image-1",
      source_region: "multi_card_layout",
      evidence_kind: "PHYSICAL_CARD_COUNT",
      visible_text: "3 separate cards",
      review_required: true,
      directly_observed: true,
      direct_observation: true
    }
  ],
  unresolved: []
});
assert.equal(directlyObservedLot.fields.multi_card, false, "provider-only visual lot claims must fail closed");
assert.equal(directlyObservedLot.fields.card_count, null);
assert.ok(directlyObservedLot.unresolved.includes("multi_card"));
assert.equal(directlyObservedLot.field_evidence.multi_card, undefined);
assert.equal(directlyObservedLot.field_evidence.card_count, undefined);
assert.equal(directlyObservedLot.field_evidence.lot_type, undefined);
assert.deepEqual(
  directlyObservedLot.provider_field_rejections.at(-1).rejected_evidence_fields,
  ["multi_card", "card_count", "lot_type"]
);
const directlyObservedLotDocument = providerPayloadToEvidenceDocument(directlyObservedLot);
assert.equal(directlyObservedLotDocument.resolved.multi_card, false, "rejected lot evidence must not be reconstructed downstream");
assert.equal(directlyObservedLotDocument.resolved.card_count, null);

const operatorConfirmedLot = validateProviderEvidencePayload("openai_legacy", issueTrustedOperatorEvidenceEnvelope({
  fields: { multi_card: true, card_count: 3, lot_type: "multi_card_lot" },
  field_evidence: [{
    field: "multi_card",
    value: true,
    source_type: "OPERATOR",
    source_image_id: "image-1",
    source_region: "multi_card_layout",
    evidence_kind: "PHYSICAL_CARD_COUNT",
    operator_action_id: "operator-lot-action",
    visible_text: "3 separate cards",
    directly_observed: true,
    direct_observation: true
  }],
  unresolved: []
}, { operatorActionId: "operator-lot-action" }));
assert.equal(operatorConfirmedLot.fields.multi_card, true);
assert.equal(operatorConfirmedLot.fields.card_count, 3);
assert.equal(operatorConfirmedLot.field_evidence.multi_card.source_type, "OPERATOR");

const pairedViewsAreNotALot = validateProviderEvidencePayload("openai_legacy", {
  fields: { multi_card: true, card_count: 2, lot_type: "multi_card_lot" },
  field_evidence: [{
    field: "multi_card",
    value: true,
    source_type: "VISION_ONLY",
    source_image_id: "image-1",
    source_region: "card_layout",
    evidence_kind: "PHYSICAL_CARD_COUNT",
    visible_text: "1 card in a slab",
    review_required: true,
    directly_observed: true,
    direct_observation: true
  }],
  unresolved: []
});
assert.equal(pairedViewsAreNotALot.fields.multi_card, false, "two uploaded views of one card must not become Lot x2");
assert.equal(pairedViewsAreNotALot.fields.card_count, null);
assert.ok(pairedViewsAreNotALot.unresolved.includes("multi_card"));

const parsedTool = parseProviderMessagePayload({
  tool_calls: [
    {
      type: "function",
      function: {
        name: "submit_card_evidence",
        arguments: JSON.stringify(shorthandEvidence)
      }
    }
  ]
});
assert.equal(parsedTool.parse_source, "tool_call");
assert.equal(validateProviderEvidencePayload("openai_legacy", parsedTool.parsed).evidence.player.value, "Tester");

const schemaFailures = [
  {
    name: "non object",
    payload: null,
    expectedPath: null
  },
  {
    name: "missing shape",
    payload: { confidence: "HIGH" },
    expectedPath: "payload"
  },
  {
    name: "bad unresolved",
    payload: { title: "x", unresolved: "parallel" },
    expectedPath: "unresolved"
  },
  {
    name: "bad field object",
    payload: { fields: { player: { nested: true } }, unresolved: [] },
    expectedPath: "fields.player"
  },
  {
    name: "bad evidence shorthand",
    payload: { evidence: { player: { confidence: 2 } }, unresolved: [] },
    expectedPath: "evidence.player"
  },
  {
    name: "bad full evidence",
    payload: {
      evidence: {
        serial_number: {
          value: "31/50",
          normalized_value: "31/50",
          status: "CERTAIN",
          confidence: 0.82,
          candidates: [{ value: "31/50", confidence: 0.82 }],
          sources: [{ source_type: "CARD_FRONT", trust_tier: 1 }],
          conflicts: []
        }
      },
      unresolved: []
    },
    expectedPath: "evidence.serial_number.status"
  },
  {
    name: "unknown resolved field",
    payload: {
      resolved: {
        fake_field: "x"
      },
      unresolved: []
    },
    expectedPath: "resolved.fake_field"
  },
  {
    name: "bad resolved card count",
    payload: {
      resolved: {
        card_count: 0
      },
      unresolved: []
    },
    expectedPath: "resolved.card_count"
  },
  {
    name: "bad image quality",
    payload: {
      title: "x",
      image_quality: "good",
      unresolved: []
    },
    expectedPath: "image_quality"
  }
];

for (const failure of schemaFailures) {
  assert.throws(
    () => validateProviderEvidencePayload("openai_legacy", failure.payload),
    (error) => {
      assert.equal(error.code, "schema_validation_failed", failure.name);
      assert.equal(error.retryable, true, `${failure.name}: a fresh provider response may recover once`);
      if (failure.expectedPath) {
        assert.equal(error.details.validation_errors[0].path, failure.expectedPath, failure.name);
      }
      return true;
    }
  );
}

console.log("provider response normalizer tests passed");
