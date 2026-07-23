import assert from "node:assert/strict";
import {
  buildPreingestionCropPlan,
  buildPreingestionQualitySummary,
  buildPreingestionWorkerJobs,
  createPreIngestionBundle,
  currentPreingestionEvidencePatches,
  imagesFromPreIngestionBundle,
  normalizeEvidencePatch,
  readCurrentPreingestionOcrJobsByAsset,
  readPreIngestionBundleByAsset,
  readPreIngestionBundle,
  preingestionOcrJobVersion,
  summarizePreIngestionBundle,
  upsertPreIngestionBundle
} from "../lib/listing/preingestion/preingestion-bundle.mjs";
import {
  applyPreIngestionEvidencePatchesToPayload,
  retrievalOnlyOcrContextFromPayload
} from "../lib/listing/pipeline/preingestion-evidence.mjs";
import { applyIdentityResolutionGate } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { __listingCopilotTitleTestHooks } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role"
};
const tenantId = "tenant_a";
const assetId = "asset_11111111-1111-4111-8111-111111111111";
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const front = {
  id: "front",
  assetId,
  storageRole: "front_original",
  objectPath: `tenants/tenant_a/listing-assets/2026-07-06/${assetId}/front.jpg`,
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
  assetId,
  storageRole: "back_original",
  objectPath: `tenants/tenant_a/listing-assets/2026-07-06/${assetId}/back.jpg`,
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
  assetId,
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

const currentPatchSet = currentPreingestionEvidencePatches([
  {
    field: "serial_number",
    value: "2/250",
    source_type: "OCR",
    provenance: { job_key: "ocr:ocr-crop-v4:bundle:serial" }
  },
  {
    field: "serial_number",
    value: "242/250",
    source_type: "OCR",
    provenance: { job_key: `ocr:${preingestionOcrJobVersion}:bundle:serial` }
  },
  {
    field: "serial_number",
    value: "09/50",
    source_type: "CARD_FRONT_PRINTED_TEXT"
  }
]);
assert.deepEqual(
  currentPatchSet.map((entry) => entry.value),
  ["242/250", "09/50"],
  "historical OCR must remain auditable without participating in the current decision"
);
assert.equal(
  currentPreingestionEvidencePatches([{ field: "serial_number", value: "7/10", source_type: "OCR" }]).length,
  0,
  "unversioned OCR must fail closed"
);

const inMemoryPayload = {
  preingestion_evidence_patches: [{ field: "grade_company", value: "BGS", source_type: "SLAB_LABEL" }]
};
const inMemoryPatchResult = applyPreIngestionEvidencePatchesToPayload(inMemoryPayload, [
  currentPatchSet[0],
  currentPatchSet[1]
], { source: "ocr_rendezvous_snapshot" });
assert.equal(inMemoryPatchResult.source, "ocr_rendezvous_snapshot");
assert.equal(inMemoryPatchResult.patch_count, 2);
assert.equal(inMemoryPatchResult.added_patch_count, 1);
assert.deepEqual(inMemoryPayload.preingestion_evidence_patches.map((entry) => entry.value), ["242/250", "09/50"]);

const quality = buildPreingestionQualitySummary({
  images: [front, back, { ...front, id: "front-copy" }],
  derivedImages: [],
  cropPlan
});
assert.equal(quality.image_count, 3);
assert.equal(quality.duplicate_sha256_count, 1);

const bundle = createPreIngestionBundle({
  tenantId,
  assetId,
  images: [front, back, { ...front, id: "front-copy" }],
  derivedImages: [
    {
      id: "serial-crop",
      assetId,
      source_image_id: "front",
      role: "serial_crop",
      objectPath: `tenants/tenant_a/listing-assets/2026-07-06/${assetId}/serial.webp`,
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
assert.equal(summary.ocr_stage_execution, null);
const summaryWithOcrExecution = summarizePreIngestionBundle({
  ...bundle,
  quality_summary: {
    ...bundle.quality_summary,
    ocr_stage_execution: {
      capacity_control_enabled: true,
      global_capacity: 8,
      claimed: 5
    }
  }
});
assert.deepEqual(summaryWithOcrExecution.ocr_stage_execution, {
  capacity_control_enabled: true,
  global_capacity: 8,
  claimed: 5
});

// Consumerless job types default OFF: only OCR (which has a consumer) is
// enqueued unless a type is explicitly enabled.
const jobs = buildPreingestionWorkerJobs({ bundle });
assert.ok(jobs.every((job) => job.job_type === "ocr_crop_verification"));
assert.ok(jobs.every((job) => job.job_key.startsWith(`ocr:${preingestionOcrJobVersion}:`)));
assert.deepEqual(
  jobs.map((job) => `${job.payload.crop.crop_metadata.source_side}:${job.payload.crop.role}`).sort(),
  ["back:card_code_crop", "front:serial_crop"],
  "raw front/back cards must enqueue only the highest-value crop for each hard-text field"
);
assert.ok(!jobs.some((job) => ["year_product_crop", "subject_crop"].includes(job.payload.crop.role)));
assert.equal(
  new Set(jobs.map((job) => `${job.payload.crop.source_image_id}:${job.payload.crop.role}`)).size,
  jobs.length,
  "overlapping collector/checklist crops must collapse to one card-code OCR request per image"
);
assert.ok(jobs.filter((job) => job.payload.crop.role === "card_code_crop").every((job) => job.priority === 10));
assert.ok(jobs.filter((job) => job.payload.crop.role === "serial_crop").every((job) => job.priority === 12));
assert.ok(jobs.filter((job) => job.payload.crop.role === "grade_label_crop").every((job) => job.priority === 14));
const slabJobs = buildPreingestionWorkerJobs({
  bundle: {
    ...bundle,
    crop_plan: bundle.crop_plan.map((crop) => ({
      ...crop,
      crop_metadata: {
        ...crop.crop_metadata,
        source_width: 800,
        source_height: 1400
      }
    }))
  }
});
assert.equal(slabJobs.filter((job) => job.payload.crop.role === "grade_label_crop").length, 1);
const detailJobs = buildPreingestionWorkerJobs({ bundle, enableOcrDetail: true });
assert.ok(detailJobs.some((job) => job.payload.crop.role === "year_product_crop" && job.priority === 30));
assert.ok(detailJobs.some((job) => job.payload.crop.role === "subject_crop" && job.priority === 35));
assert.ok(detailJobs.every((job) => job.payload.persist_raw_ocr_observation === true));
assert.ok(jobs.every((job) => job.payload.persist_raw_ocr_observation === false));
assert.ok(detailJobs.length > jobs.length);
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
  if (parsed.pathname === "/rest/v1/listing_assets" && (init.method || "GET") === "GET") {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ tenant_id: tenantId, id: assetId }])
    };
  }
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
assert.equal(calls[0].path, "/rest/v1/listing_assets");
assert.equal(calls[0].method, "GET");
assert.equal(calls[0].search.tenant_id, `eq.${tenantId}`);
assert.equal(calls[0].search.id, `eq.${assetId}`);
assert.equal(calls[1].path, "/rest/v1/preingestion_bundles");
assert.equal(calls[1].search.on_conflict, "tenant_id,asset_id,source,bundle_version");
assert.equal(calls[1].body.tenant_id, tenantId);
assert.equal(calls[1].body.asset_id, assetId);
assert.equal(JSON.stringify(calls[1].body).includes("should-not-persist"), false);

let transientWriteAttempts = 0;
const recoveredWrite = await upsertPreIngestionBundle({
  bundle,
  env,
  fetchImpl: async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/rest/v1/listing_assets") {
      return {
        ok: true,
        status: 200,
        headers: null,
        text: async () => JSON.stringify([{ tenant_id: tenantId, id: assetId }])
      };
    }
    transientWriteAttempts += 1;
    if (transientWriteAttempts === 1) {
      return { ok: false, status: 503, headers: null, text: async () => "temporary" };
    }
    return {
      ok: true,
      status: 201,
      headers: null,
      text: async () => JSON.stringify([JSON.parse(init.body)])
    };
  }
});
assert.equal(recoveredWrite.saved, true);
assert.equal(transientWriteAttempts, 2, "idempotent bundle writes should recover one transient transport failure");

