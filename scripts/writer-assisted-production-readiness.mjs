#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadEnvFiles } from "../lib/listing/readiness/workflow-context-schema.mjs";

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
  const index = source("app/index.html");
  const directApi = source("api/csm-listing-title.js");
  const runtime = source("lib/listing/thin/csm-runtime-contract.mjs");
  const health = source("api/health.js");
  const orchestration = source("lib/listing/thin/csm-orchestration.mjs");
  const release = source(".github/workflows/deploy-production.yml");
  return [
    check("writer_one_line_surface", /id="processButton"[^>]*hidden/.test(index)
      && /CSM_THIN_API_ENDPOINT\s*=\s*["']\/api\/csm-listing-title["']/.test(app)
      && /processAssetViaCsmThinPath/.test(app), "Uploading images is the recognition intent; the writer receives one editable title without a start button."),
    check("direct_csm_boundary", /CSM_THIN_DIRECT/.test(directApi)
      && /gpt-5\.6-luna/.test(runtime)
      && /reasoning_effort|reasoningEffort/.test(directApi), "Recognition uses the direct Luna -> CSM/SEM boundary."),
    check("atomic_persistence", /persistPreparedCanonicalListingPath/.test(orchestration)
      && /writeCsmStagePacketAtomically/.test(orchestration)
      && /verifyReplay/.test(orchestration), "The CSM packet is persisted atomically and replay-verified before the writer sees it."),
    check("retired_execution_paths", /cloud_run_calls:\s*0/.test(health)
      && /vector_calls:\s*0/.test(health)
      && /generic_ocr_calls:\s*0/.test(health)
      && /active_path === 'CSM_THIN_DIRECT'/.test(release), "Cloud Run, vector, OCR, and the old V4 execution path are disabled for this release."),
    check("release_gate", /npm ls --omit=dev --all/.test(release)
      && /node scripts\/npm-audit-gate\.mjs/.test(release)
      && /npm run check:csm-thin/.test(release)
      && /npm run test:csm-thin/.test(release)
      && /VERCEL_DEPLOY_HOOK_URL/.test(release)
      && /git_commit_sha === process\.env\.GITHUB_SHA/.test(release)
      && /check-csm-thin-production-readiness\.mjs/.test(release)
      && !/\/api\/admin-apply-/.test(release), "Production deploy verifies dependencies, the exact Git commit, CSM behavior, and the read-only Supabase readiness contract without running migrations from the application deployment.")
  ];
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") || "";
  return value.split(";")[0];
}

export function cloudModelCapacityReady(health = {}) {
  const capacity = health.capacity || {};
  return health.active_path === "CSM_THIN_DIRECT"
    && health.model === "gpt-5.6-luna"
    && health.reasoning_effort === "none"
    && Number(capacity.scheduler_attempt_slots || 0) === 120
    && Number(capacity.baseline_working_attempts || 0) === 43
    && Number(capacity.effective_reserved_attempt_ceiling || 0) >= 1
    && Number(capacity.effective_reserved_attempt_ceiling || 0) <= 83;
}

async function cloudChecks({ baseUrl, username, password }) {
  if (!username || !password) {
    return [check("cloud_runtime", false, "Cloud verification credentials are missing.")];
  }
  const healthResponse = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(30_000) });
  const health = await healthResponse.json().catch(() => ({}));
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(30_000)
  });
  const cookie = cookieFrom(loginResponse);
  const appResponse = cookie ? await fetch(`${baseUrl}/app/listing-copilot.js`, {
    headers: { cookie },
    signal: AbortSignal.timeout(30_000)
  }) : null;
  return [
    check("cloud_health", healthResponse.ok && health.ready === true, "CSM thin production health reports ready.", {
      deployment_sha: health.deployment?.git_commit_sha || null,
      active_path: health.active_path || null
    }),
    check("cloud_model_and_capacity", cloudModelCapacityReady(health), "Production uses Luna within the durable provider authority envelope.", {
      model: health.model || null,
      scheduler_attempt_slots: health.capacity?.scheduler_attempt_slots || null,
      baseline_working_attempts: health.capacity?.baseline_working_attempts || null,
      effective_reserved_attempt_ceiling: health.capacity?.effective_reserved_attempt_ceiling || null
    }),
    check("cloud_supabase_contract", health.runtime?.persistence_configured === true
      && health.runtime?.retired_capabilities_disabled === true, "CSM persistence is configured and retired runtime capabilities are disabled.", {
      persistence_configured: health.runtime?.persistence_configured ?? null,
      retired_capabilities_disabled: health.runtime?.retired_capabilities_disabled ?? null
    }),
    check("cloud_workflow", loginResponse.ok && appResponse?.ok === true,
      "Authenticated writer workflow can open the CSM thin frontend.", {
        login_ok: loginResponse.ok,
        app_ok: appResponse?.ok === true
    }),
    check("cloud_retired_boundaries", health.runtime?.cloud_run_calls === 0
      && health.runtime?.vector_calls === 0
      && health.runtime?.generic_ocr_calls === 0, "Cloud Run, vector, and generic OCR calls are absent from the active chain.", {
        cloud_run_calls: health.runtime?.cloud_run_calls ?? null,
        vector_calls: health.runtime?.vector_calls ?? null,
        generic_ocr_calls: health.runtime?.generic_ocr_calls ?? null
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
