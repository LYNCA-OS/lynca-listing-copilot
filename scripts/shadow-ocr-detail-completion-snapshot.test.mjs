#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShadowOcrDetailSchedule,
  buildShadowOcrDetailCompletionSnapshot,
  shadowOcrDetailDurableJobKeyVersion,
  shadowOcrDetailCompletionToken
} from "../lib/listing/evaluation/shadow-ocr-detail-completion-snapshot.mjs";
import {
  buildPreingestionWorkerJobs,
  enqueuePreIngestionJobs,
  preingestionBundleVersion,
  preingestionOcrJobVersion
} from "../lib/listing/preingestion/preingestion-bundle.mjs";
import { bundlePatchesFromOcrResult } from "../lib/listing/preingestion/preingestion-ocr-worker.mjs";

const tenantId = "tenant_shadow_detail";
const assetId = "asset_11111111-1111-4111-8111-111111111111";
const bundleId = "22222222-2222-4222-8222-222222222222";

function crop(role, region, imageId) {
  return {
    source_image_id: imageId,
    source_region: region,
    role,
    crop_metadata: {
      crop_id: `${assetId}__${imageId}__${region}__field-crop-v1`,
      source_image_id: imageId,
      source_region: region,
      crop_role: role,
      transform_version: "field-crop-v1"
    }
  };
}

function fixtureBundle() {
  return {
    tenant_id: tenantId,
    asset_id: assetId,
    bundle_id: bundleId,
    bundle_version: preingestionBundleVersion,
    images: [{
      image_id: "front",
      role: "front_original",
      object_path: `tenants/${tenantId}/listing-assets/2026-07-30/${assetId}/front.jpg`,
      content_sha256: "a".repeat(64)
    }],
    derived_images: [],
    crop_plan: [
      crop("year_product_crop", "year_product", "front"),
      crop("subject_crop", "subject_name", "front")
    ],
    evidence_patches: []
  };
}

function detailJobs(bundle = fixtureBundle()) {
  return buildPreingestionWorkerJobs({
    bundle,
    enableOcrDetail: true,
    now: new Date(0)
  }).filter((job) => ["year_product_crop", "subject_crop"].includes(job.payload.crop.role));
}

function versionedDetailJobs(bundle = fixtureBundle()) {
  return buildShadowOcrDetailSchedule({ bundle }).jobs;
}

function patchesFor(jobs, bundle = fixtureBundle()) {
  const token = shadowOcrDetailCompletionToken({ bundle });
  return jobs.map((job) => {
    const role = job.payload.crop.role;
    assert.equal(job.payload.bundle_generation_fingerprint, token.bundle_generation_fingerprint);
    assert.equal(job.payload.detail_revision, token.detail_revision);
    return {
      field: role === "year_product_crop" ? "product" : "players",
      value: role === "year_product_crop" ? "Prizm" : ["Test Player"],
      source_type: "OCR",
      source_image_id: "front",
      crop_id: job.payload.crop.crop_metadata.crop_id,
      provenance: {
        job_key: job.job_key,
        bundle_generation_fingerprint: job.payload.bundle_generation_fingerprint,
        detail_revision: job.payload.detail_revision
      }
    };
  });
}

test("a one-shot probe before detail jobs land is fail-closed", () => {
  const snapshot = buildShadowOcrDetailCompletionSnapshot({ bundle: fixtureBundle() });
  assert.equal(snapshot.status, "INCOMPLETE");
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.expected_job_count, 2);
  assert.ok(snapshot.reason_codes.some((reason) => reason.startsWith("EXPECTED_JOB_NOT_OBSERVED:")));
  assert.equal(snapshot.production_effect, "NONE");
  assert.equal(snapshot.title_effect, "NONE");
});

test("partial detail completion stays incomplete even when one patch is persisted", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle);
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    observedJobs: [
      { ...jobs[0], status: "succeeded" },
      { ...jobs[1], status: "running" }
    ],
    observedPatches: [patchesFor(jobs)[0]]
  });
  assert.equal(snapshot.status, "INCOMPLETE");
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.complete_job_count, 1);
  assert.ok(snapshot.reason_codes.includes("EXPECTED_JOB_ACTIVE:subject_crop"));
});

