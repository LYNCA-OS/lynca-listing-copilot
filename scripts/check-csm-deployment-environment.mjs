#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  CSM_RETIRED_RUNTIME_DISABLE_FLAGS,
  CSM_RETIRED_RUNTIME_FLAGS,
  csmRetiredCapabilitiesDisabled,
  enabledExactly
} from "../lib/listing/thin/csm-runtime-contract.mjs";

export function checkCsmDeploymentEnvironment(env = process.env) {
  const target = String(env.VERCEL_ENV || "").trim().toLowerCase();
  if (!new Set(["preview", "production"]).has(target)) {
    return { ok: true, skipped: true, target: target || "local" };
  }

  const failures = [];
  if (!enabledExactly(env.CSM_PERSISTENCE_ENABLED)) {
    failures.push("CSM_PERSISTENCE_ENABLED_must_be_true");
  }
  if (!String(env.OPENAI_API_KEY || "").trim()) failures.push("OPENAI_API_KEY_missing");
  if (!String(env.SUPABASE_URL || "").trim()) failures.push("SUPABASE_URL_missing");
  if (!String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim()) {
    failures.push("SUPABASE_SERVICE_KEY_missing");
  }
  if (!csmRetiredCapabilitiesDisabled(env)) {
    failures.push(...CSM_RETIRED_RUNTIME_FLAGS
      .filter((name) => enabledExactly(env[name]))
      .map((name) => `${name}_must_not_be_true`));
    failures.push(...CSM_RETIRED_RUNTIME_DISABLE_FLAGS
      .filter((name) => !enabledExactly(env[name]))
      .map((name) => `${name}_must_be_true`));
  }

  if (failures.length) {
    const error = new Error(`csm_deployment_environment_invalid:${failures.join(",")}`);
    error.code = "csm_deployment_environment_invalid";
    error.failures = failures;
    throw error;
  }
  return { ok: true, skipped: false, target };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = checkCsmDeploymentEnvironment();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || "csm_deployment_environment_invalid",
      failures: error.failures || []
    })}\n`);
    process.exitCode = 1;
  }
}
