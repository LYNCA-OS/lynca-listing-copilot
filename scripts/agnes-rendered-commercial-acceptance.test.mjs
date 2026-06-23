import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAgnesRenderedCommercialAcceptanceSummary,
  measureAgnesRenderedCommercialAcceptance
} from "./measure-agnes-rendered-commercial-acceptance.mjs";
import { evaluateCommercialAcceptanceRow } from "./measure-agnes-commercial-acceptance-proxy.mjs";

const agnesReport = {
  schema_version: "agnes-supabase-feedback-eval-v1",
  provider: "agnes",
  target_count: 4,
  evaluated_count: 3,
  provider_error_count: 1,
  results: [
    {
      candidate_id: "already-ok",
      source_feedback_id: "already-ok",
      status: "evaluated",
      corrected_title_reference: "2025 Topps Chrome Shohei Ohtani Gold Refractor 29/199 PSA 10 Auto RC",
      prediction: {
        title: "2025 Topps Chrome Shohei Ohtani Gold Refractor 29/199 PSA 10 Auto RC",
        fields: {
          year: "2025",
          manufacturer: "Topps",
          product: "Topps Chrome",
          players: ["Shohei Ohtani"],
          parallel: "Gold Refractor",
          serial_number: "29/199",
          grade_company: "PSA",
          card_grade: "10",
          auto: true,
          rc: true
        }
      },
      corrected_title_comparison: {
        token_recall: 1,
        token_precision: 1,
        wrong_year: false,
        wrong_serial: false,
        wrong_grade: false,
        unexpected_color: false
      }
    },
    {
      candidate_id: "renderer-recovers",
      source_feedback_id: "renderer-recovers",
      status: "evaluated",
      corrected_title_reference: "2024 Panini Prizm Caitlin Clark Silver Prizm 5/10 PSA 10",
      prediction: {
        title: "2024 Panini Prizm Caitlin Clark",
        fields: {
          year: "2024",
          manufacturer: "Panini",
          product: "Prizm",
          players: ["Caitlin Clark"],
          subset: "Silver Prizm",
          serial_number: "5/10",
          grade_company: "PSA",
          card_grade: "10"
        }
      },
      corrected_title_comparison: {
        token_recall: 0.5,
        token_precision: 1,
        wrong_year: false,
        wrong_serial: false,
        wrong_grade: false,
        unexpected_color: false
      }
    },
    {
      candidate_id: "still-wrong",
      source_feedback_id: "still-wrong",
      status: "evaluated",
      corrected_title_reference: "2024 Bowman Chrome Caitlin Clark Blue 51/50 PSA 10",
      prediction: {
        title: "2023 Panini Prizm LeBron James Red 31/50 PSA 9",
        fields: {
          year: "2023",
          manufacturer: "Panini",
          product: "Prizm",
          players: ["LeBron James"],
          parallel: "Red",
          serial_number: "31/50",
          grade_company: "PSA",
          card_grade: "9"
        }
      },
      corrected_title_comparison: {
        token_recall: 0.75,
        token_precision: 0.75,
        wrong_year: true,
        wrong_serial: true,
        wrong_grade: true,
        unexpected_color: true
      }
    },
    {
      candidate_id: "provider-error",
      source_feedback_id: "provider-error",
      status: "provider_error",
      corrected_title_reference: "2024 Topps Chrome Mike Trout Silver Refractor",
      error: "timeout"
    }
  ]
};

const report = measureAgnesRenderedCommercialAcceptance({
  report: agnesReport,
  targetAccuracy: 0.75,
  maxManualRate: 0.25,
  now: () => new Date("2026-06-23T12:00:00.000Z")
});

assert.equal(report.schema_version, "agnes-rendered-commercial-acceptance-v1");
assert.equal(report.generated_at, "2026-06-23T12:00:00.000Z");
assert.equal(report.status, "completed");
assert.equal(report.scope.exact_title_match_required, false);
assert.equal(report.scope.word_order_required, false);
assert.equal(report.scope.raw_titles_in_report, false);
assert.equal(report.policy.title_render_source, "deterministic_renderer");
assert.equal(report.policy.max_title_length, 80);
assert.equal(report.policy.target_auto_correct_count, 3);
assert.equal(report.policy.max_manual_count, 1);
assert.equal(report.metrics.base_provider_title_accepted_count, 1);
assert.equal(report.metrics.rendered_title_accepted_count, 2);
assert.equal(report.metrics.renderer_recovered_count, 1);
assert.equal(report.metrics.renderer_regressed_count, 0);
assert.equal(report.metrics.additional_auto_correct_needed_for_target, 1);
assert.equal(report.metrics.current_manual_over_budget_count, 1);
assert.equal(report.rendered_failure_summary.primary_failure_reasons.principle_error, 1);
assert.equal(report.rendered_failure_summary.primary_failure_reasons.provider_error, 1);

