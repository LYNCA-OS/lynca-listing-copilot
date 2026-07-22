import assert from "node:assert/strict";
import { buildPreProviderRescueShadow } from "../lib/listing/v4/risk/pre-provider-rescue-shadow.mjs";

const disabled = buildPreProviderRescueShadow();
assert.equal(disabled.enabled, false);
assert.equal(disabled.strategy_mutation_allowed, false);
assert.equal(disabled.critical_path_budget_ms, 0);

const numberedMissingParallel = buildPreProviderRescueShadow({
  enabled: true,
  resolvedFields: {
    player: "Example Player",
    year: "2025",
    product: "Example Product"
  },
  confirmedPreingestionFields: {
    serial_denominator: "25",
    card_number: "EX-1"
  },
  preingestionBundlePresent: true,
  catalogContext: {
    catalog_assist_eligibility: {
      prompt_candidate_count: 1,
      prompt_candidate_ids: ["candidate-1"],
      conflict_blocked_count: 0
    },
    assistPacket: {
      vector_retrieval: {
        candidates: [{ fields: { parallel_exact: "Example Parallel" } }]
      }
    }
  },
  vectorContext: { status: "COMPLETED" }
});
assert.equal(numberedMissingParallel.rescue_recommended, true);
assert.equal(numberedMissingParallel.risk_score, 0.8);
assert.deepEqual(numberedMissingParallel.reasons, [
  "NUMBERED_WITHOUT_PARALLEL_IDENTITY",
  "CATALOG_PARALLEL_NOT_YET_OBSERVED"
]);
assert.deepEqual(numberedMissingParallel.recommended_lanes, [
  "FOCUSED_FINISH_CROP",
  "CATALOG_PARALLEL_CONFIRMATION",
  "OCR_RENDEZVOUS"
]);
assert.equal("serial_denominator" in numberedMissingParallel.signals, false);

const fullyAnchored = buildPreProviderRescueShadow({
  enabled: true,
  resolvedFields: {
    player: "Example Player",
    year: "2025",
    product: "Example Product",
    card_number: "EX-1",
    serial_denominator: "25",
    parallel_exact: "Example Parallel"
  },
  catalogContext: {
    catalog_assist_eligibility: {
      prompt_candidate_count: 1,
      conflict_blocked_count: 0
    }
  }
});
assert.equal(fullyAnchored.rescue_recommended, false);
assert.equal(fullyAnchored.risk_score, 0);
assert.deepEqual(fullyAnchored.reasons, []);

const ambiguous = buildPreProviderRescueShadow({
  enabled: true,
  resolvedFields: {},
  catalogContext: {
    catalog_assist_eligibility: {
      prompt_candidate_count: 2,
      conflict_blocked_count: 1
    }
  },
  vectorContext: { worker: { status: "COMPLETED" } }
});
assert.equal(ambiguous.rescue_recommended, true);
assert.deepEqual(ambiguous.reasons, [
  "CATALOG_CONFLICT_BLOCKED",
  "MULTIPLE_CATALOG_IDENTITIES",
  "WEAK_PRE_PROVIDER_IDENTITY_ANCHOR"
]);
assert.deepEqual(ambiguous.recommended_lanes, ["VECTOR_IDENTITY_TIEBREAK"]);

console.log("pre-provider rescue shadow tests passed");
