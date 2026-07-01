import assert from "node:assert/strict";
import {
  attachFieldTaskOrchestration,
  buildFieldTaskOrchestration
} from "../lib/listing/orchestration/field-task-orchestrator.mjs";

function task(report, id) {
  return report.tasks.find((entry) => entry.task_id === id);
}

const baseResult = {
  resolved: {
    year: "1997-98",
    brand: "Bowman's Best",
    product: "Bowman's Best",
    players: ["Michael Jordan"],
    team: "Chicago Bulls",
    card_name: "Best Performance",
    collector_number: "96",
    surface_color: "Gold",
    grade_company: "PSA",
    card_grade: "9"
  },
  evidence: {
    year: {
      value: "1997-98",
      status: "REVIEW",
      confidence: 0.78,
      sources: [{ source_type: "CARD_BACK_PRINTED_TEXT", region: "back_copyright" }]
    },
    product: {
      value: "Bowman's Best",
      status: "REVIEW",
      confidence: 0.82,
      sources: [{ source_type: "CARD_BACK_PRINTED_TEXT", region: "back_brand" }]
    },
    players: {
      value: ["Michael Jordan"],
      status: "REVIEW",
      confidence: 0.9,
      sources: [{ source_type: "CARD_FRONT_PRINTED_TEXT", region: "front_name" }]
    },
    collector_number: {
      value: "96",
      status: "CONFIRMED",
      confidence: 0.94,
      sources: [{ source_type: "CARD_BACK_PRINTED_TEXT", region: "back_number" }]
    },
    surface_color: {
      value: "Gold",
      status: "REVIEW",
      confidence: 0.72,
      sources: [{ source_type: "VISION_MODEL", region: "front_surface" }]
    },
    grade_company: {
      value: "PSA",
      status: "REVIEW",
      confidence: 0.6,
      sources: [{ source_type: "VISION_MODEL", region: "full_card" }]
    }
  },
  catalog_assist_eligibility: {
    raw_candidate_count: 3,
    approved_candidate_count: 1,
    prompt_candidate_count: 1,
    conflict_blocked_count: 0,
    prompt_candidate_ids: ["identity-96"]
  },
  vector_assist_eligibility: {
    raw_candidate_count: 5,
    approved_candidate_count: 5,
    prompt_candidate_count: 0,
    conflict_blocked_count: 0
  },
  vector_lazy_skip: {
    skipped: true,
    reason: "strong_catalog_anchor",
    catalog_candidate_id: "identity-96"
  }
};

const timing = {
  provider_total_ms: 1200,
  catalog_retrieval_ms: 80,
  catalog_cache_ms: 2,
  vector_embedding_ms: 0,
  vector_retrieval_ms: 0,
  resolver_ms: 12,
  renderer_ms: 6,
  total_ms: 1420
};

const report = buildFieldTaskOrchestration(baseResult, { timing });

assert.equal(report.schema_version, "field-task-orchestrator-v1");
assert.equal(report.resolver_authority.includes("single source of truth"), true);
assert.equal(task(report, "year_product_observation").status, "SUPPORTED");
assert.equal(task(report, "subject_team_observation").status, "SUPPORTED");
assert.equal(task(report, "collector_number_observation").status, "CONFIRMED");
assert.equal(task(report, "surface_color_observation").status, "REVIEW_REQUIRED");
assert.equal(task(report, "grade_label_observation").status, "REVIEW_REQUIRED");
assert.equal(task(report, "catalog_exact_code_lookup").status, "SUPPORTED");
assert.equal(task(report, "vector_retrieval_lazy").status, "SUPPORTED");
assert.equal(task(report, "surface_color_observation").evidence_patch.surface_color.confidence, 0.72);
assert.equal(report.module_task_status.catalog_exact_code_lookup, "SUPPORTED");
assert.equal(report.timing.time_to_first_field_ms, 1200);
assert.equal(report.timing.time_to_core_identity_ms, 1200);
assert.equal(report.timing.time_to_final_assisted_title_ms, 1420);

const attached = attachFieldTaskOrchestration({ ...baseResult, timing }, { timing });
assert.equal(attached.module_task_status.vector_retrieval_lazy, "SUPPORTED");
assert.equal(attached.timing.time_to_writer_draft_ms, 1200);
assert.equal(attached.timing.per_task_latency_ms.catalog_exact_code_lookup, 82);

const conflicted = buildFieldTaskOrchestration({
  ...baseResult,
  conflict_map: [{ field: "year", severity: "HIGH" }]
}, { timing });
assert.equal(task(conflicted, "year_product_observation").status, "CONFLICT");

const noCatalogPrompt = buildFieldTaskOrchestration({
  ...baseResult,
  catalog_assist_eligibility: {
    raw_candidate_count: 4,
    approved_candidate_count: 1,
    prompt_candidate_count: 0,
    conflict_blocked_count: 0
  },
  vector_lazy_skip: null
}, { timing });
assert.equal(task(noCatalogPrompt, "catalog_exact_code_lookup").status, "REVIEW_REQUIRED");
assert.equal(task(noCatalogPrompt, "vector_retrieval_lazy").status, "REVIEW_REQUIRED");

console.log("field task orchestrator tests passed");
