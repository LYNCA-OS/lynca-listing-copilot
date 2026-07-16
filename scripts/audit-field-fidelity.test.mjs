import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildFieldFidelityAudit } from "./audit-field-fidelity.mjs";

const fidelityOnlyReport = {
  schema_version: "cloud-listing-api-eval-v1",
  generated_at: "2026-07-15T00:00:00.000Z",
  results: [
    {
      candidate_id: "fidelity-card",
      corrected_title: "1999 Corrected Title Must Not Become Field Truth",
      corrected_title_is_reviewed_title_ground_truth: true,
      reviewed_ground_truth: { year: "1999" },
      raw_provider_fields: {
        year: "2024",
        players: ["Alice Example"],
        product: "Topps Chrome",
        parallel_exact: "Gold Refractor",
        serial_number: "12/50"
      },
      identity_resolution: {
        identity: {
          year: "2024",
          players: ["Alice Example"],
          product: "Topps Chrome",
          parallel_exact: "Blue Refractor",
          card_number: "A-1"
        }
      },
      resolved_fields: {
        year: "2024",
        players: ["Alice Example"],
        product: "Topps Chrome",
        parallel_exact: "Blue Refractor",
        card_number: "A-1"
      },
      renderer_input: {
        fields: {
          year: "2024",
          players: ["Alice Example"],
          product: "Topps Chrome",
          parallel_exact: "Blue Refractor",
          card_number: "A-1"
        }
      },
      rendered_fields: {
        rendered_title: "2024 Topps Chrome Blue Refractor",
        modules: {
          year: {
            text: "2024",
            fields: ["year"],
            tokens: [{ text: "2024", fields: ["year"] }]
          },
          product_identity: {
            text: "Topps Chrome",
            fields: ["manufacturer", "product", "set"],
            tokens: [{ text: "Topps Chrome", fields: ["manufacturer", "product", "set"] }]
          },
          subject: {
            text: "Alice Example",
            fields: ["players"],
            tokens: [{ text: "Alice Example", fields: ["players"] }]
          },
          print_finish: {
            text: "Blue Refractor",
            fields: ["parallel_exact"],
            tokens: [{ text: "Blue Refractor", fields: ["parallel_exact"] }]
          },
          card_number: {
            text: "#A-1",
            fields: ["card_number"],
            tokens: [{ text: "#A-1", fields: ["card_number"] }]
          }
        }
      }
    },
    {
      candidate_id: "missing-provider-layer",
      resolved_fields: { year: "2025" },
      renderer_input: { fields: { year: "2025" } },
      rendered_fields: {
        rendered_title: "2025",
        modules: {
          year: { tokens: [{ text: "2025", fields: ["year"] }] }
        }
      }
    },
    {
      candidate_id: "renderer-input-loss",
      raw_provider_fields: { product: "Panini Prizm" },
      identity_resolution: { identity: { product: "Panini Prizm" } },
      resolved_fields: { product: "Panini Prizm" },
      renderer_input: { fields: {} },
      rendered_fields: { rendered_title: "", modules: {} }
    }
  ]
};

const fidelityAudit = buildFieldFidelityAudit(fidelityOnlyReport, {
  exampleLimit: 1,
  now: () => new Date("2026-07-15T01:00:00.000Z")
});

assert.equal(fidelityAudit.schema_version, "field-fidelity-audit-v1");
assert.equal(fidelityAudit.status, "completed");
assert.equal(fidelityAudit.generated_at, "2026-07-15T01:00:00.000Z");
assert.equal(fidelityAudit.summary.card_count, 3);
assert.equal(fidelityAudit.summary.reviewed_sem_card_count, 0);
assert.equal(fidelityAudit.summary.fidelity_only_card_count, 3);
assert.equal(fidelityAudit.summary.correctness.status, "not_evaluated");
assert.equal(fidelityAudit.policy.corrected_title_used_for_correctness, false);

assert.equal(fidelityAudit.summary.counts.provider_unread, 1);
assert.equal(fidelityAudit.summary.counts.resolver_loss, 1);
assert.equal(fidelityAudit.summary.counts.renderer_input_loss, 1);
assert.equal(fidelityAudit.summary.counts.renderer_title_loss, 2);
assert.equal(fidelityAudit.summary.counts.presentation_loss, 3);
assert.equal(fidelityAudit.summary.counts.recovery, 1);
assert.equal(fidelityAudit.summary.counts.pollution, 1);
assert.equal(fidelityAudit.summary.counts.loss, 4);

assert.equal(fidelityAudit.fields.card_number.counts.provider_unread, 1);
assert.equal(fidelityAudit.fields.card_number.counts.resolver_recovery, 1);
assert.equal(fidelityAudit.fields.card_number.counts.renderer_title_loss, 1);
assert.equal(fidelityAudit.fields.numerical_rarity.counts.resolver_loss, 1);
assert.equal(fidelityAudit.fields.subject.counts.renderer_title_loss, 1);
assert.equal(fidelityAudit.fields.product.counts.renderer_input_loss, 1);
assert.equal(fidelityAudit.fields.print_finish.counts.resolver_pollution, 1);
assert.equal(fidelityAudit.fields.print_finish.counts.pollution, 1);
assert.equal(fidelityAudit.fields.print_finish.examples.pollution.length, 1);
assert.equal(fidelityAudit.fields.print_finish.examples.pollution[0].from_value, "Gold Refractor");
assert.equal(fidelityAudit.fields.print_finish.examples.pollution[0].to_value, "Blue Refractor");

