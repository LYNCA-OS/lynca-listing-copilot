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
  ocr_backend: "paddle",
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

const serialCropCannotCreateGrade = normalizePaddleOcrResponse({
  raw_text: "PLAYER DATA PSA 2 63787877",
  confidence: 0.7901,
  boxes: [
    { text: "PSA", confidence: 0.989, bbox: [20, 20, 80, 45] },
    { text: "2", confidence: 0.1118, bbox: [85, 20, 100, 45] },
    { text: "63787877", confidence: 0.9979, bbox: [110, 20, 210, 45] }
  ]
}, {
  request_id: "ocr-serial-grade-boundary",
  image_url: "https://storage.test/full-card.jpg",
  crop_type: "serial_crop"
});
assert.equal(serialCropCannotCreateGrade.normalized_fields.grade_company, undefined);
assert.equal(serialCropCannotCreateGrade.normalized_fields.card_grade, undefined);
assert.equal(ocrResultToEvidencePatch(serialCropCannotCreateGrade).evidence.card_grade, undefined);

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

for (const [requestId, rawText] of [
  ["ocr-serial-season-slash-guard", "MASTERS AUTOGRAPH CARD FROM 2025/26 TOPPS FINEST"],
  ["ocr-serial-prose-season-slash-guard", "PERCENTAGE IMPROVED IN 2024/25 WHILE PLAYING"]
]) {
  const slashSeasonYearIsNotPrintRun = normalizePaddleOcrResponse({
    raw_text: rawText,
    confidence: 0.97
  }, {
    request_id: requestId,
    image_url: "https://storage.test/serial-season-slash.jpg",
    crop_type: "serial_crop"
  });
  assert.equal(slashSeasonYearIsNotPrintRun.normalized_fields.serial_number, undefined);
  assert.equal(slashSeasonYearIsNotPrintRun.normalized_fields.print_run_denominator, undefined);
}

const explicitSeasonSuffixCannotBypassGuard = normalizePaddleOcrResponse({
  raw_text: "MASTERS AUTOGRAPH CARD FROM 2025/26 TOPPS FINEST",
  normalized_fields: {
    serial_number: "#/26",
    serial_denominator: "26",
    print_run_denominator: "26"
  },
  confidence: 0.99
}, {
  request_id: "ocr-explicit-season-slash-guard",
  image_url: "https://storage.test/serial-season-explicit.jpg",
  crop_type: "serial_crop"
});
assert.equal(explicitSeasonSuffixCannotBypassGuard.normalized_fields.serial_number, undefined);
assert.equal(explicitSeasonSuffixCannotBypassGuard.normalized_fields.serial_denominator, undefined);

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

const psaLabelWithOcrDroppedLetter = normalizePaddleOcrResponse({
  raw_text: "2020 BOWMAN DRAFT GEM MT CHR.DP AUTO-BLACK REF 10 PA 63787877",
  confidence: 0.9771,
  boxes: [
    { text: "2020 BOWMAN DRAFT", confidence: 0.9509, bbox: [0, 0, 190, 24] },
    { text: "GEM MT", confidence: 0.9524, bbox: [0, 30, 90, 54] },
    { text: "CHR.DP AUTO-BLACK REF", confidence: 0.9571, bbox: [100, 30, 300, 54] },
    { text: "10", confidence: 0.9938, bbox: [305, 30, 340, 62] },
    { text: "PA", confidence: 0.9626, bbox: [350, 30, 390, 54] },
    { text: "63787877", confidence: 0.997, bbox: [400, 30, 500, 54] }
  ]
}, {
  request_id: "ocr-grade-psa-dropped-letter",
  image_url: "https://storage.test/grade-label.jpg",
  crop_type: "grade_label"
});
assert.equal(psaLabelWithOcrDroppedLetter.normalized_fields.grade_company, "PSA");
assert.equal(psaLabelWithOcrDroppedLetter.normalized_fields.card_grade, "10");
assert.equal(psaLabelWithOcrDroppedLetter.normalized_fields.cert_number, "63787877");
assert.equal(psaLabelWithOcrDroppedLetter.normalized_field_confidence.card_grade, 0.9938);
assert.equal(ocrResultToEvidencePatch(psaLabelWithOcrDroppedLetter).evidence.card_grade.confidence, 0.9938);

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

