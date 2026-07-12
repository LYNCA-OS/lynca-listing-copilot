import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseProviderMessagePayload,
  validateProviderEvidencePayload
} from "../lib/listing/providers/provider-response-normalizer.mjs";
import { openAiProviderResponseSchema } from "../lib/listing/providers/openai-emergency-provider.mjs";
import { resolvedFieldNames } from "../lib/listing/evidence/evidence-schema.mjs";

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
    name: "bad field evidence key",
    payload: { field_evidence: { fake_field: { value: "Tester" } }, unresolved: [] },
    expectedPath: "field_evidence.fake_field"
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
