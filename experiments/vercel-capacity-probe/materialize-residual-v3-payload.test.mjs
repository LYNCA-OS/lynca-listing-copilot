import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main as buildManifestFile } from "./build-residual-v3-assets-only-manifest.mjs";
import { buildAssetsOnlyManifestFromDataset, signAssetsOnlyManifest }
  from "./materialize-residual-v3-payload.mjs";
import { imageSetFingerprint } from "../../scripts/run-thin-path-eval.mjs";

const items = Array.from({ length: 35 }, (_, index) => ({
  asset_id: `synthetic-${String(index + 1).padStart(2, "0")}`,
  images: [
    { bucket: "listing-feedback-images", object_path: `synthetic/${index}/front.jpg`, role: "front_original" },
    { bucket: "listing-feedback-images", object_path: `synthetic/${index}/back.jpg`, role: "back_original" }
  ],
  canonical_title: "must not project",
  sealed_eval_label_ref: { path: "must-not-project", key: `label-${index}` }
}));
const dataset = { schema_version: "synthetic-image-only-v1", items };
const prereg = { cohort: items.map((item) => ({ asset_id: item.asset_id,
  image_set_sha256: imageSetFingerprint(item), order: ["control_a", "control_b", "residual_c"] })) };
const manifest = buildAssetsOnlyManifestFromDataset({ dataset, prereg });
assert.equal(manifest.assets.length, 35);
assert.equal(/reviewed_title|sealed_eval_label_ref|canonical_title/.test(JSON.stringify(manifest)), false);

let signCalls = 0;
const signer = async () => { signCalls += 1; throw new Error("must_not_sign_invalid_pairing"); };
const swappedPaths = structuredClone(manifest);
[swappedPaths.assets[0].images[0].object_path, swappedPaths.assets[1].images[0].object_path]
  = [swappedPaths.assets[1].images[0].object_path, swappedPaths.assets[0].images[0].object_path];
await assert.rejects(() => signAssetsOnlyManifest(swappedPaths,
  { serviceKey: "test", fetchImpl: signer }), /image_pairing_mismatch/);
assert.equal(signCalls, 0);

const swappedRoles = structuredClone(manifest);
[swappedRoles.assets[0].images[0].role, swappedRoles.assets[0].images[1].role]
  = [swappedRoles.assets[0].images[1].role, swappedRoles.assets[0].images[0].role];
await assert.rejects(() => signAssetsOnlyManifest(swappedRoles,
  { serviceKey: "test", fetchImpl: signer }), /image_pairing_mismatch/);
assert.equal(signCalls, 0);

const swappedOrder = structuredClone(manifest);
swappedOrder.assets[0].images.reverse();
await assert.rejects(() => signAssetsOnlyManifest(swappedOrder,
  { serviceKey: "test", fetchImpl: signer }), /image_pairing_mismatch/);
assert.equal(signCalls, 0);

const directory = await mkdtemp(join(tmpdir(), "v3-assets-only-builder-"));
const datasetPath = join(directory, "dataset.json");
const preregPath = join(directory, "prereg.json");
const outPath = join(directory, "assets-only.json");
await Promise.all([writeFile(datasetPath, JSON.stringify(dataset)), writeFile(preregPath, JSON.stringify(prereg))]);
const written = await buildManifestFile(["--dataset", datasetPath, "--prereg", preregPath,
  "--out", outPath]);
assert.deepEqual(written, manifest);
assert.equal((await stat(outPath)).mode & 0o777, 0o600);
assert.deepEqual(JSON.parse(await readFile(outPath)), manifest);
console.log("cloud residual v3 assets-only materializer tests passed");
