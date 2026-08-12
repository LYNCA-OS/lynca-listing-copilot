import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";
import {
  materializeWriterJourneySources,
  validateWriterJourneyActivationSources,
  verifiedExactParitySourceRows,
  verifiedProductionAssetSourceRows,
  WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS,
  WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT,
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS
} from "./materialize-writer-journey-source.mjs";

const productionUrl = "https://irpgnhkslrsiucybkufc.supabase.co";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]);
const calls = [];
const fetchImpl = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (init.method === "POST" && String(url).includes("/storage/v1/object/sign/")) {
    return new Response(JSON.stringify({
      signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(jpeg, {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-length": String(jpeg.length) }
  });
};
const sha256 = createHash("sha256").update(jpeg).digest("hex");
const testStandardContract = {
  case_id: "NON_TCG",
  expected_grammar: "NON_TCG",
  source_kind: "PRODUCTION_ASSET",
  source_record_id: "asset_test_standard",
  source_asset_id: "asset_test_standard",
  evaluation_cohort: "PRODUCTION_LOW_REASONING_VERIFIED",
  hash_provenance: "TEST_PRODUCTION_ASSET_EXACT_VERIFICATION",
  images: ["front", "back"].map((side, index) => ({
    image_id: `standard-${side}`,
    storage_role: `image_${index + 1}_original`,
    role: `${side}_original`,
    content_type: "image/jpeg",
    bytes: jpeg.length,
    width: 10 + index,
    height: 20 + index,
    content_sha256: sha256
  }))
};
const standardRows = testStandardContract.images.map((image, index) => ({
  object_path: `verified/standard/${index + 1}.jpg`,
  bucket: "listing-card-images",
  asset_id: testStandardContract.source_asset_id,
  image_id: image.image_id,
  storage_role: image.storage_role,
  content_type: image.content_type,
  size: image.bytes,
  width: image.width,
  height: image.height,
  object_verified: true,
  content_hash_verified: true,
  content_sha256: image.content_sha256
}));
const verifiedStandardCase = verifiedProductionAssetSourceRows(standardRows, {
  contract: testStandardContract,
  errorCode: "writer_journey_standard_source_invalid"
});
const tcgContract = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[1];
const testTcgCase = {
  case_id: "TCG",
  expected_grammar: "TCG",
  source_feedback_id: tcgContract.source_feedback_id,
  evaluation_cohort: tcgContract.evaluation_cohort,
  hash_provenance: tcgContract.hash_provenance,
  images: ["front", "back"].map((side) => ({
    bucket: "listing-feedback-images",
    object_path: `feedback/safe-tcg/${side}.jpg`,
    role: `${side}_original`,
    content_sha256: sha256
  }))
};
const cases = [testStandardContract, testTcgCase];
const sandboxDir = await mkdtemp(path.join(os.tmpdir(), "writer-journey-source-"));
const freshOutDir = (label = "attempt") => mkdtemp(path.join(sandboxDir, `${label}-`));
const productionEnv = {
  SUPABASE_URL: productionUrl,
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_service-test"
};
const runAttempt = async ({
  env = productionEnv,
  outDir = null,
  cases: attemptCases = cases,
  standardCase = verifiedStandardCase,
  parityCase = null,
  activationCases = null,
  fetchImpl: attemptFetch = fetchImpl
} = {}) => materializeWriterJourneySources({
  env,
  outDir: outDir || await freshOutDir(),
  cases: attemptCases,
  standardCase,
  parityCase,
  activationCases,
  fetchImpl: attemptFetch
});

try {
  assert.equal(buildCsmResolutionView({ composed: { grammar: "standard" } }).grammar.value,
    WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[0].expected_grammar,
    "the manifest grammar must follow the resolution-view contract, not an internal SEM enum");
  assert.equal(buildCsmResolutionView({ composed: { grammar: "tcg" } }).grammar.value,
    WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[1].expected_grammar);
  const frozenStandard = WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[0];
  assert.deepEqual({
    case_id: frozenStandard.case_id,
    expected_grammar: frozenStandard.expected_grammar,
    source_kind: frozenStandard.source_kind,
    source_record_id: frozenStandard.source_record_id,
    source_asset_id: frozenStandard.source_asset_id,
    evaluation_cohort: frozenStandard.evaluation_cohort,
    hash_provenance: frozenStandard.hash_provenance
  }, {
    case_id: "NON_TCG",
    expected_grammar: "NON_TCG",
    source_kind: "PRODUCTION_ASSET",
    source_record_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
    source_asset_id: "asset_6fb25b62-0498-8b3a-91a6-30ad4d62f5ef",
    evaluation_cohort: "PRODUCTION_LOW_REASONING_VERIFIED",
    hash_provenance: "2026-08-11_PRODUCTION_ASSET_EXACT_VERIFICATION"
  });
  assert.deepEqual(frozenStandard.images, [{
    image_id: "f55f120f-09e0-4c2f-9166-8bcf7310b4d0",
    storage_role: "image_1_original",
    role: "front_original",
    content_type: "image/webp",
    bytes: 237200,
    width: 910,
    height: 1255,
    content_sha256: "161f0d97df619f8d34b2453551567a0473d3e477c3e0ec9295029fbce8c59e44"
  }, {
    image_id: "cd43a047-0472-441e-bc4d-00e53b04634f",
    storage_role: "image_2_original",
    role: "back_original",
    content_type: "image/webp",
    bytes: 180260,
    width: 922,
    height: 1258,
    content_sha256: "cef46b5d761d2d20f5cd21d611cab8d8037721bcdb4ae8c1a0d4441439a6fdc3"
  }]);
  assert.deepEqual({
    case_id: tcgContract.case_id,
    expected_grammar: tcgContract.expected_grammar,
    source_feedback_id: tcgContract.source_feedback_id
  }, {
    case_id: "TCG",
    expected_grammar: "TCG",
    source_feedback_id: "6356cb8c-664a-4c9e-b909-63274390f4e1"
  });
  for (const hash of frozenStandard.images.map((image) => image.content_sha256)) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[1].image_sha256, {
    "6356cb8c-664a-4c9e-b909-63274390f4e1_front":
      "3678b079635cea9524e4d159594f9af24b69806577f981b87f391b8f43600bfe",
    "6356cb8c-664a-4c9e-b909-63274390f4e1_back":
      "7e06b39628b32fa78eedc1dc602485e8a13d6dab28751ae06605265d31aeb388"
  });
  assert.equal(WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS[1].hash_provenance,
    "2026-08-09_DIRECT_EXACT_PATH_BYTE_ACQUISITION");
  assert.deepEqual(WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map((contract) => ({
    case_id: contract.case_id,
    expected_grammar: contract.expected_grammar,
    source_feedback_id: contract.source_feedback_id,
    original_set_sha256: contract.original_set_sha256
  })), [{
    case_id: "NON_TCG_WEB_IDENTITY",
    expected_grammar: "NON_TCG",
    source_feedback_id: "4e22aa27-1702-4189-a3fb-8d159e053571",
    original_set_sha256:
      "f2c21929f45fc664aa0136bb5f3ef045018b53bbe05ada9cf799bb914213f2a0"
  }, {
    case_id: "LOT_SHARED_ONLY",
    expected_grammar: "LOT",
    source_feedback_id: "59305b58-e160-49bd-ba65-3676b1e4619a",
    original_set_sha256:
      "ab13bae6159a14cecfd2832288546373a89b4ecd46e8217eeb8b2fbc5c14c65c"
  }]);
  const frozenActivationSources = WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map(
    (contract) => ({
      ...contract,
      images: ["front", "back"].map((side) => ({
        image_id: `${contract.source_feedback_id}_${side}`,
        role: `${side}_original`,
        content_sha256: contract.image_sha256[`${contract.source_feedback_id}_${side}`]
      }))
    })
  );
  assert.equal(validateWriterJourneyActivationSources(frozenActivationSources), true);
  assert.equal(validateWriterJourneyActivationSources(frozenActivationSources.map(
    (source, index) => index === 0 ? {
      ...source,
      images: source.images.map((image, imageIndex) => imageIndex === 0
        ? { ...image, content_sha256: "f".repeat(64) }
        : image)
    } : source
  )), false, "Activation A source bytes are immutable");
  const parityRows = WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images.map((image, index) => ({
    object_path: `verified/parity/${index + 1}.jpg`,
    bucket: "listing-card-images",
    asset_id: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id,
    image_id: image.image_id,
    storage_role: image.storage_role,
    content_type: "image/jpeg",
    size: 400_000 + index,
    width: 1085 + index,
    height: 1429 - index,
    object_verified: true,
    content_hash_verified: true,
    content_sha256: image.content_sha256
  }));
  const verifiedParity = verifiedExactParitySourceRows(parityRows);
  assert.equal(verifiedParity.source_asset_id,
    WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id);
  assert.deepEqual(verifiedParity.images.map((image) => ({
    image_id: image.image_id,
    storage_role: image.storage_role,
    role: image.role,
    content_sha256: image.content_sha256,
    object_verified: image.object_verified,
    content_hash_verified: image.content_hash_verified
  })), WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images.map((image) => ({
    ...image,
    object_verified: true,
    content_hash_verified: true
  })));
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[1].image_id = rows[0].image_id; },
    (rows) => { rows[0].asset_id = "asset_wrong"; },
    (rows) => { rows[0].content_sha256 = "0".repeat(64); },
    (rows) => { rows[0].storage_role = "image_1_original"; },
    (rows) => { rows[0].object_verified = false; },
    (rows) => { rows[0].content_hash_verified = false; }
  ]) {
    const invalidRows = structuredClone(parityRows);
    mutate(invalidRows);
    assert.throws(() => verifiedExactParitySourceRows(invalidRows),
      /writer_journey_parity_source_invalid/);
  }
  assert.equal(verifiedStandardCase.source_asset_id, testStandardContract.source_asset_id);
  assert.deepEqual(verifiedStandardCase.images.map((image) => ({
    image_id: image.image_id,
    storage_role: image.storage_role,
    role: image.role,
    content_sha256: image.content_sha256,
    object_verified: image.object_verified,
    content_hash_verified: image.content_hash_verified
  })), testStandardContract.images.map((image) => ({
    image_id: image.image_id,
    storage_role: image.storage_role,
    role: image.role,
    content_sha256: image.content_sha256,
    object_verified: true,
    content_hash_verified: true
  })));
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[1].image_id = rows[0].image_id; },
    (rows) => { rows[0].asset_id = "asset_wrong"; },
    (rows) => { rows[0].storage_role = "image_9_original"; },
    (rows) => { rows[0].content_type = "image/png"; },
    (rows) => { rows[0].size += 1; },
    (rows) => { rows[0].width += 1; },
    (rows) => { rows[0].height += 1; },
    (rows) => { rows[0].content_sha256 = "0".repeat(64); },
    (rows) => { rows[0].object_verified = false; },
    (rows) => { rows[0].content_hash_verified = false; }
  ]) {
    const invalidRows = structuredClone(standardRows);
    mutate(invalidRows);
    assert.throws(() => verifiedProductionAssetSourceRows(invalidRows, {
      contract: testStandardContract,
      errorCode: "writer_journey_standard_source_invalid"
    }), /writer_journey_standard_source_invalid/);
  }
  let standardRead = null;
  await assert.rejects(
    materializeWriterJourneySources({
      env: productionEnv,
      outDir: await freshOutDir("invalid-live-standard"),
      cases,
      standardCase: undefined,
      parityCase: null,
      fetchImpl: async (url, init = {}) => {
        standardRead = { url: String(url), init };
        return new Response(JSON.stringify([
          { ...standardRows[0], content_hash_verified: false }, standardRows[1]
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
    }),
    /writer_journey_standard_source_invalid/
  );
  const standardReadUrl = new URL(standardRead.url);
  assert.equal(standardReadUrl.pathname, "/rest/v1/listing_image_verifications");
  assert.equal(standardReadUrl.searchParams.get("asset_id"),
    `eq.${testStandardContract.source_asset_id}`);
  assert.equal(standardReadUrl.searchParams.get("image_id"),
    `in.(${testStandardContract.images.map((image) => image.image_id).join(",")})`);
  assert.equal(standardReadUrl.searchParams.get("limit"), "3");
  assert.equal(standardRead.init.headers.apikey, productionEnv.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(standardRead.init.headers.authorization, undefined);
  assert.equal(standardRead.init.redirect, "error");
  let parityRead = null;
  await assert.rejects(
    materializeWriterJourneySources({
      env: productionEnv,
      outDir: await freshOutDir("invalid-live-parity"),
      cases,
      fetchImpl: async (url, init = {}) => {
        parityRead = { url: String(url), init };
        return new Response(JSON.stringify([
          { ...parityRows[0], object_verified: false }, parityRows[1]
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
    }),
    /writer_journey_parity_source_invalid/
  );
  const parityReadUrl = new URL(parityRead.url);
  assert.equal(parityReadUrl.pathname, "/rest/v1/listing_image_verifications");
  assert.equal(parityReadUrl.searchParams.get("asset_id"),
    `eq.${WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.source_asset_id}`);
  assert.equal(parityReadUrl.searchParams.get("image_id"),
    `in.(${WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images.map((image) => image.image_id).join(",")})`);
  assert.equal(parityReadUrl.searchParams.get("limit"), "3");
  assert.equal(parityRead.init.headers.apikey, productionEnv.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(parityRead.init.headers.authorization, undefined);
  assert.equal(parityRead.init.redirect, "error");
  const materializerSource = await readFile(new URL("./materialize-writer-journey-source.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(materializerSource, /error:\s*String\(error/,
    "CLI failures must not echo signed URLs, tokens, or service secrets");
  assert.doesNotMatch(materializerSource, /production-standard-p0-verifier/,
    "verifier-only expected identity must not enter source materialization");
  const outDir = await freshOutDir("success");
  await chmod(outDir, 0o755);
  assert.equal((await stat(outDir)).mode & 0o777, 0o755,
    "the fixture must begin with broad permissions");
  const result = await runAttempt({
    outDir,
  });
  assert.equal(result.schema_version, "writer-journey-cases-v2");
  assert.equal(result.evidence_scope, "LIVE_CONTRACT_RECEIPT_ONLY");
  assert.equal(result.accuracy_claim, null);
  assert.deepEqual(result.cases.map((entry) => entry.expected_grammar), ["NON_TCG", "TCG"]);
  assert.deepEqual(result.cases.map((entry) => entry.image_count), [2, 2]);
  assert.deepEqual({
    source_kind: result.cases[0].source_kind,
    source_record_id: result.cases[0].source_record_id,
    source_asset_id: result.cases[0].source_asset_id
  }, {
    source_kind: testStandardContract.source_kind,
    source_record_id: testStandardContract.source_record_id,
    source_asset_id: testStandardContract.source_asset_id
  });
  assert.equal(Object.hasOwn(result.cases[0], "source_feedback_id"), false);
  assert.doesNotMatch(JSON.stringify(result),
    /expected_card_number|expected_serial|card_number|serial/,
    "verifier-only expected values must not enter the materialized manifest");
  assert.equal((await stat(outDir)).mode & 0o777, 0o700,
    "a pre-existing broad output directory must be tightened");
  for (const entry of result.cases) {
    assert.deepEqual(entry.files.map((file) => file.role), ["front_original", "back_original"]);
    assert.equal((await stat(path.dirname(entry.files[0].path))).mode & 0o777, 0o700);
    for (const file of entry.files) {
      assert.deepEqual(await readFile(file.path), jpeg);
      assert.equal((await stat(file.path)).mode & 0o777, 0o600);
      assert.equal(file.content_sha256, sha256);
    }
  }
  assert.equal(calls.length, 8);
  assert.match(calls[0].url, /verified\/standard\/1\.jpg$/);
  assert.equal(calls[0].init.headers.apikey, "sb_secret_service-test");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.redirect, "error",
    "a Storage redirect must not receive the server-only apikey");
  assert.equal(calls[1].init.redirect, "error",
    "a signed download redirect must not escape the exact Storage object");
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_service-test/);

  const activationCases = WRITER_JOURNEY_ACTIVATION_SOURCE_CONTRACTS.map((contract) => ({
    ...contract,
    images: ["front", "back"].map((side) => ({
      bucket: "listing-feedback-images",
      object_path: `feedback/activation/${contract.case_id.toLowerCase()}/${side}.jpg`,
      image_id: `${contract.source_feedback_id}_${side}`,
      role: `${side}_original`,
      content_sha256: sha256
    }))
  })).map((contract) => ({
    ...contract,
    image_sha256: Object.fromEntries(contract.images.map((image) => [
      image.image_id, sha256
    ])),
    // The real digest is separately frozen above. The test double needs a
    // content-addressed digest for its deliberately identical JPEG bytes.
    original_set_sha256: null
  }));
  // A valid activation source requires distinct exact bytes. Verify that a
  // caller cannot swap in an arbitrary pair even when every other field looks
  // correct; the default live path is covered by the frozen contract assertions.
  await assert.rejects(runAttempt({
    outDir: await freshOutDir("invalid-activation"),
    parityCase: {
      ...WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT,
      images: WRITER_JOURNEY_EXACT_PARITY_SOURCE_CONTRACT.images.map((image, index) => ({
        ...image,
        bucket: "listing-card-images",
        object_path: `verified/parity/${index + 1}.jpg`,
        object_verified: true,
        content_hash_verified: true
      }))
    },
    activationCases
  }), /writer_journey_activation_source_invalid/);

  await assert.rejects(
    runAttempt({
      env: { SUPABASE_URL: "https://wrong.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "x" },
    }),
    /SUPABASE_URL_not_production/
  );
  await assert.rejects(
    runAttempt({
      env: { SUPABASE_URL: productionUrl },
    }),
    /SUPABASE_SERVICE_ROLE_KEY_required/
  );
  await assert.rejects(
    runAttempt({
      cases: [{ ...cases[0], evaluation_cohort: "EBAY_COLD_START" }, cases[1]],
    }),
    /writer_journey_source_record_invalid/
  );
  await assert.rejects(
    runAttempt({
      cases: [{ ...cases[0], images: [cases[0].images[1], cases[0].images[0]] }, cases[1]],
    }),
    /writer_journey_source_record_invalid/,
    "front/back order is part of the fixed live case identity"
  );
  await assert.rejects(
    runAttempt({
      cases: [{ ...cases[0], images: [cases[0].images[0], cases[0].images[0]] }, cases[1]],
    }),
    /writer_journey_source_record_invalid/,
    "duplicate roles must not manufacture a two-view case"
  );
  await assert.rejects(
    runAttempt({
      standardCase: {
        ...verifiedStandardCase,
        images: [
          { ...verifiedStandardCase.images[0], object_path: "../escape.jpg" },
          verifiedStandardCase.images[1]
        ]
      },
    }),
    /storage_object_path_invalid/
  );
  const existingCaseOutDir = await freshOutDir("existing-case");
  await mkdir(path.join(existingCaseOutDir, "non-tcg"), { mode: 0o755 });
  await assert.rejects(
    runAttempt({ outDir: existingCaseOutDir }),
    /writer_journey_source_case_directory_exists/,
    "case directories must be newly created so stale files cannot be reused"
  );

  const existingFileOutDir = await freshOutDir("existing-file");
  const existingFilePath = path.join(existingFileOutDir, "non-tcg", "1-front_original.jpg");
  const existingBytes = Buffer.from("do-not-overwrite", "utf8");
  let existingFilePlanted = false;
  await assert.rejects(
    runAttempt({
      outDir: existingFileOutDir,
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") {
          return new Response(JSON.stringify({
            signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (!existingFilePlanted) {
          await writeFile(existingFilePath, existingBytes, { mode: 0o644 });
          await chmod(existingFilePath, 0o644);
          existingFilePlanted = true;
        }
        return new Response(jpeg, { status: 200 });
      }
    }),
    /writer_journey_source_file_exists/,
    "an existing 0644 fixture must fail rather than be overwritten or repaired"
  );
  assert.deepEqual(await readFile(existingFilePath), existingBytes);
  assert.equal((await stat(existingFilePath)).mode & 0o777, 0o644);

  const symlinkOutDir = await freshOutDir("existing-symlink");
  const symlinkPath = path.join(symlinkOutDir, "non-tcg", "1-front_original.jpg");
  const sentinelPath = path.join(sandboxDir, "symlink-sentinel.txt");
  const sentinelBytes = Buffer.from("sentinel-must-remain-unchanged", "utf8");
  await writeFile(sentinelPath, sentinelBytes, { mode: 0o600 });
  let symlinkPlanted = false;
  await assert.rejects(
    runAttempt({
      outDir: symlinkOutDir,
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") {
          return new Response(JSON.stringify({
            signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (!symlinkPlanted) {
          await symlink(sentinelPath, symlinkPath);
          symlinkPlanted = true;
        }
        return new Response(jpeg, { status: 200 });
      }
    }),
    /writer_journey_source_file_exists/,
    "exclusive creation must reject a symlink planted at the destination"
  );
  assert.deepEqual(await readFile(sentinelPath), sentinelBytes);

  await assert.rejects(
    runAttempt({
      fetchImpl: async () => new Response(JSON.stringify({
        signedURL: "https://attacker.example/object/sign/file?token=x"
      }), { status: 200, headers: { "content-type": "application/json" } })
    }),
    /writer_journey_signing_response_invalid/
  );
  await assert.rejects(
    runAttempt({
      fetchImpl: async (url) => new Response(JSON.stringify({
        signedURL: new URL(String(url)).pathname.replace("/storage/v1", "")
      }), { status: 200, headers: { "content-type": "application/json" } })
    }),
    /writer_journey_signing_response_invalid/,
    "the exact Storage object path is not usable without a signed token"
  );
  await assert.rejects(
    runAttempt({
      fetchImpl: async (url) => ({
        ok: true,
        redirected: true,
        json: async () => ({
          signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
        })
      })
    }),
    /writer_journey_source_signing_failed/,
    "an injected transport must not hide a followed signing redirect"
  );
  await assert.rejects(
    runAttempt({
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") {
          return new Response(JSON.stringify({
            signedURL: "/object/sign/listing-feedback-images/feedback/wrong-object.jpg?token=test"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(jpeg, { status: 200 });
      }
    }),
    /writer_journey_signing_response_invalid/,
    "same-origin signed URLs must still bind the exact bucket and object path"
  );
  await assert.rejects(
    runAttempt({
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") {
          return new Response(JSON.stringify({
            signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        assert.equal(init.redirect, "error");
        return new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/redirected-object.jpg" }
        });
      }
    }),
    /writer_journey_source_download_failed/,
    "redirect responses must fail closed without following Location"
  );
  await assert.rejects(
    runAttempt({
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") {
          return new Response(JSON.stringify({
            signedURL: new URL(String(url)).pathname.replace("/storage/v1", "") + "?token=test"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return { ok: true, redirected: true };
      }
    }),
    /writer_journey_source_download_failed/,
    "an injected transport must not hide a followed download redirect"
  );
  await assert.rejects(
    runAttempt({
      cases: [{
        ...cases[0],
        images: [
          { ...cases[0].images[0], content_sha256: "0".repeat(64) },
          cases[0].images[1]
        ]
      }, cases[1]],
      standardCase: {
        ...verifiedStandardCase,
        images: [
          { ...verifiedStandardCase.images[0], content_sha256: "0".repeat(64) },
          verifiedStandardCase.images[1]
        ]
      },
    }),
    /writer_journey_source_hash_mismatch/
  );
} finally {
  await rm(sandboxDir, { recursive: true, force: true });
}

console.log("writer journey source materialization tests passed");