const bgsDetachedMainGrade = normalizePaddleOcrResponse({
  raw_text: "BECKETT\nCENTERING 9\nCORNERS 8\nEDGES 8.5\nSURFACE 9\nAUTOGRAPH 10",
  confidence: 0.95,
  boxes: [
    { text: "BECKETT", confidence: 0.98, bbox: [0, 0, 180, 36] },
    { text: "8.5", confidence: 0.97, bbox: [210, 0, 330, 100] },
    { text: "CENTERING 9", confidence: 0.92, bbox: [0, 110, 150, 130] },
    { text: "CORNERS 8", confidence: 0.91, bbox: [0, 135, 150, 155] },
    { text: "EDGES 8.5", confidence: 0.92, bbox: [0, 160, 150, 180] },
    { text: "SURFACE 9", confidence: 0.92, bbox: [0, 185, 150, 205] },
    { text: "AUTOGRAPH", confidence: 0.96, bbox: [210, 110, 330, 135] },
    { text: "10", confidence: 0.97, bbox: [210, 140, 330, 210] }
  ]
}, {
  request_id: "ocr-grade-detached-main",
  image_url: "https://storage.test/grade-detached.jpg",
  crop_type: "grade_label"
});
assert.equal(bgsDetachedMainGrade.normalized_fields.grade_company, "BGS");
assert.equal(bgsDetachedMainGrade.normalized_fields.card_grade, "8.5", "the largest detached score is the BGS card grade, not a subgrade");
assert.equal(bgsDetachedMainGrade.normalized_fields.auto_grade, "10");
assert.equal(bgsDetachedMainGrade.normalized_fields.grade_type, "CARD_AND_AUTO");

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
assert.equal(certCannotOverwriteGrade.normalized_fields.card_grade, undefined);
assert.equal(certCannotOverwriteGrade.normalized_fields.cert_number, "127928791");
assert.equal(certCannotOverwriteGrade.normalized_fields.grade_type, undefined);

const unrelatedCardTextNumberCannotBecomeGrade = normalizePaddleOcrResponse({
  raw_text: "PSA CERT 127928791\nPLAYER DATA\n4",
  confidence: 0.95,
  boxes: [
    { text: "PSA CERT 127928791", confidence: 0.98, bbox: [0, 0, 220, 28] },
    { text: "PLAYER DATA", confidence: 0.93, bbox: [0, 80, 160, 105] },
    { text: "4", confidence: 0.97, bbox: [180, 80, 210, 105] }
  ]
}, {
  request_id: "ocr-grade-unrelated-number-guard",
  image_url: "https://storage.test/grade-unrelated-number.jpg",
  crop_type: "grade_label"
});
assert.equal(unrelatedCardTextNumberCannotBecomeGrade.normalized_fields.grade_company, "PSA");
assert.equal(unrelatedCardTextNumberCannotBecomeGrade.normalized_fields.card_grade, undefined);

const lowConfidenceBackTextCannotBecomePsaGrade = normalizePaddleOcrResponse({
  raw_text: "PSA 63787877 PSA 2 PLAYER DATA COPYRIGHT 2020 BOWMAN DRAFT",
  confidence: 0.9896,
  normalized_fields: {
    grade_company: "PSA",
    card_grade: "2",
    grade_type: "CARD_ONLY",
    cert_number: "63787877"
  },
  boxes: [
    { text: "PSA", confidence: 0.979, bbox: [0, 0, 70, 24] },
    { text: "63787877", confidence: 0.996, bbox: [80, 0, 190, 24] },
    { text: "PSA", confidence: 0.981, bbox: [0, 30, 70, 54] },
    { text: "2", confidence: 0.1118, bbox: [80, 30, 100, 54] },
    { text: "PLAYER DATA COPYRIGHT 2020 BOWMAN DRAFT", confidence: 0.96, bbox: [0, 100, 420, 130] }
  ]
}, {
  request_id: "ocr-grade-production-back-text-guard",
  image_url: "https://storage.test/card-back.jpg",
  crop_type: "grade_label"
});
assert.equal(lowConfidenceBackTextCannotBecomePsaGrade.normalized_fields.grade_company, "PSA");
assert.equal(lowConfidenceBackTextCannotBecomePsaGrade.normalized_fields.card_grade, undefined);
assert.equal(lowConfidenceBackTextCannotBecomePsaGrade.normalized_fields.grade_type, undefined);
assert.equal(lowConfidenceBackTextCannotBecomePsaGrade.normalized_fields.cert_number, "63787877");
assert.equal(ocrResultToEvidencePatch(lowConfidenceBackTextCannotBecomePsaGrade).evidence.card_grade, undefined);

const detachedPsaGradeWithLocalMarker = normalizePaddleOcrResponse({
  raw_text: "PSA\nGEM MT\n10",
  confidence: 0.97,
  boxes: [
    { text: "PSA", confidence: 0.98, bbox: [0, 0, 80, 25] },
    { text: "GEM MT", confidence: 0.96, bbox: [0, 30, 100, 55] },
    { text: "10", confidence: 0.97, bbox: [110, 30, 160, 70] }
  ]
}, {
  request_id: "ocr-grade-detached-psa",
  image_url: "https://storage.test/grade-detached-psa.jpg",
  crop_type: "grade_label"
});
assert.equal(detachedPsaGradeWithLocalMarker.normalized_fields.grade_company, "PSA");
assert.equal(detachedPsaGradeWithLocalMarker.normalized_fields.card_grade, "10");

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

const statsTableNumberIsNotCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "COLLEGE PASSING RECORD YR TEAM ATT COMP 99 MICHIGAN 341 214",
  confidence: 0.97
}, {
  request_id: "ocr-card-number-stats-guard",
  image_url: "https://storage.test/card-back.jpg",
  crop_type: "collector_number"
});
assert.equal(statsTableNumberIsNotCollectorNumber.normalized_fields.collector_number, undefined);

const websiteCodeIsNotCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "WWW.TOPPS.COM CODE#CMP127171",
  confidence: 0.96
}, {
  request_id: "ocr-card-number-website-guard",
  image_url: "https://storage.test/card-back-code.jpg",
  crop_type: "collector_number"
});
assert.equal(websiteCodeIsNotCollectorNumber.normalized_fields.collector_number, undefined);
assert.equal(websiteCodeIsNotCollectorNumber.normalized_fields.checklist_code, undefined);

const ocrConfusedWebsiteCodeIsNotCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "WWW.T0PPS.C0M C0DE#CMP134780",
  confidence: 0.98
}, {
  request_id: "ocr-card-number-confused-website-guard",
  image_url: "https://storage.test/card-back-confused-code.jpg",
  crop_type: "collector_number"
});
assert.equal(ocrConfusedWebsiteCodeIsNotCollectorNumber.normalized_fields.collector_number, undefined);
assert.equal(ocrConfusedWebsiteCodeIsNotCollectorNumber.normalized_fields.checklist_code, undefined);

const proseNoIsNotCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "HUSTLE IS HAVING NO REGRETS AND DOING THE WORK",
  confidence: 0.98
}, {
  request_id: "ocr-card-number-prose-no-guard",
  image_url: "https://storage.test/card-back-prose.jpg",
  crop_type: "collector_number"
});
assert.equal(proseNoIsNotCollectorNumber.normalized_fields.collector_number, undefined);

const explicitFalseCodesCannotBypassGuard = normalizePaddleOcrResponse({
  raw_text: "WWW.T0PPS.C0M C0DE#CMP134780\nHUSTLE IS HAVING NO REGRETS",
  normalized_fields: {
    collector_number: "REGRETS",
    checklist_code: "CMP134780"
  },
  confidence: 0.99
}, {
  request_id: "ocr-explicit-false-code-guard",
  image_url: "https://storage.test/card-back-explicit-false-code.jpg",
  crop_type: "collector_number"
});
assert.equal(explicitFalseCodesCannotBypassGuard.normalized_fields.collector_number, undefined);
assert.equal(explicitFalseCodesCannotBypassGuard.normalized_fields.checklist_code, undefined);

const alphaCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "No. PAU-AED",
  confidence: 0.96
}, {
  request_id: "ocr-card-number-alpha",
  image_url: "https://storage.test/card-back-number.jpg",
  crop_type: "collector_number"
});
assert.equal(alphaCollectorNumber.normalized_fields.collector_number, "PAU-AED");

const numericCollectorNumber = normalizePaddleOcrResponse({
  raw_text: "Card #381",
  confidence: 0.96
}, {
  request_id: "ocr-card-number-numeric",
  image_url: "https://storage.test/card-back-number-381.jpg",
  crop_type: "collector_number"
});
assert.equal(numericCollectorNumber.normalized_fields.collector_number, "381");

const validNumberSurvivesUnrelatedWebsiteText = normalizePaddleOcrResponse({
  raw_text: "CARD #381\nWWW.TOPPS.COM",
  confidence: 0.96
}, {
  request_id: "ocr-card-number-with-website",
  image_url: "https://storage.test/card-back-number-with-website.jpg",
  crop_type: "collector_number"
});
assert.equal(validNumberSurvivesUnrelatedWebsiteText.normalized_fields.collector_number, "381");

const disabledConfig = paddleOcrConfig({
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "false"
});
assert.equal(disabledConfig.enabled, false);