const missingProvider = fidelityAudit.cards.find((card) => card.card_id === "missing-provider-layer");
assert.deepEqual(missingProvider.data_quality.unavailable_layers, [
  "raw_provider_fields",
  "identity_resolution.identity"
]);
assert.equal(missingProvider.counts.provider_unread, 0);
assert.equal(missingProvider.counts.loss, 0);

const fidelityCard = fidelityAudit.cards.find((card) => card.card_id === "fidelity-card");
assert.equal(fidelityCard.correctness_mode, "fidelity_only");
assert.equal(fidelityCard.fields.year.correctness, null);
assert.ok(fidelityCard.fields.card_number.events.some((event) => event.type === "provider_unread"));
assert.ok(fidelityCard.fields.numerical_rarity.events.some((event) => event.type === "resolver_loss"));
assert.ok(fidelityCard.fields.subject.events.some((event) => event.type === "renderer_title_loss"));

const reviewedSemReport = {
  schema_version: "cloud-listing-api-eval-v1",
  evaluation_truth_policy: {
    field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
  },
  results: [{
    candidate_id: "reviewed-sem-card",
    corrected_title: "1999 This Title Is Deliberately Irrelevant",
    corrected_title_is_reviewed_title_ground_truth: true,
    reviewed_ground_truth: {
      fields: {
        year: "2024",
        subject: ["Jane Doe"],
        numerical_rarity: "7/25"
      },
      field_statuses: {
        year: "CONFIRMED",
        subject: "CONFIRMED",
        numerical_rarity: "CONFIRMED"
      }
    },
    raw_provider_fields: {
      year: "2023",
      players: ["Jane Doe"],
      serial_number: "7/25"
    },
    identity_resolution: {
      identity: {
        year: "2024",
        players: ["Jane Doe"],
        serial_number: "7/25"
      }
    },
    resolved_fields: {
      year: "2024",
      players: ["Jane Doe"],
      serial_number: "7/25"
    },
    renderer_input: {
      fields: {
        year: "2024",
        players: ["Jane Doe"],
        serial_number: "7/25"
      }
    },
    rendered_fields: {
      rendered_title: "2024 Topps Chrome Jane Doe 7/25",
      modules: {
        year: { tokens: [{ text: "2024", fields: ["year"] }] },
        subject: { tokens: [{ text: "Jane Doe", fields: ["players"] }] },
        numerical_rarity: { tokens: [{ text: "7/25", fields: ["serial_number"] }] }
      }
    }
  }]
};

const reviewedAudit = buildFieldFidelityAudit(reviewedSemReport, {
  now: () => new Date("2026-07-15T02:00:00.000Z")
});

assert.equal(reviewedAudit.summary.reviewed_sem_card_count, 1);
assert.equal(reviewedAudit.summary.fidelity_only_card_count, 0);
assert.equal(reviewedAudit.summary.correctness.status, "reviewed_sem_available");
assert.equal(reviewedAudit.summary.correctness.stages.raw_provider_fields.evaluated_count, 3);
assert.equal(reviewedAudit.summary.correctness.stages.raw_provider_fields.correct_count, 2);
assert.equal(reviewedAudit.summary.correctness.stages.raw_provider_fields.incorrect_count, 1);
assert.equal(reviewedAudit.summary.correctness.stages.resolver_output.correct_count, 3);
assert.equal(reviewedAudit.summary.correctness.stages.final_title.correct_count, 3);
assert.equal(reviewedAudit.fields.year.correctness.raw_provider_fields.incorrect_count, 1);
assert.equal(reviewedAudit.fields.year.correctness.resolver_output.correct_count, 1);
assert.equal(reviewedAudit.cards[0].fields.year.correctness.reviewed_sem_value, "2024");
assert.equal(reviewedAudit.cards[0].fields.year.correctness.stages.raw_provider_fields, "INCORRECT");
assert.equal(reviewedAudit.cards[0].fields.year.correctness.stages.final_title, "CORRECT");

const directReviewedFieldsAudit = buildFieldFidelityAudit({
  evaluation_truth_policy: {
    field_ground_truth_class: "HUMAN_REVIEWED_FIELD_GROUND_TRUTH"
  },
  results: [{
    candidate_id: "direct-reviewed-fields",
    reviewed_ground_truth: { year: "2026" },
    raw_provider_fields: { year: "2026" }
  }]
});
assert.equal(directReviewedFieldsAudit.summary.reviewed_sem_card_count, 1);
assert.equal(directReviewedFieldsAudit.fields.year.correctness.raw_provider_fields.correct_count, 1);

const emptyAudit = buildFieldFidelityAudit({ results: [] }, {
  now: () => new Date("2026-07-15T03:00:00.000Z")
});
assert.equal(emptyAudit.status, "no_results");
assert.equal(emptyAudit.summary.card_count, 0);

const tmp = await mkdtemp(join(tmpdir(), "field-fidelity-audit-"));
try {
  const inputPath = join(tmp, "cloud-eval.json");
  const outPath = join(tmp, "field-fidelity.json");
  await writeFile(inputPath, `${JSON.stringify(fidelityOnlyReport, null, 2)}\n`);
  const cli = spawnSync(process.execPath, [
    "scripts/audit-field-fidelity.mjs",
    "--input",
    inputPath,
    "--out",
    outPath,
    "--examples",
    "1"
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /field fidelity audit completed/);
  assert.match(cli.stdout, /provider_unread: 1/);
  const cliAudit = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(cliAudit.summary.card_count, 3);
  assert.equal(cliAudit.policy.corrected_title_used_for_correctness, false);
  assert.equal(cliAudit.fields.print_finish.examples.pollution.length, 1);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log("field fidelity audit tests passed");
