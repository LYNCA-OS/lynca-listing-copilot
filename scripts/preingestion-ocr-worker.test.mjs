import assert from "node:assert/strict";
import {
  appendEvidencePatchesToBundle,
  bundlePatchesFromOcrResult,
  claimQueuedPreingestionOcrJobs,
  fairOcrAnchorJobOrder,
  fairOcrClaimOrder,
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

function currentOcrPatch(field, value, extra = {}) {
  return {
    field,
    value,
    source_type: "OCR",
    confidence: 0.95,
    ...extra,
    provenance: {
      ...(extra.provenance || {}),
      job_key: extra.provenance?.job_key || `ocr:${preingestionOcrJobVersion}:bundle-1:${field}`,
      crop_type: extra.provenance?.crop_type || (["print_run_number", "serial_number", "numerical_rarity"].includes(field) ? "serial_number" : null),
      source_region: extra.provenance?.source_region || (["print_run_number", "serial_number", "numerical_rarity"].includes(field) ? "serial_region" : null)
    }
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

const fairAnchorOrder = fairOcrAnchorJobOrder([
  { job_id: "code-1", payload: { crop: { role: "card_code_crop" } } },
  { job_id: "code-2", payload: { crop: { role: "card_code_crop" } } },
  { job_id: "serial-1", payload: { crop: { role: "serial_crop" } } },
  { job_id: "serial-2", payload: { crop: { role: "serial_crop" } } },
  { job_id: "grade-1", payload: { crop: { role: "grade_label_crop" } } },
  { job_id: "grade-2", payload: { crop: { role: "grade_label_crop" } } }
]);
assert.deepEqual(fairAnchorOrder.slice(0, 3).map((job) => job.job_id), ["serial-1", "grade-1", "code-1"]);

const fairClaimOrder = fairOcrClaimOrder([
  { job_id: "a-code", asset_id: "asset-a", priority: 10, payload: { crop: { role: "card_code_crop" } } },
  { job_id: "a-serial", asset_id: "asset-a", priority: 12, payload: { crop: { role: "serial_crop" } } },
  { job_id: "a-grade", asset_id: "asset-a", priority: 14, payload: { crop: { role: "grade_label_crop" } } },
  { job_id: "b-code", asset_id: "asset-b", priority: 10, payload: { crop: { role: "card_code_crop" } } },
  { job_id: "b-serial", asset_id: "asset-b", priority: 12, payload: { crop: { role: "serial_crop" } } },
  { job_id: "b-grade", asset_id: "asset-b", priority: 14, payload: { crop: { role: "grade_label_crop" } } }
], { limit: 4, jobsPerAsset: 2 });
assert.deepEqual(
  fairClaimOrder.map((job) => job.job_id),
  ["a-serial", "a-code", "b-serial", "b-code"],
  "raw-card OCR claims must prioritize serial and exact card code without spending first-wave capacity on grade"
);

const slabClaimOrder = fairOcrClaimOrder([
  { job_id: "slab-serial-1", asset_id: "slab-a", priority: 12, payload: { crop: { role: "serial_crop" } } },
  { job_id: "slab-serial-2", asset_id: "slab-a", priority: 12, payload: { crop: { role: "serial_crop" } } },
  {
    job_id: "slab-grade-1",
    asset_id: "slab-a",
    priority: 14,
    payload: { crop: { role: "grade_label_crop", crop_metadata: { source_width: 800, source_height: 1400 } } }
  },
  {
    job_id: "slab-grade-2",
    asset_id: "slab-a",
    priority: 14,
    payload: { crop: { role: "grade_label_crop", crop_metadata: { source_width: 800, source_height: 1400 } } }
  },
  { job_id: "slab-code-1", asset_id: "slab-a", priority: 10, payload: { crop: { role: "card_code_crop" } } }
], { limit: 2, jobsPerAsset: 2 });
assert.deepEqual(
  slabClaimOrder.map((job) => job.job_id),
  ["slab-grade-1", "slab-serial-1"],
  "slab OCR claims must make grade and serial the first value-aware wave"
);

const tenCardFirstWave = fairOcrClaimOrder(Array.from({ length: 10 }, (_, index) => ([
  {
    job_id: `asset-${index}-serial`,
    asset_id: `asset-${index}`,
    priority: 12,
    created_at: "2026-07-14T00:00:00.000Z",
    payload: { crop: { role: "serial_crop" } }
  },
  {
    job_id: `asset-${index}-code`,
    asset_id: `asset-${index}`,
    priority: 10,
    created_at: "2026-07-14T00:00:00.001Z",
    payload: { crop: { role: "card_code_crop" } }
  }
])).flat(), { limit: 10, jobsPerAsset: 1 });
assert.equal(new Set(tenCardFirstWave.map((job) => job.asset_id)).size, 10);
assert.ok(
  tenCardFirstWave.every((job) => job.job_id.endsWith("-serial")),
  "the first ten OCR slots must reach ten different cards before any second-wave crop starts"
);

// --- ocrRequestForPreingestionJob maps crop plan into the OCR contract ---
const request = ocrRequestForPreingestionJob(sampleJob, { imageUrl: "https://signed.test/front.jpg" });
assert.equal(request.request_id, "ocr:bundle-1:crop-1");
assert.equal(request.crop_type, "serial_crop");
assert.match(request.expected_pattern, /\\d/);
assert.equal(request.image_url, "https://signed.test/front.jpg");
assert.deepEqual(request.crop_box, { x: 1200, y: 1600, width: 700, height: 300 });
assert.equal(request.metadata.crop_id, "crop-1");
assert.equal(request.metadata.image_id, "img-front");
assert.equal(request.metadata.inline_full_image_fallback, true);
assert.equal(request.metadata.grade_source_looks_like_slab, false);

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
    anchorOnly: true,
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
  assert.match(calls[0].url, /priority=lte\.14/, "writer-path claims must reserve the first wave for OCR anchors");
  assert.match(calls[0].url, /limit=32/, "asset-scoped claims must not overfetch global queue rows");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
}

// --- a small claim limit still inspects enough rows to choose the best slab wave ---
{
  const listedJobs = [
    { ...sampleJob, job_id: "slab-code", priority: 10, payload: { crop: { role: "card_code_crop" } } },
    { ...sampleJob, job_id: "slab-serial", priority: 12, payload: { crop: { role: "serial_crop" } } },
    {
      ...sampleJob,
      job_id: "slab-grade",
      priority: 14,
      payload: { crop: { role: "grade_label_crop", crop_metadata: { source_width: 800, source_height: 1400 } } }
    }
  ];
  let listUrl = "";
  const jobs = await claimQueuedPreingestionOcrJobs({
    bundleId: "bundle-slab-window",
    limit: 2,
    env,
    fetchImpl: async (url, init = {}) => {
      if (!init.method) {
        listUrl = String(url);
        return jsonResponse(listedJobs);
      }
      const jobId = new URL(String(url)).searchParams.get("job_id")?.replace(/^eq\./, "");
      return jsonResponse([{ status: "running", attempts: 1, job_id: jobId }]);
    }
  });
  assert.match(listUrl, /limit=8/, "claim limit and candidate inspection window must remain separate");
  assert.deepEqual(
    jobs.map((job) => job.job_id),
    ["slab-grade", "slab-serial"],
    "slab first-wave selection must see grade work even when database priority lists card code first"
  );
}

// --- a provider-triggered rescue must claim the missing field, not poll an idle job ---
{
  const listedJobs = [
    { ...sampleJob, job_id: "rescue-serial", priority: 12, payload: { crop: { role: "serial_crop" } } },
    {
      ...sampleJob,
      job_id: "rescue-grade",
      priority: 14,
      payload: { crop: { role: "grade_label_crop", crop_metadata: { source_width: 1200, source_height: 1200 } } }
    },
    { ...sampleJob, job_id: "rescue-code", priority: 10, payload: { crop: { role: "card_code_crop" } } }
  ];
  const jobs = await claimQueuedPreingestionOcrJobs({
    bundleId: "bundle-targeted-grade-rescue",
    limit: 1,
    targetFields: ["grade"],
    env,
    fetchImpl: async (url, init = {}) => {
      if (!init.method) return jsonResponse(listedJobs);
      const jobId = new URL(String(url)).searchParams.get("job_id")?.replace(/^eq\./, "");
      return jsonResponse([{ status: "running", attempts: 1, job_id: jobId }]);
    }
  });
  assert.deepEqual(
    jobs.map((job) => job.job_id),
    ["rescue-grade"],
    "targeted grade rescue must start the queued grade verifier even when serial/card-code have lower priority"
  );
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

// --- slab-like grade crops fall back to full-image OCR; raw cards do not ---
{
  const calls = [];
  const slabGradeJob = {
    ...sampleJob,
    job_id: "job-grade-slab",
    job_key: "ocr:bundle-1:grade-slab",
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        source_region: "grade_label",
        role: "grade_label_crop",
        crop_metadata: {
          ...sampleJob.payload.crop.crop_metadata,
          crop_id: "grade-slab",
          normalized_bounds: { x: 0, y: 0, width: 1, height: 0.22 },
          pixel_bounds: { x: 0, y: 0, width: 1600, height: 218 }
        }
      }
    }
  };
  const gradeResult = {
    raw_text: "PSA 10",
    confidence: 0.96,
    text_candidates: [{ text: "PSA 10", confidence: 0.96 }],
    evidence_patch: {
      crop_type: "grade_label",
      raw_text: "PSA 10",
      evidence: {
        grade_company: { value: "PSA" },
        card_grade: { value: "10" }
      }
    }
  };
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse([{ ...slabGradeJob }]);
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
        return calls.length === 1
          ? {
              raw_text: "PSA",
              confidence: 0.9,
              text_candidates: [{ text: "PSA", confidence: 0.9 }],
              evidence_patch: { evidence: { grade_company: { value: "PSA" } } }
            }
          : gradeResult;
      }
    },
    signedReadUrlFor: async () => "https://signed.test/slab.jpg"
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].crop_box, null);
  assert.match(calls[1].request_id, /full-image-grade$/);
  assert.equal(result.patches_appended, 2);
  assert.equal(result.job_observability[0].full_image_fallback_used, true);
  assert.equal(result.job_observability[0].full_image_fallback_kind, "grade");
  assert.equal(result.execution_summary.full_image_fallback_count, 1);
}