test("a completed job without a persisted role-appropriate patch is not ready", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    observedJobs: jobs,
    observedPatches: [{
      ...patchesFor(jobs)[0],
      field: "card_number",
      value: "17"
    }, patchesFor(jobs)[1]]
  });
  assert.equal(snapshot.status, "INCOMPLETE");
  assert.ok(snapshot.reason_codes.includes("EXPECTED_PATCH_FIELD_MISSING:year_product_crop"));
});

test("a changed image generation rejects the token captured at scheduling time", () => {
  const scheduledBundle = fixtureBundle();
  const token = shadowOcrDetailCompletionToken({ bundle: scheduledBundle });
  const changedBundle = {
    ...scheduledBundle,
    images: scheduledBundle.images.map((image) => ({ ...image, content_sha256: "b".repeat(64) }))
  };
  const jobs = versionedDetailJobs(changedBundle).map((job) => ({ ...job, status: "succeeded" }));
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle: changedBundle,
    scheduledToken: token,
    observedJobs: jobs,
    observedPatches: patchesFor(jobs, changedBundle)
  });
  assert.equal(snapshot.status, "STALE");
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.reason_codes.includes("BUNDLE_GENERATION_STALE"));
  assert.ok(snapshot.reason_codes.includes("DETAIL_REVISION_STALE"));
});

test("old-version rows cannot satisfy a current detail revision", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle);
  const staleJobKey = jobs[0].job_key.replace(`ocr:${preingestionOcrJobVersion}:`, "ocr:ocr-crop-v20:");
  const currentPatches = patchesFor(jobs);
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    observedJobs: [
      { ...jobs[0], job_key: staleJobKey, status: "succeeded" },
      { ...jobs[1], status: "succeeded" }
    ],
    observedPatches: [
      { ...currentPatches[0], provenance: { ...currentPatches[0].provenance, job_key: staleJobKey } },
      currentPatches[1]
    ]
  });
  assert.equal(snapshot.status, "STALE");
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.reason_codes.includes("OBSERVED_JOB_STALE:year_product_crop"));
});

test("same-version jobs and role patches produce one complete immutable snapshot", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const patches = patchesFor(jobs);
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: jobs,
    observedPatches: patches
  });
  assert.equal(snapshot.status, "COMPLETE");
  assert.equal(snapshot.ready, true);
  assert.deepEqual(snapshot.reason_codes, ["DETAIL_SNAPSHOT_COMPLETE"]);
  assert.equal(snapshot.complete_job_count, 2);
  assert.match(snapshot.snapshot_fingerprint, /^[0-9a-f]{64}$/);
});

test("the real OCR worker preserves shadow schedule lineage and can complete the snapshot", () => {
  const bundle = fixtureBundle();
  const scheduled = buildShadowOcrDetailSchedule({ bundle });
  const jobs = scheduled.jobs.map((job) => ({ ...job, status: "succeeded" }));
  const patches = jobs.flatMap((job) => {
    const role = job.payload.crop.role;
    const field = role === "year_product_crop" ? "product" : "players";
    const value = role === "year_product_crop" ? "Prizm" : "Test Player";
    return bundlePatchesFromOcrResult({
      confidence: 0.98,
      text_candidates: [{ text: value, confidence: 0.98 }],
      evidence_patch: {
        crop_type: role,
        raw_text: value,
        evidence: { [field]: { value } }
      }
    }, job);
  });

  assert.equal(patches.filter((patch) => patch.field !== "region_observation").length, 2);
  assert.equal(
    patches.filter((patch) => patch.field === "region_observation").length,
    2,
    "additive RegionEvidence telemetry must preserve one typed observation per OCR detail job"
  );
  for (const patch of patches.filter((item) => item.field !== "region_observation")) {
    assert.equal(patch.provenance.evaluation_mode, "SHADOW_EVALUATION_ONLY");
    assert.equal(
      patch.provenance.bundle_generation_fingerprint,
      scheduled.token.bundle_generation_fingerprint
    );
    assert.equal(patch.provenance.detail_revision, scheduled.token.detail_revision);
  }

  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: scheduled.token,
    observedJobs: jobs,
    observedPatches: patches
  });
  assert.equal(snapshot.status, "COMPLETE");
  assert.equal(snapshot.ready, true);
  assert.deepEqual(snapshot.reason_codes, ["DETAIL_SNAPSHOT_COMPLETE"]);
});

