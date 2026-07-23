import assert from "node:assert/strict";
import {
  planSmokeWaves,
  runSmokeWaves,
  waveBatchId,
  waveOutputPath
} from "./run-v4-ebay-smoke-waves.mjs";

assert.deepEqual(planSmokeWaves({ offset: 5, limit: 23, waveSize: 10 }), [
  { index: 1, offset: 5, limit: 10 },
  { index: 2, offset: 15, limit: 10 },
  { index: 3, offset: 25, limit: 3 }
]);
assert.equal(planSmokeWaves({ limit: 20, waveSize: 50 })[0].limit, 10, "wave size must remain bounded by the shared backend budget");
assert.match(waveOutputPath("report.json", 2), /report\.wave-002\.json$/);
assert.equal(waveBatchId("batch", 3), "batch-w003");

const written = new Map();
const calls = [];
await runSmokeWaves([
  "node", "waves", "--dataset", "fixture.json", "--limit", "21", "--offset", "4",
  "--wave-size", "10", "--wave-settle-ms", "0", "--batch-id", "stable", "--out", "/tmp/waves.json"
], {}, {
  runWave: async (args) => {
    calls.push(args);
    const outIndex = args.indexOf("--out");
    const limitIndex = args.indexOf("--limit");
    const count = Number(args[limitIndex + 1]);
    written.set(args[outIndex + 1], {
      summary: { attempted_count: count, ok_count: count, title_ready_count: count }
    });
  },
  readJson: async (path) => written.get(path),
  writeJson: async (path, value) => written.set(path, value),
  sleep: async () => {}
});
assert.equal(calls.length, 3);
assert.deepEqual(calls.map((args) => args[args.indexOf("--offset") + 1]), ["4", "14", "24"]);
assert.deepEqual(calls.map((args) => args[args.indexOf("--limit") + 1]), ["10", "10", "1"]);
assert.deepEqual(calls.map((args) => args[args.indexOf("--batch-id") + 1]), ["stable-w001", "stable-w002", "stable-w003"]);

let failedCalls = 0;
await assert.rejects(() => runSmokeWaves([
  "node", "waves", "--dataset", "fixture.json", "--limit", "20", "--wave-settle-ms", "0", "--out", "/tmp/fail.json"
], {}, {
  runWave: async (args) => {
    failedCalls += 1;
    const outIndex = args.indexOf("--out");
    written.set(args[outIndex + 1], {
      summary: { attempted_count: 10, ok_count: 9, title_ready_count: 9 }
    });
  },
  readJson: async (path) => written.get(path),
  writeJson: async (path, value) => written.set(path, value),
  sleep: async () => {}
}), /wave_gate_failed/);
assert.equal(failedCalls, 1, "a failed wave must prevent later load from entering the shared backend");

console.log("run-v4-ebay-smoke-waves.test.mjs OK");
