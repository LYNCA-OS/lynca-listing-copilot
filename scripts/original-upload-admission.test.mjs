import assert from "node:assert/strict";

function element() {
  return {
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {},
    querySelector() { return element(); }, querySelectorAll() { return []; },
    getClientRects() { return []; }, classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, style: {}, textContent: "", innerHTML: "", disabled: false
  };
}
globalThis.document = {
  body: element(), documentElement: element(), activeElement: null,
  createElement: element, querySelector: element, querySelectorAll: () => [], addEventListener() {}
};
globalThis.window = { addEventListener() {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const { __listingCopilotAppTestHooks } = await import("../app/listing-copilot.js");
const gates = [deferred(), deferred(), deferred()];
const starts = [];
const jobs = gates.map((gate, index) => __listingCopilotAppTestHooks.withOriginalUploadAdmission(async () => {
  starts.push(index + 1);
  await gate.promise;
  return index + 1;
}));

await Promise.resolve();
await Promise.resolve();
assert.deepEqual(starts, [1], "one writer uplink must admit one original-bearing asset at a time");
gates[0].resolve();
assert.equal(await jobs[0], 1);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(starts, [1, 2]);
gates[1].resolve();
assert.equal(await jobs[1], 2);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(starts, [1, 2, 3]);
gates[2].resolve();
assert.equal(await jobs[2], 3);

console.log("original upload admission tests passed");