test("identical duplicate observations are idempotent", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const patches = patchesFor(jobs);
  const single = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: jobs,
    observedPatches: patches
  });
  const duplicated = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: [...jobs, ...jobs.map((job) => structuredClone(job))],
    observedPatches: [...patches, ...patches.map((patch) => structuredClone(patch))]
  });
  assert.equal(duplicated.status, "COMPLETE");
  assert.equal(duplicated.expected_job_count, 2);
  assert.equal(duplicated.expected_jobs.every((job) => job.observed_patch_count === 1), true);
  assert.equal(duplicated.snapshot_fingerprint, single.snapshot_fingerprint);
});

test("conflicting duplicate job rows are stale rather than order-dependent", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: [...jobs, { ...jobs[0], status: "running" }],
    observedPatches: patchesFor(jobs)
  });
  assert.equal(snapshot.status, "STALE");
  assert.ok(snapshot.reason_codes.includes("DUPLICATE_JOB_CONFLICT:year_product_crop"));
});

test("unversioned successful rows cannot satisfy a current generation", () => {
  const bundle = fixtureBundle();
  const jobs = detailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const unversionedPatches = patchesFor(versionedDetailJobs(bundle)).map((patch) => ({
    ...patch,
    provenance: { job_key: patch.provenance.job_key }
  }));
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: jobs,
    observedPatches: unversionedPatches
  });
  assert.equal(snapshot.status, "STALE");
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.reason_codes.includes("OBSERVED_JOB_GENERATION_MISSING:year_product_crop"));
  assert.ok(snapshot.reason_codes.includes("OBSERVED_PATCH_GENERATION_MISSING:subject_crop"));
});

test("a patch with the right job key but wrong crop id cannot complete", () => {
  const bundle = fixtureBundle();
  const jobs = versionedDetailJobs(bundle).map((job) => ({ ...job, status: "succeeded" }));
  const patches = [...patchesFor(jobs)];
  patches[0] = { ...patches[0], crop_id: "wrong-crop" };
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle }),
    observedJobs: jobs,
    observedPatches: patches
  });
  assert.equal(snapshot.status, "STALE");
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.reason_codes.includes("OBSERVED_PATCH_CROP_MISMATCH:year_product_crop"));
});

test("old-generation rows with unchanged job keys cannot complete", () => {
  const oldBundle = fixtureBundle();
  const oldJobs = versionedDetailJobs(oldBundle).map((job) => ({ ...job, status: "succeeded" }));
  const changedBundle = {
    ...oldBundle,
    images: oldBundle.images.map((image) => ({ ...image, content_sha256: "b".repeat(64) }))
  };
  const snapshot = buildShadowOcrDetailCompletionSnapshot({
    bundle: changedBundle,
    scheduledToken: shadowOcrDetailCompletionToken({ bundle: changedBundle }),
    observedJobs: oldJobs,
    observedPatches: patchesFor(oldJobs, oldBundle)
  });
  assert.equal(snapshot.status, "STALE");
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.reason_codes.includes("OBSERVED_JOB_GENERATION_MISMATCH:year_product_crop"));
  assert.ok(snapshot.reason_codes.includes("OBSERVED_PATCH_GENERATION_MISMATCH:subject_crop"));
});

test("changing crop geometry changes both generation and detail revision", () => {
  const original = fixtureBundle();
  const changed = {
    ...original,
    crop_plan: original.crop_plan.map((entry, index) => index === 0
      ? {
          ...entry,
          crop_region: { x: 0.5, y: 0, width: 0.5, height: 1 },
          crop_metadata: {
            ...entry.crop_metadata,
            normalized_bounds: { x: 0.5, y: 0, width: 0.5, height: 1 },
            pixel_bounds: { x: 500, y: 0, width: 500, height: 1000 }
          }
        }
      : entry)
  };
  const originalToken = shadowOcrDetailCompletionToken({ bundle: original });
  const changedToken = shadowOcrDetailCompletionToken({ bundle: changed });
  assert.notEqual(changedToken.bundle_generation_fingerprint, originalToken.bundle_generation_fingerprint);
  assert.notEqual(changedToken.detail_revision, originalToken.detail_revision);
});