const read = await readPreIngestionBundle({
  bundleId: bundle.bundle_id,
  tenantId,
  env,
  fetchImpl
});
assert.equal(read.found, true);
assert.equal(calls[2].search.bundle_id, `eq.${bundle.bundle_id}`);
assert.equal(calls[2].search.tenant_id, `eq.${tenantId}`);

const byAsset = await readPreIngestionBundleByAsset({
  assetId: bundle.asset_id,
  tenantId,
  source: bundle.source,
  env,
  fetchImpl
});

const currentOcrJobs = await readCurrentPreingestionOcrJobsByAsset({
  assetId,
  tenantId,
  env,
  fetchImpl: async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("tenant_id"), `eq.${tenantId}`);
    assert.equal(parsed.searchParams.get("asset_id"), `eq.${assetId}`);
    assert.equal(parsed.searchParams.get("job_type"), "eq.ocr_crop_verification");
    assert.equal(parsed.searchParams.get("job_key"), `like.ocr:${preingestionOcrJobVersion}:*`);
    return new Response(JSON.stringify([{
      tenant_id: tenantId,
      asset_id: assetId,
      bundle_id: bundle.bundle_id,
      job_key: `ocr:${preingestionOcrJobVersion}:${bundle.bundle_id}:serial`,
      status: "succeeded"
    }, {
      tenant_id: tenantId,
      asset_id: assetId,
      bundle_id: bundle.bundle_id,
      job_key: `ocr:ocr-crop-v10:${bundle.bundle_id}:stale`,
      status: "succeeded"
    }]), { status: 200 });
  }
});
assert.equal(currentOcrJobs.length, 1);
assert.ok(currentOcrJobs[0].job_key.startsWith(`ocr:${preingestionOcrJobVersion}:`));
assert.equal(byAsset.bundle_id, bundle.bundle_id);
assert.equal(calls[3].search.asset_id, `eq.${bundle.asset_id}`);
assert.equal(calls[3].search.tenant_id, `eq.${tenantId}`);
assert.equal(calls[3].search.source, `eq.${bundle.source}`);
assert.equal(calls[3].search.bundle_version, `eq.${bundle.bundle_version}`);