// New Recognition Worker revisions perform the fallback against the already
// downloaded image. The Node consumer must not issue a second network request.
{
  const calls = [];
  const inlineGradeJob = {
    ...sampleJob,
    job_id: "job-grade-inline",
    job_key: "ocr:bundle-1:grade-inline",
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        source_region: "grade_label",
        role: "grade_label_crop",
        crop_metadata: {
          ...sampleJob.payload.crop.crop_metadata,
          crop_id: "grade-inline",
          normalized_bounds: { x: 0, y: 0, width: 1, height: 0.22 },
          pixel_bounds: { x: 0, y: 0, width: 1600, height: 218 }
        }
      }
    }
  };
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse([{ ...inlineGradeJob }]);
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
        return {
          raw_text: "PSA GEM MT 10",
          confidence: 0.97,
          text_candidates: [{ text: "PSA GEM MT 10", confidence: 0.97 }],
          inline_full_image_fallback_evaluated: true,
          inline_full_image_fallback_used: true,
          inline_full_image_fallback_target_found: true,
          inline_grade_component_fallback_used: true,
          inline_grade_component_fallback_kind: "company",
          inline_grade_component_fallback_target_found: true,
          inline_grade_component_fallback_latency_ms: 7,
          evidence_patch: {
            evidence: {
              grade_company: { value: "PSA" },
              card_grade: { value: "10" }
            }
          }
        };
      }
    },
    signedReadUrlFor: async () => "https://signed.test/slab-inline.jpg"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].metadata.inline_full_image_fallback, true);
  assert.equal(calls[0].metadata.grade_source_looks_like_slab, true);
  assert.equal(result.patches_appended, 2);
  assert.equal(result.job_observability[0].full_image_fallback_used, true);
  assert.equal(result.job_observability[0].full_image_fallback_inline_count, 1);
  assert.equal(result.job_observability[0].full_image_fallback_network_request_count, 0);
  assert.equal(result.job_observability[0].full_image_fallback_target_found, true);
  assert.equal(result.job_observability[0].grade_component_fallback_used, true);
  assert.equal(result.job_observability[0].grade_component_fallback_kind, "company");
  assert.equal(result.job_observability[0].grade_component_fallback_target_found, true);
  assert.equal(result.job_observability[0].grade_component_fallback_latency_ms, 7);
  assert.equal(result.execution_summary.grade_component_fallback_count, 1);
  assert.equal(result.execution_summary.grade_component_fallback_target_found_count, 1);
  assert.equal(result.execution_summary.grade_component_fallback_latency_ms, 7);
}

