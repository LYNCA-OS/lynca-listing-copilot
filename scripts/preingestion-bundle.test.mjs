import assert from "node:assert/strict";
import {
  buildPreingestionCropPlan,
  buildPreingestionQualitySummary,
  buildPreingestionWorkerJobs,
  createPreIngestionBundle,
  imagesFromPreIngestionBundle,
  normalizeEvidencePatch,
  readPreIngestionBundle,
  summarizePreIngestionBundle,
  upsertPreIngestionBundle
} from "../lib/listing/preingestion/preingestion-bundle.mjs";
import { __listingCopilotTitleTestHooks } from "../api/listing-copilot-title.js";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const front = {
  id: "front",
  assetId: "asset-pre",
  storageRole: "front_original",
  objectPath: "listing-assets/2026-07-06/asset-pre/front.jpg",
  bucket: "listing-card-images",
  contentSha256: "a".repeat(64),
  originalType: "image/jpeg",
  originalSize: 1200,
  originalWidth: 900,
  originalHeight: 1260,
  storageVerified: true,
  signedUrl: "https://should-not-persist.test/front"
};
const back = {
  id: "back",
  assetId: "asset-pre",
  storageRole: "back_original",
  objectPath: "listing-assets/2026-07-06/asset-pre/back.jpg",
  bucket: "listing-card-images",
  contentSha256: "b".repeat(64),
  originalType: "image/jpeg",
  originalSize: 1300,
  originalWidth: 900,
  originalHeight: 1260,
  storageVerified: true,
  signed_url: "https://should-not-persist.test/back"
};

const cropPlan = buildPreingestionCropPlan({
  assetId: "asset-pre",
  images: [front, back],
  requestedFields: ["serial_number", "grade_label"]
});
assert.ok(cropPlan.length >= 2);

const patch = normalizeEvidencePatch({
  field: "serial_number",
  value: "2/3",
  raw_text: "2/3",
  source_type: "CARD_FRONT_PRINTED_TEXT",
  source_image_id: "front",
  confidence: 0.91,
  provenance: { region: "upper_left" }
});
assert.equal(patch.field, "serial_number");
assert.equal(patch.source_type, "CARD_FRONT_PRINTED_TEXT");
assert.equal(patch.provenance.source_image_id, "front");
assert.equal(normalizeEvidencePatch({ field: "serial_number", value: "2/3" }), null);

const quality = buildPreingestionQualitySummary({
  images: [front, back, { ...front, id: "front-copy" }],
  derivedImages: [],
  cropPlan
});
assert.equal(quality.image_count, 3);
assert.equal(quality.duplicate_sha256_count, 1);

const bundle = createPreIngestionBundle({
  assetId: "asset-pre",
  images: [front, back, { ...front, id: "front-copy" }],
  derivedImages: [
    {
      id: "serial-crop",
      assetId: "asset-pre",
      source_image_id: "front",
      role: "serial_crop",
      objectPath: "listing-assets/2026-07-06/asset-pre/serial.webp",
      bucket: "listing-card-images",
      crop_box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      originalWidth: 320,
      originalHeight: 120,
      originalType: "image/webp",
      storageVerified: true,
      signedUrl: "https://should-not-persist.test/crop"
    }
  ],
  initialEvidence: {
    print_run_candidate: {
      value: "#/3",
      source_type: "PREINGESTION_DETERMINISTIC",
      source_image_id: "front",
      confidence: 0.8
    }
  },
  evidencePatches: [patch],
  cropPlan
});

assert.equal(bundle.images.length, 2, "duplicate content hash should be deduped");
assert.equal(bundle.derived_images.length, 1);
assert.equal(bundle.initial_evidence.print_run_candidate.value, "#/3");
assert.equal(bundle.evidence_patches.length, 1);
assert.equal(JSON.stringify(bundle).includes("should-not-persist"), false, "signed URLs must not be persisted");

const apiImages = imagesFromPreIngestionBundle(bundle);
assert.equal(apiImages.length, 3);
assert.equal(apiImages[0].storageVerified, true);
assert.equal(apiImages[2].derived, true);
assert.equal(apiImages[2].storageRole, "serial_crop");

const summary = summarizePreIngestionBundle(bundle);
assert.equal(summary.image_count, 2);
assert.equal(summary.derived_image_count, 1);
assert.equal(summary.initial_evidence_count, 1);

// Consumerless job types default OFF: only OCR (which has a consumer) is
// enqueued unless a type is explicitly enabled.
const jobs = buildPreingestionWorkerJobs({ bundle });
assert.ok(jobs.every((job) => job.job_type === "ocr_crop_verification"));
assert.ok(jobs.every((job) => job.job_key.startsWith("ocr:ocr-crop-v3:")));
assert.ok(jobs.every((job) => ["serial_crop", "card_code_crop", "grade_label_crop"].includes(job.payload.crop.role)));
const optInJobs = buildPreingestionWorkerJobs({ bundle, enableEmbeddings: true, enableQuality: true });
assert.ok(optInJobs.some((job) => job.job_type === "visual_embedding"));
assert.ok(optInJobs.some((job) => job.job_type === "image_quality_deep_analysis"));
assert.equal(new Set(optInJobs.map((job) => job.job_key)).size, optInJobs.length);

