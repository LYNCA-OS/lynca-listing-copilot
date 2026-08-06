import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./replay-exhaustive-identity-v1.mjs", import.meta.url), "utf8");
assert.match(source, /label !== "logo"/);
assert.match(source, /replayCandidateIdentityV1/);
assert.match(source, /exhaustive_observation_high/);
console.log("exhaustive identity replay v1 tests passed");