// Marketplace slabs may omit source dimensions. A visible grading-company token
// is enough to justify one full-image grade scan, while an empty raw-card crop is not.
{
  const calls = [];
  const slabWithoutDimensionsJob = {
    ...sampleJob,
    job_id: "job-grade-slab-no-dimensions",
    job_key: "ocr:bundle-1:grade-slab-no-dimensions",
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        source_region: "grade_label",
        role: "grade_label_crop",
        crop_metadata: {
          crop_id: "grade-slab-no-dimensions",
          source_object_path: sampleJob.payload.crop.crop_metadata.source_object_path
        }
      }
    }
  };
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse([{ ...slabWithoutDimensionsJob }]);
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
        return calls.length === 1
          ? {
              raw_text: "PSA",
              confidence: 0.93,
              text_candidates: [{ text: "PSA", confidence: 0.93 }],
              evidence_patch: { evidence: { grade_company: { value: "PSA" } } }
            }
          : {
              raw_text: "PSA GEM MT 10",
              confidence: 0.97,
              text_candidates: [{ text: "PSA GEM MT 10", confidence: 0.97 }],
              evidence_patch: {
                evidence: {
                  grade_company: { value: "PSA" },
                  card_grade: { value: "10" }
                }
              }
            };
      }
    },
    signedReadUrlFor: async () => "https://signed.test/slab-no-dimensions.jpg"
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].crop_box, null);
  assert.match(calls[1].request_id, /full-image-grade$/);
  assert.equal(result.job_observability[0].full_image_fallback_used, true);
}