const canonicalWorkerConfig = paddleOcrConfig({
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
  RECOGNITION_WORKER_URL: "https://recognition-canonical.internal",
  PADDLE_OCR_WORKER_URL: "https://legacy-shadow.internal"
});
assert.equal(canonicalWorkerConfig.url, "https://recognition-canonical.internal");

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
        ocr_backend: "google_vision",
        model_id: "paddleocr",
        model_revision: "ppocr-v5",
        inline_full_image_fallback_evaluated: true,
        inline_full_image_fallback_used: true,
        inline_full_image_fallback_target_found: true,
        inline_grade_component_fallback_used: true,
        inline_grade_component_fallback_kind: "company",
        inline_grade_component_fallback_target_found: true,
        inline_grade_component_fallback_latency_ms: 5,
        primary_ocr_latency_ms: 8,
        fallback_ocr_latency_ms: 13
      })
    };
  }
});
const clientResult = await client.verifyCrop(request);
assert.equal(captured.url, "https://ocr.internal/v1/ocr-field");
assert.equal(captured.headers.authorization, "Bearer secret-token");
assert.equal(captured.body.image_url.includes("token=secret"), true);
assert.equal(captured.body.ocr_backend, "paddle", "paired A/B requests must preserve the explicit shadow backend");
assert.equal(clientResult.evidence_patch.evidence.serial_number.value, "31/50");
assert.equal(clientResult.ocr_backend, "google_vision");
assert.equal(clientResult.worker_attempt_count, 1);
assert.equal(clientResult.inline_full_image_fallback_evaluated, true);
assert.equal(clientResult.inline_full_image_fallback_used, true);
assert.equal(clientResult.inline_full_image_fallback_target_found, true);
assert.equal(clientResult.inline_grade_component_fallback_used, true);
assert.equal(clientResult.inline_grade_component_fallback_kind, "company");
assert.equal(clientResult.inline_grade_component_fallback_target_found, true);
assert.equal(clientResult.inline_grade_component_fallback_latency_ms, 5);
assert.equal(clientResult.primary_ocr_latency_ms, 8);
assert.equal(clientResult.fallback_ocr_latency_ms, 13);

let capturedBatch = null;
const batchClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://vision-ocr.internal",
    PADDLE_OCR_WORKER_TOKEN: "batch-secret"
  },
  fetchImpl: async (url, init) => {
    capturedBatch = { url, headers: init.headers, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        results: [
          {
            request_id: "ocr-serial-1",
            crop_type: "serial_crop",
            raw_text: "24/25",
            confidence: 0.97,
            ocr_backend: "google_vision",
            vision_unit_count: 2,
            vision_cost_estimate: 0.003,
            serial_consensus: { verified: true, chosen: "24/25" }
          },
          {
            request_id: "ocr-card-code-1",
            crop_type: "collector_number",
            raw_text: "381",
            confidence: 0.95,
            vision_unit_count: 1,
            vision_cost_estimate: 0.0015
          }
        ]
      })
    };
  }
});
const batchRequests = [
  request,
  {
    request_id: "ocr-card-code-1",
    image_url: "https://storage.test/card-code.jpg?token=secret",
    crop_type: "collector_number"
  }
];
const batchResults = await batchClient.verifyCrops(batchRequests);
assert.equal(capturedBatch.url, "https://vision-ocr.internal/v1/ocr-fields-batch");
assert.equal(capturedBatch.headers.authorization, "Bearer batch-secret");
assert.equal(capturedBatch.body.requests.length, 2);
assert.equal(batchResults.length, 2);
assert.equal(batchResults[0].normalized_fields.serial_number, "24/25");
assert.equal(batchResults[0].vision_unit_count, 2);
assert.equal(batchResults[0].ocr_backend, "google_vision");
assert.equal(batchResults[0].serial_consensus.verified, true);
assert.equal(batchResults[1].normalized_fields.collector_number, "381");

let compatibilityCalls = 0;
const compatibilityClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://old-ocr.internal"
  },
  fetchImpl: async (url) => {
    compatibilityCalls += 1;
    if (url.endsWith("/v1/ocr-fields-batch")) {
      return { ok: false, status: 404, text: async () => "not found" };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ raw_text: "31/50", confidence: 0.94 })
    };
  }
});
const compatibilityResults = await compatibilityClient.verifyCrops([request, request]);
assert.equal(compatibilityResults.length, 2);
assert.equal(compatibilityCalls, 3, "one unsupported batch call must fall back to two compatible single calls");

const missingLatencyClient = createPaddleOcrClient({
  env: {
    ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
    PADDLE_OCR_WORKER_URL: "https://ocr-no-latency.internal"
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ raw_text: "31/50", confidence: 0.94 })
  })
});
const missingLatencyResult = await missingLatencyClient.verifyCrop(request);
assert.equal(missingLatencyResult.primary_ocr_latency_ms, null);
assert.equal(missingLatencyResult.fallback_ocr_latency_ms, null);
assert.equal(missingLatencyResult.inline_grade_component_fallback_latency_ms, null);

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
