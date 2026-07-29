import crypto from "node:crypto";

import {
  buildPreingestionWorkerJobs,
  preingestionOcrJobVersion
} from "../preingestion/preingestion-bundle.mjs";

// Evaluation-only rendezvous contract for the optional product/subject OCR
// wave. It does not wait, mutate a bundle, or publish evidence. Its only job is
// to make a one-shot shadow probe fail closed until the exact scheduled bundle
// generation has a successful, persisted patch for every expected detail crop.
export const shadowOcrDetailCompletionSnapshotVersion = "shadow-ocr-detail-completion-snapshot-v1";
export const shadowOcrDetailDurableJobKeyVersion = "shadow-detail-v1";

export const shadowOcrDetailCompletionStatuses = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
  STALE: "STALE"
});

export const shadowOcrDetailCompletionReasons = Object.freeze({
  COMPLETE: "DETAIL_SNAPSHOT_COMPLETE",
  BUNDLE_ID_MISSING: "BUNDLE_ID_MISSING",
  BUNDLE_VERSION_MISSING: "BUNDLE_VERSION_MISSING",
  EXPECTED_DETAIL_CROP_MISSING: "EXPECTED_DETAIL_CROP_MISSING",
  EXPECTED_JOB_NOT_OBSERVED: "EXPECTED_JOB_NOT_OBSERVED",
  EXPECTED_JOB_ACTIVE: "EXPECTED_JOB_ACTIVE",
  EXPECTED_JOB_FAILED: "EXPECTED_JOB_FAILED",
  EXPECTED_PATCH_NOT_OBSERVED: "EXPECTED_PATCH_NOT_OBSERVED",
  EXPECTED_PATCH_FIELD_MISSING: "EXPECTED_PATCH_FIELD_MISSING",
  BUNDLE_GENERATION_STALE: "BUNDLE_GENERATION_STALE",
  DETAIL_REVISION_STALE: "DETAIL_REVISION_STALE",
  SCHEDULED_TOKEN_MISSING: "SCHEDULED_TOKEN_MISSING",
  OBSERVED_JOB_STALE: "OBSERVED_JOB_STALE",
  OBSERVED_JOB_GENERATION_MISSING: "OBSERVED_JOB_GENERATION_MISSING",
  OBSERVED_JOB_GENERATION_MISMATCH: "OBSERVED_JOB_GENERATION_MISMATCH",
  OBSERVED_JOB_DETAIL_REVISION_MISSING: "OBSERVED_JOB_DETAIL_REVISION_MISSING",
  OBSERVED_JOB_DETAIL_REVISION_MISMATCH: "OBSERVED_JOB_DETAIL_REVISION_MISMATCH",
  OBSERVED_PATCH_STALE: "OBSERVED_PATCH_STALE",
  OBSERVED_PATCH_CROP_MISMATCH: "OBSERVED_PATCH_CROP_MISMATCH",
  OBSERVED_PATCH_GENERATION_MISSING: "OBSERVED_PATCH_GENERATION_MISSING",
  OBSERVED_PATCH_GENERATION_MISMATCH: "OBSERVED_PATCH_GENERATION_MISMATCH",
  OBSERVED_PATCH_DETAIL_REVISION_MISSING: "OBSERVED_PATCH_DETAIL_REVISION_MISSING",
  OBSERVED_PATCH_DETAIL_REVISION_MISMATCH: "OBSERVED_PATCH_DETAIL_REVISION_MISMATCH",
  DUPLICATE_JOB_CONFLICT: "DUPLICATE_JOB_CONFLICT"
});

const defaultRequiredDetailRoles = Object.freeze([
  "year_product_crop",
  "subject_crop"
]);

const acceptedPatchFieldsByRole = Object.freeze({
  year_product_crop: new Set([
    "product",
    "product_text",
    "product_text_candidate",
    "year",
    "year_product",
    "year_product_candidate"
  ]),
  subject_crop: new Set([
    "players",
    "player",
    "player_name",
    "player_names",
    "player_text",
    "player_text_candidate",
    "subject",
    "subject_name"
  ])
});