const recovered = report.items.find((item) => item.source_feedback_id === "renderer-recovers");
assert.equal(recovered.outcome, "renderer_recovered");
assert.equal(recovered.rendered_accepted, true);
const stillWrong = report.items.find((item) => item.source_feedback_id === "still-wrong");
assert.equal(stillWrong.rendered_accepted, false);
assert.ok(stillWrong.rendered_principle_failures.includes("wrong_player"));

const rangeYearAccepted = evaluateCommercialAcceptanceRow({
  status: "evaluated",
  corrected_title_reference: "1998-99 Upper Deck MJx Michael Jordan Timepieces Bronze 102/230",
  prediction: {
    title: "1998 Upper Deck MJx Michael Jordan Timepieces Bronze 102/230",
    fields: {
      year: "1998",
      product: "MJx",
      players: ["Michael Jordan"],
      parallel: "Bronze",
      serial_number: "102/230"
    }
  },
  corrected_title_comparison: {
    token_recall: 1,
    token_precision: 1,
    wrong_year: false,
    wrong_serial: false,
    wrong_grade: false,
    unexpected_color: false
  }
});
assert.equal(rangeYearAccepted.accepted, true);

const identityAbstainRow = evaluateCommercialAcceptanceRow({
  status: "evaluated",
  corrected_title_reference: "2022 Panini Gold Standard Hunter Renfrow Rush 19/299",
  identity_resolution_status: "ABSTAIN",
  prediction: {
    title: "Renfrow 196/299",
    identity_resolution_status: "ABSTAIN",
    title_render_source: "identity_resolution_abstain",
    fields: {
      year: "2022",
      product: "Gold Standard",
      players: ["Hunter Renfrow"],
      serial_number: "196/299"
    }
  },
  corrected_title_comparison: {
    token_recall: 0.2,
    token_precision: 0.5,
    wrong_year: false,
    wrong_serial: true,
    wrong_grade: false,
    unexpected_color: false
  }
});
assert.equal(identityAbstainRow.accepted, false);
assert.equal(identityAbstainRow.primary_failure_reason, "identity_abstain");
assert.deepEqual(identityAbstainRow.principle_failures, []);

const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /Shohei Ohtani/);
assert.doesNotMatch(serialized, /Caitlin Clark/);
assert.doesNotMatch(serialized, /LeBron James/);
assert.doesNotMatch(serialized, /"corrected_title_reference"\s*:/);
assert.doesNotMatch(serialized, /"prediction"\s*:/);

const summary = formatAgnesRenderedCommercialAcceptanceSummary(report);
assert.match(summary, /base_provider_title_accepted: 1\/4 \(0.25\)/);
assert.match(summary, /rendered_title_accepted: 2\/4 \(0.5\)/);
assert.match(summary, /renderer_recovered: 1/);
assert.doesNotMatch(summary, /Caitlin Clark/);

const tmp = await mkdtemp(join(tmpdir(), "agnes-rendered-commercial-acceptance-"));
const inputPath = join(tmp, "agnes.json");
const outPath = join(tmp, "rendered.json");
await writeFile(inputPath, `${JSON.stringify(agnesReport, null, 2)}\n`);
const cli = spawnSync(process.execPath, [
  "scripts/measure-agnes-rendered-commercial-acceptance.mjs",
  "--input",
  inputPath,
  "--out",
  outPath,
  "--target-accuracy",
  "0.75",
  "--max-manual-rate",
  "0.25"
], {
  encoding: "utf8"
});
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Agnes rendered commercial acceptance/);
assert.match(cli.stdout, /rendered_title_accepted: 2\/4 \(0.5\)/);
assert.doesNotMatch(cli.stdout, /LeBron James/);

const written = JSON.parse(await readFile(outPath, "utf8"));
assert.equal(written.metrics.renderer_recovered_count, 1);
assert.doesNotMatch(JSON.stringify(written), /Shohei Ohtani/);

console.log("Agnes rendered commercial acceptance tests passed");
