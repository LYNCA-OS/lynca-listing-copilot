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

const seasonYearIsNotPrintRun = normalizePaddleOcrResponse({
  raw_text: "2022-23 NBA SEASON NO. 23",
  confidence: 0.94
}, {
  request_id: "ocr-serial-season-guard",
  image_url: "https://storage.test/serial-season.jpg",
  crop_type: "serial_crop"
});
assert.equal(seasonYearIsNotPrintRun.normalized_fields.serial_number, undefined);
assert.equal(seasonYearIsNotPrintRun.normalized_fields.print_run_denominator, undefined);

const isolatedHyphenPrintRun = normalizePaddleOcrResponse({
  raw_text: "09-50",
  confidence: 0.95
}, {
  request_id: "ocr-serial-hyphen",
  image_url: "https://storage.test/serial-hyphen.jpg",
  crop_type: "serial_crop"
});
assert.equal(isolatedHyphenPrintRun.normalized_fields.serial_number, "09/50");
assert.equal(isolatedHyphenPrintRun.normalized_fields.print_run_denominator, "50");

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

const bgsDualGradeResult = normalizePaddleOcrResponse({
  raw_text: "BGS 8.5 AUTOGRAPH 10 CERT 0020299654",
  confidence: 0.97
}, {
  request_id: "ocr-grade-dual",
  image_url: "https://storage.test/grade-dual.jpg",
  crop_type: "grade_label"
});
assert.equal(bgsDualGradeResult.normalized_fields.grade_company, "BGS");
assert.equal(bgsDualGradeResult.normalized_fields.card_grade, "8.5");
assert.equal(bgsDualGradeResult.normalized_fields.auto_grade, "10");
assert.equal(bgsDualGradeResult.normalized_fields.grade_type, "CARD_AND_AUTO");

const certCannotOverwriteGrade = normalizePaddleOcrResponse({
  raw_text: "PSA CERT 127928791",
  confidence: 0.96,
  normalized_fields: {
    grade_company: "PSA",
    card_grade: "127928791",
    cert_number: "127928791"
  }
}, {
  request_id: "ocr-grade-cert-guard",
  image_url: "https://storage.test/grade-cert.jpg",
  crop_type: "grade_label"
});
assert.equal(certCannotOverwriteGrade.normalized_fields.card_grade, null);
assert.equal(certCannotOverwriteGrade.normalized_fields.cert_number, "127928791");
assert.equal(certCannotOverwriteGrade.normalized_fields.grade_type, "UNKNOWN");

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
assert.equal(clientResult.worker_attempt_count, 1);

let retryCalls = 0;
const retryClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://ocr-retry.internal",
    PADDLE_OCR_REQUEST_MAX_ATTEMPTS: "2",
    PADDLE_OCR_RETRY_BASE_MS: "1"
  },
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => "temporarily unavailable"
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ raw_text: "31/50", confidence: 0.94 })
    };
  }
});
const retryResult = await retryClient.verifyCrop(request);
assert.equal(retryCalls, 2);
assert.equal(retryResult.worker_attempt_count, 2);

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
