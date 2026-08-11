import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertLargeInternalFixturePosixRuntime,
  buildLargeInternalWriterFixture,
  LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT,
  LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT,
  prepareLargeInternalFixtureOutputDirectory,
  validateApprovedSourceManifest
} from "./build-large-internal-writer-fixture.mjs";
import { LISTING_IMAGE_RELAY_MAX_BYTES } from "../api/listing-image-upload-relay.js";

const materializer = await import("./materialize-writer-journey-source.mjs");
const materializerContracts = materializer.WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACTS;
const sourceId = LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.source_feedback_id;
const frontHash = LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.image_sha256[`${sourceId}_front`];
const backHash = LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.image_sha256[`${sourceId}_back`];
const approvedFiles = [
  {
    path: "/private/tmp/approved-front.jpg",
    role: "front_original",
    bytes: 101,
    content_type: "image/jpeg",
    content_sha256: frontHash
  },
  {
    path: "/private/tmp/approved-back.jpg",
    role: "back_original",
    bytes: 102,
    content_type: "image/jpeg",
    content_sha256: backHash
  }
];
const approvedCase = {
  case_id: "NON_TCG",
  expected_grammar: "NON_TCG",
  source_feedback_id: sourceId,
  evaluation_cohort: "INTERNAL_REVIEWED_GT",
  hash_provenance: LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.hash_provenance,
  image_count: 2,
  files: approvedFiles
};
const tcgContract = materializerContracts.find((contract) => contract?.case_id === "TCG");
const approvedTcgCase = {
  case_id: "TCG",
  expected_grammar: "TCG",
  source_feedback_id: tcgContract.source_feedback_id,
  evaluation_cohort: tcgContract.evaluation_cohort,
  hash_provenance: tcgContract.hash_provenance,
  image_count: 2,
  files: ["front", "back"].map((side, index) => ({
    path: `/private/tmp/approved-tcg-${side}.jpg`,
    role: `${side}_original`,
    bytes: 201 + index,
    content_type: "image/jpeg",
    content_sha256: tcgContract.image_sha256[`${tcgContract.source_feedback_id}_${side}`]
  }))
};
const approvedCasesManifest = {
  schema_version: "writer-journey-cases-v2",
  evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
  accuracy_claim: null,
  cases: [
    approvedTcgCase,
    approvedCase
  ]
};

assert.deepEqual(LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT, {
  case_id: "NON_TCG",
  expected_grammar: "NON_TCG",
  source_feedback_id: "007edfc1-e52d-4a9e-ab8f-3955e6500620",
  evaluation_cohort: "INTERNAL_REVIEWED_GT",
  hash_provenance: "2026-08-08_DIRECT_EXACT_PATH_BYTE_ACQUISITION",
  content_type: "image/jpeg",
  image_sha256: {
    "007edfc1-e52d-4a9e-ab8f-3955e6500620_front": frontHash,
    "007edfc1-e52d-4a9e-ab8f-3955e6500620_back": backHash
  }
});
const matchingMaterializerContract = materializerContracts.find((contract) => (
  contract?.case_id === "NON_TCG"
));
assert.equal(matchingMaterializerContract?.source_feedback_id, sourceId);
assert.equal(matchingMaterializerContract?.evaluation_cohort, "INTERNAL_REVIEWED_GT");
assert.deepEqual(matchingMaterializerContract?.image_sha256,
  LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.image_sha256);
assert.equal(matchingMaterializerContract.hash_provenance,
  LARGE_INTERNAL_WRITER_FIXTURE_SOURCE_CONTRACT.hash_provenance);

assert.deepEqual(LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT, {
  schema_version: "large-internal-writer-fixture-receipt-v1",
  builder_id: "large-internal-writer-fixture-builder",
  builder_version: "1.1.0",
  source_class: "LYNCA_INTERNAL_SYNTHETIC_TEST",
  allowed_use: "PRODUCTION_RELEASE_TRANSPORT_ONLY",
  forbidden_uses: [
    "ACCURACY_BENCHMARK",
    "GROUND_TRUTH",
    "TRAINING",
    "SHARED_KNOWLEDGE",
    "PRODUCTION_PROMOTION"
  ],
  seed: 0x4c594e43,
  output_width: 3000,
  output_height: 4200,
  original_jpeg_quality: 0.8,
  semantic_panel: { x: 240, y: 280, width: 2520, height: 3640, padding: 48 },
  staged_lane_version: "readability-derived-inline-v2",
  staged_long_edge: 1600,
  staged_jpeg_quality: 0.8,
  original_total_min_bytes_exclusive: 3_200_000,
  original_each_max_bytes: 25 * 1024 * 1024,
  original_each_relay_max_bytes: 3_200_000,
  derived_total_max_bytes: 3_200_000,
  playwright_version: "1.61.1"
});
assert.equal(
  LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.original_each_relay_max_bytes,
  LISTING_IMAGE_RELAY_MAX_BYTES,
  "the transport fixture must use the same per-request relay ceiling as Production"
);

