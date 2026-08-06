import assert from "node:assert/strict";
import { replayCandidateIdentityV2 } from "../lib/listing/thin/candidate-identity-replay-v2.mjs";

const empty = { manufacturer: "Topps", product: "Chrome", set: "", card_name: "", subjects: ["LeBron James"] };
const fact = (value, kind = "identity") => ({
  value, kind, basis: "logo_or_symbol", image: "image_1", region: "card_front", uncertainty: "none"
});

assert.equal(replayCandidateIdentityV2(empty, [fact("Disney")]).fields.set, "Disney");
assert.equal(replayCandidateIdentityV2(empty, [fact("VeeFriends")]).fields.set, "VeeFriends");
assert.equal(replayCandidateIdentityV2(empty, [fact("Disney", "affiliation")]).fields.set, "Disney");
assert.equal(replayCandidateIdentityV2(empty, [fact("VeeFriends", "affiliation")]).fields.set, "VeeFriends");
assert.equal(replayCandidateIdentityV2(empty, [fact("Chrome")]).changes.length, 0);
assert.equal(replayCandidateIdentityV2({ ...empty, product: "Donruss Optic" }, [fact("Optic O")]).changes.length, 0);
assert.equal(replayCandidateIdentityV2(empty, [fact("Golden State Warriors", "affiliation")]).changes.length, 0);
assert.equal(replayCandidateIdentityV2(empty, [fact("Beckett", "affiliation")]).changes.length, 0);
assert.equal(replayCandidateIdentityV2(empty, [
  { ...fact("Disney"), basis: "model_knowledge", image: "none", region: "unknown" }
]).changes.length, 0);

console.log("candidate identity replay v2: ok");
