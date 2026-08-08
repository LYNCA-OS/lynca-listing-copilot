import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  materializeWriterJourneySource,
  WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT
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
const source = {
  source_feedback_id: "safe-source",
  evaluation_cohort: "INTERNAL_REVIEWED_GT",
  images: [{
    bucket: "listing-feedback-images",
    object_path: "feedback/safe source/front.jpg",
    role: "front_original",
    content_sha256: createHash("sha256").update(jpeg).digest("hex")
  }]
};
const outDir = await mkdtemp(path.join(os.tmpdir(), "writer-journey-source-"));

try {
  assert.deepEqual(WRITER_JOURNEY_INTERNAL_SOURCE_CONTRACT, {
    source_feedback_id: "007edfc1-e52d-4a9e-ab8f-3955e6500620",
    evaluation_cohort: "INTERNAL_REVIEWED_GT",
    image_sha256: {
      "007edfc1-e52d-4a9e-ab8f-3955e6500620_front":
        "16f731783a954b79d696ff2343c25e996692c0f845fc2bb01ed483ab7a74774b",
      "007edfc1-e52d-4a9e-ab8f-3955e6500620_back":
        "b3edee5956060acde3946cc5c4fcf29a0981d582e5d547b69290ce53f2f3cdc1"
    }
  });
  const result = await materializeWriterJourneySource({
    env: { SUPABASE_URL: productionUrl, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_service-test" },
    outDir,
    source,
    fetchImpl
  });
  assert.equal(result.schema_version, "writer-journey-source-v1");
  assert.equal(result.image_count, 1);
  assert.deepEqual(await readFile(result.files[0].path), jpeg);
  assert.equal((await stat(result.files[0].path)).mode & 0o777, 0o600);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /safe%20source\/front\.jpg$/);
  assert.equal(calls[0].init.headers.apikey, "sb_secret_service-test");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.redirect, "error",
    "a Storage redirect must not receive the server-only apikey");
  assert.doesNotMatch(JSON.stringify(result), /sb_secret_service-test/);

  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: "https://wrong.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "x" },
      outDir,
      source,
      fetchImpl
    }),
    /SUPABASE_URL_not_production/
  );
  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: productionUrl },
      outDir,
      source,
      fetchImpl
    }),
    /SUPABASE_SERVICE_ROLE_KEY_required/
  );
  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: productionUrl, SUPABASE_SERVICE_ROLE_KEY: "x" },
      outDir,
      source: { ...source, evaluation_cohort: "EBAY_COLD_START" },
      fetchImpl
    }),
    /writer_journey_source_record_invalid/
  );
  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: productionUrl, SUPABASE_SERVICE_ROLE_KEY: "x" },
      outDir,
      source: { ...source, images: [{ ...source.images[0], object_path: "../escape.jpg" }] },
      fetchImpl
    }),
    /storage_object_path_invalid/
  );
  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: productionUrl, SUPABASE_SERVICE_ROLE_KEY: "x" },
      outDir,
      source,
      fetchImpl: async () => new Response(JSON.stringify({
        signedURL: "https://attacker.example/object/sign/file?token=x"
      }), { status: 200, headers: { "content-type": "application/json" } })
    }),
    /writer_journey_signing_response_invalid/
  );
  await assert.rejects(
    materializeWriterJourneySource({
      env: { SUPABASE_URL: productionUrl, SUPABASE_SERVICE_ROLE_KEY: "x" },
      outDir,
      source: {
        ...source,
        images: [{ ...source.images[0], content_sha256: "0".repeat(64) }]
      },
      fetchImpl
    }),
    /writer_journey_source_hash_mismatch/
  );
} finally {
  await rm(outDir, { recursive: true, force: true });
}

console.log("writer journey source materialization tests passed");