const titlePayload = {
  tenant_id: tenantId,
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

const canonicalImages = [{ id: "canonical-front", objectPath: "server-canonical-front" }];
const canonicalPayload = {
  tenant_id: tenantId,
  preingestion_bundle_id: bundle.bundle_id,
  v4_preserve_canonical_images_on_bundle_load: true,
  images: canonicalImages
};
const canonicalApplied = await __listingCopilotTitleTestHooks.applyPreIngestionBundleToPayload(canonicalPayload, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([bundle])
  })
});
assert.equal(canonicalApplied.applied, true);
assert.equal(canonicalPayload.preingestion_bundle_used, true);
assert.equal(canonicalPayload.images, canonicalImages, "server-canonical queue images must remain the recognition truth");

const signedImages = [{ signed_url: "https://signed.test/front", image_id: "front" }];
const refreshPayload = {
  tenant_id: tenantId,
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
    },
    {
      field: "ocr_raw_observation",
      value: "METAVERSE CARDS SHOHEI OHTANI LOS ANGELES DODGERS 17",
      raw_text: "METAVERSE CARDS SHOHEI OHTANI LOS ANGELES DODGERS 17",
      source_type: "OCR_AUDIT",
      source_image_id: "back",
      confidence: 0.98,
      provenance: { audit_only: true, crop_type: "card_code_crop" }
    }
  ]
};
const hardEvidenceDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload(hardEvidencePayload);
assert.equal(hardEvidenceDocument.evidence.print_run_number.value, "09/50");
assert.equal(hardEvidenceDocument.evidence.card_grade.value, "9.5");
assert.equal(hardEvidenceDocument.evidence.auto_grade.value, "10");
assert.equal(hardEvidenceDocument.evidence.ocr_raw_observation, undefined, "audit text must never become Resolver evidence");

const atomicGradeDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
  preingestion_evidence_patches: [
    {
      field: "grade_company",
      value: "PSA",
      raw_text: "PSA 98151458",
      source_type: "SLAB_LABEL",
      source_image_id: "slab",
      confidence: 0.97
    },
    {
      field: "card_grade",
      value: "10",
      raw_text: "GEM MT 10",
      source_type: "SLAB_LABEL",
      source_image_id: "slab",
      confidence: 0.96
    }
  ]
});
assert.equal(atomicGradeDocument.evidence.grade_company.value, "PSA");
assert.equal(atomicGradeDocument.evidence.card_grade.value, "10");
assert.equal(atomicGradeDocument.evidence.grade_type.value, "CARD_ONLY");
assert.equal(atomicGradeDocument.resolved.grade_company, "PSA");
assert.equal(atomicGradeDocument.resolved.card_grade, "10");

const beckettAtomicGradeDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
  preingestion_evidence_patches: [{
    field: "grade_company",
    value: "BECKETT",
    raw_text: "BECKETT 9.5 AUTOGRAPH 9",
    source_type: "SLAB_LABEL",
    source_image_id: "slab",
    confidence: 0.95
  }]
});
assert.equal(beckettAtomicGradeDocument.evidence.grade_company.value, "BGS");

const noisyBgsPayload = {
  maxTitleLength: 80,
  preingestion_evidence_patches: [
    {
      field: "grade_company",
      value: "BECKETT",
      raw_text: "BECKETT 9.5 AUTOGRAPH 9 CERT 0011371970",
      text_candidates: [
        { value: "BECKETT", confidence: 0.97 },
        { value: "9.5", confidence: 0.96 },
        { value: "AUTOGRAPH 9", confidence: 0.94 },
        { value: "0011371970", confidence: 0.93 }
      ],
      source_type: "OCR",
      source_image_id: "slab",
      crop_id: "grade-label",
      confidence: 0.95,
      provenance: { crop_type: "grade_label_crop", job_key: "ocr:ocr-crop-v6:grade-label" }
    },
    {
      field: "card_grade",
      value: "9.5",
      raw_text: "BECKETT 9.5 AUTOGRAPH 9 CERT 0011371970",
      text_candidates: [
        { value: "BECKETT", confidence: 0.97 },
        { value: "9.5", confidence: 0.96 },
        { value: "AUTOGRAPH 9", confidence: 0.94 },
        { value: "0011371970", confidence: 0.93 }
      ],
      source_type: "OCR",
      source_image_id: "slab",
      crop_id: "grade-label",
      confidence: 0.95,
      provenance: { crop_type: "grade_label_crop", job_key: "ocr:ocr-crop-v6:grade-label" }
    }
  ]
};
const noisyBgsDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload(noisyBgsPayload);
assert.deepEqual(noisyBgsDocument.evidence.grade_company.candidates.map((candidate) => candidate.value), ["BGS"]);
assert.deepEqual(noisyBgsDocument.evidence.card_grade.candidates.map((candidate) => candidate.value), ["9.5"]);
assert.equal(noisyBgsDocument.evidence.grade_company.sources[0].source_type, "SLAB_LABEL");
assert.equal(noisyBgsDocument.evidence.card_grade.sources[0].source_type, "SLAB_LABEL");

const directEvidence = (value) => ({
  value,
  normalized_value: value,
  status: "CONFIRMED",
  confidence: 0.96,
  candidates: [{
    value,
    confidence: 0.96,
    sources: [{ source_type: "CARD_FRONT", observed_text: Array.isArray(value) ? value.join(" / ") : String(value) }]
  }],
  sources: [{ source_type: "CARD_FRONT", observed_text: Array.isArray(value) ? value.join(" / ") : String(value) }],
  conflicts: []
});
const noisyBgsMerged = __listingCopilotTitleTestHooks.withRecognitionEvidence({
  provider: "openai_legacy",
  confidence: "HIGH",
  resolved: {
    year: "2018-19",
    product: "Panini Encased",
    players: ["Jaren Jackson Jr."],
    card_name: "Rookie Patch Auto",
    serial_number: "20/99",
    card_grade: "9.5"
  },
  evidence: {
    year: directEvidence("2018-19"),
    product: directEvidence("Panini Encased"),
    players: directEvidence(["Jaren Jackson Jr."]),
    card_name: directEvidence("Rookie Patch Auto"),
    serial_number: directEvidence("20/99"),
    card_grade: directEvidence("9.5")
  },
  unresolved: []
}, null, noisyBgsPayload);
const noisyBgsResolved = applyIdentityResolutionGate(noisyBgsMerged, {
  maxLength: 80,
  providerId: "openai_legacy"
});
assert.equal(noisyBgsResolved.resolved.grade_company, "BGS");
assert.equal(noisyBgsResolved.resolved.card_grade, "9.5");
assert.match(noisyBgsResolved.final_title, /BGS 9\.5/);

const falseSeasonPrintRunDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
  preingestion_evidence_patches: [
    {
      field: "print_run_denominator",
      value: "23",
      raw_text: "2022-23 NBA SEASON",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.94,
      provenance: { source_region: "full_image_serial_scan" }
    },
    {
      field: "serial_number",
      value: "#/19",
      raw_text: "2018-19 PANINI NO. 19",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.93,
      provenance: { source_region: "full_image_serial_scan" }
    },
    {
      field: "print_run_denominator",
      value: "26",
      raw_text: "MASTERS AUTOGRAPH CARD FROM 2025/26 TOPPS FINEST",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.97,
      provenance: { source_region: "full_image_serial_scan" }
    }
  ]
});
assert.equal(falseSeasonPrintRunDocument, null, "season years and card numbers must not become numerical rarity");

const directDenominatorDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
  preingestion_evidence_patches: [{
    field: "print_run_denominator",
    value: "5",
    raw_text: "2023 PRIZM STEPHEN CURRY 2/5",
    source_type: "OCR",
    source_image_id: "front",
    confidence: 0.96
  }]
});
assert.equal(directDenominatorDocument.evidence.print_run_number.value, "#/5");
assert.equal(directDenominatorDocument.evidence.print_run_denominator.value, "5");

const lineConfidenceDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
  preingestion_evidence_patches: [
    {
      field: "print_run_number",
      value: "30/99",
      raw_text: "JUSTIN HERBERT 30/99 AUTO",
      source_type: "OCR",
      source_image_id: "front",
      confidence: 0.71,
      text_candidates: [{ value: "30/99", confidence: 0.95 }]
    },
    {
      field: "card_grade",
      value: "63221071",
      raw_text: "PSA 63221071",
      source_type: "OCR",
      source_image_id: "front",
      confidence: 0.92
    }
  ]
});
assert.equal(lineConfidenceDocument.evidence.print_run_number.status, "CONFIRMED");
assert.equal(lineConfidenceDocument.evidence.print_run_number.confidence, 0.95);
assert.equal(lineConfidenceDocument.evidence.card_grade, undefined, "cert-like long numbers must not become card grades");

const confirmedRetrievalFields = __listingCopilotTitleTestHooks.confirmedPreingestionRetrievalFields({
  preingestion_evidence_patches: [
    {
      field: "collector_number",
      value: "PA-ANT",
      raw_text: "No. PA-ANT",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.94
    },
    {
      field: "serial_number",
      value: "2/3",
      raw_text: "2/3",
      source_type: "OCR",
      source_image_id: "front",
      confidence: 0.95
    },
    {
      field: "checklist_code",
      value: "BLURRY-READ",
      raw_text: "BLURRY-READ",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.61
    },
    {
      field: "grade_label",
      value: "BGS 8.5 AUTO 10",
      raw_text: "BGS 8.5 AUTO 10",
      source_type: "SLAB_LABEL",
      source_image_id: "front",
      confidence: 0.97
    }
  ]
});
assert.equal(confirmedRetrievalFields.collector_number, "PA-ANT");
assert.equal(confirmedRetrievalFields.print_run_number, "2/3");
assert.equal(confirmedRetrievalFields.serial_denominator, "3");
assert.equal(confirmedRetrievalFields.checklist_code, undefined, "review-confidence OCR must not become a retrieval identity lock");
assert.equal(confirmedRetrievalFields.grade_company, undefined, "grade evidence is not a catalog identity anchor");

const falsePrintedCodeRetrievalFields = __listingCopilotTitleTestHooks.confirmedPreingestionRetrievalFields({
  preingestion_evidence_patches: [
    {
      field: "collector_number",
      value: "99",
      raw_text: "COLLEGE PASSING RECORD YR TEAM ATT COMP 99 MICHIGAN 341 214",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.97
    },
    {
      field: "collector_number",
      value: "CMP1271",
      raw_text: "WWW.TOPPS.COM CODE#CMP127171",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.96
    },
    {
      field: "collector_number",
      value: "CMP134780",
      raw_text: "WWW.T0PPS.C0M C0DE#CMP134780",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.98
    },
    {
      field: "collector_number",
      value: "REGRETS",
      raw_text: "HUSTLE IS HAVING NO REGRETS AND DOING THE WORK",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.98
    }
  ]
});
assert.deepEqual(falsePrintedCodeRetrievalFields, {}, "OCR boilerplate and stat-table numbers must stay out of retrieval anchors");

