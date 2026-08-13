import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchGateImageSourceRecords } from
  "../lib/listing/evaluation/launch-gate-image-source-index.generated.mjs";
import { computeVerifiedOriginalSetSha256 } from
  "../lib/listing/knowledge/csm-external-identity-support.mjs";
import { CSM_PRODUCTION_SUPABASE_PROJECT_REF } from
  "../lib/listing/thin/csm-deployment-environment.mjs";
import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT = Object.freeze({
  case_id: "NON_TCG",
  expected_grammar: "NON_TCG",
  source_kind: "PRODUCTION_ASSET",
  source_record_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  source_asset_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
  evaluation_cohort: "PRODUCTION_LOW_REASONING_VERIFIED",
  hash_provenance: "2026-08-11_PRODUCTION_ASSET_EXACT_VERIFICATION",
  images: Object.freeze([
    Object.freeze({
      image_id: "f55f120f-09e0-4c2f-9166-8bcf7310b4d0",
      storage_role: "image_1_original",
      role: "front_original",
      content_type: "image/webp",
      bytes: 237200,
      width: 910,
      height: 1255,
      content_sha256: "161f0d97df619f8d34b2453551567a0473d3e477c3e0ec9295029fbce8c59e44"
    }),
    Object.freeze({
      image_id: "cd43a047-0472-441e-bc4d-00e53b04634f",
      storage_role: "image_2_original",
      role: "back_original",
      content_type: "image/webp",
      bytes: 180260,
      width: 922,
      height: 1258,
      content_sha256: "cef46b5d761d2d20f5cd21d611cab8d8037721bcdb4ae8c1a0d4441439a6fdc3"
    })
  ])
});

export const WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS = Object.freeze([
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT,
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

// Activation A adds only two frozen sources. The existing TCG case above is
// a no-search-capable acceptance case, so it is deliberately not duplicated
// here. Search is model-autonomous; this source freezes visible content, not a
// tool decision.
// Expected titles are absent: the live runtime must derive them from the exact
// original bytes, while the verifier checks only governed behavior and visible
// semantic relationships.
export const WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({
    case_id: "NON_TCG_WEB_IDENTITY",
    expected_grammar: "NON_TCG",
    original_set_sha256:
      "f2c21929f45fc664aa0136bb5f3ef045018b53bbe05ada9cf799bb914213f2a0",
    source_feedback_id: "4e22aa27-1702-4189-a3fb-8d159e053571",
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    hash_provenance: "2026-08-12_DIRECT_EXACT_PATH_BYTE_ACQUISITION",
    image_sha256: Object.freeze({
      "4e22aa27-1702-4189-a3fb-8d159e053571_front":
        "52e20e096c333ffa4892f67fd01eadbcf3385c5fc62e396fb626458d69e61cb3",
      "4e22aa27-1702-4189-a3fb-8d159e053571_back":
        "550bb85ee6dce1176f57067ff350c76ff73eb268ec7c4d6b930b95548b816471"
    })
  }),
  Object.freeze({
    case_id: "LOT_SHARED_ONLY",
    expected_grammar: "LOT",
    expected_lot_count: "3",
    original_set_sha256:
      "ab13bae6159a14cecfd2832288546373a89b4ecd46e8217eeb8b2fbc5c14c65c",
    source_feedback_id: "59305b58-e160-49bd-ba65-3676b1e4619a",
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    hash_provenance: "2026-08-12_DIRECT_EXACT_PATH_BYTE_ACQUISITION",
    image_sha256: Object.freeze({
      "59305b58-e160-49bd-ba65-3676b1e4619a_front":
        "9d77030639409173fbc0864e9fe9da897f6ba756b06223e71ec375146e2dc1e5",
      "59305b58-e160-49bd-ba65-3676b1e4619a_back":
        "08caafab16ca5219669bc60dbc5153b8f48999a17c1c8a224ab28da066ef947d"
    })
  })
]);

