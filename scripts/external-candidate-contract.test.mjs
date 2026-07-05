import assert from "node:assert/strict";
import {
  allowedUsageForTrust,
  allowedUsageValues,
  createMockExternalCandidateProvider,
  externalMatchLevels,
  forbiddenUsageViolations,
  forbiddenUsageValues,
  isExternalDirectoryTrust,
  isMarketplaceTrust,
  normalizeExternalCandidate,
  sourceTrustRank,
  sourceTrustValues
} from "../lib/listing/external/external-candidate-contract.mjs";

{
  assert.ok(sourceTrustRank(sourceTrustValues.REVIEWED_INTERNAL) > sourceTrustRank(sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY));
  assert.ok(sourceTrustRank(sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY) > sourceTrustRank(sourceTrustValues.MARKETPLACE_RAW));
  assert.equal(isExternalDirectoryTrust(""), false);
  assert.equal(isMarketplaceTrust(""), false);
}

{
  const usage = allowedUsageForTrust(sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY);
  assert.ok(usage.includes(allowedUsageValues.CANDIDATE_GENERATION));
  assert.ok(usage.includes(allowedUsageValues.LEGALITY_CHECK));
  assert.ok(usage.includes(allowedUsageValues.ALIAS_LEARNING));
  assert.ok(usage.includes(allowedUsageValues.RERANKER_FEATURE));
  assert.ok(usage.includes(allowedUsageValues.WRITER_REFERENCE));
  assert.ok(usage.includes(allowedUsageValues.PROMPT_ASSIST_ALLOWED));
  assert.equal(usage.includes(allowedUsageValues.FIELD_AUTO_APPLY_ALLOWED), false);
}

{
  const candidate = normalizeExternalCandidate({
    provider_id: "cardsight",
    source_trust: sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
    match_level: externalMatchLevels.EXACT_CARD,
    external_card_id: "card-1",
    title: "1997-98 Bowman's Best Michael Jordan #96",
    used_as_truth: true,
    fields: {
      year: "1997-98",
      product: "Bowman's Best",
      players: ["Michael Jordan"],
      serial_number: "17/50",
      serial_numerator: "17",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    },
    forbidden_usage: [forbiddenUsageValues.DIRECT_TITLE_RENDERING]
  });
  assert.equal(candidate.used_as_truth, false);
  assert.equal(candidate.fields.year, "1997-98");
  assert.equal(candidate.fields.serial_number, undefined);
  assert.equal(candidate.fields.serial_numerator, undefined);
  assert.equal(candidate.fields.grade_company, undefined);
  assert.equal(candidate.fields.card_grade, undefined);
  assert.equal(candidate.fields.cert_number, undefined);
  assert.ok(candidate.forbidden_usage.includes(forbiddenUsageValues.SERIAL_NUMERATOR_COPY));
  assert.ok(candidate.forbidden_usage.includes(forbiddenUsageValues.GRADE_CERT_COPY));
}

{
  const violations = forbiddenUsageViolations({
    source_trust: sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY,
    used_as_truth: true,
    review_status: sourceTrustValues.REVIEWED_INTERNAL,
    fields: {
      product: "Prizm",
      grade: "9",
      cert_number: "999"
    }
  });
  assert.ok(violations.includes("external_candidate_used_as_truth"));
  assert.ok(violations.includes("external_candidate_marked_reviewed_internal"));
  assert.ok(violations.includes("physical_instance_field:grade"));
  assert.ok(violations.includes("physical_instance_field:cert_number"));
}

{
  const provider = createMockExternalCandidateProvider({
    candidates: [{
      external_card_id: "card-2",
      title: "2023 Panini Prizm Test Player #12",
      fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Test Player"],
        cert_number: "should-not-copy"
      }
    }]
  });
  const result = await provider.searchByObservedFields();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_trust, sourceTrustValues.LICENSED_EXTERNAL_DIRECTORY);
  assert.equal(result.candidates[0].used_as_truth, false);
  assert.equal(result.candidates[0].fields.cert_number, undefined);

  const card = await provider.getCard("card-2");
  assert.equal(card.candidate.external_card_id, "card-2");

  const parallels = await provider.getParallels("card-2");
  assert.deepEqual(parallels.parallels, []);
}

console.log("external candidate contract tests passed");
