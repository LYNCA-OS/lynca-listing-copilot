import assert from "node:assert/strict";
import {
  enforceAtomicGradeFields,
  gradeAtomicCompleteness
} from "../lib/listing/grade/grade-value.mjs";
import {
  gradeOcrRescueDecision,
  guardGradeFieldStates
} from "../lib/listing/pipeline/grade-atomic-policy.mjs";
import {
  captureQualityLooksLikeSlab,
  criticalOcrRendezvousDecision
} from "../lib/listing/pipeline/ocr-rendezvous-policy.mjs";
import { resolveGradeFields } from "../lib/listing/resolver/grade-resolver.mjs";
import { classifyNumberToken, resolveNumberFields, splitCardNumber } from "../lib/listing/resolver/number-resolver.mjs";
import { resolveCardFields } from "../lib/listing/resolver/resolve-card.mjs";

assert.equal(classifyNumberToken("31/50"), "serial_number");
assert.equal(classifyNumberToken("130/175"), "serial_number");
assert.equal(classifyNumberToken("257/208"), "collector_number");
assert.equal(classifyNumberToken("#136"), "collector_number");
assert.equal(classifyNumberToken("UV-16"), "checklist_code");

assert.deepEqual(splitCardNumber("UV 16"), {
  serial_number: null,
  collector_number: null,
  checklist_code: "UV-16"
});

const numberResult = resolveNumberFields({
  resolved: {},
  legacyFields: {
    card_number: "257/208",
    serial_number: "31 / 50"
  }
});
assert.equal(numberResult.resolved.collector_number, "257/208");
assert.equal(numberResult.resolved.serial_number, "31/50");
assert.ok(numberResult.notes.some((note) => note.field === "collector_number"));

const ambiguousSlashCardNumber = resolveNumberFields({
  resolved: {},
  legacyFields: { card_number: "31/50" }
});
assert.equal(ambiguousSlashCardNumber.resolved.collector_number, "31/50");
assert.equal(ambiguousSlashCardNumber.resolved.serial_number, undefined, "card_number must not manufacture Numerical Rarity without an explicit print-run source");
const explicitlyPromotedPrintRun = resolveNumberFields({
  resolved: {},
  legacyFields: { card_number: "31/50" },
  allowLegacyCardNumberAsPrintRun: true
});
assert.equal(explicitlyPromotedPrintRun.resolved.serial_number, "31/50");

const psaDualGrade = resolveGradeFields({
  resolved: {},
  legacyFields: {
    grade_company: "PSA",
    grade: "9/10"
  }
});
assert.equal(psaDualGrade.resolved.grade_company, "PSA");
assert.equal(psaDualGrade.resolved.card_grade, "9");
assert.equal(psaDualGrade.resolved.auto_grade, "10");
assert.equal(psaDualGrade.resolved.grade_type, "CARD_AND_AUTO");

const autoOnly = resolveGradeFields({
  resolved: {},
  legacyFields: {
    grade_company: "BGS",
    grade: "AUTO 10"
  }
});
assert.equal(autoOnly.resolved.auto_grade, "10");
assert.equal(autoOnly.resolved.grade_type, "AUTO_ONLY");

const authentic = resolveGradeFields({
  resolved: {},
  legacyFields: {
    grade_company: "PSA",
    grade: "Authentic"
  }
});
assert.equal(authentic.resolved.card_grade, "Auth");
assert.equal(authentic.resolved.grade_type, "AUTHENTIC");

const titleAutoGrade = resolveGradeFields({
  resolved: {},
  legacyFields: {
    title: "2025 Topps Chrome Cooper Flagg PSA 9 Auto 10",
    grade_company: "PSA",
    grade: "9"
  }
});
assert.equal(titleAutoGrade.resolved.card_grade, "9");
assert.equal(titleAutoGrade.resolved.auto_grade, "10");
assert.equal(titleAutoGrade.resolved.grade_type, "CARD_AND_AUTO");

const descriptorAutoGrade = resolveGradeFields({
  resolved: {},
  legacyFields: {
    title: "2025 Topps Chrome Cooper Flagg PSA 10 MINT 9",
    grade_company: "PSA",
    grade: "10"
  }
});
assert.equal(descriptorAutoGrade.resolved.card_grade, "10");
assert.equal(descriptorAutoGrade.resolved.auto_grade, "9");
assert.equal(descriptorAutoGrade.resolved.grade_type, "CARD_AND_AUTO");

const incompleteGrade = resolveGradeFields({
  resolved: { card_grade: "10", grade_type: "CARD_ONLY" },
  legacyFields: {}
});
assert.equal(incompleteGrade.resolved.grade_company, undefined);
assert.equal(incompleteGrade.resolved.card_grade, null);
assert.equal(incompleteGrade.resolved.grade_type, "UNKNOWN");
assert.ok(incompleteGrade.notes.some((note) => note.action === "discard_incomplete_grade_without_company"));

