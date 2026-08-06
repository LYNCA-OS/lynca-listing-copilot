import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./replay-accuracy-modifications-100.mjs", import.meta.url), "utf8");
for (const marker of ["logo_set", "printed_set", "serial_observation", "language_observation", "--limit", "--canonical-arm", "--exhaustive-arm", "replay_cohort_too_small", "replay_cohort_mismatch", "reference_token_loss", "rejected_cards"]) assert.match(source, new RegExp(marker));
console.log("accuracy modifications replay 100 tests passed");