const uniqueBackFullImageRetrievalFields = __listingCopilotTitleTestHooks.confirmedPreingestionRetrievalFields({
  preingestion_evidence_patches: [{
    field: "collector_number",
    value: "17",
    raw_text: "SHOHEI OHTANI 17 MAJOR LEAGUE BATTING RECORD GAMES AT BATS RUNS HITS ©2025",
    source_type: "OCR",
    source_image_id: "back",
    confidence: 0.99,
    provenance: {
      source_side: "back",
      direct_extraction_method: "unique_back_numeric"
    }
  }]
});
assert.equal(uniqueBackFullImageRetrievalFields.collector_number, "17");

const frontFullImageRetrievalFields = __listingCopilotTitleTestHooks.confirmedPreingestionRetrievalFields({
  preingestion_evidence_patches: [{
    field: "collector_number",
    value: "17",
    raw_text: "SHOHEI OHTANI 17",
    source_type: "OCR",
    source_image_id: "front",
    confidence: 0.99,
    provenance: {
      source_side: "front",
      direct_extraction_method: "unique_back_numeric"
    }
  }]
});
assert.deepEqual(frontFullImageRetrievalFields, {}, "a front jersey number must never inherit the unique-back card-code exception");

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
  tenant_id: tenantId,
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

// ---- printed season-range year evidence ------------------------------------
// Only a PRINTED season range read off the card is decisive for season
// products; a bare copyright year (©2025 fits both 2024-25 and 2025-26) must
// never become year evidence.
{
  const seasonDocument = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
    preingestion_evidence_patches: [
      {
        field: "year_product",
        value: "2025/26",
        raw_text: "2025/26 TOPPS CHROME BASKETBALL",
        source_type: "OCR",
        source_image_id: "back",
        crop_id: "year-product",
        confidence: 0.94,
        provenance: { crop_type: "year_product_crop" }
      },
      {
        field: "copyright_year",
        value: "2025",
        raw_text: "© 2025 THE TOPPS COMPANY",
        source_type: "OCR",
        source_image_id: "back",
        confidence: 0.97
      }
    ]
  });
  assert.equal(seasonDocument.evidence.year.value, "2025-26", "printed season range is admitted and canonicalized to dash form");
  assert.equal(seasonDocument.resolved.year, "2025-26");
  assert.equal(seasonDocument.evidence.year.candidates.length, 1, "the bare copyright year must be rejected, not merged as a candidate");

  const copyrightOnly = __listingCopilotTitleTestHooks.preingestionEvidenceDocumentFromPayload({
    preingestion_evidence_patches: [{
      field: "copyright_year",
      value: "2025",
      raw_text: "© 2025 THE TOPPS COMPANY",
      source_type: "OCR",
      source_image_id: "back",
      confidence: 0.97
    }]
  });
  assert.equal(copyrightOnly, null, "a bare copyright year alone yields no evidence document");
}

{
  const retrievalContext = retrievalOnlyOcrContextFromPayload({
    preingestion_evidence_patches: [
      {
        field: "ocr_raw_observation",
        value: "Metaverse Cards SHOHEI OHTANI TOPPS 17 Los Angeles Dodgers Metaverse Cards SHOHEI OHTANI TOPPS 17 Los Angeles Dodgers",
        confidence: 0.95,
        provenance: { audit_only: true }
      },
      {
        field: "ocr_raw_observation",
        value: "UNTRUSTED LOW CONFIDENCE TEXT 999",
        confidence: 0.5,
        provenance: { audit_only: true }
      },
      {
        field: "ocr_raw_observation",
        value: "NON AUDIT TEXT 888",
        confidence: 0.99,
        provenance: { audit_only: false }
      }
    ]
  });
  assert.equal(retrievalContext, "SHOHEI OHTANI TOPPS 17 Los Angeles Dodgers");
  assert.doesNotMatch(retrievalContext, /999|888|Metaverse Cards/);
}

console.log("pre-ingestion bundle tests passed");
