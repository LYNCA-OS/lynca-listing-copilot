#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  acquireCheckpointLock,
  deploymentOrigin,
  durableJsonWriter,
  invokePreview,
  readJson,
  runTokenFromKeychain
} from "./cloud-io.mjs";
import {
  buildLunaExplicitCacheScreenPlan,
  normalizeCachePreviewIdentity,
  preflightReceiptSha256
} from "./luna-explicit-cache-contract.mjs";
import { assertLunaExplicitCachePreregisteredContract } from "./luna-explicit-cache-prereg.mjs";

function wireSteps(plan) {
  return plan.steps.map((step) => ({ id: step.id, request: step.request }));
}

function cliArguments(argv) {
  const values = {};
  const booleans = new Set(["--execution-authorized"]);
  const allowed = new Set([
    "--deployment",
    "--out",
    "--preflight",
    "--run-id",
    "--execution-authorized"
  ]);
  for (let index = 0; index < argv.length;) {
    const name = argv[index];
    if (!allowed.has(name) || Object.hasOwn(values, name)) {
      throw new Error("unsupported_or_duplicate_option");
    }
    if (booleans.has(name)) {
      values[name] = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("option_value_required");
    values[name] = value;
    index += 2;
  }
  return values;
}

function reportPreviewIdentity(report) {
  return normalizeCachePreviewIdentity({
    environment: report?.environment,
    region: report?.region,
    deployment_id: report?.deployment_id,
    deployment_hostname: report?.deployment_hostname,
    release_git_sha: report?.release_git_sha
  });
}

function validatePreflight(report, { runId, deployment, plan }) {
  const deploymentHost = new URL(deployment).hostname;
  const identity = reportPreviewIdentity(report);
  if (report?.schema_version !== "lynca-luna-explicit-cache-screen-v1"
      || report?.state !== "PREFLIGHT_READY_NO_PROVIDER_CALL"
      || report?.decision !== "NOT_EXECUTED"
      || report?.execution_authorized !== false
      || report?.provider_calls !== 0
      || report?.provider_retries !== 0
      || report?.run_id !== runId
      || report?.production_recommendation !== false
      || report?.accuracy_claim_allowed !== false
      || identity.deployment_hostname !== deploymentHost
      || report?.durable_single_use_authority_available !== false
      || report?.preflight_receipt_sha256 !== preflightReceiptSha256(plan, identity)) {
    throw new Error("prompt_cache_preflight_invalid");
  }
  return report;
}

function validatePaidReport(report, preflight) {
  const preflightIdentity = reportPreviewIdentity(preflight);
  let reportIdentity;
  try { reportIdentity = reportPreviewIdentity(report); } catch {
    throw new Error("prompt_cache_paid_report_invalid");
  }
  if (report?.schema_version !== "lynca-luna-explicit-cache-screen-v1"
      || report?.execution_authorized !== true
      || report?.run_id !== preflight.run_id
      || report?.preflight_receipt_sha256 !== preflight.preflight_receipt_sha256
      || report?.cache_policy_id !== preflight.cache_policy_id
      || report?.semantic_contract_sha256 !== preflight.semantic_contract_sha256
      || report?.stable_prefix_sha256 !== preflight.stable_prefix_sha256
      || report?.provider_retries !== 0
      || report?.retry !== false
      || !Number.isInteger(report?.provider_calls)
      || !Array.isArray(report?.rows)
      || report.rows.length !== report.provider_calls
      || JSON.stringify(reportIdentity) !== JSON.stringify(preflightIdentity)
      || ![
        "PASS_CACHE_TRANSPORT_CANDIDATE",
        "STOPPED",
        "AMBIGUOUS_PROVIDER_OUTCOME",
        "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED"
      ].includes(report?.state)
      || report?.production_recommendation !== false
      || report?.accuracy_claim_allowed !== false) {
    throw new Error("prompt_cache_paid_report_invalid");
  }
  if (report.state === "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED"
      && (report.decision !== "HOLD"
        || report.provider_calls !== 0
        || report.rows.length !== 0
        || report.retry_allowed !== false
        || report.durable_single_use_authority_available !== false)) {
    throw new Error("prompt_cache_paid_hold_not_honest");
  }
  if (report.state !== "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED"
      && (report.provider_calls < 1 || report.provider_calls > 3
        || report.durable_single_use_authority_available !== true)) {
    throw new Error("prompt_cache_paid_call_count_invalid");
  }
  if (report.state === "PASS_CACHE_TRANSPORT_CANDIDATE"
      && (report.provider_calls !== 3
        || report.provider_failures !== 0
        || report.request_failures !== 0
        || report.rows.some((row) => !row?.request_ok || row?.gate?.passed !== true))) {
    throw new Error("prompt_cache_paid_pass_not_proven");
  }
  if (report.state === "STOPPED" && report.decision !== "STOP") {
    throw new Error("prompt_cache_paid_stop_not_honest");
  }
  if (report.state === "AMBIGUOUS_PROVIDER_OUTCOME"
      && (report.decision !== "HOLD"
        || report.provider_calls_known !== report.provider_calls
        || report.retry_allowed !== false
        || !report.rows.some((row) => row?.transport_outcome_ambiguous === true))) {
    throw new Error("prompt_cache_paid_ambiguity_not_honest");
  }
  return report;
}

export async function runLunaExplicitCacheCloudScreen({
  deployment,
  outPath,
  runId,
  preflightPath = null,
  executionAuthorized = false,
  runToken,
  invoke = invokePreview
}) {
  if (!outPath) throw new Error("out_path_required");
  const origin = deploymentOrigin(deployment);
  const token = runToken || await runTokenFromKeychain();
  const plan = buildLunaExplicitCacheScreenPlan(runId);
  assertLunaExplicitCachePreregisteredContract(plan.contract);
  const release = await acquireCheckpointLock(outPath);
  const write = durableJsonWriter(outPath);
  try {
    const existing = await readJson(outPath);
    if (existing?.state === "AMBIGUOUS_PROVIDER_OUTCOME") {
      throw new Error("prompt_cache_checkpoint_ambiguous_no_retry");
    }
    if (existing?.state === "PREFLIGHT_READY_NO_PROVIDER_CALL") {
      if (executionAuthorized) throw new Error("paid_output_path_contains_preflight");
      return validatePreflight(existing, { runId, deployment: origin, plan });
    }
    if (existing?.state === "PASS_CACHE_TRANSPORT_CANDIDATE"
        || existing?.state === "STOPPED"
        || existing?.state === "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED") {
      if (existing.run_id !== runId
          || existing.deployment_hostname !== new URL(origin).hostname) {
        throw new Error("prompt_cache_checkpoint_identity_mismatch");
      }
      return existing;
    }

    if (!executionAuthorized) {
      const report = await invoke({
        apiPath: "/api/prompt-cache",
        maxTimeSeconds: 280,
        deployment: origin,
        runToken: token,
        body: {
          run_id: runId,
          execution_authorized: false,
          steps: wireSteps(plan)
        }
      });
      validatePreflight(report, { runId, deployment: origin, plan });
      await write(report);
      return report;
    }

    if (!preflightPath) throw new Error("paid_execution_preflight_path_required");
    const preflight = validatePreflight(await readJson(preflightPath), {
      runId,
      deployment: origin,
      plan
    });
    const previewIdentity = reportPreviewIdentity(preflight);
    if (preflight.preflight_receipt_sha256 !== preflightReceiptSha256(plan, previewIdentity)) {
      throw new Error("paid_execution_local_contract_drift");
    }
    await write({
      schema_version: "lynca-luna-explicit-cache-checkpoint-v1",
      state: "IN_FLIGHT_AMBIGUOUS_IF_INTERRUPTED",
      execution_authorized: true,
      run_id: runId,
      preflight_receipt_sha256: preflight.preflight_receipt_sha256,
      preview_identity: previewIdentity,
      provider_calls_known: null,
      retry: false,
      retry_allowed: false
    });
    let report;
    try {
      report = await invoke({
        apiPath: "/api/prompt-cache",
        maxTimeSeconds: 280,
        deployment: origin,
        runToken: token,
        body: {
          run_id: runId,
          execution_authorized: true,
          preflight_receipt_sha256: preflight.preflight_receipt_sha256,
          preview_identity: previewIdentity,
          steps: wireSteps(plan)
        }
      });
    } catch (error) {
      await write({
        schema_version: "lynca-luna-explicit-cache-checkpoint-v1",
        state: "AMBIGUOUS_PROVIDER_OUTCOME",
        execution_authorized: true,
        run_id: runId,
        preflight_receipt_sha256: preflight.preflight_receipt_sha256,
        preview_identity: previewIdentity,
        provider_calls_known: null,
        retry: false,
        retry_allowed: false,
        error: String(error?.message || "preview_transport_ambiguous")
          .replace(/https?:\/\/\S+/g, "[redacted-url]")
          .slice(0, 240)
      });
      throw error;
    }
    validatePaidReport(report, preflight);
    await write(report);
    return report;
  } finally {
    await release();
  }
}

export async function main(argv = process.argv.slice(2), {
  stdout = process.stdout,
  runToken
} = {}) {
  const options = cliArguments(argv);
  const report = await runLunaExplicitCacheCloudScreen({
    deployment: options["--deployment"],
    outPath: options["--out"],
    runId: options["--run-id"],
    preflightPath: options["--preflight"] || null,
    executionAuthorized: options["--execution-authorized"] === true,
    runToken
  });
  stdout.write(`${JSON.stringify({
    ok: report.ok,
    state: report.state,
    decision: report.decision,
    execution_authorized: report.execution_authorized,
    provider_calls: report.provider_calls
  })}\n`);
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "prompt_cache_screen_failed").slice(0, 200)}\n`);
    process.exitCode = 1;
  });
}
