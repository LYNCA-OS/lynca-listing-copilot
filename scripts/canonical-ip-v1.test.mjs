import assert from "node:assert/strict";
import {
  CANONICAL_IP_V1_PROMPT,
  CANONICAL_IP_V1_SCHEMA,
  buildCanonicalIpV1Request,
  finishCanonicalIpV1,
  parseCanonicalIpV1
} from "../lib/listing/thin/canonical-ip-v1.mjs";

assert.ok(CANONICAL_IP_V1_SCHEMA.properties.ip);
assert.ok(CANONICAL_IP_V1_SCHEMA.required.includes("ip"));
assert.match(CANONICAL_IP_V1_PROMPT, /printed game, franchise, or IP/i);
const request = buildCanonicalIpV1Request({ imageUrls: ["https://example.test/card.jpg"], model: "gpt-5.6-luna" });
assert.equal(request.text.format.name, "canonical_card_fields_ip_v1");
assert.equal(request.input[0].content[1].detail, "high");

const tcg = parseCanonicalIpV1({ grammar: "tcg", ip: "Disney", product: "Chrome", subjects: ["Elsa"] });
assert.equal(tcg.fields.ip, "Disney");
assert.equal(tcg.fields.grammar, "tcg");
assert.match(finishCanonicalIpV1({ grammar: "tcg", ip: "Disney", year: "2026", manufacturer: "Topps", product: "Chrome", subjects: ["Elsa"] }).title, /Disney/);

const sports = parseCanonicalIpV1({ grammar: "standard", ip: "NBA", product: "Prizm", subjects: ["LeBron James"] });
assert.equal(sports.fields.ip, "");
assert.ok(sports.defects.includes("ip_requires_tcg_grammar"));

console.log("canonical-ip-v1 tests passed");
