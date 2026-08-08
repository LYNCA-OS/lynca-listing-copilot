import assert from "node:assert/strict";
import { storageVerificationTimeoutMs } from "../app/storage-verification-budget.mjs";

assert.equal(storageVerificationTimeoutMs([]), 3_500);
assert.equal(storageVerificationTimeoutMs([3_200_000]), 3_500);
assert.equal(storageVerificationTimeoutMs([3_200_001]), 4_500);
assert.equal(storageVerificationTimeoutMs([11_516_252, 12_176_889]), 12_500);
assert.equal(storageVerificationTimeoutMs([25_000_000]), 18_000);
assert.equal(storageVerificationTimeoutMs([Number.NaN, -1]), 3_500);

console.log("storage verification budget tests passed");

