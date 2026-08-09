import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchGateImageSourceRecords } from
  "../lib/listing/evaluation/launch-gate-image-source-index.generated.mjs";
import { CSM_PRODUCTION_SUPABASE_PROJECT_REF } from
  "../lib/listing/thin/csm-deployment-environment.mjs";
import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({
    case_id: "NON_TCG",
    expected_grammar: "NON_TCG",
    source_feedback_id: "007edfc1-e52d-4a9e-ab8f-3955e6500620",
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    hash_provenance: "2026-08-08_DIRECT_EXACT_PATH_BYTE_ACQUISITION",
    image_sha256: Object.freeze({
      "007edfc1-e52d-4a9e-ab8f-3955e6500620_front":
        "16f731783a954b79d696ff2343c25e996692c0f845fc2bb01ed483ab7a74774b",
      "007edfc1-e52d-4a9e-ab8f-3955e6500620_back":
        "b3edee5956060acde3946cc5c4fcf29a0981d582e5d547b69290ce53f2f3cdc1"
    })
  }),
  Object.freeze({
    case_id: "TCG",
    expected_grammar: "TCG",
    source_feedback_id: "6356cb8c-664a-4c9e-b909-63274390f4e1",
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    hash_provenance: "2026-08-09_DIRECT_EXACT_PATH_BYTE_ACQUISITION",
    image_sha256: Object.freeze({
      // First frozen from exact-path bytes on 2026-08-09. These are not
      // historical verification-table hashes; that table recorded null.
      "6356cb8c-664a-4c9e-b909-63274390f4e1_front":
        "3678b079635cea9524e4d159594f9af24b69806577f981b87f391b8f43600bfe",
      "6356cb8c-664a-4c9e-b909-63274390f4e1_back":
        "7e06b39628b32fa78eedc1dc602485e8a13d6dab28751ae06605265d31aeb388"
    })
  })
]);

function sourceForContract(contract) {
  const indexed = launchGateImageSourceRecords.find((source) => (
    source.source_feedback_id === contract.source_feedback_id
    && source.evaluation_cohort === contract.evaluation_cohort
  ));
  return indexed ? {
    ...indexed,
    case_id: contract.case_id,
    expected_grammar: contract.expected_grammar,
    hash_provenance: contract.hash_provenance,
    images: indexed.images.map((image) => ({
      ...image,
      content_sha256: contract.image_sha256[image.image_id] || null
    }))
  } : null;
}

const DEFAULT_CASES = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.map(sourceForContract);

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

function signedStorageUrl(value, origin, expectedPathname) {
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
    || url.username || url.password
    || url.pathname !== expectedPathname
    || url.hash
    || !url.searchParams.get("token")) {
    throw new Error("writer_journey_signing_response_invalid");
  }
  return url.href;
}

async function secureRootDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("writer_journey_source_directory_invalid");
  }
  await chmod(directory, 0o700);
  if (((await lstat(directory)).mode & 0o777) !== 0o700) {
    throw new Error("writer_journey_source_directory_permissions_invalid");
  }
}

async function secureNewCaseDirectory(directory) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("writer_journey_source_case_directory_exists");
    }
    throw error;
  }
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("writer_journey_source_case_directory_invalid");
  }
  await chmod(directory, 0o700);
  if (((await lstat(directory)).mode & 0o777) !== 0o700) {
    throw new Error("writer_journey_source_case_directory_invalid");
  }
}

async function secureWrite(filePath, bytes) {
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("writer_journey_source_file_exists");
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o600);
    const status = await handle.stat();
    if (!status.isFile() || (status.mode & 0o777) !== 0o600) {
      throw new Error("writer_journey_source_file_permissions_invalid");
    }
  } finally {
    await handle.close();
  }
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o777) !== 0o600) {
    throw new Error("writer_journey_source_file_permissions_invalid");
  }
}

async function responseJson(response, errorCode) {
  if (!response?.ok || response.redirected === true) throw new Error(errorCode);
  try {
    return await response.json();
  } catch {
    throw new Error(errorCode);
  }
}

export async function materializeWriterJourneySources({
  env = process.env,
  outDir,
  cases = DEFAULT_CASES,
  fetchImpl = globalThis.fetch
} = {}) {
  const origin = productionSupabaseOrigin(env.SUPABASE_URL);
  const serviceKey = requiredText(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const directory = path.resolve(requiredText(outDir, "out_dir"));
  if (!Array.isArray(cases) || cases.length !== 2
    || new Set(cases.map((source) => source?.case_id)).size !== 2
    || new Set(cases.map((source) => source?.expected_grammar)).size !== 2
    || cases.some((source) => source?.evaluation_cohort !== "INTERNAL_REVIEWED_GT"
      || !["NON_TCG", "TCG"].includes(source?.case_id)
      || (source.case_id === "NON_TCG" && source.expected_grammar !== "NON_TCG")
      || (source.case_id === "TCG" && source.expected_grammar !== "TCG")
      || !source?.source_feedback_id || !source?.hash_provenance
      || !Array.isArray(source.images) || source.images.length !== 2
      || source.images[0]?.role !== "front_original"
      || source.images[1]?.role !== "back_original")) {
    throw new Error("writer_journey_source_record_invalid");
  }
  await secureRootDirectory(directory);

  const materializedCases = [];
  for (const source of cases) {
    const caseDirectory = path.join(directory, source.case_id.toLowerCase().replace("_", "-"));
    await secureNewCaseDirectory(caseDirectory);
    const files = [];
    for (const [index, image] of source.images.entries()) {
      const bucket = encodedStoragePath(image.bucket, "storage_bucket");
      const objectPath = encodedStoragePath(image.object_path, "storage_object_path");
      const signedPathname = `/storage/v1/object/sign/${bucket}/${objectPath}`;
      const signResponse = await fetchImpl(
        `${origin}${signedPathname}`,
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
        signedStorageUrl(
          signing.signedURL || signing.signedUrl || signing.signedUrlPath,
          origin,
          signedPathname
        ),
        { redirect: "error", signal: AbortSignal.timeout(30_000) }
      );
      if (!downloadResponse?.ok || downloadResponse.redirected === true) {
        throw new Error("writer_journey_source_download_failed");
      }
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
      const filePath = path.join(caseDirectory, `${index + 1}-${role}.${type.extension}`);
      await secureWrite(filePath, bytes);
      files.push({
        path: filePath,
        role,
        bytes: bytes.length,
        content_type: type.contentType,
        content_sha256: contentSha256
      });
    }
    materializedCases.push({
      case_id: source.case_id,
      expected_grammar: source.expected_grammar,
      source_feedback_id: source.source_feedback_id,
      evaluation_cohort: source.evaluation_cohort,
      hash_provenance: source.hash_provenance,
      image_count: files.length,
      files
    });
  }
  return {
    schema_version: "writer-journey-cases-v2",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases: materializedCases
  };
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

function publicMaterializerError(error) {
  const code = String(error?.message || "").trim();
  return /^(?:SUPABASE_[A-Z0-9_]+|writer_journey_[a-z0-9_]+|storage_[a-z0-9_]+|out_dir_required|signed_url_required)$/.test(code)
    ? code
    : "writer_journey_source_failed";
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  try {
    const result = await materializeWriterJourneySources({
      outDir: argumentValue(process.argv.slice(2), "--out-dir")
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: publicMaterializerError(error)
    })}\n`);
    process.exitCode = 1;
  }
}
