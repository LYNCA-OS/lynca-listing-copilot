import assert from "node:assert/strict";
import { resolveGradeFields } from "../lib/listing/resolver/grade-resolver.mjs";
import { classifyNumberToken, resolveNumberFields, splitCardNumber } from "../lib/listing/resolver/number-resolver.mjs";
import { resolveCardFields } from "../lib/listing/resolver/resolve-card.mjs";
import { resolveTrustedNameCandidate, trustedNameSimilarity } from "../lib/listing/resolver/trusted-name-candidate-resolver.mjs";

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

const publicNameCandidates = [
  "Cinccino ex",
  "Tyrantrum",
  "Eelektrik",
  "Larry's Dudunsparce ex",
  "Xerneas"
].map((name) => ({
  name,
  source_type: "PUBLIC_STRUCTURED_CARD_DATABASE",
  trust_tier: 5
}));

for (const [observedName, expectedName] of [
  ["Cincino ex", "Cinccino ex"],
  ["Tyranttrum", "Tyrantrum"],
  ["Eleektrik", "Eelektrik"],
  ["Larry's Dudunce ex", "Larry's Dudunsparce ex"]
]) {
  const result = resolveTrustedNameCandidate({
    observedName,
    candidates: publicNameCandidates
  });
  assert.equal(result.status, "TRUSTED_CORRECTION");
  assert.equal(result.resolved_name, expectedName);
  assert.ok(result.confidence >= 0.8);
}

assert.equal(trustedNameSimilarity("Cinccino ex", "Cinccino ex"), 1);
assert.ok(trustedNameSimilarity("Cincino ex", "Cinccino ex") > trustedNameSimilarity("Cincino ex", "Xerneas"));

const duplicateNameCandidates = resolveTrustedNameCandidate({
  observedName: "Cincino ex",
  candidates: [
    {
      name: "Cinccino ex",
      source_type: "PUBLIC_STRUCTURED_CARD_DATABASE"
    },
    {
      name: "Cinccino ex",
      source_type: "PUBLIC_STRUCTURED_CARD_DATABASE"
    },
    {
      name: "Xerneas",
      source_type: "PUBLIC_STRUCTURED_CARD_DATABASE"
    }
  ]
});
assert.equal(duplicateNameCandidates.status, "TRUSTED_CORRECTION");
assert.equal(duplicateNameCandidates.resolved_name, "Cinccino ex");
assert.ok(duplicateNameCandidates.candidate_margin > 0);

const marketplaceOnlyCorrection = resolveTrustedNameCandidate({
  observedName: "Cincino ex",
  candidates: [
    {
      name: "Cinccino ex",
      source_type: "MARKETPLACE",
      trust_tier: 8
    }
  ]
});
assert.equal(marketplaceOnlyCorrection.status, "UNRESOLVED");
assert.equal(marketplaceOnlyCorrection.reason, "no_trusted_candidates");

console.log("resolver tests passed");
