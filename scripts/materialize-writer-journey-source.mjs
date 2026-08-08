import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchGateImageSourceRecords } from
  "../lib/listing/evaluation/launch-gate-image-source-index.generated.mjs";
import { CSM_PRODUCTION_SUPABASE_PROJECT_REF } from
  "../lib/listing/thin/csm-deployment-environment.mjs";
import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT = Object.freeze({
  source_feedback_id: "007edfc1-e52d-4a9e-ab8f-3955e6500620",
  evaluation_cohort: "INTERNAL_REVIEWED_GT",
  image_sha256: Object.freeze({
    "007edfc1-e52d-4a9e-ab8f-3955e6500620_front":
      "16f731783a954b79d696ff2343c25e996692c0f845fc2bb01ed483ab7a74774b",
    "007edfc1-e52d-4a9e-ab8f-3955e6500620_back":
      "b3edee5956060acde3946cc5c4fcf29a0981d582e5d547b69290ce53f2f3cdc1"
  })
});
const indexedInternalSource = launchGateImageSourceRecords.find((source) => (
  source.source_feedback_id === WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT.source_feedback_id
  && source.evaluation_cohort === WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT.evaluation_cohort
));
const DEFAULT_SOURCE = indexedInternalSource ? {
  ...indexedInternalSource,
  images: indexedInternalSource.images.map((image) => ({
    ...image,
    content_sha256: WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT.image_sha256[image.image_id] || null
  }))
} : null;

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name}_required`);
  return text;
}

function encodedStoragePath(value, name) {
  const segments = requiredText(value, name).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${name}_invalid`);
  }
  return segments.map(encodeURIComponent).join("/");
}

function productionSupabaseOrigin(value) {
  let url;
  try {
    url = new URL(requiredText(value, "SUPABASE_URL"));
  } catch {
    throw new Error("SUPABASE_URL_invalid");
  }
  if (url.protocol !== "https:"
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || url.hostname !== `${CSM_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`) {
    throw new Error("SUPABASE_URL_not_production");
  }
  return url.origin;
}

function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  throw new Error("writer_journey_source_image_invalid");
}

function signedStorageUrl(value, origin) {
  let url;
  try {
    const text = requiredText(value, "signed_url");
    url = text.startsWith("http")
      ? new URL(text)
      : new URL(`${origin}/storage/v1/${text.replace(/^\/+/, "")}`);
  } catch {
    throw new Error("writer_journey_signing_response_invalid");
  }
  if (url.protocol !== "https:"
    || url.origin !== origin
    || !url.pathname.startsWith("/storage/v1/object/sign/")) {
    throw new Error("writer_journey_signing_response_invalid");
  }
  return url.href;
}

async function responseJson(response, errorCode) {
  if (!response?.ok) throw new Error(errorCode);
  try {
    return await response.json();
  } catch {
    throw new Error(errorCode);
  }
}

export async function materializeWriterJourneySource({
  env = process.env,
  outDir,
  source = DEFAULT_SOURCE,
  fetchImpl = globalThis.fetch
} = {}) {
  const origin = productionSupabaseOrigin(env.SUPABASE_URL);
  const serviceKey = requiredText(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const directory = path.resolve(requiredText(outDir, "out_dir"));
  if (source?.evaluation_cohort !== "INTERNAL_REVIEWED_GT"
    || !source?.source_feedback_id || !Array.isArray(source.images) || !source.images.length) {
    throw new Error("writer_journey_source_record_invalid");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const files = [];
  for (const [index, image] of source.images.slice(0, 2).entries()) {
    const bucket = encodedStoragePath(image.bucket, "storage_bucket");
    const objectPath = encodedStoragePath(image.object_path, "storage_object_path");
    const signResponse = await fetchImpl(
      `${origin}/storage/v1/object/sign/${bucket}/${objectPath}`,
      {
        method: "POST",
        headers: supabaseServiceHeaders(serviceKey, { "content-type": "application/json" }),
        redirect: "error",
        body: JSON.stringify({ expiresIn: 60 }),
        signal: AbortSignal.timeout(15_000)
      }
    );
    const signing = await responseJson(signResponse, "writer_journey_source_signing_failed");
    const downloadResponse = await fetchImpl(
      signedStorageUrl(signing.signedURL || signing.signedUrl || signing.signedUrlPath, origin),
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!downloadResponse?.ok) throw new Error("writer_journey_source_download_failed");
    const declaredLength = Number(downloadResponse.headers.get("content-length") || 0);
    if (declaredLength > MAX_SOURCE_BYTES) throw new Error("writer_journey_source_too_large");
    const bytes = Buffer.from(await downloadResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) {
      throw new Error("writer_journey_source_size_invalid");
    }
    const type = imageType(bytes);
    const expectedHash = String(image.content_sha256 || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
      throw new Error("writer_journey_source_expected_hash_required");
    }
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (expectedHash !== contentSha256) {
      throw new Error("writer_journey_source_hash_mismatch");
    }
    const role = String(image.role || `image-${index + 1}`)
      .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
      || `image-${index + 1}`;
    const filePath = path.join(directory, `${index + 1}-${role}.${type.extension}`);
    await writeFile(filePath, bytes, { mode: 0o600 });
    files.push({
      path: filePath,
      role,
      bytes: bytes.length,
      content_type: type.contentType,
      content_sha256: contentSha256
    });
  }
  return {
    schema_version: "writer-journey-source-v1",
    source_feedback_id: source.source_feedback_id,
    evaluation_cohort: source.evaluation_cohort,
    image_count: files.length,
    files
  };
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  try {
    const result = await materializeWriterJourneySource({
      outDir: argumentValue(process.argv.slice(2), "--out-dir")
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.message || error).slice(0, 160)
    })}\n`);
    process.exitCode = 1;
  }
}