const normalized = validateApprovedSourceManifest(approvedCasesManifest);
assert.equal(approvedCasesManifest.cases[0].case_id, "TCG");
assert.deepEqual(validateApprovedSourceManifest(approvedCasesManifest), normalized,
  "the v2 manifest must select NON_TCG by case identity, not array position");
assert.deepEqual(normalized.map(({ image_id, side, role, content_sha256 }) => ({
  image_id, side, role, content_sha256
})), [
  {
    image_id: `${sourceId}_front`,
    side: "front",
    role: "front_original",
    content_sha256: frontHash
  },
  {
    image_id: `${sourceId}_back`,
    side: "back",
    role: "back_original",
    content_sha256: backHash
  }
]);

for (const invalid of [
  { ...approvedCasesManifest, title: "must-not-enter-execution" },
  { ...approvedCasesManifest, schema_version: "writer-journey-source-v1" },
  { ...approvedCasesManifest, evidence_scope: "MODEL_EVALUATION" },
  { ...approvedCasesManifest, accuracy_claim: { score: 1 } },
  { ...approvedCasesManifest, cases: [approvedCasesManifest.cases[0]] },
  { ...approvedCasesManifest, cases: [{ ...approvedCase, source_feedback_id: "another-source" }] },
  { ...approvedCasesManifest, cases: [{ ...approvedCase, evaluation_cohort: "EBAY_COLD_START" }] },
  { ...approvedCasesManifest, cases: [{ ...approvedCase, image_count: 1 }] },
  { ...approvedCasesManifest, cases: [{ ...approvedCase, files: approvedFiles.slice(0, 1) }] },
  {
    ...approvedCasesManifest,
    cases: [approvedCasesManifest.cases[0], { ...approvedCase, expected_grammar: "TCG" }]
  },
  {
    ...approvedCasesManifest,
    cases: [{ ...approvedTcgCase, ground_truth: "must-not-enter-execution" }, approvedCase]
  },
  {
    ...approvedCasesManifest,
    cases: [approvedTcgCase, {
      ...approvedCase,
      files: [{ ...approvedFiles[0], writer_title: "must-not-enter-execution" }, approvedFiles[1]]
    }]
  },
  {
    ...approvedCasesManifest,
    cases: [approvedCase, approvedCase]
  },
  {
    ...approvedCasesManifest,
    cases: [{ ...approvedCase, files: [{ ...approvedFiles[0], role: "back_original" }, approvedFiles[1]] }]
  },
  {
    ...approvedCasesManifest,
    cases: [{ ...approvedCase, files: [{ ...approvedFiles[0], content_sha256: "0".repeat(64) }, approvedFiles[1]] }]
  },
  {
    ...approvedCasesManifest,
    cases: [{ ...approvedCase, files: [{ ...approvedFiles[0], path: "relative/front.jpg" }, approvedFiles[1]] }]
  },
  {
    ...approvedCasesManifest,
    cases: [{ ...approvedCase, files: [{ ...approvedFiles[0], content_type: "image/png" }, approvedFiles[1]] }]
  }
]) {
  assert.throws(() => validateApprovedSourceManifest(invalid), /large_fixture_source_manifest_not_approved/);
}

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.devDependencies["@playwright/test"], LARGE_INTERNAL_WRITER_FIXTURE_CONTRACT.playwright_version);

const source = await readFile(new URL("./build-large-internal-writer-fixture.mjs", import.meta.url), "utf8");
const receiptBuilderSource = source.match(
  /async function buildReceipt[\s\S]+?(?=\nexport async function prepareLargeInternalFixtureOutputDirectory)/
)?.[0] || "";
assert.ok(receiptBuilderSource);
assert.doesNotMatch(receiptBuilderSource,
  /expected_grammar|case_id|source_labels_copied|accuracy_claim|writer_(?:raw_|final_)?title/,
  "the transport receipt must not copy grammar, title, label, or accuracy-claim fields");
