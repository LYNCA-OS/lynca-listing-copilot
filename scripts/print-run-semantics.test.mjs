import assert from "node:assert/strict";
import {
  __listingCopilotTitleTestHooks,
  serialNumeratorVerificationFromPreingestion,
  verifiedSerialNumeratorFromPreingestion
} from "../api/listing-copilot-title.js";
import {
  createEvidenceField,
  createVisionSource,
  normalizeResolvedFields
} from "../lib/listing/evidence/evidence-schema.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import { normalizePaddleOcrResponse } from "../lib/listing/ocr/ocr-contract.mjs";
import {
  parsePrintRunValue,
  printRunTitleText,
  stripReferencePrintRunNumerator
} from "../lib/listing/print-run/print-run-fields.mjs";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";

const direct = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    print_run_number: "31/50",
    serial_number: "31/50"
  },
  evidence: {
    print_run_number: createEvidenceField({
      value: "31/50",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [createVisionSource({ sourceType: "CARD_FRONT", observedText: "31/50", region: "serial_number" })]
    })
  },
  maxLength: 80
});
assert.match(direct.final_title, /31\/50/);
assert.equal(direct.modules.numerical_rarity.label, "Numbered / Print Run / 数字限编");
assert.equal(direct.modules.numerical_rarity.text, "31/50");

