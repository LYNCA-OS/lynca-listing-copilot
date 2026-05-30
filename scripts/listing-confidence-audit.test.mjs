import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_LISTING_MODEL = "test-model";

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callApi(openAiResult) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(openAiResult) })
  });

  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  const promise = handler(req, res);
  req.emit("data", JSON.stringify({
    assetId: "asset-test",
    mode: "single",
    images: [{ name: "card.webp", dataUrl: "data:image/webp;base64,AAAA" }],
    resolutionMap: {},
    maxTitleLength: 80
  }));
  req.emit("end");
  await promise;

  return JSON.parse(res.body);
}

const serialVisibleUncertainParallel = await callApi({
  title: "2025 Topps Chrome Quinshon Judkins RC Purple 130/175",
  confidence: "HIGH",
  reason: "Serial visible and preserved; exact parallel requires operator review from visual foil.",
  fields: {
    year: "2025",
    brand: "Topps Chrome",
    player: "Quinshon Judkins",
    subset: "RC",
    parallel: "Purple Wave Refractor",
    serial_number: "130/175"
  },
  unresolved: ["exact parallel requires operator review"]
});

assert.equal(serialVisibleUncertainParallel.confidence, "MEDIUM");
assert.match(serialVisibleUncertainParallel.title, /130\/175/);

const backgroundIgnored = await callApi({
  title: "Metaverse Cards 2024 Topps Chrome Shohei Ohtani",
  confidence: "HIGH",
  reason: "Metaverse Cards surface text appears above the card; card text supports player.",
  fields: {
    year: "2024",
    brand: "Metaverse Cards",
    player: "Shohei Ohtani",
    product: "Topps Chrome"
  },
  unresolved: []
});

assert.doesNotMatch(backgroundIgnored.title, /Metaverse Cards/i);
assert.notEqual(backgroundIgnored.fields.brand, "Metaverse Cards");
assert.doesNotMatch(backgroundIgnored.reason, /Metaverse Cards/i);
assert.match(backgroundIgnored.reason, /Background branding ignored/i);

const clearPsaLabel = await callApi({
  title: "2024 Topps Chrome Shohei Ohtani PSA 10",
  confidence: "HIGH",
  reason: "PSA label explicitly supports player, year, product, and grade.",
  fields: {
    year: "2024",
    brand: "Topps Chrome",
    player: "Shohei Ohtani",
    grade_company: "PSA",
    grade: "Gem Mint 10"
  },
  unresolved: []
});

assert.equal(clearPsaLabel.confidence, "HIGH");

const visuallyGuessedParallel = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto 137/199",
  confidence: "HIGH",
  reason: "Player and serial are visible; Fuchsia Wave is visually guessed from foil alone.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(visuallyGuessedParallel.confidence, "MEDIUM");

const missingVisibleSerial = await callApi({
  title: "2025 Bowman Chrome Test Player Fuchsia Wave Auto",
  confidence: "HIGH",
  reason: "Card text explicitly supports player and auto; serial is visible.",
  fields: {
    year: "2025",
    brand: "Bowman Chrome",
    player: "Test Player",
    parallel: "Fuchsia Wave",
    auto: true,
    serial_number: "137/199"
  },
  unresolved: []
});

assert.equal(missingVisibleSerial.confidence, "LOW");
assert.match(missingVisibleSerial.unresolved.join(" "), /title missing serial/);

console.log("listing confidence audit mock tests passed");