assert.doesNotMatch(source, /tenant_staging_cos51|tenant_legacy/);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.match(source, /provider_calls:\s*0/);
assert.match(source, /determinism_scope:\s*"EXECUTOR_BOUND"/);
assert.match(source, /cross_browser_byte_stability_claimed:\s*false/);
assert.match(source, /network_boundary:\s*"PAGE_AND_APP_REQUESTS_BLOCKED_OUTER_SANDBOX_REQUIRED"/);
assert.match(source, /context\.route\(\/\^\(\?:https\?\|wss\?\):\/i/);
assert.match(source, /handle = await open\(filePath, "wx", 0o600\)/);
assert.match(source, /await handle\.writeFile\(bytes\);[\s\S]*?await handle\.sync\(\);[\s\S]*?await handle\.chmod\(0o600\);[\s\S]*?openedInfo = await handle\.stat\(\);[\s\S]*?await handle\.close\(\);/);
assert.doesNotMatch(source, /chmod\(filePath/,
  "file permissions must be set through the still-open file descriptor");
assert.match(source, /large_fixture_output_permissions_invalid/);
assert.match(source, /mkdir\(directory, \{ recursive: false, mode: 0o700 \}\)/);
assert.match(source, /large_fixture_out_dir_exists/);
assert.match(source, /Strict process-level[\s\S]*outer sandbox/);
assert.match(source, /assertLargeInternalFixturePosixRuntime\(\);[\s\S]*?loadPlaywright\(\)/,
  "POSIX support must fail closed before Playwright loads");
assert.doesNotMatch(source, /--seed|--chromium-executable/,
  "the operational CLI must not expose algorithm or executor mutation flags");

for (const runtime of [
  { platform: "win32", getuid: () => 1000 },
  { platform: "freebsd", getuid: () => 1000 },
  { platform: "linux", getuid: null }
]) {
  assert.throws(
    () => assertLargeInternalFixturePosixRuntime(runtime),
    /large_fixture_posix_required/
  );
}

await assert.rejects(
  buildLargeInternalWriterFixture({
    sourceManifestPath: "relative/source.json",
    outDir: path.join(os.tmpdir(), "large-fixture-should-not-exist")
  }),
  /large_fixture_source_manifest_path_invalid/
);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "large-fixture-contract-"));
try {
  const secureParent = path.join(tempDir, "secure-parent");
  await mkdir(secureParent, { mode: 0o700 });
  const createdDirectory = await prepareLargeInternalFixtureOutputDirectory(
    path.join(secureParent, "fresh-output")
  );
  const createdInfo = await lstat(createdDirectory);
  assert.equal(createdInfo.isSymbolicLink(), false);
  assert.equal(createdInfo.mode & 0o777, 0o700);
  await assert.rejects(
    prepareLargeInternalFixtureOutputDirectory(createdDirectory),
    /large_fixture_out_dir_exists/,
    "a pre-existing target must never be reused"
  );

  const permissiveParent = path.join(tempDir, "permissive-parent");
  await mkdir(permissiveParent, { mode: 0o700 });
  await chmod(permissiveParent, 0o777);
  await assert.rejects(
    prepareLargeInternalFixtureOutputDirectory(path.join(permissiveParent, "output")),
    /large_fixture_out_parent_permissions_invalid/,
    "a group/world-accessible parent must fail before rendering"
  );

  const symlinkParent = path.join(tempDir, "symlink-parent");
  await symlink(secureParent, symlinkParent);
  await assert.rejects(
    prepareLargeInternalFixtureOutputDirectory(path.join(symlinkParent, "output")),
    /large_fixture_out_parent_invalid/,
    "a symlink parent must fail before rendering"
  );

  const frontPath = path.join(tempDir, "front.jpg");
  const backPath = path.join(tempDir, "back.jpg");
  const manifestPath = path.join(tempDir, "source.json");
  const front = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const back = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00]);
  await writeFile(frontPath, front);
  await writeFile(backPath, back);
  await writeFile(manifestPath, JSON.stringify({
    ...approvedCasesManifest,
    cases: [approvedTcgCase, {
      ...approvedCase,
      files: [
        { ...approvedFiles[0], path: frontPath, bytes: front.length },
        { ...approvedFiles[1], path: backPath, bytes: back.length }
      ]
    }]
  }));
  await assert.rejects(
    buildLargeInternalWriterFixture({
      sourceManifestPath: manifestPath,
      outDir: path.join(tempDir, "out")
    }),
    /large_fixture_source_file_hash_mismatch/,
    "unapproved local bytes must fail before Chromium is loaded or output is created"
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("large internal Writer fixture contract tests passed");
