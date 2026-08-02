#!/usr/bin/env node

// Small, explicit production latency sample. This is not a capacity sweep:
// eight assets is the hard ceiling and every asset id must be supplied.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};
const clean = (value) => String(value ?? "").trim();
const baseUrl = clean(arg("--base-url", process.env.LYNCA_PRODUCTION_URL || "https://listing.lyncafei.team"))
  .replace(/\/+$/, "");
const assets = clean(arg("--assets")).split(",").map(clean).filter(Boolean);
const concurrency = Math.max(1, Math.min(8, Math.trunc(Number(arg("--concurrency", "1"))) || 1));
const imageDetail = clean(arg("--image-detail", "high")).toLowerCase();
const username = clean(arg("--username", process.env.METAVERSE_USERNAME));
const password = clean(arg("--password", process.env.METAVERSE_PASSWORD));
const outPath = clean(arg("--out"));
if (!assets.length || assets.length > 8) throw new Error("pass_1_to_8_explicit_assets");
if (!username || !password) throw new Error("METAVERSE_USERNAME_and_METAVERSE_PASSWORD_required");
if (!new Set(["high", "original"]).has(imageDetail)) throw new Error("image_detail_must_be_high_or_original");

const host = new URL(baseUrl).host;
const origin = new URL(baseUrl).origin;
const commonHeaders = { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", host };
const login = await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({ username, password })
});
const loginBody = await login.json().catch(() => ({}));
const cookie = clean(login.headers.get("set-cookie")).split(";", 1)[0];
if (!login.ok || !cookie) throw new Error(`production_login_failed:${login.status}:${String(loginBody?.code || "unknown").slice(0, 100)}`);

let cursor = 0;
const cards = new Array(assets.length);
async function worker() {
  while (cursor < assets.length) {
    const index = cursor++;
    const assetId = assets[index];
    const intentId = `latency-batch-${Date.now()}-${randomUUID()}`;
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/csm-listing-title`, {
        method: "POST",
        headers: { ...commonHeaders, cookie },
        body: JSON.stringify({ asset_id: assetId, intent_id: intentId, image_detail: imageDetail })
      });
      const body = await response.json().catch(() => ({}));
      cards[index] = {
        asset_id: assetId,
        status: response.status,
        ok: response.ok && body?.ok === true,
        client_latency_ms: Math.round(performance.now() - startedAt),
        request_total_ms: body?.latency_stages_ms?.request_total_ms ?? null,
        latency_stages_ms: body?.latency_stages_ms || null,
        route: body?.route || null,
        trace_status: body?.trace_status || null,
        code: body?.code || null,
        retryable: body?.retryable === true,
        title_length: typeof body?.title === "string" ? body.title.length : null
      };
    } catch (error) {
      cards[index] = {
        asset_id: assetId,
        status: null,
        ok: false,
        client_latency_ms: Math.round(performance.now() - startedAt),
        request_total_ms: null,
        latency_stages_ms: null,
        route: null,
        trace_status: null,
        code: "network_error",
        error: String(error?.message || error).slice(0, 160)
      };
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, worker));
const values = cards.map((card) => Number(card.request_total_ms)).filter(Number.isFinite).sort((a, b) => a - b);
const percentile = fraction => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
const result = {
  schema_version: "production-csm-latency-batch-v1",
  measured_at: new Date().toISOString(),
  base_url: baseUrl,
  image_detail: imageDetail,
  requested_concurrency: concurrency,
  cards: cards.length,
  summary: {
    succeeded: cards.filter(card => card.ok).length,
    failed: cards.filter(card => !card.ok).length,
    request_total_p50_ms: percentile(0.5),
    request_total_p95_ms: percentile(0.95),
    request_total_max_ms: values.length ? Math.max(...values) : null
  },
  cards_detail: cards
};
if (outPath) await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
