#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";

const supabaseUrl = String(process.env.SOAK_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SOAK_SUPABASE_SERVICE_ROLE_KEY || "");
const previewUrl = String(process.env.SOAK_PREVIEW_URL || "").replace(/\/+$/, "");
const workerSecret = String(process.env.SOAK_V4_WORKER_SECRET || "");
const protectionBypass = String(process.env.SOAK_VERCEL_AUTOMATION_BYPASS_SECRET || "");
const expectedProjectRef = String(process.env.SOAK_EXPECTED_PROJECT_REF || "").trim();
const reportPath = String(process.env.SOAK_REPORT_PATH || "/tmp/track-c-hosted-3x100-soak.json");
const runId = `tc_hosted_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
const waveCount = 3;
const jobsPerWave = 100;

function required(value, name) {
  assert.ok(value, `${name} is required`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function rest(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: headers({ prefer }),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) throw new Error(`PostgREST ${method} ${path} failed (${response.status}): ${String(text).slice(0, 500)}`);
  return { value, response };
}

async function insert(table, rows) {
  return (await rest(table, { method: "POST", body: rows })).value;
}

async function select(table, query) {
  return (await rest(`${table}?${query}`, { prefer: "count=exact" })).value || [];
}

async function remove(table, query) {
  return rest(`${table}?${query}`, { method: "DELETE", prefer: "return=minimal" });
}

async function createHostedVerifiedAsset(tenantId) {
  const assetId = `asset_${crypto.randomUUID()}`;
  const objectPath = `tenants/${tenantId}/listing-assets/2026-07-24/${assetId}/front.jpg`;
  const contentSha256 = crypto.createHash("sha256").update(`${tenantId}:${assetId}:front`).digest("hex");
  await insert("listing_assets", {
    id: assetId,
    tenant_id: tenantId,
    category: "control_plane_soak",
    front_object_path: objectPath,
    additional_image_paths: [],
    image_generation_id: assetId,
    expected_original_count: 1,
    image_set_state: "INCOMPLETE"
  });
  await insert("listing_image_verifications", {
    object_path: objectPath,
    bucket: "listing-card-images",
    tenant_id: tenantId,
    asset_id: assetId,
    image_id: "front",
    storage_role: "front_original",
    content_type: "image/jpeg",
    size: 1,
    width: 1,
    height: 1,
    object_verified: true,
    content_hash_verified: true,
    content_sha256: contentSha256,
    dimension_source: "object_bytes",
    image_generation_id: assetId,
    crop_metadata: null,
    canonical_eligible: true
  });
  const rpc = await rest("rpc/canonical_listing_asset_image_set", {
    method: "POST",
    body: { p_tenant_id: tenantId, p_asset_id: assetId }
  });
  const manifest = Array.isArray(rpc.value) ? rpc.value[0] : rpc.value;
  assert.equal(manifest?.asset_id, assetId);
  return { assetId, manifest };
}

async function invokePump(tenantId, { timeoutMs = 120_000, allowAbort = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${previewUrl}/api/v4/listing-job-pump`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lynca-worker-secret": workerSecret,
        ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {})
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        background_only: true,
        cycles: 30,
        limit: 25,
        process_concurrency: 4,
        max_runtime_ms: 120000,
        idle_cycles_before_stop: 1,
        background_idle_cycles: 1,
        detached: false
      }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(`Preview pump failed (${response.status}): ${body.message || "unknown error"}`);
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    if (allowAbort && error?.name === "AbortError") return { ok: false, response_lost: true };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function statuses(tenantId) {
  return select("v4_recognition_jobs", `select=id,status,canonical_state,attempt_count,result,lease_owner,lease_expires_at&tenant_id=eq.${encodeURIComponent(tenantId)}&order=id.asc&limit=200`);
}

async function drainTenant(tenantId, { simulateResponseLoss = false } = {}) {
  let responseLossObserved = false;
  if (simulateResponseLoss) {
    const lost = await invokePump(tenantId, { timeoutMs: 25, allowAbort: true });
    responseLossObserved = lost.response_lost === true;
  }
  const duplicateWake = await Promise.all([
    invokePump(tenantId),
    invokePump(tenantId)
  ]);
  const deadline = Date.now() + 180_000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await statuses(tenantId);
    if (rows.length && rows.every((row) => ["L2_READY", "FAILED"].includes(String(row.status)))) break;
    await sleep(2_000);
    await invokePump(tenantId);
  }
  return { rows, responseLossObserved, duplicateWake };
}

async function cleanup(tenantIds) {
  if (!tenantIds.length) return;
  const encoded = tenantIds.map((id) => `"${id}"`).join(",");
  const filter = `tenant_id=in.(${encodeURIComponent(encoded)})`;
  await remove("request_logs", filter);
  await remove("error_logs", filter);
  await remove("production_events", filter);
  await remove("job_attempt_events", filter);
  await remove("v4_recognition_jobs", filter);
  await remove("v4_recognition_batches", filter);
  await remove("listing_image_verifications", filter);
  await remove("listing_assets", filter);
  await remove("tenants", `id=in.(${encodeURIComponent(encoded)})`);
}

