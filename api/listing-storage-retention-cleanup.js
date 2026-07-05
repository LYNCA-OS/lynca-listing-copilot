import crypto from "node:crypto";
import {
  runListingImageRetentionCleanup,
  summarizeListingImageRetentionCleanup
} from "../lib/listing/storage/storage-retention.mjs";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function headerValue(req, name) {
  const lower = name.toLowerCase();
  const value = req?.headers?.[lower] ?? req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function cronSecret(env = process.env) {
  return String(env.CRON_SECRET || env.LISTING_STORAGE_RETENTION_CRON_SECRET || "").trim();
}

function authorizedCronRequest(req, env = process.env) {
  const secret = cronSecret(env);
  if (!secret) return false;

  const expected = `Bearer ${secret}`;
  const actual = headerValue(req, "authorization");
  return timingSafeEqualString(actual, expected);
}

function dryRunFromRequest(req) {
  const host = headerValue(req, "host") || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  return /^(?:1|true|yes)$/i.test(url.searchParams.get("dry_run") || "");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (!authorizedCronRequest(req)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }

  try {
    const result = await runListingImageRetentionCleanup({
      dryRun: dryRunFromRequest(req)
    });
    sendJson(res, 200, {
      ok: true,
      ...summarizeListingImageRetentionCleanup(result)
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: String(error.message || "Storage retention cleanup failed.").slice(0, 240)
    });
  }
}