{
  const calls = [];
  const rawCardGradeJob = {
    ...sampleJob,
    job_id: "job-grade-raw",
    job_key: "ocr:bundle-1:grade-raw",
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        source_region: "grade_label",
        role: "grade_label_crop",
        crop_metadata: {
          ...sampleJob.payload.crop.crop_metadata,
          crop_id: "grade-raw",
          normalized_bounds: { x: 0, y: 0, width: 1, height: 0.2 },
          pixel_bounds: { x: 0, y: 0, width: 1200, height: 336 }
        }
      }
    }
  };
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (!init.method && target.includes("preingestion_jobs")) return jsonResponse([{ ...rawCardGradeJob }]);
      if (init.method === "PATCH" && target.includes("preingestion_jobs")) {
        return jsonResponse([{ status: JSON.parse(init.body).status || "running", attempts: 1 }]);
      }
      if (!init.method && target.includes("preingestion_bundles")) {
        return jsonResponse([{ bundle_id: "bundle-1", quality_summary: {}, updated_at: "2026-07-11T00:00:00.000Z" }]);
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
        return { raw_text: "", confidence: 0, text_candidates: [], evidence_patch: { evidence: {} } };
      }
    },
    signedReadUrlFor: async () => "https://signed.test/raw-card.jpg"
  });
  assert.equal(calls.length, 1);
  assert.equal(result.patches_appended, 0);
  assert.equal(result.job_observability[0].full_image_fallback_used, false);
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
        evidence_patches: [currentOcrPatch("serial_number", "30/99")]
      }]);
    }
  });
  assert.equal(state.terminal, true);
  assert.equal(state.job_count, 2);
  assert.equal(state.status_counts.succeeded, 1);
  assert.equal(state.status_counts.failed, 1);
  assert.equal(state.serial_patch_count, 1);
  assert.deepEqual(state.evidence_patches.map((patch) => patch.value), ["30/99"]);
  assert.equal(state.historical_job_count, 1);
  assert.equal(state.verified_serial_ready, true);
}

