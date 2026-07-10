import assert from "node:assert/strict";
import {
  appendEvidencePatchesToBundle,
  bundlePatchesFromOcrResult,
  claimQueuedPreingestionOcrJobs,
  ocrConfidenceForFieldValue,
  ocrRequestForPreingestionJob,
  processQueuedPreingestionOcrJobs,
  readPreingestionOcrState,
  requeueRetryableFailedPreingestionOcrJobs,
  waitForPreingestionOcrEvidence
} from "../lib/listing/preingestion/preingestion-ocr-worker.mjs";
import { preingestionOcrJobVersion } from "../lib/listing/preingestion/preingestion-bundle.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
};

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

const sampleJob = {
  job_id: "job-1",
  job_key: "ocr:bundle-1:crop-1",
  asset_id: "asset-1",
  bundle_id: "bundle-1",
  attempts: 0,
  payload: {
    crop: {
      source_image_id: "img-front",
      source_region: "serial_region",
      role: "serial_crop",
      crop_region: { x: 0.6, y: 0.8, width: 0.35, height: 0.15 },
      crop_metadata: {
        crop_id: "crop-1",
        source_object_path: "assets/asset-1/front.jpg",
        normalized_bounds: { x: 0.6, y: 0.8, width: 0.35, height: 0.15 },
        pixel_bounds: { x: 1200, y: 1600, width: 700, height: 300 }
      }
    }
  }
};

// --- ocrRequestForPreingestionJob maps crop plan into the OCR contract ---
const request = ocrRequestForPreingestionJob(sampleJob, { imageUrl: "https://signed.test/front.jpg" });
assert.equal(request.request_id, "ocr:bundle-1:crop-1");
assert.equal(request.crop_type, "serial_crop");
assert.match(request.expected_pattern, /\\d/);
assert.equal(request.image_url, "https://signed.test/front.jpg");
assert.deepEqual(request.crop_box, { x: 1200, y: 1600, width: 700, height: 300 });
assert.equal(request.metadata.crop_id, "crop-1");
assert.equal(request.metadata.image_id, "img-front");

// --- bundlePatchesFromOcrResult flattens the rich OCR patch to flat patches ---
const ocrResult = {
  raw_text: "09/50",
  confidence: 0.94,
  model_id: "paddleocr",
  model_revision: "v1",
  text_candidates: [{ text: "09/50", normalized_text: "09/50", confidence: 0.94 }],
  evidence_patch: {
    schema_version: "ocr-evidence-patch-v1",
    crop_type: "serial_number",
    raw_text: "09/50",
    confidence: 0.94,
    evidence: {
      serial_number: { value: "09/50", normalized_value: "09/50" },
      print_run_denominator: { value: "50" }
    }
  }
};
const flatPatches = bundlePatchesFromOcrResult(ocrResult, sampleJob);
assert.equal(flatPatches.length, 2);
const serialPatch = flatPatches.find((patch) => patch.field === "serial_number");
assert.equal(serialPatch.value, "09/50");
assert.equal(serialPatch.source_type, "OCR");
assert.equal(serialPatch.source_image_id, "img-front");
assert.equal(serialPatch.crop_id, "crop-1");
assert.equal(serialPatch.confidence, 0.94);
assert.equal(serialPatch.provenance.job_key, "ocr:bundle-1:crop-1");

const exactLineConfidence = ocrConfidenceForFieldValue({
  confidence: 0.71,
  text_candidates: [
    { text: "TEST PLAYER 30/99 AUTO", confidence: 0.71 },
    { text: "30/99", confidence: 0.96 }
  ]
}, "30/99");
assert.equal(exactLineConfidence, 0.96);

const lineWeightedPatches = bundlePatchesFromOcrResult({
  ...ocrResult,
  confidence: 0.71,
  text_candidates: [{ text: "09/50", normalized_text: "09/50", confidence: 0.96 }],
  evidence_patch: { ...ocrResult.evidence_patch, confidence: 0.71 }
}, sampleJob);
assert.equal(lineWeightedPatches.find((patch) => patch.field === "serial_number")?.confidence, 0.96);

// --- claim is conditional on status=queued (atomic per row) ---
{
  const calls = [];
  const jobs = await claimQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET" });
      if (!init.method) {
        return jsonResponse([{ ...sampleJob }]);
      }
      assert.match(String(url), /status=eq\.queued/);
      return jsonResponse([{ status: "running", attempts: 1 }]);
    }
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "running");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
}

// --- only current-version transient failures are recovered ---
{
  const updates = [];
  const recovered = await requeueRetryableFailedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env: { ...env, PREINGESTION_OCR_MAX_ATTEMPTS: "3" },
    fetchImpl: async (url, init = {}) => {
      if (!init.method) {
        return jsonResponse([
          { job_id: "retry-current", job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:crop-1`, attempts: 1, last_error: "PaddleOCR worker request timed out." },
          { job_id: "old-version", job_key: "ocr:ocr-crop-v3:bundle-1:crop-1", attempts: 1, last_error: "PaddleOCR worker request timed out." },
          { job_id: "permanent", job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:crop-2`, attempts: 1, last_error: "crop source_object_path missing" }
        ]);
      }
      updates.push(String(url));
      return jsonResponse([{ job_id: "retry-current", status: "queued" }]);
    }
  });
  assert.equal(recovered.requeued, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /retry-current/);
}

