import assert from "node:assert/strict";
import {
  startNonBlockingDerivedUpload,
  summarizeDerivedUploadOutcomes
} from "../lib/listing/client/upload-phases.mjs";

let releaseDerived;
const derivedGate = new Promise((resolve) => {
  releaseDerived = resolve;
});
const calls = [];
let derivedFinished = false;
const phase = await startNonBlockingDerivedUpload({
  entries: [
    { id: "original-a", derived: false },
    { id: "crop-a", derived: true }
  ],
  isDerived: (entry) => entry.derived,
  uploadPhase: async (entries) => {
    calls.push(entries.map((entry) => entry.id));
    if (entries.some((entry) => entry.derived)) {
      await derivedGate;
      derivedFinished = true;
    }
    return entries.map((entry) => ({ ok: true, uploaded: true, entry }));
  }
});

assert.equal(derivedFinished, false, "derived completion must not delay the original barrier");
assert.equal(phase.originalOutcomes[0].uploaded, true);
releaseDerived();
const derivedOutcomes = await phase.derivedPromise;
assert.deepEqual(calls, [["original-a"], ["crop-a"]]);
assert.equal(derivedFinished, true);
assert.equal(summarizeDerivedUploadOutcomes(derivedOutcomes).status, "ready");

const partial = summarizeDerivedUploadOutcomes([
  { ok: true, uploaded: true },
  { ok: false, error: new Error("crop upload failed") }
]);
assert.equal(partial.status, "partial");
assert.equal(partial.failed, 1);

await assert.rejects(
  () => startNonBlockingDerivedUpload({
    entries: [{ id: "original-b", derived: false }],
    isDerived: (entry) => entry.derived,
    uploadPhase: async () => [{ ok: false, error: new Error("original upload failed") }]
  }),
  /original upload failed/,
  "an original failure must still fail closed"
);

console.log("client upload phase tests passed");