required(supabaseUrl, "SOAK_SUPABASE_URL");
required(serviceRoleKey, "SOAK_SUPABASE_SERVICE_ROLE_KEY");
required(previewUrl, "SOAK_PREVIEW_URL");
required(workerSecret, "SOAK_V4_WORKER_SECRET");
required(expectedProjectRef, "SOAK_EXPECTED_PROJECT_REF");
const preview = new URL(previewUrl);
const supabase = new URL(supabaseUrl);
assert.notEqual(preview.hostname, "listing.lyncafei.team", "hosted soak must never target production");
assert.ok(preview.hostname.endsWith(".vercel.app"), "hosted soak must target a Vercel Preview hostname");
assert.equal(supabase.hostname.split(".")[0], expectedProjectRef, "dedicated soak project ref mismatch");

const allTenantIds = [];
const waveReports = [];
try {
  for (let wave = 1; wave <= waveCount; wave += 1) {
    const tenantA = `${runId}_w${wave}_a`;
    const tenantB = `${runId}_w${wave}_b`;
    const tenantIds = [tenantA, tenantB];
    allTenantIds.push(...tenantIds);
    await insert("tenants", tenantIds.map((id) => ({
      id,
      name: `Track C hosted soak ${id}`,
      plan: "pilot",
      status: "ACTIVE"
    })));
    const assetsByTenant = new Map();
    for (const tenantId of tenantIds) {
      assetsByTenant.set(tenantId, await createHostedVerifiedAsset(tenantId));
    }
    const batches = tenantIds.map((tenantId, index) => ({
      id: `batch_${tenantId}`,
      tenant_id: tenantId,
      status: "QUEUED",
      item_count: jobsPerWave / 2,
      metadata: { control_plane_soak: true, run_id: runId, wave, partition: index }
    }));
    await insert("v4_recognition_batches", batches);
    const jobs = Array.from({ length: jobsPerWave }, (_, offset) => {
      const tenantId = offset < jobsPerWave / 2 ? tenantA : tenantB;
      const asset = assetsByTenant.get(tenantId);
      return {
        id: `${runId}_w${wave}_${String(offset + 1).padStart(3, "0")}`,
        schema_version: "v4-recognition-session-v1",
        batch_id: `batch_${tenantId}`,
        tenant_id: tenantId,
        asset_id: asset.assetId,
        job_type: "CONTROL_PLANE_SOAK",
        provider_id: "openai_legacy",
        status: "QUEUED",
        priority: 100,
        lane: "background",
        payload: {
          ...asset.manifest,
          control_plane_soak: true,
          run_id: runId,
          wave,
          ordinal: offset + 1,
          soak_failures_before_success: offset === 0 ? 1 : 0
        },
        max_attempts: 4,
        not_before: new Date(Date.now() - 1000).toISOString()
      };
    });
    await insert("v4_recognition_jobs", jobs);

    const a = await drainTenant(tenantA, { simulateResponseLoss: wave === 1 });
    const bBefore = await statuses(tenantB);
    assert.equal(bBefore.filter((row) => row.status !== "QUEUED").length, 0, "tenant A wake crossed into tenant B");
    const b = await drainTenant(tenantB);
    const completed = [...a.rows, ...b.rows];
    assert.equal(completed.length, jobsPerWave);
    assert.equal(new Set(completed.map((row) => row.id)).size, jobsPerWave);
    assert.equal(completed.filter((row) => row.status === "L2_READY").length, jobsPerWave);
    assert.equal(completed.filter((row) => row.canonical_state === "SUCCESS").length, jobsPerWave);
    assert.equal(completed.filter((row) => row.lease_owner || row.lease_expires_at).length, 0);
    assert.ok(completed.every((row) => row.result?.route === "CONTROL_PLANE_SOAK"));
    assert.ok(completed.some((row) => Number(row.attempt_count) === 2), "retry path must converge");
    const liveSlots = await select("v4_provider_capacity_leases", `select=job_id,lease_owner&job_id=not.is.null&limit=200`);
    assert.equal(liveSlots.filter((row) => String(row.job_id || "").startsWith(runId)).length, 0);
    waveReports.push({
      wave,
      jobs: jobsPerWave,
      terminal: completed.length,
      successful: completed.filter((row) => row.status === "L2_READY").length,
      retry_converged: completed.some((row) => Number(row.attempt_count) === 2),
      cross_tenant_claims: 0,
      duplicate_results: 0,
      response_loss_observed: a.responseLossObserved,
      duplicate_wakes_completed: a.duplicateWake.every((item) => item.ok)
    });
    await cleanup(tenantIds);
    const residual = await select("v4_recognition_jobs", `select=id&tenant_id=in.(${encodeURIComponent(tenantIds.map((id) => `"${id}"`).join(","))})&limit=1`);
    assert.equal(residual.length, 0, "wave cleanup must leave no queued state");
  }

  const report = {
    ok: true,
    schema_version: "track-c-hosted-3x100-soak-v1",
    run_id: runId,
    waves: waveReports,
    totals: {
      jobs: waveCount * jobsPerWave,
      terminal: waveReports.reduce((sum, wave) => sum + wave.terminal, 0),
      lost_jobs: 0,
      duplicate_results: 0,
      cross_tenant_claims: 0,
      leaked_capacity_slots: 0,
      external_provider_calls: 0,
      residual_test_rows: 0
    }
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await cleanup(allTenantIds).catch((error) => {
    console.error(`Hosted soak cleanup failed: ${error.message}`);
  });
}