// --- serial crop falls back to full-image OCR only when the fixed crop has no numbering ---
{
  const calls = [];
  const noSerialResult = {
    raw_text: "ROOKIE PATCH",
    confidence: 0.92,
    evidence_patch: { evidence: {} },
    text_candidates: []
  };
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse([{ ...sampleJob }]);
      if (init.method === "PATCH" && target.includes("preingestion_jobs")) {
        return jsonResponse([{ status: JSON.parse(init.body).status || "running", attempts: 1 }]);
      }
      if (!init.method && target.includes("preingestion_bundles")) {
        return jsonResponse([{ bundle_id: "bundle-1", evidence_patches: [], updated_at: "2026-07-11T00:00:00.000Z" }]);
      }
      if (init.method === "PATCH" && target.includes("preingestion_bundles")) {
        return jsonResponse([{ bundle_id: "bundle-1", updated_at: "2026-07-11T00:00:01.000Z" }]);
      }
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async (input) => {
        calls.push(input);
        return calls.length === 1 ? noSerialResult : ocrResult;
      }
    },
    signedReadUrlFor: async () => "https://signed.test/front.jpg"
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].crop_box, sampleJob.payload.crop.crop_metadata.pixel_bounds);
  assert.equal(calls[1].crop_box, null);
  assert.match(calls[1].request_id, /full-image$/);
  assert.equal(result.patches_appended, 2);
  assert.equal(result.succeeded, 1);
}

// --- OCR state exposes terminal counts and hard-evidence availability ---
{
  const state = await readPreingestionOcrState({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        return jsonResponse([
          { job_id: "a", status: "succeeded", attempts: 1, job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:a` },
          { job_id: "b", status: "failed", attempts: 1, job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:b`, last_error: "no text" },
          { job_id: "historical", status: "failed", attempts: 1, job_key: "ocr:ocr-crop-v3:bundle-1:old", last_error: "old timeout" }
        ]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: [{ field: "serial_number", value: "30/99", source_type: "OCR", confidence: 0.95 }]
      }]);
    }
  });
  assert.equal(state.terminal, true);
  assert.equal(state.job_count, 2);
  assert.equal(state.status_counts.succeeded, 1);
  assert.equal(state.status_counts.failed, 1);
  assert.equal(state.serial_patch_count, 1);
  assert.equal(state.historical_job_count, 1);
  assert.equal(state.verified_serial_ready, true);
}

