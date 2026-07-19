import assert from "node:assert/strict";
import {
  compactV4L2RecognitionPrompt,
  fastInitialRecognitionPrompt
} from "../lib/listing/pipeline/provider-prompt.mjs";

const payload = {
  assetId: "sem_prompt_test",
  mode: "pair",
  images: [{ name: "front.jpg" }, { name: "back.jpg" }],
  provider_options: {
    v4_title_stage_target: "L2_ASSISTED_DRAFT",
    v4_compact_l2_prompt: true,
    v4_ultra_fast_l2: false,
    v4_ultra_sparse_transport: false
  }
};

const legacyPrompt = fastInitialRecognitionPrompt(payload, 80);
const semPrompt = compactV4L2RecognitionPrompt(payload, 80);

assert.ok(semPrompt.length < legacyPrompt.length * 0.4, "SEM-first prompt must remove at least 60% of the legacy prompt");
assert.match(semPrompt, /Linear SEM fields to observe/);
assert.match(semPrompt, /Base color is required when visible/);
assert.match(semPrompt, /Do not turn sparkle, shine, crystal/);
assert.match(semPrompt, /Lot: multiple separate physical cards/);
assert.match(semPrompt, /Numerical Rarity/);
assert.match(semPrompt, /prompt-safe catalog\/vector candidates may support a value only when visible anchors agree/);
assert.doesNotMatch(semPrompt, /L2 job: confirm, correct, and complete L1/);
assert.doesNotMatch(semPrompt, /This is mandatory for GPT-5-mini/);

console.log(JSON.stringify({
  legacy_chars: legacyPrompt.length,
  sem_first_chars: semPrompt.length,
  reduction_rate: Number((1 - semPrompt.length / legacyPrompt.length).toFixed(4))
}));
