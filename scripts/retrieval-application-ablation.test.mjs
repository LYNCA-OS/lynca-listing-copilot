import assert from "node:assert/strict";
import { evaluateRetrievalApplicationAblation } from "./evaluate-retrieval-application-ablation.mjs";

const confirmedStatuses = {
  year: "CONFIRMED",
  ip_sport: "UNKNOWN",
  language: "UNKNOWN",
  manufacturer: "UNKNOWN",
  product: "CONFIRMED",
  set: "UNKNOWN",
  subject: "CONFIRMED",
  card_name: "CONFIRMED",
  card_number: "UNKNOWN",
  descriptive_rarity: "UNKNOWN",
  numerical_rarity: "UNKNOWN",
  release_variant: "UNKNOWN",
  print_finish: "UNKNOWN",
  special_stamp: "UNKNOWN",
  grading_info: "UNKNOWN"
};

const dataset = {
  schema_version: "golden-sem-partition-v1",
  dataset_id: "retrieval-ablation-fixture",
  partition: "development",
  items: [
    {
      item_id: "card-1",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2024",
          product: "Topps Chrome",
          subject: ["Test Player"],
          card_name: "Autograph"
        }
      }
    },
    {
      item_id: "card-2",
      reviewed_ground_truth: {
        field_statuses: confirmedStatuses,
        fields: {
          year: "2023",
          product: "Panini Prizm",
          subject: ["Second Player"],
          card_name: "Base"
        }
      }
    }
  ]
};

const off = {
  results: [
    {
      item_id: "card-1",
      final_title: "2024 Test Player",
      resolved_fields: {
        year: "2024",
        product: "Topps",
        players: ["Test Player"],
        card_name: "Autograph"
      }
    },
    {
      item_id: "card-2",
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      }
    }
  ]
};

const on = {
  results: [
    {
      item_id: "card-1",
      final_title: "2024 Topps Chrome Test Player Autograph",
      resolved_fields: {
        year: "2024",
        product: "Topps Chrome",
        players: ["Test Player"],
        card_name: "Autograph"
      },
      retrieval_application: {
        actual_application_count: 1,
        actual_applied_fields: ["product"],
        decision_counts: { APPLY: 1, SUPPORT: 2, BLOCK: 0, REJECT: 0 }
      }
    },
    {
      item_id: "card-2",
      final_title: "2023 Panini Prizm Second Player Base",
      resolved_fields: {
        year: "2023",
        product: "Panini Prizm",
        players: ["Second Player"],
        card_name: "Base"
      },
      retrieval_application: {
        actual_application_count: 0,
        actual_applied_fields: [],
        decision_counts: { APPLY: 0, SUPPORT: 3, BLOCK: 0, REJECT: 0 }
      }
    }
  ]
};

const report = evaluateRetrievalApplicationAblation({
  dataset,
  retrievalDisabledReport: off,
  retrievalEnabledReport: on
});

assert.equal(report.cohort.same_card_cohort_complete, true);
assert.equal(report.metrics.retrieval_enabled.candidate_application_count, 1);
assert.equal(report.metrics.retrieval_enabled.title_change_count, 1);
assert.ok(report.metrics.delta.sem_field_accuracy > 0);
assert.ok(report.metrics.delta.critical_field_accuracy > 0);
assert.equal(report.metrics.delta.retrieval_recovery_count, 1);
assert.equal(report.metrics.delta.retrieval_regression_count, 0);
assert.equal(report.metrics.delta.net_benefit, 1);
assert.equal(report.per_card.find((row) => row.item_id === "card-1")?.outcome, "RECOVERY");

console.log("retrieval application ablation tests passed");