assert.equal(gradeAtomicCompleteness({ card_grade: "10" }).incomplete_score_without_company, true);
assert.equal(gradeAtomicCompleteness({ grade_company: "PSA" }).incomplete_company_without_score, true);
assert.deepEqual(
  enforceAtomicGradeFields({ grade: "10", card_grade: "10", grade_type: "CARD_ONLY" }),
  { grade: null, card_grade: null, grade_type: "UNKNOWN", auto_grade: null }
);
assert.equal(gradeAtomicCompleteness({ grade_company: "PSA", card_grade: "10" }).complete, true);

assert.deepEqual(gradeOcrRescueDecision({
  currentFields: { card_grade: "10", grade_type: "CARD_ONLY" },
  latestOcrState: { grade_label_active_count: 2 }
}), {
  needed: true,
  incomplete_grade: true,
  grade_completely_missing: false,
  slab_likely: false,
  incomplete_score_without_company: true,
  incomplete_company_without_score: false,
  grade_jobs_active: true,
  grade_company: null,
  card_grade: "10",
  auto_grade: null
});
assert.equal(gradeOcrRescueDecision({
  currentFields: { grade_company: "PSA" },
  latestOcrState: { grade_label_active_count: 2 }
}).needed, true, "a visible slab company without its score should wait briefly for grade OCR");
assert.equal(gradeOcrRescueDecision({
  currentFields: { grade_company: "PSA", card_grade: "10" },
  latestOcrState: { grade_label_active_count: 2 }
}).needed, false);
assert.equal(gradeOcrRescueDecision({
  currentFields: { card_grade: "10" },
  latestOcrState: { grade_label_active_count: 0 }
}).needed, false);
assert.equal(gradeOcrRescueDecision({
  currentFields: { year: "2024" },
  latestOcrState: { grade_label_active_count: 1 },
  slabLikely: true
}).needed, true, "a slab with completely missing grade fields should wait for the active grade OCR job");
assert.equal(gradeOcrRescueDecision({
  currentFields: { year: "2024" },
  latestOcrState: { grade_label_active_count: 1 },
  slabLikely: false
}).needed, false, "a raw card should not pay the completely-missing grade rescue wait");
assert.equal(gradeOcrRescueDecision({
  currentFields: { year: "2024" },
  latestOcrState: {
    grade_label_active_count: 1,
    evidence_patches: [
      { field: "grade_company", value: "PSA" },
      { field: "card_grade", value: "10" }
    ]
  },
  slabLikely: true
}).needed, false, "completed OCR evidence should prevent a redundant grade rescue wait");

const targetedSerialAndGradeWait = criticalOcrRendezvousDecision({
  currentFields: { print_run_number: "2/4", grade_company: "PSA" },
  unresolved: ["card_grade"],
  latestOcrState: { configured: true, serial_active_count: 2, grade_label_active_count: 1 },
  configuredWaitMs: 0,
  criticalWaitMs: 2500
});
assert.deepEqual(targetedSerialAndGradeWait.target_fields, ["serial_number", "grade"]);
assert.equal(targetedSerialAndGradeWait.wait_budget_ms, 2500);
assert.equal(targetedSerialAndGradeWait.should_wait, true);

const entirelyMissingGradeWait = criticalOcrRendezvousDecision({
  currentFields: { year: "2024", players: ["Tester"] },
  unresolved: ["grade_company", "card_grade"],
  latestOcrState: { configured: true, serial_active_count: 0, grade_label_active_count: 2 },
  configuredWaitMs: 0,
  criticalWaitMs: 2500
});
assert.deepEqual(entirelyMissingGradeWait.target_fields, ["grade"]);
assert.deepEqual(entirelyMissingGradeWait.reasons, ["provider_left_grade_unresolved"]);
assert.equal(entirelyMissingGradeWait.grade_unresolved, true);
assert.equal(entirelyMissingGradeWait.wait_budget_ms, 2500);

const slabMissingGradeWait = criticalOcrRendezvousDecision({
  currentFields: { year: "2003-04", players: ["LeBron James"] },
  unresolved: [],
  latestOcrState: { configured: true, serial_active_count: 0, grade_label_active_count: 2 },
  slabLikely: true,
  configuredWaitMs: 0,
  criticalWaitMs: 2500
});
assert.deepEqual(slabMissingGradeWait.target_fields, ["grade"]);
assert.deepEqual(slabMissingGradeWait.reasons, ["slab_capture_grade_completely_missing"]);
assert.equal(slabMissingGradeWait.grade_completely_missing, true);
assert.equal(slabMissingGradeWait.slab_likely, true);

