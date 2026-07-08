import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { v4DeploymentInfo } from "../../lib/listing/v4/prewarm.mjs";
import { checkV4Tables } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { visionProviderIds } from "../../lib/listing/providers/provider-contract.mjs";
import { openAiProviderPoolStatus } from "../../lib/listing/providers/openai-key-pool.mjs";
import { v4QueueConfigured, v4WorkerClaimLimit, v4WorkerLeaseSeconds } from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { isV4WorkerSecretConfigured } from "../../lib/listing/v4/jobs/worker-auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  const tables = await checkV4Tables();
  const allTablesOk = tables.configured && Object.values(tables.tables || {}).every((table) => table.ok);
  sendJson(res, 200, withV4Version({
    ok: true,
    service: "lynca-listing-copilot-v4",
    branch_target: "main",
    deployment: v4DeploymentInfo(),
    default_provider: visionProviderIds.OPENAI_LEGACY,
    env_default_provider: process.env.DEFAULT_VISION_PROVIDER || null,
    openai_pool: openAiProviderPoolStatus(process.env),
    vector_index_ready: ["1", "true", "yes", "on"].includes(String(process.env.VECTOR_INDEX_READY || "").toLowerCase()),
    production_queue: {
      configured: v4QueueConfigured(process.env),
      worker_secret_configured: isV4WorkerSecretConfigured(process.env),
      worker_claim_limit: v4WorkerClaimLimit(process.env),
      lease_seconds: v4WorkerLeaseSeconds(process.env)
    },
    supabase: tables,
    ready: allTablesOk
  }));
}
