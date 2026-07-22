import assert from "node:assert/strict";
import { evaluateOcrFieldAb } from "./evaluate-ocr-field-ab.mjs";

const crops = Array.from({ length: 300 }, (_, index) => ({
  crop_id: `crop-${index + 1}`,
  image_url: `https://storage.test/${index + 1}.jpg`,
  crop_type: "serial_number",
  field: "serial_number",
  expected_value: `${index + 1}/999`,
  label_source: "HUMAN_REVIEWED_FIELD"
}));

let call = 0;
const client = {
  async verifyCrop(request) {
    call += 1;
    const index = Number(request.request_id.split("-")[1]);
    const expected = `${index}/999`;
    const paddleCorrect = index <= 280;
    const visionCorrect = index <= 250;
    const correct = request.ocr_backend === "paddle" ? paddleCorrect : visionCorrect;
    return {
      status: "OK",
      raw_text: correct ? expected : "noise",
      normalized_fields: correct ? { serial_number: expected } : {},
      confidence: 0.9,
      latency_ms: request.ocr_backend === "paddle" ? 900 : 700
    };
  }
};

const report = await evaluateOcrFieldAb({ payload: { cohort_id: "fixed-300", crops }, client, concurrency: 2 });
assert.equal(call, 600);
assert.equal(report.metrics.paired.paddle_wins, 30);
assert.equal(report.metrics.paired.google_vision_wins, 0);
assert.equal(report.gates.complete_reviewed_cohort, true);
assert.equal(report.gates.switch_primary_eligible, true);
assert.equal(report.decision, "SWITCH_PADDLE_PRIMARY");

const diagnosticOnly = await evaluateOcrFieldAb({
  payload: { crops: crops.map((crop) => ({ ...crop, label_source: "TITLE_DERIVED_HINT" })) },
  client,
  concurrency: 2
});
assert.equal(diagnosticOnly.reviewed_field_label_count, 0);
assert.equal(diagnosticOnly.gates.switch_primary_eligible, false);
assert.equal(diagnosticOnly.decision, "KEEP_GOOGLE_VISION_PRIMARY");

console.log("OCR field paired A/B tests passed");
