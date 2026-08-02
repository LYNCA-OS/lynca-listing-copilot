#!/usr/bin/env node

// One-card, one-request production latency probe. It intentionally requires an
// explicit asset id: this is an evidence probe, not a batch evaluator.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};
const clean = (value) => String(value ?? "").trim();
const baseUrl = clean(arg("--base-url", process.env.LYNCA_PRODUCTION_URL || "https://listing.lyncafei.team"))
  .replace(/\/+$/, "");
const assetId = clean(arg("--asset-id"));
const intentId = clean(arg("--intent-id", `latency-probe-${Date.now()}-${randomUUID()}`));
const imageDetail = clean(arg("--image-detail", "high")).toLowerCase();
const username = clean(arg("--username", process.env.METAVERSE_USERNAME));
const password = clean(arg("--password", process.env.METAVERSE_PASSWORD));
const outPath = clean(arg("--out"));

if (!assetId) throw new Error("explicit_--asset-id_required");
if (!username || !password) throw new Error("METAVERSE_USERNAME_and_METAVERSE_PASSWORD_required");
if (!new Set(["high", "original"]).has(imageDetail)) throw new Error("image_detail_must_be_high_or_original");

const origin = new URL(baseUrl).origin;
const host = new URL(baseUrl).host;
const sameOriginHeaders = {
  "content-type": "application/json",
  origin,
  "sec-fetch-site": "same-origin",
  host
};

const loginStartedAt = performance.now();
const loginResponse = await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: sameOriginHeaders,
  body: JSON.stringify({ username, password })
});
const loginBody = await loginResponse.json().catch(() => ({}));
const cookie = clean(loginResponse.headers.get("set-cookie")).split(";", 1)[0];
if (!loginResponse.ok || !cookie) {
  throw new Error(`production_login_failed:${loginResponse.status}:${String(loginBody?.code || loginBody?.message || "unknown").slice(0, 120)}`);
}

const requestStartedAt = performance.now();
const response = await fetch(`${baseUrl}/api/csm-listing-title`, {
  method: "POST",
  headers: {
    ...sameOriginHeaders,
    cookie
  },
  body: JSON.stringify({ asset_id: assetId, intent_id: intentId, image_detail: imageDetail })
});
const body = await response.json().catch(() => ({}));
const requestLatencyMs = Math.round(performance.now() - requestStartedAt);
const result = {
  schema_version: "production-csm-latency-probe-v1",
  measured_at: new Date().toISOString(),
  base_url: baseUrl,
  asset_id: assetId,
  intent_id: intentId,
  image_detail: imageDetail,
  login: {
    status: loginResponse.status,
    ok: loginResponse.ok,
    latency_ms: Math.round(performance.now() - loginStartedAt)
  },
  request: {
    status: response.status,
    ok: response.ok && body?.ok === true,
    latency_ms: requestLatencyMs,
    route: body?.route || null,
    trace_status: body?.trace_status || null,
    code: body?.code || null,
    retryable: body?.retryable === true,
    provider_failure_receipt: body?.provider_failure_receipt || null,
    title_length: typeof body?.title === "string" ? body.title.length : null,
    latency_stages_ms: body?.latency_stages_ms || null,
    csm_persistence: body?.csm_persistence
      ? { ok: body.csm_persistence.ok === true, atomic: body.csm_persistence.atomic === true }
      : null,
    retired_boundaries: {
      cloud_run_calls: body?.cloud_run_calls ?? null,
      vector_calls: body?.vector_calls ?? null,
      ocr_calls: body?.ocr_calls ?? null
    }
  }
};
if (outPath) await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
