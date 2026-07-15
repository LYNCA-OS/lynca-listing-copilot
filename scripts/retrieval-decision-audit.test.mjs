import assert from "node:assert/strict";
import {
  buildRetrievalParticipationSummary,
  classifyRetrievalParticipation,
  retrievalParticipationLevels
} from "../lib/listing/retrieval/retrieval-participation.mjs";
import { buildRetrievalDecisionAudit } from "./retrieval-decision-audit.mjs";

const notUsed = classifyRetrievalParticipation({
  source: "catalog",
  funnel: { query_attempted: true, raw_candidate_count: 0 }
});
assert.equal(notUsed.participation_level, retrievalParticipationLevels.NOT_USED);
assert.equal(notUsed.retrieval_available, false);

const observationOnly = classifyRetrievalParticipation({
  source: "vector",
  funnel: { query_attempted: true, raw_candidate_count: 5, prompt_candidate_count: 0 }
});
assert.equal(observationOnly.participation_level, retrievalParticipationLevels.OBSERVATION_ONLY);
assert.equal(observationOnly.retrieval_unused, true);
assert.equal(observationOnly.retrieval_available_but_not_applied, true);

const assistModeWithoutCandidate = classifyRetrievalParticipation({
  source: "vector",
  funnel: {
    query_attempted: true,
    raw_candidate_count: 5,
    prompt_candidate_count: 0,
    prompt_assist_used: true
  }
});
assert.equal(assistModeWithoutCandidate.participation_level, retrievalParticipationLevels.OBSERVATION_ONLY);
assert.equal(assistModeWithoutCandidate.retrieval_unused, true);
assert.ok(assistModeWithoutCandidate.reason_codes.includes("PROMPT_ASSIST_MODE_WITHOUT_PROMPT_CANDIDATE"));

const providerPromptCandidate = classifyRetrievalParticipation({
  source: "catalog",
  funnel: {
    raw_candidate_count: 2,
    prompt_candidate_count: 0,
    provider_prompt_candidate_count: 1
  }
});
assert.equal(providerPromptCandidate.participation_level, retrievalParticipationLevels.CANDIDATE_RANKING);
assert.equal(providerPromptCandidate.prompt_candidate_count, 1);

const candidateRanking = classifyRetrievalParticipation({
  source: "vector",
  funnel: { raw_candidate_count: 5, prompt_candidate_count: 2, prompt_assist_used: true }
});
assert.equal(candidateRanking.participation_level, retrievalParticipationLevels.CANDIDATE_RANKING);
assert.equal(candidateRanking.retrieval_used, true);
assert.equal(candidateRanking.retrieval_applied, false);

const fieldEvidence = classifyRetrievalParticipation({
  source: "catalog",
  funnel: { raw_candidate_count: 3, prompt_candidate_count: 0, evidence_support_field_count: 4 }
});
assert.equal(fieldEvidence.participation_level, retrievalParticipationLevels.FIELD_EVIDENCE);
assert.ok(fieldEvidence.participation_roles.includes(retrievalParticipationLevels.FIELD_EVIDENCE));
assert.equal(fieldEvidence.retrieval_applied, false);

const rankedWithFieldEvidence = classifyRetrievalParticipation({
  source: "catalog",
  funnel: { raw_candidate_count: 3, prompt_candidate_count: 1, evidence_support_field_count: 4 }
});
assert.equal(rankedWithFieldEvidence.participation_level, retrievalParticipationLevels.CANDIDATE_RANKING);
assert.ok(rankedWithFieldEvidence.participation_roles.includes(retrievalParticipationLevels.FIELD_EVIDENCE));

const identityDecision = classifyRetrievalParticipation({
  source: "catalog",
  funnel: {
    raw_candidate_count: 1,
    prompt_candidate_count: 1,
    selected_candidate_id: "catalog-1",
    applied_field_count: 2,
    applied_fields: ["year", "product"],
    title_changed: true
  }
});
assert.equal(identityDecision.participation_level, retrievalParticipationLevels.IDENTITY_DECISION);
assert.equal(identityDecision.retrieval_applied, true);
assert.deepEqual(identityDecision.applied_fields, ["year", "product"]);