// --- rendezvous waits through a running state and returns the completed patch state ---
{
  let jobReads = 0;
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 1_000,
    pollMs: 100,
    triggerSweep: false,
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        jobReads += 1;
        return jsonResponse([{ job_id: "a", status: jobReads === 1 ? "running" : "succeeded", attempts: 1, job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:a` }]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: jobReads === 1 ? [] : [{ field: "serial_number", value: "30/99", source_type: "OCR", confidence: 0.95 }]
      }]);
    }
  });
  assert.equal(state.status, "EVIDENCE_READY");
  assert.equal(state.evidence_ready, true);
  assert.equal(state.serial_patch_count, 1);
assert.ok(state.state_reads >= 2);
}

// --- a verified serial must not end rendezvous while authoritative slab text is still running ---
{
  let jobReads = 0;
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 1_000,
    pollMs: 100,
    triggerSweep: false,
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        jobReads += 1;
        return jsonResponse([
          {
            job_id: "serial",
            status: "succeeded",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:serial`,
            payload: { crop: { role: "serial_crop" } }
          },
          {
            job_id: "grade",
            status: jobReads === 1 ? "running" : "succeeded",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:grade`,
            payload: { crop: { role: "grade_label_crop" } }
          }
        ]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: [
          { field: "serial_number", value: "06/25", source_type: "OCR", confidence: 0.95 },
          ...(jobReads > 1 ? [{
            field: "grade",
            value: "PSA 10",
            source_type: "OCR",
            source_image_id: "img-1",
            crop_id: "grade-1",
            confidence: 0.96,
            raw_text: "2021 PANINI CONTENDERS OPTIC\nSPLTNG.IMG - BLACK SCOPE\nPSA 10",
            provenance: { crop_type: "grade_label" }
          }] : [])
        ]
      }]);
    }
  });
  assert.equal(state.status, "EVIDENCE_READY");
  assert.equal(state.verified_serial_ready, true);
  assert.equal(state.verified_slab_parallel_ready, true);
  assert.equal(state.verified_slab_parallel_value, "Black Scope");
  assert.ok(state.state_reads >= 2);
}

// --- append dedupes against existing bundle patches ---
{
  let written = null;
  const result = await appendEvidencePatchesToBundle({
    bundleId: "bundle-1",
    patches: flatPatches,
    env,
    fetchImpl: async (url, init = {}) => {
      if (!init.method) {
        return jsonResponse([{
          bundle_id: "bundle-1",
          evidence_patches: [{ field: "serial_number", crop_id: "crop-1", value: "09/50" }]
        }]);
      }
      written = JSON.parse(init.body);
      return jsonResponse(null);
    }
  });
  assert.equal(result.updated, true);
  assert.equal(result.appended, 1);
  assert.equal(written.evidence_patches.length, 2);
  assert.equal(written.evidence_patches[1].field, "print_run_denominator");
}

// --- fail-closed when PaddleOCR is not configured: jobs stay queued ---
{
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async () => {
      throw new Error("must not touch supabase when OCR is unconfigured");
    },
    paddleClient: { configured: false, config: { reason: "feature_disabled" } }
  });
  assert.equal(result.ok, true);
  assert.equal(result.ocr_configured, false);
  assert.equal(result.claimed, 0);
  assert.equal(result.reason, "feature_disabled");
}

// --- end-to-end sweep: claim, OCR, patch write-back, job completion ---
{
  const supabaseWrites = [];
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) {
        return jsonResponse([{ ...sampleJob }]);
      }
      if (init.method === "PATCH" && target.includes("preingestion_jobs")) {
        supabaseWrites.push({ target, body: JSON.parse(init.body) });
        return jsonResponse([{ status: JSON.parse(init.body).status || "running", attempts: 1 }]);
      }
      if (!init.method && target.includes("preingestion_bundles")) {
        return jsonResponse([{ bundle_id: "bundle-1", evidence_patches: [] }]);
      }
      if (init.method === "PATCH" && target.includes("preingestion_bundles")) {
        supabaseWrites.push({ target, body: JSON.parse(init.body) });
        return jsonResponse(null);
      }
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async (input) => {
        assert.equal(input.crop_type, "serial_crop");
        assert.equal(input.image_url, "https://signed.test/front.jpg");
        return ocrResult;
      }
    },
    signedReadUrlFor: async (objectPath) => {
      assert.equal(objectPath, "assets/asset-1/front.jpg");
      return "https://signed.test/front.jpg";
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.claimed, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.patches_appended, 2);
  assert.equal(result.bundles_updated, 1);

  const bundleWrite = supabaseWrites.find((write) => write.target.includes("preingestion_bundles"));
  assert.equal(bundleWrite.body.evidence_patches.length, 2);
  const completion = supabaseWrites.filter((write) => write.target.includes("preingestion_jobs")).at(-1);
  assert.equal(completion.body.status, "succeeded");
}

// --- OCR failure marks the job failed, not succeeded ---
{
  const jobStatusWrites = [];
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) {
        return jsonResponse([{ ...sampleJob }]);
      }
      if (init.method === "PATCH" && target.includes("preingestion_jobs")) {
        const body = JSON.parse(init.body);
        jobStatusWrites.push(body.status);
        return jsonResponse([{ status: body.status || "running", attempts: 1 }]);
      }
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async () => {
        throw new Error("worker http 503");
      }
    },
    signedReadUrlFor: async () => "https://signed.test/front.jpg"
  });
  assert.equal(result.failed, 1);
  assert.equal(result.succeeded, 0);
  assert.equal(jobStatusWrites.at(-1), "failed");
}

// --- all crop jobs are drained with bounded parallel OCR ---
{
  const jobs = Array.from({ length: 5 }, (_, index) => ({
    ...sampleJob,
    job_id: `parallel-job-${index}`,
    job_key: `ocr:ocr-crop-v2:bundle-1:parallel-crop-${index}`,
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        crop_metadata: {
          ...sampleJob.payload.crop.crop_metadata,
          crop_id: `parallel-crop-${index}`
        }
      }
    }
  }));
  let active = 0;
  let peakActive = 0;
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env: { ...env, PREINGESTION_OCR_CONCURRENCY: "3" },
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse(jobs);
      if (init.method === "PATCH" && target.includes("preingestion_jobs")) {
        return jsonResponse([{ status: JSON.parse(init.body).status || "running", attempts: 1 }]);
      }
      if (!init.method && target.includes("preingestion_bundles")) {
        return jsonResponse([{ bundle_id: "bundle-1", evidence_patches: [] }]);
      }
      if (init.method === "PATCH" && target.includes("preingestion_bundles")) return jsonResponse(null);
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return ocrResult;
      }
    },
    signedReadUrlFor: async () => "https://signed.test/front.jpg"
  });
  assert.equal(result.claimed, 5);
  assert.equal(result.succeeded, 5);
  assert.equal(result.failed, 0);
  assert.equal(result.concurrency, 3);
  assert.equal(peakActive, 3);
}

console.log("preingestion-ocr-worker.test.mjs OK");
