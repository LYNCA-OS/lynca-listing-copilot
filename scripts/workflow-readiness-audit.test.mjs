import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildWorkflowReadinessAudit,
  loadWorkflowReadinessEnv,
  main,
  workflowReadinessVersion
} from "./workflow-readiness-audit.mjs";

function response({ ok = true, status = 200, body = "[]" } = {}) {
  return {
    ok,
    status,
    text: async () => body
  };
}

async function readyFetch(url) {
  if (String(url).endsWith("/readyz")) {
    return response({
      body: JSON.stringify({
        status: "ready",
        visual_embeddings_enabled: true,
        visual_embedding_preload_enabled: true,
        visual_embedding_preload_status: { status: "READY" },
        visual_embedding_model_id: "google/siglip2-base-patch16-384",
        visual_embedding_model_revision: "f775b65a79762255128c981547af89addcfe0f88"
      })
    });
  }
  return response();
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lynca-workflow-readiness-"));
fs.writeFileSync(path.join(tempDir, ".env.local"), [
  "OPENAI_API_KEY=file-openai-key",
  "SUPABASE_URL=https://file.supabase.test",
  "SUPABASE_SERVICE_ROLE_KEY=file-supabase-key"
].join("\n"));

const loaded = loadWorkflowReadinessEnv({
  argv: ["--env-file", ".env.local"],
  env: { OPENAI_API_KEY: "runtime-openai-key" },
  cwd: tempDir
});
assert.equal(loaded.env.OPENAI_API_KEY, "runtime-openai-key");
assert.equal(loaded.env.SUPABASE_SERVICE_ROLE_KEY, "file-supabase-key");
assert.deepEqual(loaded.loaded_env_files, [".env.local"]);

const configuredEnv = {
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_LISTING_MODEL: "gpt-4.1-mini",
  OPENAI_PROVIDER_UI_CONCURRENCY: "2",
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-supabase-key",
  LISTING_IMAGE_BUCKET: "listing-card-images",
  LISTING_FEEDBACK_RETENTION_ENABLED: "true",
  ENABLE_VECTOR_RETRIEVAL: "true",
  VECTOR_RETRIEVAL_MODE: "assist",
  VECTOR_WORKER_URL: "https://vector.worker.test",
  VECTOR_WORKER_TOKEN: "test-vector-token",
  ENABLE_ADVANCED_RETRIEVAL: "true",
  ENABLE_HYBRID_RETRIEVAL: "true",
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true",
  PADDLE_OCR_WORKER_URL: "https://ocr.worker.test",
  PADDLE_OCR_WORKER_TOKEN: "test-ocr-token",
  DATA_LOOP_SIDECARS_ENABLED: "true",
  DATA_LOOP_PADDLE_OCR_DISPATCH_ENABLED: "true",
  DATA_LOOP_SPLINK_LOOKUP_ENABLED: "true",
  DATA_LOOP_FIFTYONE_EXPORT_ENABLED: "true",
  DATA_LOOP_LIGHTGBM_SHADOW_ENABLED: "true",
  DATA_LOOP_INTERNAL_SIDECAR_TOKEN: "test-sidecar-token",
  EBAY_CLIENT_ID: "test-ebay-client",
  EBAY_CLIENT_SECRET: "test-ebay-secret",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_SELLER_USERNAME: "dcsports87"
};

const readyReport = await buildWorkflowReadinessAudit({
  argv: ["--no-env-file"],
  env: configuredEnv,
  cwd: tempDir,
  fetchImpl: readyFetch
});
assert.equal(readyReport.schema_version, workflowReadinessVersion);
assert.equal(readyReport.ok, true);
assert.equal(readyReport.can_run_cloud_recognition, true);
assert.equal(component(readyReport, "vision_provider").status, "READY");
assert.match(component(readyReport, "vision_provider").summary, /gpt-4\.1-mini/);
assert.equal(component(readyReport, "image_storage").status, "READY");
assert.equal(component(readyReport, "feedback_workflow_schema").status, "READY");
assert.equal(component(readyReport, "vector_retrieval").status, "READY");
assert.equal(component(readyReport, "vector_retrieval").details.runtime_ready, true);
assert.equal(component(readyReport, "paddle_ocr").status, "READY");
assert.equal(component(readyReport, "catalog_store").status, "READY");
assert.equal(component(readyReport, "marketplace_reference").status, "READY");
assert.doesNotMatch(JSON.stringify(readyReport), /test-openai-key|test-supabase-key|test-vector-token|test-ocr-token|test-ebay-secret|worker\.test|supabase\.test/);

const missingReport = await buildWorkflowReadinessAudit({
  argv: ["--no-env-file"],
  env: {},
  cwd: tempDir,
  fetchImpl: async () => {
    throw new Error("fetch should not run when schema config is absent");
  }
});
assert.equal(missingReport.ok, false);
assert.equal(missingReport.can_run_cloud_recognition, false);
assert.deepEqual(missingReport.blockers.sort(), ["image_storage", "vision_provider"]);
assert.equal(component(missingReport, "feedback_workflow_schema").status, "FAIL_CLOSED");
assert.equal(component(missingReport, "vector_retrieval").status, "DISABLED");
assert.equal(component(missingReport, "paddle_ocr").status, "DISABLED");
assert.equal(component(missingReport, "catalog_store").status, "FAIL_CLOSED");

const requestOptInVectorReport = await buildWorkflowReadinessAudit({
  argv: ["--no-env-file"],
  env: {
    ...configuredEnv,
    OPENAI_LISTING_MODEL: "gpt-5-mini",
    ENABLE_VECTOR_RETRIEVAL: "false",
    VECTOR_RETRIEVAL_MODE: "off",
    VECTOR_INDEX_READY: "true"
  },
  cwd: tempDir,
  fetchImpl: readyFetch
});
assert.match(component(requestOptInVectorReport, "vision_provider").summary, /gpt-5-mini/);
assert.equal(component(requestOptInVectorReport, "vector_retrieval").status, "READY");
assert.equal(component(requestOptInVectorReport, "vector_retrieval").details.default_enabled, false);
assert.equal(component(requestOptInVectorReport, "vector_retrieval").details.index_ready, true);
assert.equal(component(requestOptInVectorReport, "vector_retrieval").details.request_override_supported, true);
assert.equal(component(requestOptInVectorReport, "vector_retrieval").details.runtime_ready, true);
assert.equal(component(requestOptInVectorReport, "vector_retrieval").details.prompt_influence_by_default, false);

const schemaBlockedReport = await buildWorkflowReadinessAudit({
  argv: ["--no-env-file"],
  env: {
    ...configuredEnv,
    ENABLE_VECTOR_RETRIEVAL: "true",
    VECTOR_RETRIEVAL_MODE: "assist",
    VECTOR_WORKER_TOKEN: "",
    PADDLE_OCR_WORKER_TOKEN: ""
  },
  cwd: tempDir,
  fetchImpl: async (url) => {
    if (String(url).endsWith("/readyz")) return readyFetch(url);
    const endpoint = new URL(String(url));
    if (endpoint.searchParams.get("select") === "workflow_summary" && endpoint.pathname.endsWith("/listing_reviews")) {
      return response({
        ok: false,
        status: 400,
        body: "Could not find the 'workflow_summary' column of 'listing_reviews' in the schema cache"
      });
    }
    return response();
  }
});
assert.equal(schemaBlockedReport.ok, false);
assert.equal(schemaBlockedReport.blockers.includes("feedback_workflow_schema"), true);
assert.equal(component(schemaBlockedReport, "feedback_workflow_schema").status, "BLOCKED");
assert.equal(component(schemaBlockedReport, "vector_retrieval").status, "FAIL_CLOSED");
assert.equal(component(schemaBlockedReport, "paddle_ocr").status, "FAIL_CLOSED");

let stdout = "";
let stderr = "";
const notReadyExit = await main(["--no-env-file", "--json"], {
  env: {},
  cwd: tempDir,
  fetchImpl: async () => response(),
  stdout: { write: (value) => { stdout += value; } },
  stderr: { write: (value) => { stderr += value; } }
});
assert.equal(notReadyExit, 1);
assert.match(stdout, /"schema_version": "listing-workflow-readiness-v1"/);
assert.match(stderr, /not ready/i);

stdout = "";
stderr = "";
const allowedExit = await main(["--no-env-file", "--allow-not-ready"], {
  env: {},
  cwd: tempDir,
  fetchImpl: async () => response(),
  stdout: { write: (value) => { stdout += value; } },
  stderr: { write: (value) => { stderr += value; } }
});
assert.equal(allowedExit, 0);
assert.match(stdout, /workflow_readiness: NOT_READY/);
assert.equal(stderr, "");

function component(report, id) {
  return report.components.find((item) => item.id === id);
}

console.log("workflow readiness audit tests passed");
