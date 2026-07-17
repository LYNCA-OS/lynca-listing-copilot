import { runV4Prewarm } from "../../lib/listing/v4/prewarm.mjs";
import { instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { isV4CronRequest, isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/prewarm" });
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!isV4WorkerRequest(req, process.env) && !isV4CronRequest(req, process.env)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized prewarm" }));
    return;
  }

  const payload = await runV4Prewarm();
  res.setHeader("cache-control", "no-store");

  if (req.method === "HEAD") {
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, withV4Version({
    ok: true,
    service: "lynca-listing-copilot-v4",
    prewarm: payload
  }));
}
