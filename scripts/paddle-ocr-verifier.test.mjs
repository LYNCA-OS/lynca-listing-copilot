import assert from "node:assert/strict";
import {
  applyOcrEvidencePatchToResult,
  normalizePaddleOcrResponse,
  ocrResultToEvidencePatch,
  validateOcrRequest
} from "../lib/listing/ocr/ocr-contract.mjs";
import {
  createPaddleOcrClient,
  PaddleOcrClientError,
  paddleOcrConfig
} from "../lib/listing/ocr/paddle-ocr-client.mjs";
import {
  createEvidenceField,
  createVisionSource
} from "../lib/listing/evidence/evidence-schema.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";

const request = {
  request_id: "ocr-serial-1",
  image_url: "https://storage.test/serial-crop.jpg?token=secret",
  crop_type: "serial_crop",
  expected_pattern: "serial_number",
  metadata: {
    image_id: "front",
    crop_id: "crop-serial"
  }
};

assert.deepEqual(validateOcrRequest(request), []);
assert.ok(validateOcrRequest({ ...request, image_url: "" }).some((error) => error.path === "image_url"));

const ocrResult = normalizePaddleOcrResponse({
  raw_text: "Serial 31 / 50",
  confidence: 0.93,
  boxes: [{ text: "31 / 50", confidence: 0.93, bbox: [10, 20, 90, 40] }],
  model_id: "paddleocr",
  model_revision: "ppocr-v5"
}, request, { startedAt: 100, endedAt: 132 });
assert.equal(ocrResult.crop_type, "serial_number");
assert.equal(ocrResult.normalized_fields.serial_number, "31/50");
assert.equal(ocrResult.normalized_fields.serial_denominator, "50");
assert.equal(ocrResult.normalized_fields.card_grade, undefined);
assert.equal(ocrResult.normalized_fields.collector_number, undefined);
assert.equal(ocrResult.latency_ms, 32);

const patch = ocrResultToEvidencePatch(ocrResult, {
  imageId: "front",
  cropId: "crop-serial"
});
assert.equal(patch.policy.can_generate_title, false);
assert.equal(patch.policy.can_override_resolved_fields, false);
assert.equal(patch.evidence.serial_number.value, "31/50");
assert.equal(patch.evidence.serial_number.sources[0].source_type, "OCR");

const gptResult = {
  resolved: {
    year: "2024",
    product: "Topps Chrome",
    players: ["Shohei Ohtani"],
    serial_number: "37/50"
  },
  evidence: {
    year: createEvidenceField({
      value: "2024",
      status: "CONFIRMED",
      confidence: 0.9,
      sources: [createVisionSource({ sourceType: "CARD_BACK", observedText: "2024 Topps Chrome" })]
    }),
    product: createEvidenceField({
      value: "Topps Chrome",
      status: "CONFIRMED",
      confidence: 0.9,
      sources: [createVisionSource({ sourceType: "CARD_BACK", observedText: "Topps Chrome" })]
    }),
    players: createEvidenceField({
      value: ["Shohei Ohtani"],
      status: "CONFIRMED",
      confidence: 0.9,
      sources: [createVisionSource({ sourceType: "CARD_FRONT", observedText: "Shohei Ohtani" })]
    }),
    serial_number: createEvidenceField({
      value: "37/50",
      status: "REVIEW",
      confidence: 0.78,
      sources: [createVisionSource({ sourceType: "VISION_MODEL", observedText: "37/50" })]
    })
  },
  unresolved: []
};
const merged = applyOcrEvidencePatchToResult(gptResult, patch);
assert.equal(merged.resolved.serial_number, "37/50", "OCR patch must not overwrite resolved fields before Resolver/Gate");
assert.equal(merged.evidence.serial_number.status, "CONFLICT");
assert.ok(merged.conflict_map.some((conflict) => conflict.conflict_type === "OCR_FIELD_CONFLICT"));

const gated = applyIdentityResolutionGate(merged, {
  providerId: "openai_legacy",
  maxLength: 85
});
assert.ok(gated.conflict_map.some((conflict) => conflict.field === "serial_number"));
assert.equal(gated.publication_gate.field_publication_states.serial_number, "REVIEW_REQUIRED");

const gradeResult = normalizePaddleOcrResponse({
  raw_text: "PSA GEM MT 10 Cert 123456789",
  confidence: 0.96
}, {
  request_id: "ocr-grade-1",
  image_url: "https://storage.test/grade.jpg",
  crop_type: "grade_label"
});
assert.equal(gradeResult.normalized_fields.grade_company, "PSA");
assert.equal(gradeResult.normalized_fields.card_grade, "10");
assert.equal(gradeResult.normalized_fields.cert_number, "123456789");

const tcgResult = normalizePaddleOcrResponse({
  raw_text: "OP01-001 Luffy SR",
  confidence: 0.91
}, {
  request_id: "ocr-tcg-1",
  image_url: "https://storage.test/tcg.jpg",
  crop_type: "tcg_code"
});
assert.equal(tcgResult.normalized_fields.tcg_card_number, "OP01-001");
assert.equal(tcgResult.normalized_fields.rarity, "SR");

const disabledConfig = paddleOcrConfig({
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "false"
});
assert.equal(disabledConfig.enabled, false);

const disabledClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "false"
  },
  fetchImpl: async () => {
    throw new Error("should not fetch");
  }
});
await assert.rejects(
  disabledClient.verifyCrop(request),
  (error) => error instanceof PaddleOcrClientError && error.code === "paddle_ocr_disabled"
);

let captured = null;
const client = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://ocr.internal",
    PADDLE_OCR_WORKER_TOKEN: "secret-token",
    PADDLE_OCR_MODEL_REVISION: "ppocr-v5"
  },
  fetchImpl: async (url, init) => {
    captured = {
      url,
      headers: init.headers,
      body: JSON.parse(init.body)
    };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        raw_text: "31/50",
        confidence: 0.94,
        model_id: "paddleocr",
        model_revision: "ppocr-v5"
      })
    };
  }
});
const clientResult = await client.verifyCrop(request);
assert.equal(captured.url, "https://ocr.internal/v1/ocr-field");
assert.equal(captured.headers.authorization, "Bearer secret-token");
assert.equal(captured.body.image_url.includes("token=secret"), true);
assert.equal(clientResult.evidence_patch.evidence.serial_number.value, "31/50");

const roundRobinUrls = [];
const roundRobinClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URLS: "https://ocr-a.internal, https://ocr-b.internal",
    PADDLE_OCR_WORKER_TOKEN: "secret-token"
  },
  fetchImpl: async (url) => {
    roundRobinUrls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ raw_text: "31/50", confidence: 0.94 })
    };
  }
});
await roundRobinClient.verifyCrop(request);
await roundRobinClient.verifyCrop(request);
await roundRobinClient.verifyCrop(request);
assert.deepEqual(roundRobinUrls, [
  "https://ocr-a.internal/v1/ocr-field",
  "https://ocr-b.internal/v1/ocr-field",
  "https://ocr-a.internal/v1/ocr-field"
]);

console.log("paddle ocr verifier tests passed");