// The exact card the Owner selected as the Codex-parity acceptance case.
// Identity and original bytes are pinned here; the title is deliberately not.
// The release journey must obtain the expected title from the candidate runtime,
// not from a source manifest that could leak the answer into recognition.
export const WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT = Object.freeze({
  case_id: "EXTERNAL_IDENTITY",
  expected_grammar: "NON_TCG",
  source_kind: "PRODUCTION_ASSET",
  source_record_id: "asset_c1ffe54e-8d04-8e8d-ab22-1d333ab3d8a8",
  source_asset_id: "asset_c1ffe54e-8d04-8e8d-ab22-1d333ab3d8a8",
  evaluation_cohort: "OWNER_APPROVED_EXACT_PARITY",
  hash_provenance: "2026-08-10_PRODUCTION_ASSET_EXACT_VERIFICATION",
  images: Object.freeze([
    Object.freeze({
      image_id: "67c4a38b-1bee-4bdc-acfa-8263701e685c",
      storage_role: "image_2_original",
      role: "front_original",
      content_sha256: "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a"
    }),
    Object.freeze({
      image_id: "4500648f-c0c3-4222-a408-0bfd7ad988c0",
      storage_role: "image_1_original",
      role: "back_original",
      content_sha256: "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
    })
  ])
});

function sourceForContract(contract) {
  if (contract.source_kind === "PRODUCTION_ASSET") return contract;
  const indexed = launchGateImageSourceRecords.find((source) => (
    source.source_feedback_id === contract.source_feedback_id
    && source.evaluation_cohort === contract.evaluation_cohort
  ));
  return indexed ? {
    ...indexed,
    ...contract,
    images: indexed.images.map((image) => ({
      ...image,
      content_sha256: contract.image_sha256[image.image_id] || null
    }))
  } : null;
}

const DEFAULT_CASES = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS.map(sourceForContract);
const DEFAULT_ACTIVATION_CASES = WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map(
  sourceForContract
);

export function validateWriterJourneyActivationSources(cases) {
  if (!Array.isArray(cases) || cases.length !== 2) return false;
  const expectedById = new Map(WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map(
    (contract) => [contract.case_id, contract]
  ));
  return new Set(cases.map((source) => source?.case_id)).size === 2
    && cases.every((source) => {
      const contract = expectedById.get(source?.case_id);
      const hashes = Array.isArray(source?.images)
        ? source.images.map((image) => image?.content_sha256) : [];
      return contract
        && source.expected_grammar === contract.expected_grammar
        && source.source_feedback_id === contract.source_feedback_id
        && source.evaluation_cohort === contract.evaluation_cohort
        && source.hash_provenance === contract.hash_provenance
        && source.original_set_sha256 === contract.original_set_sha256
        && Array.isArray(source.images) && source.images.length === 2
        && source.images[0]?.role === "front_original"
        && source.images[1]?.role === "back_original"
        && source.images.every((image) => (
          image?.content_sha256 === contract.image_sha256[image?.image_id]
        ))
        && computeVerifiedOriginalSetSha256(hashes) === contract.original_set_sha256;
    });
}

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

export function verifiedProductionAssetSourceRows(rows, {
  contract,
  errorCode = "writer_journey_production_asset_source_invalid"
} = {}) {
  if (!contract || contract.source_kind !== "PRODUCTION_ASSET"
      || !Array.isArray(contract.images) || contract.images.length !== 2
      || !Array.isArray(rows) || rows.length !== 2) {
    throw new Error(errorCode);
  }
  const byImageId = new Map(rows.map((row) => [row?.image_id, row]));
  const images = contract.images.map((expected) => {
    const row = byImageId.get(expected.image_id);
    if (!row
      || row.asset_id !== contract.source_asset_id
      || row.storage_role !== expected.storage_role
      || row.object_verified !== true
      || row.content_hash_verified !== true
      || row.content_sha256 !== expected.content_sha256
      || !["image/jpeg", "image/png", "image/webp"].includes(row.content_type)
      || (expected.content_type && row.content_type !== expected.content_type)
      || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAX_SOURCE_BYTES
      || (expected.bytes && row.size !== expected.bytes)
      || !Number.isSafeInteger(row.width) || row.width < 1
      || (expected.width && row.width !== expected.width)
      || !Number.isSafeInteger(row.height) || row.height < 1
      || (expected.height && row.height !== expected.height)
      || !row.bucket || !row.object_path) {
      throw new Error(errorCode);
    }
    return {
      bucket: row.bucket,
      object_path: row.object_path,
      image_id: expected.image_id,
      storage_role: expected.storage_role,
      role: expected.role,
      content_sha256: expected.content_sha256,
      object_verified: true,
      content_hash_verified: true
    };
  });
  return { ...contract, images };
}