const exactAnchor = buildRetrievalParticipationSummary({
  catalogFunnel: { raw_candidate_count: 1 },
  vectorFunnel: {},
  exactAnchorIdentityDecision: true
});
assert.equal(exactAnchor.sources.catalog.participation_level, retrievalParticipationLevels.IDENTITY_DECISION);
assert.deepEqual(exactAnchor.identity_decision_sources, ["catalog"]);

const officialChecklist = buildRetrievalParticipationSummary({
  catalogFunnel: { raw_candidate_count: 1 },
  candidateApplicationTrace: [{
    candidate_id: "official-1",
    candidate_lane: "catalog",
    source_type: "TOPPS_OFFICIAL_CHECKLIST",
    prompt_eligible: true,
    can_apply_fields: ["year", "card_number"]
  }]
});
assert.equal(officialChecklist.sources.official_checklist.participation_level, retrievalParticipationLevels.CANDIDATE_RANKING);
assert.deepEqual(officialChecklist.sources.official_checklist.supported_fields, ["year", "card_number"]);

const report = {
  generated_at: "2026-07-15T00:00:00.000Z",
  soak_run_id: "retrieval-audit-test",
  results: [
    {
      asset_id: "no-retrieval",
      job_created_at: "2026-07-15T00:00:01.000Z",
      ok: true,
      writer_ready: true,
      l2_candidate_debug: {
        catalog_activation_funnel: { raw_candidate_count: 0 },
        vector_activation_funnel: { raw_candidate_count: 0 }
      }
    },
    {
      asset_id: "available-unused",
      job_created_at: "2026-07-15T00:00:02.000Z",
      ok: true,
      writer_ready: true,
      l2_candidate_debug: {
        catalog_activation_funnel: { raw_candidate_count: 2 },
        vector_activation_funnel: { raw_candidate_count: 0 }
      }
    },
    {
      asset_id: "ranked-unattributed",
      job_created_at: "2026-07-15T00:00:03.000Z",
      ok: true,
      writer_ready: true,
      l2_candidate_debug: {
        catalog_activation_funnel: { raw_candidate_count: 2, prompt_candidate_count: 1 },
        vector_activation_funnel: { raw_candidate_count: 3, prompt_candidate_count: 1 }
      }
    },
    {
      asset_id: "identity-applied",
      job_created_at: "2026-07-15T00:00:04.000Z",
      ok: true,
      writer_ready: true,
      retrieval_recovery: true,
      l2_candidate_debug: {
        catalog_activation_funnel: {
          raw_candidate_count: 1,
          prompt_candidate_count: 1,
          selected_candidate_id: "catalog-1",
          applied_field_count: 1,
          applied_fields: ["product"],
          title_changed: true
        },
        vector_activation_funnel: { raw_candidate_count: 0 }
      }
    }
  ]
};

const audit = buildRetrievalDecisionAudit(report, { sampleSize: 4 });
assert.equal(audit.cohort.evaluated_count, 4);
assert.equal(audit.metrics.catalog_hit_rate, 0.75);
assert.equal(audit.metrics.catalog_applied_rate, 0.25);
assert.equal(audit.metrics.vector_hit_rate, 0.25);
assert.equal(audit.metrics.vector_applied_rate, 0);
assert.equal(audit.metrics.retrieval_available_count, 3);
assert.equal(audit.metrics.retrieval_available_but_unused_count, 1);
assert.equal(audit.metrics.candidate_available_count, 2);
assert.equal(audit.metrics.candidate_to_final_count, 1);
assert.equal(audit.metrics.candidate_to_final_rate, 0.5);
assert.equal(audit.metrics.retrieval_recovery_count, 1);
assert.equal(audit.metrics.retrieval_regression_count, 0);
assert.equal(audit.metrics.retrieval_prompt_influence_unknown_count, 1);

console.log("retrieval decision audit tests passed");