const directAwaitingOcrVerification = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    print_run_number: "31/50",
    serial_number: "31/50"
  },
  evidence: {
    print_run_number: createEvidenceField({
      value: "31/50",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [createVisionSource({ sourceType: "CARD_FRONT", observedText: "31/50", region: "serial_number" })]
    })
  },
  serialNumeratorVerified: false,
  maxLength: 80
});
assert.match(directAwaitingOcrVerification.final_title, /#\/50/);
assert.doesNotMatch(directAwaitingOcrVerification.final_title, /31\/50/);

const unverifiedOneOfOne = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    print_run_number: "1/1",
    serial_number: "1/1",
    one_of_one: true
  },
  evidence: {
    print_run_number: createEvidenceField({
      value: "1/1",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [createVisionSource({ sourceType: "CARD_FRONT", observedText: "1/1", region: "serial_number" })]
    })
  },
  serialNumeratorVerified: false,
  maxLength: 80
});
assert.doesNotMatch(unverifiedOneOfOne.final_title, /(?:1\/1|#\/1)/, "unverified 1/1 cannot degrade into an equivalent #/1 claim");
assert.equal(unverifiedOneOfOne.modules.numerical_rarity.text, "");

const finalizedAfterRejectedOcr = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  confidence: "HIGH",
  serial_numerator_verified: false,
  resolved_fields: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    print_run_number: "31/50",
    serial_number: "31/50"
  },
  evidence: {
    print_run_number: createEvidenceField({
      value: "31/50",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [createVisionSource({ sourceType: "CARD_FRONT", observedText: "31/50", region: "serial_number" })]
    })
  }
}, {});
assert.match(finalizedAfterRejectedOcr.final_title, /#\/50/);
assert.doesNotMatch(finalizedAfterRejectedOcr.final_title, /31\/50/);

const ocrSerialPatch = (value, confidence) => ({
  field: "print_run_number",
  value,
  source_type: "OCR",
  confidence
});
assert.equal(serialNumeratorVerificationFromPreingestion({
  preingestion_evidence_patches: [ocrSerialPatch("31/50", 0.93)]
}, { job_count: 1 }), true);
assert.equal(serialNumeratorVerificationFromPreingestion({
  preingestion_evidence_patches: [ocrSerialPatch("31/50", 0.72)]
}, { job_count: 1 }), false);
assert.equal(serialNumeratorVerificationFromPreingestion({
  preingestion_evidence_patches: [{
    ...ocrSerialPatch("31/50", 0.72),
    raw_text: "TEST PLAYER 31/50 AUTO",
    text_candidates: [{ value: "31/50", confidence: 0.95 }]
  }]
}, { job_count: 1 }), true, "an exact OCR line must keep its own confidence instead of the crop-wide average");

const verifiedOcrPayload = {
  images: [{ image_id: "img-current" }],
  preingestion_evidence_patches: [{
    ...ocrSerialPatch("30/99", 0.71),
    source_image_id: "img-current",
    raw_text: "TEST PLAYER 30/99 AUTO",
    text_candidates: [{ value: "30/99", confidence: 0.95 }]
  }]
};
const verifiedSerial = verifiedSerialNumeratorFromPreingestion(verifiedOcrPayload);
assert.equal(verifiedSerial.verified, true);
assert.equal(verifiedSerial.value, "30/99");

const lockedOcrTitle = __listingCopilotTitleTestHooks.withVerifiedPreingestionPrintRun({
  confidence: "HIGH",
  fields: {
    year: "2020",
    manufacturer: "Panini",
    product: "Plates & Patches",
    players: ["Justin Herbert"],
    serial_number: "06/09"
  },
  resolved: {
    year: "2020",
    manufacturer: "Panini",
    product: "Plates & Patches",
    players: ["Justin Herbert"],
    serial_number: "06/09"
  },
  resolved_fields: {
    year: "2020",
    manufacturer: "Panini",
    product: "Plates & Patches",
    players: ["Justin Herbert"],
    serial_number: "06/09"
  },
  evidence: {
    print_run_number: {
      value: "66/99",
      normalized_value: "66/99",
      status: "CONFIRMED",
      confidence: 0.99,
      source_type: "CARD_FRONT_PRINTED_TEXT"
    }
  }
}, verifiedOcrPayload);
assert.match(lockedOcrTitle.final_title, /30\/99/);
assert.doesNotMatch(lockedOcrTitle.final_title, /06\/9/);
assert.doesNotMatch(lockedOcrTitle.final_title, /66\/99/);
assert.equal(lockedOcrTitle.evidence.print_run_number.value, "30/99");
assert.equal(lockedOcrTitle.serial_numerator_verified, true);
assert.equal(lockedOcrTitle.conflict_map.at(-1).conflict_type, "OCR_CURRENT_IMAGE_OVERRIDE");
assert.equal(serialNumeratorVerificationFromPreingestion({
  preingestion_evidence_patches: [ocrSerialPatch("31/50", 0.93), ocrSerialPatch("37/50", 0.94)]
}, { job_count: 1 }), false);

const denominatorOnly = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    numbered_to: "50"
  },
  maxLength: 80
});
assert.match(denominatorOnly.final_title, /#\/50/);
assert.doesNotMatch(denominatorOnly.final_title, /31\/50/);

const referenceStripped = stripReferencePrintRunNumerator({
  serial_number: "31/50",
  print_run_number: "31/50"
});
assert.equal(referenceStripped.print_run_number, "#/50");
assert.equal(referenceStripped.print_run_numerator, null);
assert.equal(referenceStripped.print_run_denominator, "50");

const referenceRendered = renderListingPresentation({
  resolved: {
    year: "2024",
    manufacturer: "Panini",
    product: "Prizm",
    players: ["Test Player"],
    print_run_number: "31/50"
  },
  evidence: {
    print_run_number: createEvidenceField({
      value: "31/50",
      status: "CONFIRMED",
      confidence: 0.96,
      sources: [createVisionSource({ sourceType: "STRUCTURED_DATABASE", observedText: "reference title: 31/50" })]
    })
  },
  maxLength: 80
});
assert.match(referenceRendered.final_title, /#\/50/);
assert.doesNotMatch(referenceRendered.final_title, /31\/50/);

const parsedSports = parseReviewedTitleFields("2023-24 Panini Prizm Victor Wembanyama Gold Auto #136 31/50 PSA 10");
assert.equal(parsedSports.collector_number, "136");
assert.equal(parsedSports.card_number, "136");
assert.equal(parsedSports.print_run_number, "31/50");
assert.equal(parsedSports.print_run_numerator, "31");
assert.equal(parsedSports.print_run_denominator, "50");
assert.equal(parsedSports.numbered_to, "50");
assert.equal(parsedSports.serial_number, "31/50");
assert.equal(parsedSports.serial_denominator, "50");
assert.equal(parsedSports.grade_company, "PSA");
assert.equal(parsedSports.card_grade, "10");

const parsedTcg = parseReviewedTitleFields("2024 One Piece Championship Top Players Pack Eustass Captain Kid ST10-013 PSA 10");
assert.equal(parsedTcg.checklist_code, "ST10-013");
assert.equal(parsedTcg.tcg_card_number, "ST10-013");
assert.equal(parsedTcg.print_run_number, null);
assert.equal(parsedTcg.serial_number, null);

for (const code of ["#136", "CL-LM", "OP01-001", "ST10-013", "CORI-JP028"]) {
  const parsed = parseReviewedTitleFields(`2024 Test Product Test Player ${code} PSA 10`);
  assert.equal(parsed.print_run_number, null, `${code} must not parse as print_run_number`);
}

const impossible = parsePrintRunValue("13/10");
assert.equal(impossible.print_run_number, "#/10");
assert.equal(impossible.print_run_numerator, undefined);
assert.equal(impossible.print_run_denominator, "10");
assert.equal(impossible.suspicious_print_run, true);
assert.equal(printRunTitleText(impossible), "#/10");

const normalizedImpossible = normalizeResolvedFields({ serial_number: "13/10" });
assert.equal(normalizedImpossible.suspicious_print_run, true);
assert.equal(normalizedImpossible.print_run_review_required, true);

const leadingZero = parsePrintRunValue("08/25");
assert.equal(leadingZero.print_run_number, "08/25");
assert.equal(leadingZero.print_run_numerator, "08");
assert.equal(leadingZero.print_run_denominator, "25");

const ocrSlash = normalizePaddleOcrResponse({
  raw_text: "Serial 31 / 50",
  confidence: 0.93
}, {
  request_id: "print-run-ocr-1",
  image_url: "https://storage.test/crop.jpg",
  crop_type: "print_run_number",
  expected_pattern: "print_run_number"
});
assert.equal(ocrSlash.normalized_fields.print_run_number, "31/50");
assert.equal(ocrSlash.normalized_fields.print_run_numerator, "31");
assert.equal(ocrSlash.normalized_fields.print_run_denominator, "50");
assert.equal(ocrSlash.normalized_fields.numbered_to, "50");
assert.equal(ocrSlash.normalized_fields.serial_number, "31/50");
assert.equal(ocrSlash.normalized_fields.serial_denominator, "50");

const ocrHyphenAllowed = normalizePaddleOcrResponse({
  raw_text: "31-50",
  confidence: 0.9
}, {
  request_id: "print-run-ocr-2",
  image_url: "https://storage.test/crop.jpg",
  crop_type: "print_run_number",
  expected_pattern: "numbered"
});
assert.equal(ocrHyphenAllowed.normalized_fields.print_run_number, "31/50");

const ocrHyphenBlocked = normalizePaddleOcrResponse({
  raw_text: "31-50",
  confidence: 0.9
}, {
  request_id: "product-ocr-1",
  image_url: "https://storage.test/product.jpg",
  crop_type: "product_text"
});
assert.equal(ocrHyphenBlocked.normalized_fields.print_run_number, undefined);

const certMustNotBecomeGrade = normalizePaddleOcrResponse({
  raw_text: "PSA TSA 63221071",
  confidence: 0.93
}, {
  request_id: "grade-ocr-1",
  image_url: "https://storage.test/slab.jpg",
  crop_type: "grade_label"
});
assert.equal(certMustNotBecomeGrade.normalized_fields.card_grade, undefined);
assert.equal(certMustNotBecomeGrade.normalized_fields.cert_number, "63221071");

console.log("print-run semantics tests passed");