assert.equal(captureQualityLooksLikeSlab({ capture_surface_type: "SLAB" }), true);
assert.equal(
  captureQualityLooksLikeSlab({}, [{ width: 1600, height: 988 }]),
  true,
  "marketplace slab framing should selectively enable the grade rendezvous"
);
assert.equal(
  captureQualityLooksLikeSlab({}, [{ width: 1200, height: 1680 }]),
  false,
  "standard raw-card geometry must not pay the slab OCR wait"
);

const rawCardMissingGradeDoesNotWait = criticalOcrRendezvousDecision({
  currentFields: { year: "2024", players: ["Tester"] },
  unresolved: [],
  latestOcrState: { configured: true, serial_active_count: 0, grade_label_active_count: 2 },
  slabLikely: false,
  configuredWaitMs: 0
});
assert.deepEqual(rawCardMissingGradeDoesNotWait.target_fields, []);
assert.equal(rawCardMissingGradeDoesNotWait.should_wait, false, "raw cards must not pay a blanket grade wait");

const noHardFieldWait = criticalOcrRendezvousDecision({
  currentFields: { year: "2024", players: ["Tester"] },
  unresolved: ["parallel_exact"],
  latestOcrState: { configured: true, serial_active_count: 2, grade_label_active_count: 2 },
  configuredWaitMs: 0
});
assert.deepEqual(noHardFieldWait.target_fields, []);
assert.equal(noHardFieldWait.should_wait, false, "non-hard uncertainty must not add OCR latency to every card");

const ocrPartialGradeWait = criticalOcrRendezvousDecision({
  currentFields: {},
  latestOcrState: {
    configured: true,
    grade_label_active_count: 1,
    evidence_patches: [{ field: "grade_company", value: "PSA" }]
  },
  criticalWaitMs: 2500
});
assert.equal(ocrPartialGradeWait.should_wait, true, "partial OCR grade evidence should wait for its active counterpart");
assert.deepEqual(ocrPartialGradeWait.target_fields, ["grade"]);
assert.deepEqual(ocrPartialGradeWait.ocr_signal_fields, ["grade_company"]);

const ocrPartialSerialWait = criticalOcrRendezvousDecision({
  currentFields: {},
  latestOcrState: {
    configured: true,
    serial_active_count: 1,
    evidence_patches: [{ field: "numerical_rarity", value: "2/3" }]
  },
  criticalWaitMs: 2500
});
assert.equal(ocrPartialSerialWait.should_wait, true, "direct OCR numbering should wait for active serial verification");
assert.deepEqual(ocrPartialSerialWait.target_fields, ["serial_number"]);

const unrelatedOcrPatchDoesNotWait = criticalOcrRendezvousDecision({
  currentFields: {},
  latestOcrState: {
    configured: true,
    serial_active_count: 1,
    grade_label_active_count: 1,
    evidence_patches: [{ field: "product", value: "Topps Chrome" }]
  },
  criticalWaitMs: 2500
});
assert.equal(unrelatedOcrPatchDoesNotWait.should_wait, false, "unrelated OCR evidence must not slow every card");

const guardedGradeState = guardGradeFieldStates([{
  field_name: "grade",
  field_value: "10",
  display_status: "NORMAL",
  confidence: 0.8,
  provenance: {}
}], true)[0];
assert.equal(guardedGradeState.field_value, null);
assert.equal(guardedGradeState.display_status, "REVIEW");
assert.equal(guardedGradeState.provenance.atomic_grade_guard, "score_without_company");

const guardedCompanyOnlyState = guardGradeFieldStates([{
  field_name: "grade",
  field_value: "PSA",
  display_status: "NORMAL",
  confidence: 0.8,
  provenance: {}
}], true, "company_without_score")[0];
assert.equal(guardedCompanyOnlyState.field_value, null);
assert.equal(guardedCompanyOnlyState.display_status, "REVIEW");
assert.equal(guardedCompanyOnlyState.provenance.atomic_grade_guard, "company_without_score");

const resolvedCard = resolveCardFields({
  resolved: {
    players: ["Shohei Ohtani"],
    grade_company: "PSA"
  },
  legacyFields: {
    card_number: "UV-16",
    serial_number: "31/50",
    grade: "9/10"
  }
});
assert.equal(resolvedCard.resolved.checklist_code, "UV-16");
assert.equal(resolvedCard.resolved.serial_number, "31/50");
assert.equal(resolvedCard.resolved.card_grade, "9");
assert.equal(resolvedCard.resolved.auto_grade, "10");
assert.equal(resolvedCard.resolved.grade_type, "CARD_AND_AUTO");
assert.ok(resolvedCard.resolution_trace.length >= 3);

console.log("resolver tests passed");
