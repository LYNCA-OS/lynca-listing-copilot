import assert from "node:assert/strict";
import { evaluateGoldenSemAccuracy } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { assessLaunchAccuracy } from "../lib/listing/evaluation/launch-benchmark.mjs";
import { buildReviewedTitleSemProxy } from "./build-reviewed-title-sem-proxy.mjs";

const proxy = buildReviewedTitleSemProxy({
  blindDataset: {
    items: [{
      asset_id: "card-1",
      source_feedback_id: "feedback-1",
      sealed_eval_label_ref: { key: "label-1" },
      source_record: { sealed_eval_label_key: "label-1" },
      images: [{ bucket: "cards", object_path: "card-1.jpg" }]
    }]
  },
  sealedLabels: [{
    key: "label-1",
    reviewed_title: "2024 Topps Chrome Test Player Gold 2/3 PSA 10"
  }],
  now: () => new Date("2026-07-15T00:00:00.000Z")
});

assert.equal(proxy.items.length, 1);
assert.equal(proxy.evaluation_truth_policy.field_ground_truth_class, "REVIEWED_TITLE_DERIVED_SEM_PROXY");
assert.equal(proxy.evaluation_truth_policy.launch_gate_eligible, false);
assert.equal(proxy.items[0].reviewed_ground_truth.field_statuses.year, "CONFIRMED");
assert.equal(proxy.items[0].reviewed_ground_truth.field_statuses.language, "UNKNOWN");
assert.equal(proxy.items[0].recognition_input.corrected_title, undefined);

const accuracy = evaluateGoldenSemAccuracy({
  dataset: proxy,
  predictions: {
    results: [{
      asset_id: "card-1",
      resolved_fields: {
        year: "2024",
        manufacturer: "Topps",
        product: "Topps Chrome",
        players: ["Test Player"],
        parallel: "Gold",
        serial_number: "2/3",
        grade_company: "PSA",
        card_grade: "10"
      }
    }]
  }
});

assert.equal(accuracy.status, "COMPLETED_PROXY");
assert.equal(accuracy.formal_launch_gate_eligible, false);
assert.equal(accuracy.scope.formal_golden_sem, false);
assert.equal(accuracy.scope.launch_gate_eligible, false);
assert.equal(accuracy.scope.formal_launch_gate_eligible, false);
assert.equal(accuracy.scope.writer_title_used_as_field_ground_truth, true);
assert.equal(accuracy.source.field_ground_truth_class, "REVIEWED_TITLE_DERIVED_SEM_PROXY");
assert.equal(accuracy.cards[0].fields.product.is_correct, true);
const proxyLaunchAssessment = assessLaunchAccuracy(accuracy);
assert.equal(proxyLaunchAssessment.verdict, "INCONCLUSIVE");
assert.equal(proxyLaunchAssessment.formal_launch_gate_eligible, false);

const proxyCompatibleAccuracy = evaluateGoldenSemAccuracy({
  dataset: proxy,
  predictions: {
    results: [{
      asset_id: "card-1",
      resolved_fields: {
        year: "2024",
        product: "2024 Topps Chrome Basketball",
        players: ["Test Player"]
      }
    }]
  }
});
assert.equal(proxyCompatibleAccuracy.cards[0].fields.product.comparison_policy, "TITLE_PROXY_PRODUCT_HIERARCHY");
assert.equal(proxyCompatibleAccuracy.cards[0].fields.product.is_correct, true);

const formalDataset = structuredClone(proxy);
formalDataset.partition = "development";
formalDataset.evaluation_truth_policy = {
  field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH",
  launch_gate_eligible: true
};
const strictAccuracy = evaluateGoldenSemAccuracy({
  dataset: formalDataset,
  predictions: {
    results: [{
      asset_id: "card-1",
      resolved_fields: {
        year: "2024",
        product: "2024 Topps Chrome Basketball",
        players: ["Test Player"]
      }
    }]
  }
});
assert.equal(strictAccuracy.cards[0].fields.product.comparison_policy, "STRICT_SEM_FIELD");
assert.equal(strictAccuracy.cards[0].fields.product.is_correct, false);
assert.equal(strictAccuracy.scope.formal_launch_gate_eligible, false);
assert.equal(strictAccuracy.validation.formal_launch_ground_truth.review_metadata.ok, false);

const subjectBoundaryCases = [
  {
    id: "sports-subject",
    title: "2025 Topps Chrome Sapphire Shohei Ohtani Variation Gold 5/50 PSA 9",
    subject: ["Shohei Ohtani"]
  },
  {
    id: "multi-word-team",
    title: "2023 Topps Chrome Jaxson Dart RC New York Giants",
    subject: ["Jaxson Dart"]
  },
  {
    id: "standalone-card-code",
    title: "2020 Topps Chrome Sapphire CSA Gavin Lux RC Red Refractor Auto 3/5 PSA 9",
    subject: ["Gavin Lux"]
  },
  {
    id: "second-set-code",
    title: "2024-25 Topps Chrome NBL Karim Lopez RC Auto",
    subject: ["Karim Lopez"]
  },
  {
    id: "tcg-card-code",
    title: "2024 One Piece OP05-119 Monkey D. Luffy SEC",
    subject: ["Monkey D. Luffy"],
    cardNumber: "OP05-119"
  },
  {
    id: "all-caps-subject",
    title: "2020 TOPPS CHROME GAVIN LUX RC",
    subject: ["Gavin Lux"]
  },
  {
    id: "uppercase-surname-after-joiner",
    title: "2024 Topps Chrome Fernando De La CRUZ RC",
    subject: ["Fernando De La Cruz"]
  },
  {
    id: "roman-numeral-suffix",
    title: "2024 Panini Prizm Patrick Mahomes III RC",
    subject: ["Patrick Mahomes III"]
  }
];
const subjectBoundaryProxy = buildReviewedTitleSemProxy({
  blindDataset: {
    items: subjectBoundaryCases.map(({ id }) => ({
      asset_id: id,
      sealed_eval_label_ref: { key: id },
      images: [{ url: `https://example.test/${id}.jpg` }]
    }))
  },
  sealedLabels: subjectBoundaryCases.map(({ id, title }) => ({ key: id, reviewed_title: title }))
});

for (const expected of subjectBoundaryCases) {
  const fields = subjectBoundaryProxy.items.find((item) => item.item_id === expected.id)?.reviewed_ground_truth?.fields;
  assert.deepEqual(fields?.subject, expected.subject, `${expected.id}: adjacent CSM fields must not enter subject`);
  if (expected.cardNumber) assert.equal(fields.card_number, expected.cardNumber);
}

console.log("reviewed-title SEM proxy tests passed");
