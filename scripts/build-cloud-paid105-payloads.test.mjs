import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCloudPaid105Payloads } from "./build-cloud-paid105-payloads.mjs";

const directory = await mkdtemp(join(tmpdir(), "lynca-cloud-payload-test-"));
const datasetPath = join(directory, "dataset.json");
const assetIdsPath = join(directory, "ids.json");
const items = [1, 2].map((number) => ({
  asset_id: `asset-${number}`,
  images: [
    { bucket: "bucket", object_path: `${number}/front.jpg`, role: "front_original" },
    ...(number === 1 ? [] : [
      { bucket: "bucket", object_path: `${number}/back.jpg`, role: "back_original" }
    ])
  ]
}));
await Promise.all([
  writeFile(datasetPath, JSON.stringify({ items })),
  writeFile(assetIdsPath, JSON.stringify(items.map((item) => item.asset_id)))
]);

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 7200 })}.sig`;
let signingCalls = 0;
let headCalls = 0;
// The builder carries PREREGISTERED request-template fingerprints for the
// paid105 cohort, pinned on 2026-08-02. The canonical prompt and schema have
// changed legitimately since -- CSM alignment, and the schema that now actually
// reaches the provider -- so the template no longer matches, and the builder
// refuses.
//
// That refusal is the guard WORKING. Re-pinning the fingerprints would falsify
// the record: the payloads would no longer be the ones that cohort was
// registered with, and a replay would compare against a request nobody sent.
// So the assertion moved to the refusal, and the pinned values stay as the
// record of what paid105 actually carried.
//
// If the cohort is ever rebuilt deliberately, that is a NEW preregistration
// with new fingerprints and a new cohort id -- not an edit to this one.
const build = () => buildCloudPaid105Payloads({
  datasetPath,
  assetIdsPath,
  outDirectory: join(directory, "out"),
  expectedCards: 2,
  serviceKey: "test-service-key",
  fetchImpl: async (url, options) => {
    if (options?.method === "POST") {
      signingCalls += 1;
      const object = String(url).split("/object/sign/")[1];
      return new Response(JSON.stringify({ signedURL: `/object/sign/${object}?token=${token}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (options?.method === "HEAD") {
      headCalls += 1;
      return new Response(null, { status: 200 });
    }
    throw new Error("unexpected_fetch");
  }
});
await assert.rejects(build, /request_template_not_preregistered/,
  "a drifted request template must refuse rather than silently rebuild the cohort");

// Recorded rather than asserted as correct: the template check runs AFTER the
// URLs are signed, so a refused build has already done that work. Nothing is
// written -- the throw precedes the manifest -- but signing first means a
// refusal still spends signing calls. Worth moving ahead of the work it
// guards; not worth changing under a test repair.
assert.ok(signingCalls > 0, "signing currently precedes the preregistration check");

process.stdout.write("cloud paid105 payload builder: ok\n");