// --- rendezvous waits through a running state and returns the completed patch state ---
{
  let jobReads = 0;
  const observedStates = [];
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 1_000,
    pollMs: 100,
    triggerSweep: false,
    onState: (snapshot) => observedStates.push(snapshot.status_counts),
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        jobReads += 1;
        return jsonResponse([{ job_id: "a", status: jobReads === 1 ? "running" : "succeeded", attempts: 1, job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:a` }]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: jobReads === 1 ? [] : [currentOcrPatch("serial_number", "30/99")]
      }]);
    }
  });
  assert.equal(state.status, "EVIDENCE_READY");
  assert.equal(state.evidence_ready, true);
  assert.equal(state.serial_patch_count, 1);
  assert.ok(state.state_reads >= 2);
  assert.ok(observedStates.length >= 2, "each OCR state transition must be observable without another database read");
}

// --- a broken observer must not change OCR completion semantics ---
{
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 500,
    pollMs: 100,
    triggerSweep: false,
    onState: () => {
      throw new Error("observer failure");
    },
    env,
    fetchImpl: async (url) => {
      if (String(url).includes("preingestion_jobs")) {
        return jsonResponse([{
          job_id: "serial",
          status: "succeeded",
          attempts: 1,
          job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:serial`,
          payload: { crop: { role: "serial_crop" } }
        }]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: [currentOcrPatch("serial_number", "30/99")]
      }]);
    }
  });
  assert.equal(state.status, "EVIDENCE_READY");
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
          currentOcrPatch("serial_number", "06/25"),
          ...(jobReads > 1 ? [{
            field: "grade",
            value: "PSA 10",
            source_type: "OCR",
            source_image_id: "img-1",
            crop_id: "grade-1",
            confidence: 0.96,
            raw_text: "2021 PANINI CONTENDERS OPTIC\nSPLTNG.IMG - BLACK SCOPE\nPSA 10",
            provenance: {
              crop_type: "grade_label",
              job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:grade`
            }
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

// --- non-critical card-code OCR may finish in the background ---
{
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 1_000,
    pollMs: 100,
    triggerSweep: false,
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
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
            status: "succeeded",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:grade`,
            payload: { crop: { role: "grade_label_crop" } }
          },
          {
            job_id: "code",
            status: "running",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:code`,
            payload: { crop: { role: "card_code_crop" } }
          }
        ]);
      }
      return jsonResponse([{ bundle_id: "bundle-1", evidence_patches: [] }]);
    }
  });
  assert.equal(state.status, "CRITICAL_FIELDS_SETTLED");
  assert.equal(state.critical_evidence_settled, true);
  assert.equal(state.critical_active_count, 0);
  assert.equal(state.card_code_active_count, 1);
  assert.equal(state.terminal, false);
}

// --- field-aware rendezvous stops when only the requested hard field settles ---
{
  let jobReads = 0;
  const state = await waitForPreingestionOcrEvidence({
    bundleId: "bundle-1",
    timeoutMs: 1_000,
    pollMs: 100,
    targetFields: ["serial_number"],
    triggerSweep: false,
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        jobReads += 1;
        return jsonResponse([
          {
            job_id: "serial",
            status: jobReads === 1 ? "running" : "succeeded",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:serial`,
            payload: { crop: { role: "serial_crop" } }
          },
          {
            job_id: "grade",
            status: "running",
            attempts: 1,
            job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:grade`,
            payload: { crop: { role: "grade_label_crop" } }
          }
        ]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: jobReads > 1 ? [currentOcrPatch("serial_number", "2/4")] : []
      }]);
    }
  });
  assert.equal(state.status, "TARGET_FIELDS_SETTLED");
  assert.equal(state.target_fields_settled, true);
  assert.deepEqual(state.target_fields, ["serial_number"]);
  assert.equal(state.grade_label_active_count, 1, "unrequested grade OCR may continue after serial is ready");
}

// --- stale OCR remains in the audit log but cannot satisfy current evidence readiness ---
{
  const state = await readPreingestionOcrState({
    bundleId: "bundle-1",
    env,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("preingestion_jobs")) {
        return jsonResponse([{
          job_id: "current-empty",
          status: "succeeded",
          attempts: 1,
          job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:serial`
        }]);
      }
      return jsonResponse([{
        bundle_id: "bundle-1",
        evidence_patches: [
          currentOcrPatch("serial_number", "2/250", {
            provenance: { job_key: "ocr:ocr-crop-v4:bundle-1:serial" }
          }),
          {
            field: "serial_number",
            value: "09/50",
            source_type: "CARD_FRONT_PRINTED_TEXT",
            confidence: 0.96
          }
        ]
      }]);
    }
  });
  assert.equal(state.verified_serial_ready, false);
  assert.equal(state.patch_count, 1, "non-OCR direct evidence stays available to the pipeline");
  assert.equal(state.raw_patch_count, 2);
  assert.equal(state.historical_patch_count, 1);
  assert.equal(state.serial_patch_count, 1);
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