const activeJobStatuses = new Set(["QUEUED", "RUNNING", "PENDING"]);
const successfulJobStatuses = new Set(["SUCCEEDED", "SUCCESS", "COMPLETE", "COMPLETED"]);
const failedJobStatuses = new Set(["FAILED", "CANCELLED", "CANCELED", "DEAD"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value ?? null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function cropForJob(job = {}) {
  return job.payload?.crop || {};
}

function cropRoleForJob(job = {}) {
  const crop = cropForJob(job);
  return cleanText(crop.role || crop.crop_metadata?.crop_role).toLowerCase();
}

function cropIdForJob(job = {}) {
  const crop = cropForJob(job);
  return cleanText(crop.crop_metadata?.crop_id || crop.source_region);
}

function parsedOcrJobKey(jobKey = "") {
  const match = cleanText(jobKey).match(
    /^ocr:([^:]+):([^:]+):(.+?)(?::shadow-detail-v1:([0-9a-f]{64}))?$/
  );
  return match
    ? {
        job_version: match[1],
        bundle_id: match[2],
        crop_id: match[3],
        detail_revision: match[4] || null
      }
    : null;
}

export function shadowOcrDetailDurableJobKey(jobKey = "", detailRevision = "") {
  const baseJobKey = cleanText(jobKey);
  const revision = cleanText(detailRevision).toLowerCase();
  const parsed = parsedOcrJobKey(baseJobKey);
  if (!parsed || parsed.detail_revision) {
    throw new Error("Shadow OCR detail jobs require a canonical OCR job key.");
  }
  if (!/^[0-9a-f]{64}$/.test(revision)) {
    throw new Error("Shadow OCR detail jobs require a sha256 detail revision.");
  }
  return `${baseJobKey}:${shadowOcrDetailDurableJobKeyVersion}:${revision}`;
}

function patchJobKey(patch = {}) {
  return cleanText(patch.provenance?.job_key || patch.job_key);
}

function patchCropId(patch = {}) {
  return cleanText(patch.crop_id || patch.cropId || patch.provenance?.crop_id);
}

function patchField(patch = {}) {
  return cleanText(patch.field || patch.evidence_field).toLowerCase();
}

function patchValue(patch = {}) {
  const value = patch.value ?? patch.normalized_value ?? patch.normalizedValue;
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : cleanText(value);
}

function rowGenerationFingerprint(row = {}) {
  return cleanText(
    row.bundle_generation_fingerprint
    || row.payload?.bundle_generation_fingerprint
    || row.provenance?.bundle_generation_fingerprint
  );
}

function rowDetailRevision(row = {}) {
  return cleanText(
    row.detail_revision
    || row.payload?.detail_revision
    || row.provenance?.detail_revision
  );
}

function stableBundleGeneration(bundle = {}) {
  const images = [...(Array.isArray(bundle.images) ? bundle.images : []), ...(Array.isArray(bundle.derived_images) ? bundle.derived_images : [])]
    .map((image) => ({
      image_id: cleanText(image.image_id || image.derived_id || image.id),
      role: cleanText(image.role || image.storage_role),
      content_sha256: cleanText(image.content_sha256 || image.sha256),
      object_path: cleanText(image.object_path || image.storage_path)
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const crops = (Array.isArray(bundle.crop_plan) ? bundle.crop_plan : [])
    .map((crop) => ({
      crop_id: cleanText(crop.crop_metadata?.crop_id || crop.source_region),
      source_image_id: cleanText(crop.source_image_id || crop.crop_metadata?.source_image_id),
      role: cleanText(crop.role || crop.crop_metadata?.crop_role),
      source_region: cleanText(crop.source_region || crop.crop_metadata?.source_region),
      crop_region: canonical(crop.crop_region || null),
      normalized_bounds: canonical(crop.crop_metadata?.normalized_bounds || null),
      pixel_bounds: canonical(crop.crop_metadata?.pixel_bounds || null),
      transform_version: cleanText(crop.crop_metadata?.transform_version)
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256({
    tenant_id: cleanText(bundle.tenant_id),
    asset_id: cleanText(bundle.asset_id),
    bundle_id: cleanText(bundle.bundle_id),
    bundle_version: cleanText(bundle.bundle_version),
    images,
    crops
  });
}

function expectedDetailJobsForBundle(bundle = {}, requiredRoles = defaultRequiredDetailRoles) {
  const roleSet = new Set(requiredRoles.map((role) => cleanText(role).toLowerCase()).filter(Boolean));
  if (!cleanText(bundle.bundle_id) || !cleanText(bundle.bundle_version)) return [];
  return buildPreingestionWorkerJobs({
    bundle,
    enableOcr: true,
    enableOcrDetail: true,
    enableEmbeddings: false,
    enableSurface: false,
    enableQuality: false,
    now: new Date(0)
  }).filter((job) => roleSet.has(cropRoleForJob(job)));
}

function expectedDescriptor(job = {}) {
  return {
    job_key: cleanText(job.job_key),
    tenant_id: cleanText(job.tenant_id),
    asset_id: cleanText(job.asset_id),
    bundle_id: cleanText(job.bundle_id),
    crop_id: cropIdForJob(job),
    crop_role: cropRoleForJob(job),
    bundle_generation_fingerprint: rowGenerationFingerprint(job) || null,
    detail_revision: rowDetailRevision(job) || null
  };
}

function shadowDetailJobsForBundle(bundle = {}, token = {}) {
  return expectedDetailJobsForBundle(bundle, token.required_roles).map((job) => ({
    ...job,
    job_key: shadowOcrDetailDurableJobKey(job.job_key, token.detail_revision),
    payload: {
      ...job.payload,
      evaluation_mode: "SHADOW_EVALUATION_ONLY",
      bundle_generation_fingerprint: token.bundle_generation_fingerprint,
      detail_revision: token.detail_revision
    }
  }));
}

function sameJobObservation(left = {}, right = {}) {
  return cleanText(left.status).toUpperCase() === cleanText(right.status).toUpperCase()
    && cleanText(left.bundle_id) === cleanText(right.bundle_id)
    && cropRoleForJob(left) === cropRoleForJob(right)
    && cropIdForJob(left) === cropIdForJob(right)
    && rowGenerationFingerprint(left) === rowGenerationFingerprint(right)
    && rowDetailRevision(left) === rowDetailRevision(right);
}

function uniqueObservedJobs(jobs = []) {
  const byKey = new Map();
  const conflictingKeys = new Set();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const key = cleanText(job.job_key);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous) byKey.set(key, job);
    else if (!sameJobObservation(previous, job)) conflictingKeys.add(key);
  }
  return { byKey, conflictingKeys };
}

function uniqueObservedPatches(patches = []) {
  const byJobKey = new Map();
  const seen = new Set();
  for (const patch of Array.isArray(patches) ? patches : []) {
    const jobKey = patchJobKey(patch);
    if (!jobKey) continue;
    const dedupeKey = sha256({
      job_key: jobKey,
      crop_id: patchCropId(patch),
      field: patchField(patch),
      value: patchValue(patch)
    });
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!byJobKey.has(jobKey)) byJobKey.set(jobKey, []);
    byJobKey.get(jobKey).push(patch);
  }
  return byJobKey;
}

function counterpartRows(rows = [], expected = {}) {
  return rows.filter((row) => {
    const parsed = parsedOcrJobKey(row.job_key || patchJobKey(row));
    const cropId = parsed?.crop_id || cropIdForJob(row) || patchCropId(row);
    if (!cropId || cropId !== expected.crop_id) return false;
    return cleanText(row.job_key || patchJobKey(row)) !== expected.job_key;
  }).sort((left, right) => {
    const leftParsed = parsedOcrJobKey(left.job_key || patchJobKey(left));
    const rightParsed = parsedOcrJobKey(right.job_key || patchJobKey(right));
    const score = (row, parsed) => Number(parsed?.bundle_id === expected.bundle_id)
      + Number(parsed?.job_version === preingestionOcrJobVersion)
      + Number(rowGenerationFingerprint(row) === expected.bundle_generation_fingerprint)
      + Number(rowDetailRevision(row) === expected.detail_revision);
    return score(right, rightParsed) - score(left, leftParsed);
  });
}

function patchHasExpectedField(patch = {}, role = "") {
  const accepted = acceptedPatchFieldsByRole[role];
  if (!accepted) return Boolean(patchField(patch) && patchValue(patch));
  return accepted.has(patchField(patch))
    && (Array.isArray(patchValue(patch)) ? patchValue(patch).length > 0 : Boolean(patchValue(patch)));
}

export function shadowOcrDetailCompletionToken({
  bundle = {},
  requiredRoles = defaultRequiredDetailRoles
} = {}) {
  const roles = [...new Set(requiredRoles.map((role) => cleanText(role).toLowerCase()).filter(Boolean))].sort();
  const jobs = expectedDetailJobsForBundle(bundle, roles)
    .map(expectedDescriptor)
    .sort((left, right) => left.job_key.localeCompare(right.job_key));
  const bundleGenerationFingerprint = stableBundleGeneration(bundle);
  return {
    schema_version: shadowOcrDetailCompletionSnapshotVersion,
    bundle_id: cleanText(bundle.bundle_id) || null,
    bundle_version: cleanText(bundle.bundle_version) || null,
    ocr_job_version: preingestionOcrJobVersion,
    required_roles: roles,
    bundle_generation_fingerprint: bundleGenerationFingerprint,
    detail_revision: sha256({
      schema_version: shadowOcrDetailCompletionSnapshotVersion,
      ocr_job_version: preingestionOcrJobVersion,
      bundle_generation_fingerprint: bundleGenerationFingerprint,
      required_roles: roles,
      expected_jobs: jobs
    })
  };
}

export function buildShadowOcrDetailSchedule({
  bundle = {},
  requiredRoles = defaultRequiredDetailRoles
} = {}) {
  const token = shadowOcrDetailCompletionToken({ bundle, requiredRoles });
  // PostgREST enqueues with resolution=ignore-duplicates on
  // (tenant_id, job_key). The evaluation generation therefore belongs in
  // the durable identity, not only in payload; otherwise a completed
  // production/detail job can silently swallow a new shadow payload.
  const jobs = shadowDetailJobsForBundle(bundle, token);
  return Object.freeze({
    schema_version: shadowOcrDetailCompletionSnapshotVersion,
    mode: "SHADOW_EVALUATION_ONLY",
    production_effect: "NONE",
    token,
    jobs: Object.freeze(jobs)
  });
}

export function buildShadowOcrDetailCompletionSnapshot({
  bundle = {},
  observedJobs = [],
  observedPatches = null,
  scheduledToken = null,
  requiredRoles = defaultRequiredDetailRoles
} = {}) {
  const roles = [...new Set(requiredRoles.map((role) => cleanText(role).toLowerCase()).filter(Boolean))].sort();
  const token = shadowOcrDetailCompletionToken({ bundle, requiredRoles: roles });
  const jobs = shadowDetailJobsForBundle(bundle, token);
  const expected = jobs.map(expectedDescriptor).sort((left, right) => left.job_key.localeCompare(right.job_key));
  const patches = Array.isArray(observedPatches) ? observedPatches : (Array.isArray(bundle.evidence_patches) ? bundle.evidence_patches : []);
  const observedJobRows = Array.isArray(observedJobs) ? observedJobs : [];
  const { byKey: observedJobByKey, conflictingKeys } = uniqueObservedJobs(observedJobRows);
  const patchesByJobKey = uniqueObservedPatches(patches);
  const reasons = [];

  if (!token.bundle_id) reasons.push(shadowOcrDetailCompletionReasons.BUNDLE_ID_MISSING);
  if (!token.bundle_version) reasons.push(shadowOcrDetailCompletionReasons.BUNDLE_VERSION_MISSING);
  if (!scheduledToken) reasons.push(shadowOcrDetailCompletionReasons.SCHEDULED_TOKEN_MISSING);
  for (const role of roles) {
    if (!expected.some((job) => job.crop_role === role)) {
      reasons.push(`${shadowOcrDetailCompletionReasons.EXPECTED_DETAIL_CROP_MISSING}:${role}`);
    }
  }

  if (scheduledToken) {
    if (cleanText(scheduledToken.bundle_generation_fingerprint) !== token.bundle_generation_fingerprint) {
      reasons.push(shadowOcrDetailCompletionReasons.BUNDLE_GENERATION_STALE);
    }
    if (cleanText(scheduledToken.detail_revision) !== token.detail_revision) {
      reasons.push(shadowOcrDetailCompletionReasons.DETAIL_REVISION_STALE);
    }
  }

  const expectedRows = expected.map((entry) => {
    const observedJob = observedJobByKey.get(entry.job_key) || null;
    const jobCounterpart = observedJob ? null : counterpartRows(observedJobRows, entry)[0] || null;
    const diagnosticJob = observedJob || jobCounterpart;
    const exactPatches = patchesByJobKey.get(entry.job_key) || [];
    const matchingPatches = exactPatches.length > 0
      ? exactPatches
      : counterpartRows(patches, entry);
    const status = cleanText(diagnosticJob?.status).toUpperCase();
    const rowReasons = [];

    if (conflictingKeys.has(entry.job_key)) {
      rowReasons.push(shadowOcrDetailCompletionReasons.DUPLICATE_JOB_CONFLICT);
    } else if (!observedJob) {
      const parsed = parsedOcrJobKey(jobCounterpart?.job_key);
      if (!jobCounterpart) {
        rowReasons.push(shadowOcrDetailCompletionReasons.EXPECTED_JOB_NOT_OBSERVED);
      } else if (parsed?.bundle_id !== entry.bundle_id
        || parsed?.job_version !== preingestionOcrJobVersion) {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_STALE);
      } else if (!rowGenerationFingerprint(jobCounterpart)) {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISSING);
      } else if (rowGenerationFingerprint(jobCounterpart) !== token.bundle_generation_fingerprint) {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISMATCH);
      } else if (!rowDetailRevision(jobCounterpart)) {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISSING);
      } else if (rowDetailRevision(jobCounterpart) !== token.detail_revision) {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISMATCH);
      } else {
        rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_STALE);
      }
    } else if (cleanText(observedJob.bundle_id) !== entry.bundle_id) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_STALE);
    } else if (cleanText(observedJob.tenant_id) !== entry.tenant_id
      || cleanText(observedJob.asset_id) !== entry.asset_id) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_STALE);
    } else if (!rowGenerationFingerprint(observedJob)) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISSING);
    } else if (rowGenerationFingerprint(observedJob) !== token.bundle_generation_fingerprint) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISMATCH);
    } else if (!rowDetailRevision(observedJob)) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISSING);
    } else if (rowDetailRevision(observedJob) !== token.detail_revision) {
      rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISMATCH);
    } else if (activeJobStatuses.has(status) || !status) {
      rowReasons.push(shadowOcrDetailCompletionReasons.EXPECTED_JOB_ACTIVE);
    } else if (failedJobStatuses.has(status) || !successfulJobStatuses.has(status)) {
      rowReasons.push(shadowOcrDetailCompletionReasons.EXPECTED_JOB_FAILED);
    }

    if (successfulJobStatuses.has(status)) {
      if (!matchingPatches.length) {
        rowReasons.push(shadowOcrDetailCompletionReasons.EXPECTED_PATCH_NOT_OBSERVED);
      } else {
        const currentPatches = matchingPatches.filter((patch) => (
          patchJobKey(patch) === entry.job_key
          && patchCropId(patch) === entry.crop_id
          && rowGenerationFingerprint(patch) === token.bundle_generation_fingerprint
          && rowDetailRevision(patch) === token.detail_revision
        ));
        if (currentPatches.length === 0) {
          if (matchingPatches.some((patch) => patchJobKey(patch) !== entry.job_key)) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_STALE);
          }
          if (matchingPatches.some((patch) => patchCropId(patch) !== entry.crop_id)) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_CROP_MISMATCH);
          }
          if (matchingPatches.some((patch) => !rowGenerationFingerprint(patch))) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_GENERATION_MISSING);
          }
          if (matchingPatches.some((patch) => rowGenerationFingerprint(patch)
            && rowGenerationFingerprint(patch) !== token.bundle_generation_fingerprint)) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_GENERATION_MISMATCH);
          }
          if (matchingPatches.some((patch) => !rowDetailRevision(patch))) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_DETAIL_REVISION_MISSING);
          }
          if (matchingPatches.some((patch) => rowDetailRevision(patch)
            && rowDetailRevision(patch) !== token.detail_revision)) {
            rowReasons.push(shadowOcrDetailCompletionReasons.OBSERVED_PATCH_DETAIL_REVISION_MISMATCH);
          }
        } else if (!currentPatches.some((patch) => patchHasExpectedField(patch, entry.crop_role))) {
          rowReasons.push(shadowOcrDetailCompletionReasons.EXPECTED_PATCH_FIELD_MISSING);
        }
      }
    }

    return {
      ...entry,
      observed_status: status || null,
      observed_patch_count: matchingPatches.length,
      observed_patch_fields: [...new Set(matchingPatches.map(patchField).filter(Boolean))].sort(),
      complete: rowReasons.length === 0,
      reasons: rowReasons
    };
  });
  reasons.push(...expectedRows.flatMap((row) => row.reasons.map((reason) => `${reason}:${row.crop_role}`)));

  const uniqueReasons = [...new Set(reasons)];
  const stale = uniqueReasons.some((reason) => [
    shadowOcrDetailCompletionReasons.BUNDLE_GENERATION_STALE,
    shadowOcrDetailCompletionReasons.DETAIL_REVISION_STALE,
    shadowOcrDetailCompletionReasons.OBSERVED_JOB_STALE,
    shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISSING,
    shadowOcrDetailCompletionReasons.OBSERVED_JOB_GENERATION_MISMATCH,
    shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISSING,
    shadowOcrDetailCompletionReasons.OBSERVED_JOB_DETAIL_REVISION_MISMATCH,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_STALE,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_CROP_MISMATCH,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_GENERATION_MISSING,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_GENERATION_MISMATCH,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_DETAIL_REVISION_MISSING,
    shadowOcrDetailCompletionReasons.OBSERVED_PATCH_DETAIL_REVISION_MISMATCH,
    shadowOcrDetailCompletionReasons.DUPLICATE_JOB_CONFLICT
  ].some((code) => reason === code || reason.startsWith(`${code}:`)));
  const complete = uniqueReasons.length === 0 && expectedRows.length > 0 && expectedRows.every((row) => row.complete);
  const status = stale
    ? shadowOcrDetailCompletionStatuses.STALE
    : complete
      ? shadowOcrDetailCompletionStatuses.COMPLETE
      : shadowOcrDetailCompletionStatuses.INCOMPLETE;

  const result = {
    schema_version: shadowOcrDetailCompletionSnapshotVersion,
    mode: "SHADOW_EVALUATION_ONLY",
    production_effect: "NONE",
    title_effect: "NONE",
    status,
    ready: status === shadowOcrDetailCompletionStatuses.COMPLETE,
    reason_codes: complete ? [shadowOcrDetailCompletionReasons.COMPLETE] : uniqueReasons,
    token,
    expected_job_count: expectedRows.length,
    complete_job_count: expectedRows.filter((row) => row.complete).length,
    expected_jobs: expectedRows
  };
  return {
    ...result,
    snapshot_fingerprint: sha256(result)
  };
}
