import assert from "node:assert/strict";
import {
  recognitionDerivedInputUseful,
  recognitionDerivedLaneEligible,
  validOriginalFingerprintList
} from "../app/recognition-derived-contract.mjs";

assert.equal(recognitionDerivedInputUseful({
  sourceBytes: 7_000_000, sourceWidth: 3_000, sourceHeight: 4_000, derivedBytes: 480_000
}), true);
assert.equal(recognitionDerivedInputUseful({
  sourceBytes: 240_000, sourceWidth: 1_050, sourceHeight: 1_400, derivedBytes: 180_000
}), false, "already-bounded images must not be recompressed");
assert.equal(recognitionDerivedInputUseful({
  sourceBytes: 240_000, sourceWidth: 3_000, sourceHeight: 4_000, derivedBytes: 480_000
}), false, "a larger re-encode is a negative asset");

assert.equal(recognitionDerivedLaneEligible({
  originalCount: 2, inputs: [{ size: 480_000 }, { size: 510_000 }]
}), true);
assert.equal(recognitionDerivedLaneEligible({
  originalCount: 2, inputs: [{ size: 480_000 }]
}), false);
assert.equal(recognitionDerivedLaneEligible({
  originalCount: 2, inputs: [{ size: 1_700_000 }, { size: 1_600_001 }]
}), false);

const fingerprints = [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`];
assert.equal(validOriginalFingerprintList(fingerprints, 2), true);
assert.equal(validOriginalFingerprintList(fingerprints.slice(0, 1), 2), false);
assert.equal(validOriginalFingerprintList([`sha256:${"A".repeat(64)}`], 1), false);

console.log("recognition derived contract tests passed");
