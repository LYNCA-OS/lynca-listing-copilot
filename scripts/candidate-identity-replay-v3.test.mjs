import assert from "node:assert/strict";
import { replayCandidateIdentityV3 } from "../lib/listing/thin/candidate-identity-replay-v3.mjs";

const fields = { manufacturer: "Topps", product: "Topps Chrome", set: "", subjects: ["Holger Rune"] };
const fact = (value, region = "card_front") => ({
  value, kind: "affiliation", basis: "logo_or_symbol", image: "image_1", region, uncertainty: "none"
});

assert.equal(replayCandidateIdentityV3(fields, [fact("Disney")]).fields.set, "Disney");
assert.equal(replayCandidateIdentityV3(fields, [fact("VeeFriends")]).fields.set, "VeeFriends");
assert.equal(replayCandidateIdentityV3(fields, [fact("Star Wars.")]).fields.set, "Star Wars");
for (const value of ["PTPA", "MLB PLAYERS", "PLAYERS", "adidas", "Wilson", "bibigo", "Sports Collectors Digest", "PRIZM"]) {
  assert.equal(replayCandidateIdentityV3(fields, [fact(value)]).changes.length, 0, value);
}
for (const value of ["FC Barcelona", "Atlanta Hawks", "Boston Red Sox", "Minnesota Twins", "Miami Marlins"]) {
  assert.equal(replayCandidateIdentityV3(fields, [fact(value)]).changes.length, 0, value);
}
assert.equal(replayCandidateIdentityV3(fields, [fact("Sports Collectors Digest", "slab_label")]).changes.length, 0);

console.log("candidate identity replay v3: ok");