export function verifiedExactParitySourceRows(rows, {
  contract = WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT
} = {}) {
  return verifiedProductionAssetSourceRows(rows, {
    contract,
    errorCode: "writer_journey_parity_source_invalid"
  });
}

async function productionAssetSource({
  origin,
  serviceKey,
  fetchImpl,
  contract,
  readErrorCode,
  invalidErrorCode
}) {
  const endpoint = new URL(`${origin}/rest/v1/listing_image_verifications`);
  endpoint.searchParams.set("select", [
    "object_path", "bucket", "asset_id", "image_id", "storage_role", "content_type",
    "size", "width", "height", "object_verified", "content_hash_verified", "content_sha256"
  ].join(","));
  endpoint.searchParams.set("asset_id", `eq.${contract.source_asset_id}`);
  endpoint.searchParams.set("image_id", `in.(${contract.images.map((image) => image.image_id).join(",")})`);
  endpoint.searchParams.set("limit", "3");
  const response = await fetchImpl(endpoint, {
    headers: supabaseServiceHeaders(serviceKey),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  const rows = await responseJson(response, readErrorCode);
  return verifiedProductionAssetSourceRows(rows, {
    contract,
    errorCode: invalidErrorCode
  });
}

async function exactParitySource({ origin, serviceKey, fetchImpl }) {
  return productionAssetSource({
    origin,
    serviceKey,
    fetchImpl,
    contract: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT,
    readErrorCode: "writer_journey_parity_source_read_failed",
    invalidErrorCode: "writer_journey_parity_source_invalid"
  });
}

export async function materializeWriterJourneySources({
  env = process.env,
  outDir,
  cases = DEFAULT_CASES,
  standardCase = undefined,
  parityCase = undefined,
  activationCases = undefined,
  fetchImpl = globalThis.fetch
} = {}) {
  const origin = productionSupabaseOrigin(env.SUPABASE_URL);
  const serviceKey = requiredText(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const resolvedParityCase = parityCase === undefined
    ? await exactParitySource({ origin, serviceKey, fetchImpl })
    : parityCase;
  const resolvedActivationCases = activationCases === undefined
    ? (resolvedParityCase ? DEFAULT_ACTIVATION_CASES : null)
    : activationCases;
  const requestedStandardCase = Array.isArray(cases)
    ? cases.find((source) => source?.case_id === "NON_TCG")
    : null;
  const resolvedStandardCase = requestedStandardCase?.source_kind === "PRODUCTION_ASSET"
    ? (standardCase === undefined
      ? await productionAssetSource({
        origin,
        serviceKey,
        fetchImpl,
        contract: requestedStandardCase,
        readErrorCode: "writer_journey_standard_source_read_failed",
        invalidErrorCode: "writer_journey_standard_source_invalid"
      })
      : standardCase)
    : null;
  const resolvedCases = Array.isArray(cases) ? cases.map((source) => (
    source?.case_id === "NON_TCG" && resolvedStandardCase ? resolvedStandardCase : source
  )) : cases;
  const directory = path.resolve(requiredText(outDir, "out_dir"));
  const standardContract = requestedStandardCase;
  const tcgContract = Array.isArray(cases)
    ? cases.find((source) => source?.case_id === "TCG")
    : null;
  if (!Array.isArray(resolvedCases) || resolvedCases.length !== 2
    || new Set(resolvedCases.map((source) => source?.case_id)).size !== 2
    || new Set(resolvedCases.map((source) => source?.expected_grammar)).size !== 2
    || resolvedCases.some((source) => (
      !["NON_TCG", "TCG"].includes(source?.case_id)
      || (source.case_id === "NON_TCG" && source.expected_grammar !== "NON_TCG")
      || (source.case_id === "TCG" && source.expected_grammar !== "TCG")
      || !source?.hash_provenance
      || !Array.isArray(source.images) || source.images.length !== 2
      || source.images[0]?.role !== "front_original"
      || source.images[1]?.role !== "back_original"
      || (source.case_id === "NON_TCG" && (
        source.source_kind !== standardContract.source_kind
        || source.source_record_id !== standardContract.source_record_id
        || source.source_asset_id !== standardContract.source_asset_id
        || source.evaluation_cohort !== standardContract.evaluation_cohort
        || source.hash_provenance !== standardContract.hash_provenance
        || source.images.some((image, index) => (
          image?.image_id !== standardContract.images[index].image_id
          || image?.storage_role !== standardContract.images[index].storage_role
          || image?.content_sha256 !== standardContract.images[index].content_sha256
          || image?.object_verified !== true
          || image?.content_hash_verified !== true
        ))
      ))
      || (source.case_id === "TCG" && (
        source.source_feedback_id !== tcgContract.source_feedback_id
        || source.evaluation_cohort !== tcgContract.evaluation_cohort
        || source.hash_provenance !== tcgContract.hash_provenance
      ))
    ))) {
    throw new Error("writer_journey_source_record_invalid");
  }
  if (resolvedParityCase !== null && (
    resolvedParityCase?.case_id !== "EXTERNAL_IDENTITY"
    || resolvedParityCase?.expected_grammar !== "NON_TCG"
    || resolvedParityCase?.source_kind !== "PRODUCTION_ASSET"
    || resolvedParityCase?.source_record_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_record_id
    || resolvedParityCase?.source_asset_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id
    || resolvedParityCase?.evaluation_cohort !== "OWNER_APPROVED_EXACT_PARITY"
    || resolvedParityCase?.hash_provenance !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.hash_provenance
    || !Array.isArray(resolvedParityCase?.images)
    || resolvedParityCase.images.length !== 2
    || resolvedParityCase.images[0]?.role !== "front_original"
    || resolvedParityCase.images[1]?.role !== "back_original"
    || resolvedParityCase.images.some((image, index) => (
      image?.image_id !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images[index].image_id
      || image?.storage_role !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images[index].storage_role
      || image?.content_sha256 !== WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images[index].content_sha256
      || image?.object_verified !== true
      || image?.content_hash_verified !== true
    ))
  )) {
    throw new Error("writer_journey_parity_source_invalid");
  }
  if (resolvedActivationCases !== null && (
    resolvedParityCase === null
      || !validateWriterJourneyActivationSources(resolvedActivationCases)
  )) {
    throw new Error("writer_journey_activation_source_invalid");
  }
  await secureRootDirectory(directory);

  const materializedCases = [];
  for (const source of [
    ...resolvedCases,
    ...(resolvedParityCase ? [resolvedParityCase] : []),
    ...(resolvedActivationCases || [])
  ]) {
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
      ...(source.case_id === "NON_TCG_WEB_IDENTITY" ? {
        original_set_sha256: source.original_set_sha256
      } : {}),
      ...(source.case_id === "LOT_SHARED_ONLY" ? {
        expected_lot_count: source.expected_lot_count,
        original_set_sha256: source.original_set_sha256
      } : {}),
      ...(source.source_kind === "PRODUCTION_ASSET" ? {
        source_kind: source.source_kind,
        source_record_id: source.source_record_id,
        source_asset_id: source.source_asset_id
      } : { source_feedback_id: source.source_feedback_id }),
      evaluation_cohort: source.evaluation_cohort,
      hash_provenance: source.hash_provenance,
      image_count: files.length,
      files
    });
  }
  return {
    schema_version: resolvedActivationCases
      ? "writer-journey-cases-v4"
      : resolvedParityCase ? "writer-journey-cases-v3" : "writer-journey-cases-v2",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases: materializedCases.slice(0, 2),
    ...(resolvedParityCase ? { parity_case: materializedCases[2] } : {}),
    ...(resolvedActivationCases ? {
      activation_cases: materializedCases.slice(3, 5)
    } : {})
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