test("durable ignore-duplicates keeps production OCR and admits a new shadow generation", async () => {
  const originalBundle = fixtureBundle();
  const changedBundle = {
    ...originalBundle,
    images: originalBundle.images.map((image) => ({
      ...image,
      content_sha256: "b".repeat(64)
    }))
  };
  const productionJobs = buildPreingestionWorkerJobs({
    bundle: originalBundle,
    enableOcrDetail: true,
    now: new Date(0)
  }).map((job) => ({
    ...job,
    payload: { ...job.payload, production_marker: "must-not-change" }
  }));
  const oldShadowJobs = buildShadowOcrDetailSchedule({ bundle: originalBundle }).jobs;
  const newShadowSchedule = buildShadowOcrDetailSchedule({ bundle: changedBundle });
  const key = (job) => `${job.tenant_id}::${job.job_key}`;
  const durableRows = new Map(
    [...productionJobs, ...oldShadowJobs].map((job) => [key(job), structuredClone(job)])
  );
  const originalProductionRows = productionJobs.map((job) => structuredClone(durableRows.get(key(job))));
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const endpoint = new URL(String(url));
    const body = JSON.parse(init.body);
    const inserted = [];
    requests.push({ endpoint, init, body });
    for (const row of body) {
      if (durableRows.has(key(row))) continue;
      const persisted = structuredClone(row);
      durableRows.set(key(row), persisted);
      inserted.push(persisted);
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(inserted)
    };
  };
  const env = {
    SUPABASE_URL: "https://shadow-detail.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  };

  for (const job of productionJobs) {
    assert.equal(
      job.job_key,
      `ocr:${preingestionOcrJobVersion}:${originalBundle.bundle_id}:${job.payload.crop.crop_metadata.crop_id}`,
      "the ordinary production OCR job-key contract must remain byte-for-byte unchanged"
    );
    assert.equal(job.job_key.includes(`:${shadowOcrDetailDurableJobKeyVersion}:`), false);
  }
  assert.ok(oldShadowJobs.every((job) => job.job_key.endsWith(
    `:${shadowOcrDetailDurableJobKeyVersion}:${job.payload.detail_revision}`
  )));
  assert.ok(newShadowSchedule.jobs.every((job) => job.job_key.endsWith(
    `:${shadowOcrDetailDurableJobKeyVersion}:${newShadowSchedule.token.detail_revision}`
  )));
  assert.equal(
    new Set([...productionJobs, ...oldShadowJobs, ...newShadowSchedule.jobs].map(key)).size,
    productionJobs.length + oldShadowJobs.length + newShadowSchedule.jobs.length,
    "production, old shadow, and new shadow generations must have disjoint durable identities"
  );

  const first = await enqueuePreIngestionJobs({
    jobs: newShadowSchedule.jobs,
    env,
    fetchImpl
  });
  assert.deepEqual(first, {
    enqueued: newShadowSchedule.jobs.length,
    attempted: newShadowSchedule.jobs.length,
    durable: true
  });
  assert.equal(requests[0].endpoint.searchParams.get("on_conflict"), "tenant_id,job_key");
  assert.match(
    String(requests[0].init.headers.prefer || requests[0].init.headers.Prefer),
    /resolution=ignore-duplicates/
  );
  assert.deepEqual(
    productionJobs.map((job) => durableRows.get(key(job))),
    originalProductionRows,
    "shadow enqueue must not overwrite ordinary production OCR rows"
  );
  assert.ok(newShadowSchedule.jobs.every((job) => durableRows.has(key(job))));

  const second = await enqueuePreIngestionJobs({
    jobs: newShadowSchedule.jobs,
    env,
    fetchImpl
  });
  assert.deepEqual(second, {
    enqueued: 0,
    attempted: newShadowSchedule.jobs.length,
    durable: true
  });
  assert.deepEqual(
    productionJobs.map((job) => durableRows.get(key(job))),
    originalProductionRows,
    "an idempotent shadow replay must still leave production OCR rows untouched"
  );
});
