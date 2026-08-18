import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";
import {
  listingApprovedMemoryEnabled,
  listingFeedbackRetentionEnabled
} from "../lib/supabase-feedback.mjs";

const defaultDatasetPath = "data/golden-dataset.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function readJsonFile(path) {
  const resolvedPath = resolve(path);
  const text = await readFile(resolvedPath, "utf8");
  return {
    path: resolvedPath,
    value: JSON.parse(text)
  };
}

function checkResult(id, status, severity, summary, details = {}) {
  return { id, status, severity, summary, details };
}

function passed(id, summary, details = {}) {
  return checkResult(id, "passed", "info", summary, details);
}

function blocked(id, summary, details = {}) {
  return checkResult(id, "blocked", "blocker", summary, details);
}

function warning(id, summary, details = {}) {
  return checkResult(id, "warning", "warning", summary, details);
}

export async function auditGoldenDataset(datasetPath) {
  try {
    const loaded = await readJsonFile(datasetPath);
    const evaluation = evaluateGoldenDataset(loaded.value);
    if (!evaluation.ok) {
      return {
        evaluation: null,
        checks: [
          blocked("golden_dataset", "Golden dataset validation failed.", {
            dataset: loaded.path,
            errors: evaluation.validation?.errors || []
          })
        ]
      };
    }

    const gate = evaluation.commercial_acceptance_gate;
    return {
      evaluation,
      checks: [
        passed("golden_dataset", "Golden dataset is readable and schema-valid.", {
          dataset: loaded.path,
          total_assets: evaluation.dataset.total_assets,
          split_counts: evaluation.dataset.split_counts
        }),
        gate.passed
          ? passed("commercial_acceptance_gate", "Held-out commercial acceptance gate passed.", {
            metric_scope: gate.metric_scope,
            held_out_commercial_assets: evaluation.held_out_commercial_evidence.total_assets,
            minimum_held_out_assets: gate.minimum_held_out_assets,
            reasons: gate.reasons,
            threshold_results: gate.threshold_results
          })
          : blocked("commercial_acceptance_gate", "Held-out commercial acceptance gate failed; commercial accuracy claims remain blocked.", {
            metric_scope: gate.metric_scope,
            held_out_commercial_assets: evaluation.held_out_commercial_evidence.total_assets,
            minimum_held_out_assets: gate.minimum_held_out_assets,
            reasons: gate.reasons,
            threshold_results: gate.threshold_results
          })
      ]
    };
  } catch (error) {
    return {
      evaluation: null,
      checks: [
        blocked("golden_dataset", "Golden dataset could not be read.", {
          dataset: resolve(datasetPath),
          error: error.message
        })
      ]
    };
  }
}

export function auditRetentionDefaults(env = {}) {
  const retentionEnabled = listingFeedbackRetentionEnabled(env);
  const memoryEnabled = listingApprovedMemoryEnabled(env);
  return [
    retentionEnabled
      ? warning("feedback_retention_switch", "LISTING_FEEDBACK_RETENTION_ENABLED is on in this process. That is a Founder/ops Vercel switch, not commercial-readiness evidence.", {
        flag: "LISTING_FEEDBACK_RETENTION_ENABLED",
        enabled: true
      })
      : passed("feedback_retention_switch", "LISTING_FEEDBACK_RETENTION_ENABLED defaults off. It is a Founder/ops Vercel switch, not a code release.", {
        flag: "LISTING_FEEDBACK_RETENTION_ENABLED",
        enabled: false
      }),
    memoryEnabled
      ? warning("approved_memory_switch", "LISTING_APPROVED_MEMORY_ENABLED is on in this process. That is a Founder/ops Vercel switch, not commercial-readiness evidence.", {
        flag: "LISTING_APPROVED_MEMORY_ENABLED",
        enabled: true
      })
      : passed("approved_memory_switch", "LISTING_APPROVED_MEMORY_ENABLED defaults off. It is a Founder/ops Vercel switch, not a code release.", {
        flag: "LISTING_APPROVED_MEMORY_ENABLED",
        enabled: false
      })
  ];
}

export function auditPublishingBoundary() {
  const livePublishPath = resolve("api/listing-publish-draft.js");
  const livePublishPresent = existsSync(livePublishPath);
  return livePublishPresent
    ? warning("publishing_destination", "A listing-publish-draft handler is present. Publishing remains approval-gated and is not commercial-readiness evidence until a real B-end adapter exists.", {
      handler: "api/listing-publish-draft.js",
      present: true
    })
    : passed("publishing_destination", "No live B-end publish handler is in the deployable tree. Publishing remains mock-only and is not commercial readiness evidence.", {
      handler: "api/listing-publish-draft.js",
      present: false,
      destination: "mock_only_or_absent"
    });
}

export async function createCommercialReadinessReport({
  datasetPath = defaultDatasetPath,
  env = process.env
} = {}) {
  const golden = await auditGoldenDataset(datasetPath);
  const checks = [
    ...golden.checks,
    ...auditRetentionDefaults(env),
    auditPublishingBoundary()
  ];
  const blockers = checks.filter((check) => check.status === "blocked");
  const gate = golden.evaluation?.commercial_acceptance_gate || null;
  const heldOutAssets = golden.evaluation?.held_out_commercial_evidence?.total_assets ?? 0;

  return {
    schema_version: "commercial-readiness-audit-v2",
    generated_at: new Date().toISOString(),
    dataset: resolve(datasetPath),
    ready: blockers.length === 0 && gate?.passed === true,
    commercial_claim_allowed: gate?.passed === true && heldOutAssets > 0,
    held_out_commercial_assets: heldOutAssets,
    commercial_acceptance_gate: gate,
    checks,
    blockers: blockers.map((check) => check.id)
  };
}

export function formatCommercialReadinessReport(report = {}) {
  const lines = [
    `ready: ${report.ready === true}`,
    `commercial_claim_allowed: ${report.commercial_claim_allowed === true}`,
    `held_out_commercial_assets: ${report.held_out_commercial_assets ?? 0}`,
    `commercial_acceptance_gate: passed:${report.commercial_acceptance_gate?.passed === true} eligible:${report.commercial_acceptance_gate?.eligible === true}`,
    `blockers: ${report.blockers?.length ? report.blockers.join(", ") : "none"}`
  ];
  for (const check of report.checks || []) {
    lines.push(`${check.status}:${check.id} ${check.summary}`);
  }
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2), {
  env = process.env
} = {}) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    console.log([
      "Usage:",
      "  npm run readiness:audit [-- --dataset data/golden-dataset.json] [--report data/commercial-readiness-latest.json]",
      "",
      "An empty held-out commercial split fails this audit. Green CI is not commercial readiness."
    ].join("\n"));
    return null;
  }

  const datasetPath = argValue(argv, "--dataset", env.GOLDEN_DATASET_PATH || defaultDatasetPath);
  const reportPath = argValue(argv, "--report", env.COMMERCIAL_READINESS_REPORT_PATH || "");
  const report = await createCommercialReadinessReport({ datasetPath, env });
  console.log(formatCommercialReadinessReport(report));

  if (reportPath) {
    const resolved = resolve(reportPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${resolved}`);
  }

  if (!report.ready || !report.commercial_claim_allowed) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