// --- completed fields persist before a slower sibling crop finishes ---
{
  const fastJob = {
    ...sampleJob,
    job_id: "fast-job",
    job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:fast`,
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        role: "card_code_crop",
        crop_metadata: { ...sampleJob.payload.crop.crop_metadata, crop_id: "fast-crop" }
      }
    }
  };
  const slowJob = {
    ...fastJob,
    job_id: "slow-job",
    job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:slow`,
    payload: {
      crop: {
        ...fastJob.payload.crop,
        crop_metadata: { ...fastJob.payload.crop.crop_metadata, crop_id: "slow-crop" }
      }
    }
  };
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  let bundlePatches = [];
  let bundleRevision = 0;
  const jobStatuses = new Map();
  let processingFinished = false;

  const processing = processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env: { ...env, PREINGESTION_OCR_CONCURRENCY: "2" },
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url));
      if (!init.method && target.pathname.endsWith("/preingestion_jobs")) {
        return jsonResponse([fastJob, slowJob]);
      }
      if (init.method === "PATCH" && target.pathname.endsWith("/preingestion_jobs")) {
        const jobId = String(target.searchParams.get("job_id") || "").replace(/^eq\./, "");
        const body = JSON.parse(init.body);
        if (body.status) jobStatuses.set(jobId, body.status);
        return jsonResponse([{ job_id: jobId, status: body.status || "queued", attempts: body.attempts || 1 }]);
      }
      if (!init.method && target.pathname.endsWith("/preingestion_bundles")) {
        return jsonResponse([{
          bundle_id: "bundle-1",
          evidence_patches: bundlePatches,
          updated_at: `2026-07-11T00:00:0${bundleRevision}.000Z`
        }]);
      }
      if (init.method === "PATCH" && target.pathname.endsWith("/preingestion_bundles")) {
        const body = JSON.parse(init.body);
        bundlePatches = body.evidence_patches;
        bundleRevision += 1;
        return jsonResponse([{ bundle_id: "bundle-1", updated_at: body.updated_at }]);
      }
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async (input) => {
        if (input.request_id.includes("slow")) await slowGate;
        return ocrResult;
      }
    },
    signedReadUrlFor: async () => "https://signed.test/front.jpg"
  }).finally(() => { processingFinished = true; });

  const deadline = Date.now() + 500;
  while (jobStatuses.get("fast-job") !== "succeeded" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(jobStatuses.get("fast-job"), "succeeded");
  assert.equal(jobStatuses.get("slow-job"), "running");
  assert.equal(processingFinished, false);
  assert.ok(bundlePatches.length > 0, "fast OCR evidence must be visible before the slow crop completes");

  releaseSlow();
  const result = await processing;
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.patches_appended, 4);
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

