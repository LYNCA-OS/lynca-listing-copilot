import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { v4DeploymentInfo } from "../../lib/listing/v4/prewarm.mjs";
import { checkV4Tables } from "../../lib/listing/v4/session/session-store.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

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
    branch_target: "v4_pai",
    deployment: v4DeploymentInfo(),
    default_provider: process.env.DEFAULT_VISION_PROVIDER || "openai",
    vector_index_ready: ["1", "true", "yes", "on"].includes(String(process.env.VECTOR_INDEX_READY || "").toLowerCase()),
    supabase: tables,
    ready: allTablesOk
  }));
}