const calls = [];
const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(String(url));
  calls.push({
    path: parsed.pathname,
    search: Object.fromEntries(parsed.searchParams.entries()),
    method: init.method || "GET",
    body: init.body ? JSON.parse(init.body) : null,
    headers: init.headers
  });
  if ((init.method || "GET") === "POST") {
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([JSON.parse(init.body)])
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify([bundle])
  };
};

const saved = await upsertPreIngestionBundle({ bundle, env, fetchImpl });
assert.equal(saved.saved, true);
assert.equal(calls[0].path, "/rest/v1/preingestion_bundles");
assert.equal(calls[0].search.on_conflict, "asset_id,source,bundle_version");
assert.equal(calls[0].body.asset_id, "asset-pre");
assert.equal(JSON.stringify(calls[0].body).includes("should-not-persist"), false);

const read = await readPreIngestionBundle({
  bundleId: bundle.bundle_id,
  env,
  fetchImpl
});
assert.equal(read.found, true);
assert.equal(calls[1].search.bundle_id, `eq.${bundle.bundle_id}`);

const titlePayload = {
  preingestion_bundle_id: bundle.bundle_id
};
const applied = await __listingCopilotTitleTestHooks.applyPreIngestionBundleToPayload(titlePayload, {
  fetchImpl: async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/rest/v1/preingestion_bundles");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([bundle])
    };
  }
});
assert.equal(applied.applied, true);
assert.equal(titlePayload.preingestion_bundle_used, true);
assert.equal(titlePayload.images.length, 3);
assert.equal(titlePayload.images[0].storageVerified, true);
assert.equal(titlePayload.preprocessing_summary, undefined);
assert.equal(titlePayload.preingestion_summary.bundle_id, bundle.bundle_id);

const signedImages = [{ signed_url: "https://signed.test/front", image_id: "front" }];
const refreshPayload = {
  preingestion_bundle_id: bundle.bundle_id,
  images: signedImages,
  preingestion_evidence_patches: []
};
const refreshed = await __listingCopilotTitleTestHooks.refreshPreIngestionEvidencePatches(refreshPayload, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([{ ...bundle, evidence_patches: [patch] }])
  })
});
assert.equal(refreshed.refreshed, true);
assert.equal(refreshed.patch_count, 1);
assert.equal(refreshed.added_patch_count, 1);
assert.equal(refreshPayload.preingestion_evidence_patches[0].value, "2/3");
assert.equal(refreshPayload.images, signedImages, "evidence refresh must not replace provider-ready signed images");

const hardEvidencePayload = {
  maxTitleLength: 80,
  preingestion_evidence_patches: [
    {
      field: "serial_number",
      value: "09/50",
      raw_text: "09/50",
      source_type: "CARD_FRONT_PRINTED_TEXT",
      source_image_id: "front",
      crop_id: "serial-crop",
      confidence: 0.96,
      provenance: { region: "serial_number" }
    },
    {
      field: "grade_label",
      value: "BGS 9.5 AUTO 10",
      raw_text: "BGS 9.5 AUTO 10",
      source_type: "SLAB_LABEL",
      source_image_id: "front",
      crop_id: "slab-label",
      confidence: 0.95,
      provenance: { region: "slab_label" }
    }
  ]
};
const hardEvidenceDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload(hardEvidencePayload);
assert.equal(hardEvidenceDocument.evidence.print_run_number.value, "09/50");
assert.equal(hardEvidenceDocument.evidence.card_grade.value, "9.5");
assert.equal(hardEvidenceDocument.evidence.auto_grade.value, "10");

const staleGpt5Result = {
  title: "2018 Bowman Chrome Yordan Alvarez Auto Gold #CPA BGS 10/9.5",
  confidence: "HIGH",
  resolved: {
    year: "2018",
    brand: "Bowman",
    product: "Bowman Chrome",
    players: ["Yordan Alvarez"],
    card_name: "Prospect Autographs Gold Shimmer Refractor",
    surface_color: "Gold",
    collector_number: "CPA",
    auto: true,
    grade_company: "BGS",
    card_grade: "10",
    auto_grade: "9.5",
    grade_type: "CARD_AND_AUTO"
  },
  evidence: {
    grade: {
      value: "BGS 10 AUTO 9.5",
      status: "CONFIRMED",
      confidence: 0.72,
      sources: [{ source_type: "VISION_MODEL", observed_text: "BGS 10 AUTO 9.5" }],
      candidates: [{ value: "BGS 10 AUTO 9.5", confidence: 0.72, sources: [{ source_type: "VISION_MODEL" }] }]
    }
  }
};
const mergedWithPreingestion = __listingCopilotTitleTestHooks.withRecognitionEvidence(
  staleGpt5Result,
  null,
  hardEvidencePayload
);
const finalizedWithPreingestion = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation(
  mergedWithPreingestion,
  hardEvidencePayload
);
assert.match(finalizedWithPreingestion.title, /09\/50/);
assert.match(finalizedWithPreingestion.title, /BGS 9\.5\/10/);
assert.doesNotMatch(finalizedWithPreingestion.title, /BGS 10\/9\.5/);

const missingPayload = {
  preingestion_bundle_id: "00000000-0000-0000-0000-000000000000"
};
const missingApplied = await __listingCopilotTitleTestHooks.applyPreIngestionBundleToPayload(missingPayload, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([])
  })
});
assert.equal(missingApplied.applied, false);
assert.equal(missingPayload.preingestion_bundle_used, false);

console.log("preingestion bundle tests passed");
