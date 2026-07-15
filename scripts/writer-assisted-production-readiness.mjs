#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadEnvFiles } from "./check-feedback-workflow-context-schema.mjs";

const defaultBaseUrl = "https://listing.lyncafei.team";

function hasFlag(argv, name) {
  return argv.includes(name);
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || fallback) : fallback;
}

function source(file) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

function check(id, passed, summary, details = {}) {
  return { id, status: passed ? "passed" : "blocked", summary, details };
}

function staticChecks() {
  const app = source("app/listing-copilot.js");
  const enqueue = source("api/v4/listing-job-enqueue.js");
  const status = source("api/v4/listing-job-status.js");
  const feedback = source("api/v4/listing-feedback.js");
  const exportApi = source("api/v4/listing-export-workbook.js");
  const release = source(".github/workflows/deploy-production.yml");
  return [
    check("writer_one_line_surface", /function TitleCardComponent/.test(app)
      && !/\$\{workflowSummaryNotice\(result\)\}/.test(app)
      && !/\$\{publicationGateNotice\(result\)\}/.test(app), "Writer UI exposes one editable title instead of internal control-plane panels."),
    check("duplicate_paid_enqueue_guard", /speculativeNeedsFreshEnqueue/.test(app)
      && /Number\(resultCount\) === 0/.test(app)
      && /fetchWithTimeout\(JOB_ENQUEUE_API_ENDPOINT/.test(app), "The browser blocks duplicate submissions and bounds enqueue waits."),
    check("durable_queue", /enqueueV4RecognitionJobs/.test(enqueue)
      && /V4_QUEUE_MAX_JOBS_PER_REQUEST/.test(enqueue)
      && /runPostEnqueueQueueKick/.test(enqueue), "Recognition enters the durable production queue with bounded admission."),
    check("operator_isolation", /ownedJobs = result\.rows\.filter/.test(status)
      && /readV4SessionStatus/.test(feedback), "Status and feedback paths verify tenant scope and persisted writer assignment."),
    check("learning_loop", /persistV4WriterFeedbackTransaction/.test(feedback), "Writer accept/edit/reject events atomically persist feedback, training artifacts, and the terminal session state."),
    check("retained_workbook_export", /createWriterBatchExport/.test(exportApi)
      && /writerExportRowsBelongToTenant/.test(exportApi)
      && !/new pg\.Client|client\.query\(sql\)/.test(exportApi), "Final titles and image references are retained without runtime schema mutation."),
    check("release_gate", /npm audit --omit=dev --audit-level=moderate/.test(release)
      && /npm run test:v4-spine/.test(release)
      && /npm run check:production-engineering/.test(release)
      && /npm run test:production-engineering/.test(release)
      && /check-track-c-production-schema\.mjs/.test(release)
      && /track-c-production-schema-postdeploy\.json/.test(release)
      && /VERCEL_DEPLOY_HOOK_URL/.test(release)
      && /git_commit_sha === process\.env\.GITHUB_SHA/.test(release)
      && !/\/api\/admin-apply-/.test(release), "Production deploy verifies dependencies, the exact Git commit, V4 behavior, and the schema contract without mutating schema over HTTP.")
  ];
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") || "";
  return value.split(";")[0];
}

export function cloudModelCapacityReady(health = {}) {
  const keyPoolSize = Number(health.openai_pool?.key_pool_size || 0);
  const perKeyStableConcurrency = Number(health.openai_pool?.per_key_stable_concurrency || 0);
  const workerClaimLimit = Number(health.production_queue?.worker_claim_limit || 0);
  const configuredCapacity = keyPoolSize * perKeyStableConcurrency;
  return health.default_model === "gpt-5-mini"
    && keyPoolSize >= 1
    && perKeyStableConcurrency >= 1
    && workerClaimLimit >= 1
    && workerClaimLimit <= configuredCapacity;
}

async function cloudChecks({ baseUrl, username, password }) {
  if (!username || !password) {
    return [check("cloud_runtime", false, "Cloud verification credentials are missing.")];
  }
  const healthResponse = await fetch(`${baseUrl}/api/v4/health`, { signal: AbortSignal.timeout(30_000) });
  const health = await healthResponse.json().catch(() => ({}));
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(30_000)
  });
  const cookie = cookieFrom(loginResponse);
  const providerResponse = cookie ? await fetch(`${baseUrl}/api/listing-provider-status`, {
    headers: { cookie },
    signal: AbortSignal.timeout(45_000)
  }) : null;
  const provider = providerResponse ? await providerResponse.json().catch(() => ({})) : {};
  const components = new Map((provider.workflow_readiness?.components || []).map((item) => [item.id, item]));
  const vector = components.get("vector_retrieval") || {};
  const tables = health.supabase?.tables || {};
  const tableFailures = Object.entries(tables).filter(([, value]) => value?.ok !== true).map(([name]) => name);
  return [
    check("cloud_health", healthResponse.ok && health.ready === true, "V4 production health reports ready.", {
      deployment_sha: health.deployment?.git_commit_sha || null,
      reasons: health.not_ready_reasons || []
    }),
    check("cloud_model_and_capacity", cloudModelCapacityReady(health), "Production uses GPT-5-mini within the configured key pool's stable concurrency envelope.", {
      model: health.default_model || null,
      key_pool: health.openai_pool?.key_pool_size || 0,
      per_key_stable_concurrency: health.openai_pool?.per_key_stable_concurrency || null,
      claim_limit: health.production_queue?.worker_claim_limit || null
    }),
    check("cloud_supabase_contract", tableFailures.length === 0
      && tables.v4_writer_export_batches?.ok === true
      && tables.v4_writer_export_items?.ok === true, "All V4 operational, learning, and writer-export tables are queryable.", { table_failures: tableFailures }),
    check("cloud_workflow", loginResponse.ok && providerResponse?.ok === true
      && provider.workflow_readiness?.can_run_cloud_recognition === true, "Authenticated writer workflow can run cloud recognition.", {
      ready_count: provider.workflow_readiness?.summary?.ready_count ?? null,
      component_count: provider.workflow_readiness?.summary?.component_count ?? null
    }),
    check("cloud_vector_contract", vector.details?.index_ready === true
      && vector.details?.runtime_ready === true
      && vector.details?.request_override_supported === true, "Vector index is ready and remains an explicit request-level assist.", {
      default_request_enabled: vector.details?.default_request_enabled ?? null,
      model_revision: vector.details?.model_revision || null
    })
  ];
}