// --- stage capacity separates OCR from GPT while globally bounding replicas ---
{
  let bundleRequests = 0;
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-empty",
    env: {
      ...env,
      PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED: "true"
    },
    fetchImpl: async (url) => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/preingestion_jobs")) return jsonResponse([]);
      if (target.pathname.endsWith("/preingestion_bundles")) bundleRequests += 1;
      return jsonResponse([]);
    },
    paddleClient: { configured: true, verifyCrop: async () => ({}) }
  });
  assert.equal(result.claimed, 0);
  assert.equal(result.execution_summary_persisted, false);
  assert.equal(result.execution_summary_persistence_reason, "no_claimed_jobs");
  assert.equal(bundleRequests, 0, "an empty sweep must not overwrite the last real OCR execution summary");
}

// --- stage capacity separates OCR from GPT while globally bounding replicas ---
{
  const roles = ["serial_crop", "year_product_crop"];
  const jobs = roles.map((role, index) => ({
    ...sampleJob,
    job_id: `stage-job-${index}`,
    job_key: `ocr:${preingestionOcrJobVersion}:bundle-1:stage-${index}`,
    payload: {
      crop: {
        ...sampleJob.payload.crop,
        role,
        crop_metadata: {
          ...sampleJob.payload.crop.crop_metadata,
          crop_id: `stage-crop-${index}`
        }
      }
    }
  }));
  const activeSlots = new Map();
  let bundleUpdatedAt = "2026-07-13T00:00:00.000Z";
  let bundleQualitySummary = {};
  let activeOcr = 0;
  let peakActiveOcr = 0;
  const result = await processQueuedPreingestionOcrJobs({
    bundleId: "bundle-1",
    env: {
      ...env,
      PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED: "true",
      PREINGESTION_OCR_GLOBAL_CAPACITY: "2",
      PREINGESTION_OCR_PER_ASSET_CAPACITY: "2",
      PREINGESTION_OCR_PER_ASSET_BATCH_SIZE: "2",
      PREINGESTION_OCR_ANCHOR_CONCURRENCY: "2",
      PREINGESTION_OCR_DETAIL_CONCURRENCY: "1",
      PREINGESTION_OCR_CAPACITY_WAIT_MS: "1000",
      PREINGESTION_OCR_CAPACITY_POLL_MS: "5"
    },
    fetchImpl: async (url, init = {}) => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/rpc/acquire_v4_stage_capacity")) {
        const body = JSON.parse(init.body);
        const key = JSON.stringify([body.p_stage_id, body.p_job_id]);
        if (activeSlots.has(key)) return jsonResponse(activeSlots.get(key).slot);
        const stageEntries = [...activeSlots.values()].filter((entry) => entry.stage_id === body.p_stage_id);
        if (stageEntries.length >= body.p_capacity) return jsonResponse(null);
        const used = new Set(stageEntries.map((entry) => entry.slot));
        const slot = Array.from({ length: body.p_capacity }, (_, index) => index + 1).find((value) => !used.has(value));
        activeSlots.set(key, { stage_id: body.p_stage_id, slot });
        return jsonResponse(slot);
      }
      if (target.pathname.endsWith("/rpc/release_v4_stage_capacity")) {
        const body = JSON.parse(init.body);
        const released = activeSlots.delete(JSON.stringify([body.p_stage_id, body.p_job_id])) ? 1 : 0;
        return jsonResponse(released);
      }
      if (!init.method && target.pathname.endsWith("/preingestion_jobs")) return jsonResponse(jobs);
      if (init.method === "PATCH" && target.pathname.endsWith("/preingestion_jobs")) {
        const body = JSON.parse(init.body);
        return jsonResponse([{ status: body.status || "running", attempts: body.attempts || 1 }]);
      }
      if (!init.method && target.pathname.endsWith("/preingestion_bundles")) {
        return jsonResponse([{
          bundle_id: "bundle-1",
          quality_summary: bundleQualitySummary,
          updated_at: bundleUpdatedAt
        }]);
      }
      if (init.method === "PATCH" && target.pathname.endsWith("/preingestion_bundles")) {
        const body = JSON.parse(init.body);
        bundleQualitySummary = body.quality_summary;
        bundleUpdatedAt = body.updated_at;
        return jsonResponse([{ bundle_id: "bundle-1", updated_at: bundleUpdatedAt }]);
      }
      throw new Error(`unexpected fetch: ${target}`);
    },
    paddleClient: {
      configured: true,
      verifyCrop: async () => {
        activeOcr += 1;
        peakActiveOcr = Math.max(peakActiveOcr, activeOcr);
        await new Promise((resolve) => setTimeout(resolve, 15));
        activeOcr -= 1;
        return {
          raw_text: "",
          confidence: 0,
          text_candidates: [],
          evidence_patch: { evidence: {} }
        };
      }
    },
    signedReadUrlFor: async () => "https://signed.test/front.jpg"
  });
  assert.equal(result.claimed, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.deferred, 0);
  assert.equal(result.stage_capacity_control_enabled, true);
  assert.equal(result.execution_summary_persisted, true);
  assert.equal(result.stage_global_capacity, 2);
  assert.equal(result.per_asset_capacity, 2);
  assert.equal(result.requested_job_limit, 32);
  assert.equal(result.effective_claim_limit, 2);
  assert.equal(result.anchor_concurrency, 1);
  assert.equal(result.detail_concurrency, 1);
  assert.equal(result.execution_summary.lane_capacity, 2);
  assert.equal(result.execution_summary.lane_capacity_unused, 0);
  assert.equal(result.execution_summary.lane_allocation_within_global_capacity, true);
  assert.equal(result.execution_summary.claimed_asset_count, 1);
  assert.equal(result.execution_summary.max_claimed_jobs_per_asset, 2);
  assert.equal(result.execution_summary.first_wave_job_count, 2);
  assert.equal(result.execution_summary.first_wave_distinct_asset_count, 1);
  assert.equal(result.execution_summary.first_wave_expected_distinct_asset_count, 1);
  assert.equal(result.execution_summary.first_wave_fairness_satisfied, true);
  assert.equal(result.peak_local_active, 2);
  assert.equal(peakActiveOcr, 2);
  assert.equal(activeSlots.size, 0);
  assert.equal(result.job_observability.filter((row) => row.stage_lane === "anchor").length, 1);
  assert.equal(result.job_observability.filter((row) => row.stage_lane === "detail").length, 1);
  assert.ok(result.job_observability.every((row) => row.stage_capacity_released === true));
  assert.ok(result.job_observability.every((row) => row.asset_stage_capacity === 2));
  assert.equal(bundleQualitySummary.ocr_stage_execution.global_capacity, 2);
  assert.equal(bundleQualitySummary.ocr_stage_execution.per_asset_capacity, 2);
  assert.equal(bundleQualitySummary.ocr_stage_execution.anchor_job_count, 1);
  assert.equal(bundleQualitySummary.ocr_stage_execution.detail_job_count, 1);
}

console.log("preingestion-ocr-worker.test.mjs OK");
