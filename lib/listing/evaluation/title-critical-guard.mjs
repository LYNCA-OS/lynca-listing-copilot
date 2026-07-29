import { semProjectionFromTitle } from "./reviewed-title-sem-projection.mjs";
import { semFieldEquivalent } from "../v4/policy/sem-scoring-policy.mjs";

export const titleCriticalGuardSchemaVersion = "title-critical-guard-v1";

const criticalIdentityFields = Object.freeze([
  "year",
  "manufacturer",
  "product",
  "subject",
  "card_number"
]);

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valuePresent(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every(valuePresent);
  if (value && typeof value === "object") return Object.values(value).some(valuePresent);
  return cleanText(value) !== "";
}

function identityGroundTruthFields(identity = {}) {
  return {
    year: identity.season_year || identity.year || identity.release_year || null,
    manufacturer: identity.manufacturer || null,
    product: identity.product || null,
    subject: identity.player || identity.subject || identity.players || null,
    card_number: identity.card_number || identity.checklist_code || identity.collector_number || null
  };
}

/**
 * Offline-only disaster guard for a frozen reviewed-title evaluation.
 *
 * Token recall cannot see introduced fabrications: appending a wrong product
 * can leave recall at 1. This guard compares title-derived SEM only after the
 * prediction is frozen. It has no runtime authority and never writes evidence,
 * resolved fields, or a title.
 */
export function scoreTitleCriticalGuard({
  referenceTitle = "",
  finalTitle = "",
  reviewedTitleGroundTruth = false,
  identityGroundTruth = null
} = {}) {
  const reference = cleanText(referenceTitle);
  const prediction = cleanText(finalTitle);
  const expected = semProjectionFromTitle(reference);
  const actual = semProjectionFromTitle(prediction);
  const explicitIdentity = identityGroundTruthFields(identityGroundTruth || {});
  const expectedCriticalSem = Object.fromEntries(criticalIdentityFields.map((field) => {
    const parserConfirmed = expected.field_statuses?.[field] === "CONFIRMED"
      && valuePresent(expected.sem?.[field]);
    return [field, parserConfirmed ? expected.sem[field] : explicitIdentity[field]];
  }));
  const evaluatedFields = criticalIdentityFields.filter((field) => (
    valuePresent(expectedCriticalSem[field])
  ));
  const mismatches = evaluatedFields.filter((field) => (
    !semFieldEquivalent(field, expectedCriticalSem[field], actual.sem?.[field])
  )).map((field) => ({
    field,
    reason: valuePresent(actual.sem?.[field])
      ? "CONFLICTING_IDENTITY_FIELD"
      : "MISSING_REQUIRED_IDENTITY_FIELD",
    expected: expectedCriticalSem[field] ?? null,
    actual: actual.sem?.[field] ?? null
  }));
  const conflicting = mismatches.filter((item) => item.reason === "CONFLICTING_IDENTITY_FIELD");
  const requiredCoverage = {
    subject: evaluatedFields.includes("subject"),
    product_or_manufacturer: evaluatedFields.includes("product") || evaluatedFields.includes("manufacturer"),
    year_or_card_number: evaluatedFields.includes("year") || evaluatedFields.includes("card_number")
  };
  const criticalCoverageComplete = Object.values(requiredCoverage).every(Boolean);
  const complete = reviewedTitleGroundTruth === true
    && Boolean(reference)
    && Boolean(prediction)
    && criticalCoverageComplete;
  return {
    schema_version: titleCriticalGuardSchemaVersion,
    evaluation_scope: "OFFLINE_POST_PREDICTION_ONLY",
    runtime_chain_effect: "NONE",
    reviewed_title_ground_truth: reviewedTitleGroundTruth === true,
    identity_ground_truth_used: Object.values(explicitIdentity).some(valuePresent),
    complete,
    critical_coverage_complete: criticalCoverageComplete,
    required_coverage: requiredCoverage,
    evaluated_fields: evaluatedFields,
    mismatch_count: mismatches.length,
    mismatches,
    catastrophic: complete && mismatches.length > 0,
    critical_fabrication: complete && conflicting.length > 0
  };
}

export const __titleCriticalGuardTestHooks = Object.freeze({
  criticalIdentityFields,
  identityGroundTruthFields,
  valuePresent
});