export async function runWriterAssistedProductionReadiness({
  argv = process.argv.slice(2),
  env = process.env
} = {}) {
  const loaded = loadEnvFiles({ cwd: process.cwd(), envFiles: [".secrets/local.env", ".env.local", ".env"] });
  const mergedEnv = { ...loaded.values, ...env };
  const checks = staticChecks();
  if (hasFlag(argv, "--cloud")) {
    checks.push(...await cloudChecks({
      baseUrl: argValue(argv, "--base-url", defaultBaseUrl).replace(/\/+$/, ""),
      username: mergedEnv.METAVERSE_USERNAME,
      password: mergedEnv.METAVERSE_PASSWORD
    }));
  }
  const blocked = checks.filter((item) => item.status === "blocked");
  const report = {
    schema_version: "writer-assisted-production-readiness-v1",
    generated_at: new Date().toISOString(),
    scope: "writer_assisted_production",
    autonomous_accuracy_claim_ready: false,
    ready: blocked.length === 0,
    checks,
    blocked_count: blocked.length,
    note: "This gate proves the supervised writer workflow. Field-level held-out evidence remains the separate gate for autonomous 95% accuracy claims."
  };
  const out = argValue(argv, "--out", "");
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWriterAssistedProductionReadiness().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 1;
  }).catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
